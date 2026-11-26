import type {
  DbColumnMetadata,
  DbExportSeedResponsePayload,
  DbIntrospectResponsePayload,
  DbMutateRequestPayload,
  DbMutateResponsePayload,
  DbQueryRequestPayload,
  DbQueryResponsePayload,
  DbTableMetadata,
} from "@spark/shared";

/**
 * Minimal PGlite-compatible interface so db-bridge helpers work cleanly across
 * both host tests (@electric-sql/pglite) and sandbox runtime without bundling
 * PGlite directly into @spark/sandbox.
 */
export interface PgliteQueryable {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<{
    rows: T[];
    fields?: Array<{ name: string; dataTypeID?: number }>;
    affectedRows?: number;
  }>;
  exec(sql: string): Promise<
    Array<{
      rows: Record<string, unknown>[];
      fields?: Array<{ name: string; dataTypeID?: number }>;
      affectedRows?: number;
    }>
  >;
}

export interface DestructiveSqlAssessment {
  isDestructive: boolean;
  reasons: string[];
}

export const DB_QUERY_TIMEOUT_MS = 10_000;
export const MAX_SEED_SQL_BYTES = 500 * 1024;

/**
 * Safely quote a PostgreSQL identifier (table or column name) to prevent SQL injection.
 */
export function quotePgIdentifier(identifier: string): string {
  if (!identifier || typeof identifier !== "string") {
    throw new Error("SQL identifier must be a non-empty string");
  }
  return `"${identifier.replace(/"/g, '""')}"`;
}

/**
 * Escape a JavaScript value into a PostgreSQL SQL literal for seed.sql export.
 */
export function toSqlLiteral(value: unknown, columnType?: string): string {
  if (value === null || value === undefined) {
    return "NULL";
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "NULL";
    return String(value);
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Date) {
    return `'${value.toISOString().replace(/'/g, "''")}'`;
  }
  if (value instanceof Uint8Array) {
    const hex = Array.from(value)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return `'\\x${hex}'::bytea`;
  }
  if (typeof value === "object") {
    const json = JSON.stringify(value).replace(/'/g, "''");
    return columnType?.includes("json") ? `'${json}'::${columnType}` : `'${json}'`;
  }
  const str = String(value).replace(/'/g, "''");
  return `'${str}'`;
}

/**
 * Strip single-line and block SQL comments and string literals before scanning
 * for destructive DDL/DML commands.
 */
function stripSqlCommentsAndLiterals(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:''|[^'])*'/g, "''");
}

/**
 * Detect whether a SQL script contains destructive commands (DROP, TRUNCATE,
 * or DELETE without a WHERE clause).
 */
export function assessDestructiveSql(rawSql: string): DestructiveSqlAssessment {
  const cleaned = stripSqlCommentsAndLiterals(rawSql);
  const statements = cleaned
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  const reasons: string[] = [];

  for (const stmt of statements) {
    if (/^\s*DROP\s+(TABLE|SCHEMA|DATABASE|INDEX|VIEW|TYPE)\b/i.test(stmt)) {
      reasons.push("DROP statement removes database objects permanently");
    } else if (/^\s*TRUNCATE\b/i.test(stmt)) {
      reasons.push("TRUNCATE statement removes all rows from a table");
    } else if (/^\s*DELETE\s+FROM\b/i.test(stmt) && !/\bWHERE\b/i.test(stmt)) {
      reasons.push("DELETE without a WHERE clause removes every row in the table");
    }
  }

  return {
    isDestructive: reasons.length > 0,
    reasons: Array.from(new Set(reasons)),
  };
}

/**
 * Detect whether a SQL string performs writes or DDL so app/viewer reactivity
 * can emit DB_MUTATED_EVENT automatically.
 */
export function detectWriteQueryTable(rawSql: string): { isWrite: boolean; table?: string } {
  const cleaned = stripSqlCommentsAndLiterals(rawSql).trim();
  if (!cleaned) return { isWrite: false };

  const writeMatch = cleaned.match(
    /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE\s+(?:TABLE\s+)?|CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?|ALTER\s+TABLE|DROP\s+TABLE(?:\s+IF\s+EXISTS)?)\s+(?:"?public"?\.)?"?([a-zA-Z_][a-zA-Z0-9_$]*)"?/i
  );

  if (writeMatch) {
    return { isWrite: true, table: writeMatch[2] };
  }

  if (/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/i.test(cleaned)) {
    return { isWrite: true };
  }

  return { isWrite: false };
}

/**
 * Normalize values from PGlite rows for safe postMessage structured cloning.
 */
export function serializeRowsForBridge(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(row)) {
      if (val instanceof Date) {
        out[key] = val.toISOString();
      } else if (typeof val === "bigint") {
        out[key] = val.toString();
      } else if (val instanceof Uint8Array) {
        out[key] = Array.from(val);
      } else {
        out[key] = val;
      }
    }
    return out;
  });
}

