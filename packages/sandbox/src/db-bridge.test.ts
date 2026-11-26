import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  assessDestructiveSql,
  DB_QUERY_TIMEOUT_MS,
  detectWriteQueryTable,
  executePgliteMutation,
  executePgliteQuery,
  exportPgliteSeedSql,
  extractSeedTargetTables,
  introspectPglite,
  MAX_SEED_SQL_BYTES,
  type PgliteQueryable,
  quotePgIdentifier,
  replaySeedSqlWhenReady,
  serializeRowsForBridge,
  sortTablesByForeignKeys,
  toSqlLiteral,
} from "./db-bridge";

describe("sandbox PGlite db-bridge", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.waitReady;
    await db.exec(`
      CREATE TYPE task_status AS ENUM ('todo', 'doing', 'done');
      CREATE TABLE authors (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL
      );
      CREATE TABLE tasks (
        id SERIAL PRIMARY KEY,
        author_id INTEGER NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        status task_status NOT NULL DEFAULT 'todo',
        priority INTEGER DEFAULT 1
      );
      CREATE TABLE audit_logs (
        message TEXT NOT NULL,
        logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO authors (name) VALUES ('Alice'), ('Bob');
      INSERT INTO tasks (author_id, title, status, priority) VALUES
        (1, 'Design schema', 'done', 1),
        (1, 'Build data grid', 'doing', 2),
        (2, 'Write tests', 'todo', 3);
      INSERT INTO audit_logs (message) VALUES ('initialized');
    `);
  });

  afterAll(async () => {
    await db.close();
  });

  it("quotes PostgreSQL identifiers safely", () => {
    expect(quotePgIdentifier("users")).toBe('"users"');
    expect(quotePgIdentifier('my"table')).toBe('"my""table"');
    expect(() => quotePgIdentifier("")).toThrow();
  });

  it("introspects public tables, columns, primary keys, enums, and read-only keyless tables", async () => {
    const res = await introspectPglite(db, "intro-1");
    expect(res.error).toBeUndefined();
    expect(res.tables.map((t) => t.name)).toEqual(["audit_logs", "authors", "tasks"]);

    const tasks = res.tables.find((t) => t.name === "tasks");
    expect(tasks).toBeDefined();
    expect(tasks?.isReadOnly).toBe(false);
    expect(tasks?.rowCount).toBe(3);

    const idCol = tasks?.columns.find((c) => c.name === "id");
    expect(idCol?.isPrimaryKey).toBe(true);
    expect(idCol?.isIdentity).toBe(true);

    const statusCol = tasks?.columns.find((c) => c.name === "status");
    expect(statusCol?.type).toBe("task_status");
    expect(statusCol?.enumValues).toEqual(["todo", "doing", "done"]);

    const auditLogs = res.tables.find((t) => t.name === "audit_logs");
    expect(auditLogs?.isReadOnly).toBe(true);
  });

  it("executes paginated, sorted, and filtered table queries", async () => {
    const page1 = await executePgliteQuery(db, {
      id: "q-1",
      table: "tasks",
      page: 1,
      pageSize: 2,
      sortColumn: "priority",
      sortDirection: "desc",
    });

    expect(page1.error).toBeUndefined();
    expect(page1.totalCount).toBe(3);
    expect(page1.rows).toHaveLength(2);
    expect(page1.rows[0]?.title).toBe("Write tests");

    const filtered = await executePgliteQuery(db, {
      id: "q-2",
      table: "tasks",
      search: "grid",
    });
    expect(filtered.totalCount).toBe(1);
    expect(filtered.rows[0]?.title).toBe("Build data grid");
  });

  it("executes parameterized CRUD mutations and blocks keyless or streaming writes", async () => {
    const insertRes = await executePgliteMutation(db, {
      id: "m-1",
      action: "insert",
      table: "tasks",
      record: { author_id: 2, title: "Verify seed", status: "todo", priority: 4 },
    });
    expect(insertRes.success).toBe(true);
    expect(insertRes.affectedRows).toBe(1);

    const updateRes = await executePgliteMutation(db, {
      id: "m-2",
      action: "update",
      table: "tasks",
      record: { status: "done" },
      where: { id: 4 },
    });
    expect(updateRes.success).toBe(true);

    const keylessRes = await executePgliteMutation(db, {
      id: "m-3",
      action: "delete",
      table: "audit_logs",
      where: { message: "initialized" },
    });
    expect(keylessRes.success).toBe(false);
    expect(keylessRes.error).toContain("no primary key");

    const lockedRes = await executePgliteMutation(db, {
      id: "m-4",
      action: "delete",
      table: "tasks",
      where: { id: 4 },
      readOnly: true,
    });
    expect(lockedRes.success).toBe(false);

    const deleteRes = await executePgliteMutation(db, {
      id: "m-5",
      action: "delete",
      table: "tasks",
      where: { id: 4 },
    });
    expect(deleteRes.success).toBe(true);
  });

  it("enforces SET TRANSACTION READ ONLY for raw SQL queries when readOnly is true", async () => {
    const readRes = await executePgliteQuery(db, {
      id: "ro-1",
      rawSql: "SELECT COUNT(*)::int AS cnt FROM authors;",
      readOnly: true,
    });
    expect(readRes.error).toBeUndefined();
    expect(readRes.rows[0]?.cnt).toBe(2);

    const writeBlocked = await executePgliteQuery(db, {
      id: "ro-2",
      rawSql: "INSERT INTO authors (name) VALUES ('Eve');",
      readOnly: true,
    });
    expect(writeBlocked.error).toBeDefined();
    expect(writeBlocked.error?.toLowerCase()).toContain("read-only");
  });

  it("detects destructive SQL statements and write query tables", () => {
    expect(assessDestructiveSql("SELECT * FROM tasks;").isDestructive).toBe(false);
    expect(assessDestructiveSql("DELETE FROM tasks WHERE id = 1;").isDestructive).toBe(false);
    expect(assessDestructiveSql("DROP TABLE tasks;").isDestructive).toBe(true);
    expect(assessDestructiveSql("TRUNCATE tasks;").isDestructive).toBe(true);
    expect(assessDestructiveSql("DELETE FROM tasks;").isDestructive).toBe(true);

    expect(detectWriteQueryTable("INSERT INTO tasks (title) VALUES ('x')")).toEqual({
      isWrite: true,
      table: "tasks",
    });
    expect(detectWriteQueryTable("SELECT * FROM tasks")).toEqual({ isWrite: false });
  });

  it("sorts tables topologically and exports idempotent seed SQL with sequence resets", async () => {
    const order = sortTablesByForeignKeys(
      ["tasks", "authors"],
      [{ childTable: "tasks", parentTable: "authors" }]
    );
    expect(order.indexOf("authors")).toBeLessThan(order.indexOf("tasks"));

    const seedRes = await exportPgliteSeedSql(db, "seed-1");
    expect(seedRes.error).toBeUndefined();
    expect(seedRes.tableCount).toBe(3);
    expect(seedRes.rowCount).toBe(6);

    const authorsInsertIdx = seedRes.sql.indexOf('INSERT INTO "authors"');
    const tasksInsertIdx = seedRes.sql.indexOf('INSERT INTO "tasks"');
    expect(authorsInsertIdx).toBeGreaterThan(-1);
    expect(tasksInsertIdx).toBeGreaterThan(authorsInsertIdx);
    expect(seedRes.sql).toContain("pg_get_serial_sequence('tasks', 'id')");
    expect(seedRes.sql).toContain("ON CONFLICT DO NOTHING");

    // Replaying seed.sql against existing data must succeed idempotently
    await expect(db.exec(seedRes.sql)).resolves.toBeDefined();
  });

  it("defers seed.sql replay until target tables exist and replays rows + sequence cleanly", async () => {
    const freshDb = new PGlite();
    await freshDb.waitReady;
    try {
      const seedSql = [
        'INSERT INTO "demo_items" ("id", "name") VALUES (2, \'Seed A\') ON CONFLICT DO NOTHING;',
        'INSERT INTO "demo_items" ("id", "name") VALUES (5, \'Seed B\') ON CONFLICT DO NOTHING;',
        'SELECT setval(pg_get_serial_sequence(\'demo_items\', \'id\'), COALESCE((SELECT MAX("id") FROM "demo_items"), 1), (SELECT COUNT(*) > 0 FROM "demo_items"));',
      ].join("\n");

      expect(extractSeedTargetTables(seedSql)).toEqual(["demo_items"]);

      // Before DDL creates demo_items, replay must safely defer (return false, not throw)
      await expect(replaySeedSqlWhenReady(freshDb, seedSql)).resolves.toBe(false);

      // Once DDL creates demo_items, replay succeeds and restores seeded rows + sequence
      await freshDb.exec(
        "CREATE TABLE IF NOT EXISTS demo_items (id SERIAL PRIMARY KEY, name TEXT NOT NULL);"
      );
      await expect(replaySeedSqlWhenReady(freshDb, seedSql)).resolves.toBe(true);

      const rowsRes = await freshDb.query<{ id: number; name: string }>(
        "SELECT id, name FROM demo_items ORDER BY id ASC"
      );
      expect(rowsRes.rows).toEqual([
        { id: 2, name: "Seed A" },
        { id: 5, name: "Seed B" },
      ]);

      // Next auto-generated ID must be > 5 because setval ran
      const inserted = await freshDb.query<{ id: number }>(
        "INSERT INTO demo_items (name) VALUES ('Next') RETURNING id"
      );
      expect(inserted.rows[0]?.id).toBeGreaterThan(5);
    } finally {
      await freshDb.close();
    }
  });

  // covers: AC-3, AC-8
  it("formats SQL literals and bridge-safe row values across special PostgreSQL types", () => {
    const dt = new Date("2026-11-25T08:00:00.000Z");
    const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);

    expect(toSqlLiteral(null)).toBe("NULL");
    expect(toSqlLiteral(true)).toBe("TRUE");
    expect(toSqlLiteral(false)).toBe("FALSE");
    expect(toSqlLiteral(Number.NaN)).toBe("NULL");
    expect(toSqlLiteral(BigInt("9007199254740993"))).toBe("9007199254740993");
    expect(toSqlLiteral(dt)).toBe("'2026-11-25T08:00:00.000Z'");
    expect(toSqlLiteral(bytes)).toBe("'\\xdeadbeef'::bytea");
    expect(toSqlLiteral({ tag: "a'b" }, "jsonb")).toBe(`'{"tag":"a''b"}'::jsonb`);
    expect(toSqlLiteral("O'Reilly")).toBe("'O''Reilly'");

    expect(
      serializeRowsForBridge([{ created_at: dt, total: BigInt(42), payload: bytes, name: "ok" }])
    ).toEqual([
      {
        created_at: "2026-11-25T08:00:00.000Z",
        total: "42",
        payload: [0xde, 0xad, 0xbe, 0xef],
        name: "ok",
      },
    ]);
  });

  // covers: AC-3
  it("handles empty rawSql, unknown tables, and 10-second query timeout gracefully", async () => {
    const emptySql = await executePgliteQuery(db, { id: "err-1", rawSql: "   " });
    expect(emptySql.error).toBe("SQL query cannot be empty");

    const missingTbl = await executePgliteQuery(db, { id: "err-2", table: "does_not_exist" });
    expect(missingTbl.error).toContain("does_not_exist");

    // 10-second timeout test using fake timers and a hanging queryable
    vi.useFakeTimers();
    try {
      const slowDb: PgliteQueryable = {
        exec: () => new Promise(() => {}),
        query: () => new Promise(() => {}),
      };
      const promise = executePgliteQuery(slowDb, {
        id: "timeout-1",
        rawSql: "SELECT pg_sleep(20);",
      });
      await vi.advanceTimersByTimeAsync(DB_QUERY_TIMEOUT_MS);
      const timedOut = await promise;
      expect(timedOut.error).toContain("timed out after 10 seconds");
    } finally {
      vi.useRealTimers();
    }
  });

  // covers: AC-5
  it("enforces complete primary keys on composite-PK tables and rejects empty updates", async () => {
    await db.exec(`
      CREATE TABLE memberships (
        org_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        PRIMARY KEY (org_id, user_id)
      );
      INSERT INTO memberships (org_id, user_id, role) VALUES (1, 10, 'member');
    `);

    const partialPk = await executePgliteMutation(db, {
      id: "comp-1",
      action: "update",
      table: "memberships",
      record: { role: "admin" },
      where: { org_id: 1 },
    });
    expect(partialPk.success).toBe(false);
    expect(partialPk.error).toContain("complete primary key");

    const emptyUpdate = await executePgliteMutation(db, {
      id: "comp-2",
      action: "update",
      table: "memberships",
      record: {},
      where: { org_id: 1, user_id: 10 },
    });
    expect(emptyUpdate.success).toBe(false);
    expect(emptyUpdate.error).toContain("at least one column value");

    const validCompUpdate = await executePgliteMutation(db, {
      id: "comp-3",
      action: "update",
      table: "memberships",
      record: { role: "admin" },
      where: { org_id: 1, user_id: 10 },
    });
    expect(validCompUpdate.success).toBe(true);

    await db.exec("DROP TABLE memberships;");
  });

  // covers: AC-7, AC-8
  it("ignores SQL comments and string literals in destructive check and enforces 500KB seed cap", async () => {
    expect(
      assessDestructiveSql(
        "-- DROP TABLE users;\n/* TRUNCATE tasks; */\nSELECT 'DELETE FROM tasks';"
      ).isDestructive
    ).toBe(false);

    const emptySeedDb = new PGlite();
    await emptySeedDb.waitReady;
    try {
      const emptySeed = await exportPgliteSeedSql(emptySeedDb, "seed-empty");
      expect(emptySeed.tableCount).toBe(0);
      expect(emptySeed.rowCount).toBe(0);
      expect(emptySeed.sql).toContain("No tables found");
    } finally {
      await emptySeedDb.close();
    }

    const oversizedDb: PgliteQueryable = {
      query: async <T = Record<string, unknown>>(sql: string): Promise<{ rows: T[] }> => {
        if (sql.includes("information_schema.tables")) {
          return { rows: [{ table_name: "big_tbl" }] as unknown as T[] };
        }
        if (sql.includes("information_schema.columns")) {
          return {
            rows: [
              {
                table_name: "big_tbl",
                column_name: "payload",
                data_type: "text",
                udt_name: "text",
                is_nullable: "NO",
                column_default: null,
                is_identity: "NO",
              },
            ] as unknown as T[],
          };
        }
        if (sql.includes("pg_index") || sql.includes("pg_enum") || sql.includes("FOREIGN KEY")) {
          return { rows: [] as T[] };
        }
        if (sql.includes("COUNT(*)")) {
          return { rows: [{ count: 1 }] as unknown as T[] };
        }
        return { rows: [{ payload: "x".repeat(MAX_SEED_SQL_BYTES + 100) }] as unknown as T[] };
      },
      exec: async () => [],
    };
    const overLimit = await exportPgliteSeedSql(oversizedDb, "seed-big");
    expect(overLimit.error).toContain("500KB");
  });
});