/**
 * Run a promise with a hard timeout so runaway queries cannot hang the browser tab.
 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs = DB_QUERY_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Query timed out after ${Math.round(timeoutMs / 1000)} seconds`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/**
 * Introspect all public tables, columns, primary keys, identity columns, enums, and row counts.
 */
export async function introspectPglite(
  db: PgliteQueryable,
  requestId: string
): Promise<DbIntrospectResponsePayload> {
  try {
    const tablesRes = await db.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name ASC`
    );

    const columnsRes = await db.query<{
      table_name: string;
      column_name: string;
      data_type: string;
      udt_name: string;
      is_nullable: string;
      column_default: string | null;
      is_identity: string;
    }>(
      `SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default, is_identity
       FROM information_schema.columns
       WHERE table_schema = 'public'
       ORDER BY table_name ASC, ordinal_position ASC`
    );

    const pkRes = await db.query<{ table_name: string; column_name: string }>(
      `SELECT c.relname AS table_name, a.attname AS column_name
       FROM pg_index i
       JOIN pg_class c ON c.oid = i.indrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
       WHERE n.nspname = 'public' AND i.indisprimary`
    );

    const enumRes = await db.query<{ type_name: string; enum_label: string }>(
      `SELECT t.typname AS type_name, e.enumlabel AS enum_label
       FROM pg_type t
       JOIN pg_enum e ON t.oid = e.enumtypid
       JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = 'public'
       ORDER BY t.typname ASC, e.enumsortorder ASC`
    );

    const pkByTable = new Map<string, Set<string>>();
    for (const row of pkRes.rows) {
      const set = pkByTable.get(row.table_name) ?? new Set<string>();
      set.add(row.column_name);
      pkByTable.set(row.table_name, set);
    }

    const enumValuesByType = new Map<string, string[]>();
    for (const row of enumRes.rows) {
      const list = enumValuesByType.get(row.type_name) ?? [];
      list.push(row.enum_label);
      enumValuesByType.set(row.type_name, list);
    }

    const columnsByTable = new Map<string, DbColumnMetadata[]>();
    for (const col of columnsRes.rows) {
      const pks = pkByTable.get(col.table_name);
      const isPrimaryKey = Boolean(pks?.has(col.column_name));
      const isSerialDefault = Boolean(col.column_default?.startsWith("nextval("));
      const isIdentity = col.is_identity === "YES" || isSerialDefault;
      const resolvedType = col.data_type === "USER-DEFINED" ? col.udt_name : col.data_type;
      const enumValues = enumValuesByType.get(col.udt_name);

      const meta: DbColumnMetadata = {
        name: col.column_name,
        type: resolvedType,
        nullable: col.is_nullable === "YES",
        isPrimaryKey,
        isIdentity,
        defaultValue: col.column_default,
        ...(enumValues ? { enumValues } : {}),
      };

      const list = columnsByTable.get(col.table_name) ?? [];
      list.push(meta);
      columnsByTable.set(col.table_name, list);
    }

    const tables: DbTableMetadata[] = [];
    for (const tbl of tablesRes.rows) {
      const tableName = tbl.table_name;
      const cols = columnsByTable.get(tableName) ?? [];
      const hasPk = cols.some((c) => c.isPrimaryKey);
      let rowCount = 0;
      try {
        const countRes = await db.query<{ count: number }>(
          `SELECT COUNT(*)::int AS count FROM ${quotePgIdentifier(tableName)}`
        );
        rowCount = Number(countRes.rows[0]?.count ?? 0);
      } catch {
        rowCount = 0;
      }

      tables.push({
        name: tableName,
        isReadOnly: !hasPk,
        rowCount,
        columns: cols,
      });
    }

    return {
      id: requestId,
      tables,
    };
  } catch (err: unknown) {
    return {
      id: requestId,
      tables: [],
      error: err instanceof Error ? err.message : "Failed to introspect database",
    };
  }
}

/**
 * Execute either a structured paginated table browse query or a raw SQL console query
 * with a 10-second execution timeout and optional engine-level READ ONLY transaction guard.
 */
export async function executePgliteQuery(
  db: PgliteQueryable,
  req: DbQueryRequestPayload
): Promise<DbQueryResponsePayload> {
  const start = typeof performance !== "undefined" ? performance.now() : Date.now();

  try {
    return await withTimeout(
      (async () => {
        await db.exec("SET statement_timeout = '10s'");

        if (req.rawSql !== undefined) {
          const trimmed = req.rawSql.trim();
          if (!trimmed) {
            return {
              id: req.id,
              rows: [],
              totalCount: 0,
              executionTimeMs: 0,
              columns: [],
              error: "SQL query cannot be empty",
            };
          }

          if (req.readOnly) {
            await db.exec("BEGIN");
            try {
              await db.exec("SET TRANSACTION READ ONLY");
              const results = await db.exec(trimmed);
              await db.exec("COMMIT");
              const lastResult = results[results.length - 1];
              const rows = serializeRowsForBridge(lastResult?.rows ?? []);
              const columns =
                lastResult?.fields?.map((f) => f.name) ?? (rows[0] ? Object.keys(rows[0]) : []);
              const elapsed = Math.round(
                (typeof performance !== "undefined" ? performance.now() : Date.now()) - start
              );
              return {
                id: req.id,
                rows,
                totalCount: rows.length,
                executionTimeMs: elapsed,
                columns,
                affectedRows: lastResult?.affectedRows,
              };
            } catch (txErr) {
              try {
                await db.exec("ROLLBACK");
              } catch {
                // Ignore rollback cleanup failure
              }
              throw txErr;
            }
          }

          const results = await db.exec(trimmed);
          const lastResult = results[results.length - 1];
          const rows = serializeRowsForBridge(lastResult?.rows ?? []);
          const columns =
            lastResult?.fields?.map((f) => f.name) ?? (rows[0] ? Object.keys(rows[0]) : []);
          const elapsed = Math.round(
            (typeof performance !== "undefined" ? performance.now() : Date.now()) - start
          );
          return {
            id: req.id,
            rows,
            totalCount: rows.length,
            executionTimeMs: elapsed,
            columns,
            affectedRows: lastResult?.affectedRows,
          };
        }

        if (!req.table) {
          throw new Error("Either table or rawSql must be provided");
        }

        // Verify table and columns against information_schema before quoting
        const colRes = await db.query<{ column_name: string }>(
          `SELECT column_name
           FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = $1
           ORDER BY ordinal_position ASC`,
          [req.table]
        );
        const validColumns = colRes.rows.map((r) => r.column_name);
        if (validColumns.length === 0) {
          throw new Error(`Table "${req.table}" not found in public schema`);
        }

        const safeTable = quotePgIdentifier(req.table);
        const page = Math.max(1, req.page ?? 1);
        const pageSize = Math.min(Math.max(1, req.pageSize ?? 25), 200);
        const offset = (page - 1) * pageSize;

        const params: unknown[] = [];
        let whereClause = "";
        const searchTerm = req.search?.trim();
        if (searchTerm) {
          params.push(`%${searchTerm}%`);
          const searchClauses = validColumns.map(
            (col) => `CAST(${quotePgIdentifier(col)} AS TEXT) ILIKE $1`
          );
          whereClause = `WHERE (${searchClauses.join(" OR ")})`;
        }

        let orderByClause = "";
        if (req.sortColumn && validColumns.includes(req.sortColumn)) {
          const dir = req.sortDirection === "desc" ? "DESC" : "ASC";
          orderByClause = `ORDER BY ${quotePgIdentifier(req.sortColumn)} ${dir}`;
        }

        const countRes = await db.query<{ total: number }>(
          `SELECT COUNT(*)::int AS total FROM ${safeTable} ${whereClause}`,
          params
        );
        const totalCount = Number(countRes.rows[0]?.total ?? 0);

        const limitParamIdx = params.length + 1;
        const offsetParamIdx = params.length + 2;
        const dataRes = await db.query(
          `SELECT * FROM ${safeTable} ${whereClause} ${orderByClause} LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}`,
          [...params, pageSize, offset]
        );

        const elapsed = Math.round(
          (typeof performance !== "undefined" ? performance.now() : Date.now()) - start
        );

        return {
          id: req.id,
          rows: serializeRowsForBridge(dataRes.rows),
          totalCount,
          executionTimeMs: elapsed,
          columns: validColumns,
        };
      })(),
      DB_QUERY_TIMEOUT_MS
    );
  } catch (err: unknown) {
    const elapsed = Math.round(
      (typeof performance !== "undefined" ? performance.now() : Date.now()) - start
    );
    return {
      id: req.id,
      rows: [],
      totalCount: 0,
      executionTimeMs: elapsed,
      error: err instanceof Error ? err.message : "Query execution failed",
    };
  }
}

/**
 * Execute a parameterized INSERT, UPDATE, or DELETE mutation against PGlite.
 * Enforces non-empty primary key WHERE clauses for UPDATE and DELETE.
 */
export async function executePgliteMutation(
  db: PgliteQueryable,
  req: DbMutateRequestPayload
): Promise<DbMutateResponsePayload> {
  if (req.readOnly) {
    return {
      id: req.id,
      success: false,
      affectedRows: 0,
      error: "Database mutations are disabled while AI generation is streaming",
    };
  }

  try {
    // Verify table columns & primary keys from catalog
    const introspected = await introspectPglite(db, req.id);
    const tableMeta = introspected.tables.find((t) => t.name === req.table);
    if (!tableMeta) {
      throw new Error(`Table "${req.table}" does not exist`);
    }

    const validColNames = new Set(tableMeta.columns.map((c) => c.name));
    const pkColumns = tableMeta.columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
    const safeTable = quotePgIdentifier(req.table);

    if (req.action === "insert") {
      const record = req.record ?? {};
      const entries = Object.entries(record).filter(
        ([col, val]) => validColNames.has(col) && val !== undefined
      );

      if (entries.length === 0) {
        const res = await db.query(`INSERT INTO ${safeTable} DEFAULT VALUES RETURNING *`);
        return {
          id: req.id,
          success: true,
          affectedRows: res.affectedRows ?? res.rows.length ?? 1,
        };
      }

      const colsSql = entries.map(([col]) => quotePgIdentifier(col)).join(", ");
      const placeholders = entries.map((_, idx) => `$${idx + 1}`).join(", ");
      const values = entries.map(([, val]) => val);

      const res = await db.query(
        `INSERT INTO ${safeTable} (${colsSql}) VALUES (${placeholders}) RETURNING *`,
        values
      );

      return {
        id: req.id,
        success: true,
        affectedRows: res.affectedRows ?? res.rows.length ?? 1,
      };
    }

    if (tableMeta.isReadOnly || pkColumns.length === 0) {
      throw new Error(`Table "${req.table}" has no primary key and is read only`);
    }

    const where = req.where ?? {};
    const whereEntries = Object.entries(where).filter(([col]) => pkColumns.includes(col));
    if (whereEntries.length === 0 || whereEntries.length !== pkColumns.length) {
      throw new Error("Mutations require complete primary key values in the WHERE clause");
    }

    if (req.action === "update") {
      const record = req.record ?? {};
      const updateEntries = Object.entries(record).filter(
        ([col, val]) => validColNames.has(col) && val !== undefined
      );
      if (updateEntries.length === 0) {
        throw new Error("Update requires at least one column value");
      }

      const setSql = updateEntries
        .map(([col], idx) => `${quotePgIdentifier(col)} = $${idx + 1}`)
        .join(", ");
      const whereSql = whereEntries
        .map(([col], idx) => `${quotePgIdentifier(col)} = $${updateEntries.length + idx + 1}`)
        .join(" AND ");
      const values = [...updateEntries.map(([, v]) => v), ...whereEntries.map(([, v]) => v)];

      const res = await db.query(`UPDATE ${safeTable} SET ${setSql} WHERE ${whereSql}`, values);

      return {
        id: req.id,
        success: true,
        affectedRows: res.affectedRows ?? 1,
      };
    }

    if (req.action === "delete") {
      const whereSql = whereEntries
        .map(([col], idx) => `${quotePgIdentifier(col)} = $${idx + 1}`)
        .join(" AND ");
      const values = whereEntries.map(([, v]) => v);

      const res = await db.query(`DELETE FROM ${safeTable} WHERE ${whereSql}`, values);
      return {
        id: req.id,
        success: true,
        affectedRows: res.affectedRows ?? 1,
      };
    }

    throw new Error(`Unsupported mutation action: ${String(req.action)}`);
  } catch (err: unknown) {
    return {
      id: req.id,
      success: false,
      affectedRows: 0,
      error: err instanceof Error ? err.message : "Database mutation failed",
    };
  }
}

/**
 * Topologically sort tables so parent tables referenced by foreign keys come
 * before child tables. Cycles are broken deterministically.
 */
export function sortTablesByForeignKeys(
  tableNames: string[],
  edges: Array<{ childTable: string; parentTable: string }>
): string[] {
  const deps = new Map<string, Set<string>>();
  for (const name of tableNames) {
    deps.set(name, new Set());
  }
  for (const edge of edges) {
    if (
      edge.childTable !== edge.parentTable &&
      deps.has(edge.childTable) &&
      deps.has(edge.parentTable)
    ) {
      deps.get(edge.childTable)?.add(edge.parentTable);
    }
  }

  const ordered: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const visit = (node: string) => {
    if (visited.has(node) || visiting.has(node)) return;
    visiting.add(node);
    const parents = Array.from(deps.get(node) ?? []).sort();
    for (const parent of parents) {
      visit(parent);
    }
    visiting.delete(node);
    visited.add(node);
    ordered.push(node);
  };

  for (const name of [...tableNames].sort()) {
    visit(name);
  }

  return ordered;
}

/**
 * Serialize all public tables and rows into an idempotent SQL seed script
 * ordered by foreign keys with sequence resets.
 */
export async function exportPgliteSeedSql(
  db: PgliteQueryable,
  requestId: string
): Promise<DbExportSeedResponsePayload> {
  try {
    const introspected = await introspectPglite(db, requestId);
    if (introspected.error) {
      throw new Error(introspected.error);
    }

    const tables = introspected.tables;
    if (tables.length === 0) {
      return {
        id: requestId,
        sql: "-- No tables found in public schema\n",
        tableCount: 0,
        rowCount: 0,
      };
    }

    const fkRes = await db.query<{ child_table: string; parent_table: string }>(
      `SELECT DISTINCT tc.table_name AS child_table, ccu.table_name AS parent_table
       FROM information_schema.table_constraints tc
       JOIN information_schema.constraint_column_usage ccu
         ON tc.constraint_name = ccu.constraint_name
        AND tc.table_schema = ccu.table_schema
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND tc.table_schema = 'public'
         AND ccu.table_schema = 'public'`
    );

    const sortedTableNames = sortTablesByForeignKeys(
      tables.map((t) => t.name),
      fkRes.rows.map((r) => ({ childTable: r.child_table, parentTable: r.parent_table }))
    );

    const tableMap = new Map(tables.map((t) => [t.name, t]));
    const lines: string[] = [
      "-- Sparkweb generated database seed",
      `-- Exported at ${new Date().toISOString()}`,
      "",
    ];

    let totalRows = 0;

    for (const tableName of sortedTableNames) {
      const meta = tableMap.get(tableName);
      if (!meta || meta.columns.length === 0) continue;

      const pkCols = meta.columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
      const orderSql =
        pkCols.length > 0
          ? `ORDER BY ${pkCols.map((c) => quotePgIdentifier(c)).join(", ")} ASC`
          : "";

      const dataRes = await db.query(`SELECT * FROM ${quotePgIdentifier(tableName)} ${orderSql}`);

      if (dataRes.rows.length > 0) {
        lines.push(`-- Table: ${tableName} (${dataRes.rows.length} rows)`);
        const colNamesSql = meta.columns.map((c) => quotePgIdentifier(c.name)).join(", ");
        const conflictSuffix = pkCols.length > 0 ? " ON CONFLICT DO NOTHING" : "";

        for (const row of dataRes.rows) {
          const valsSql = meta.columns
            .map((col) => toSqlLiteral(row[col.name], col.type))
            .join(", ");
          lines.push(
            `INSERT INTO ${quotePgIdentifier(tableName)} (${colNamesSql}) VALUES (${valsSql})${conflictSuffix};`
          );
          totalRows++;
        }
        lines.push("");
      }

      // Reset identity / serial sequences safely
      for (const col of meta.columns) {
        if (col.isIdentity) {
          const escapedTable = tableName.replace(/'/g, "''");
          const escapedCol = col.name.replace(/'/g, "''");
          const qTable = quotePgIdentifier(tableName);
          const qCol = quotePgIdentifier(col.name);
          lines.push(
            `SELECT setval(pg_get_serial_sequence('${escapedTable}', '${escapedCol}'), COALESCE((SELECT MAX(${qCol}) FROM ${qTable}), 1), (SELECT COUNT(*) > 0 FROM ${qTable}));`
          );
        }
      }
    }

    const sqlText = `${lines.join("\n").trimEnd()}\n`;
    const byteLength = new TextEncoder().encode(sqlText).byteLength;
    if (byteLength > MAX_SEED_SQL_BYTES) {
      throw new Error(
        `Exported seed.sql (${Math.round(byteLength / 1024)}KB) exceeds the 500KB limit`
      );
    }

    return {
      id: requestId,
      sql: sqlText,
      tableCount: sortedTableNames.length,
      rowCount: totalRows,
    };
  } catch (err: unknown) {
    return {
      id: requestId,
      sql: "",
      tableCount: 0,
      rowCount: 0,
      error: err instanceof Error ? err.message : "Failed to export seed data",
    };
  }
}

/**
 * Extract target table names from INSERT statements in seed.sql so seed replay
 * can wait until all required tables have been created by application DDL.
 */
export function extractSeedTargetTables(seedSql: string): string[] {
  const tables = new Set<string>();
  const insertRegex =
    /\bINSERT\s+INTO\s+(?:"?public"?\.)?(?:"((?:[^"]|"")+)"|([a-zA-Z_][a-zA-Z0-9_$]*))/gi;
  let match = insertRegex.exec(seedSql);
  while (match !== null) {
    const rawName = match[1] ? match[1].replace(/""/g, '"') : match[2];
    if (rawName) {
      tables.add(rawName);
    }
    match = insertRegex.exec(seedSql);
  }
  return Array.from(tables);
}

/**
 * Execute seed.sql against PGlite only once every target table referenced in the
 * seed script exists in the public schema. Returns true when seed was applied.
 */
export async function replaySeedSqlWhenReady(
  db: PgliteQueryable,
  seedSql: string
): Promise<boolean> {
  const trimmed = seedSql.trim();
  if (!trimmed) {
    return false;
  }

  const requiredTables = extractSeedTargetTables(trimmed);
  if (requiredTables.length === 0) {
    return false;
  }

  const tablesRes = await db.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
  );
  const existingTables = new Set(tablesRes.rows.map((r) => r.table_name));
  const allReady = requiredTables.every((tbl) => existingTables.has(tbl));
  if (!allReady) {
    return false;
  }

  await db.exec(trimmed);
  return true;
}
