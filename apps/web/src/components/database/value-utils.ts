import type { DbColumnMetadata } from "@spark/shared";

export function isIntegerType(pgType: string): boolean {
  const normalized = pgType.toLowerCase();
  return (
    normalized === "integer" ||
    normalized === "int" ||
    normalized === "int2" ||
    normalized === "int4" ||
    normalized === "int8" ||
    normalized === "smallint" ||
    normalized === "bigint" ||
    normalized === "serial" ||
    normalized === "bigserial"
  );
}

export function isNumericType(pgType: string): boolean {
  const normalized = pgType.toLowerCase();
  return (
    isIntegerType(normalized) ||
    normalized === "numeric" ||
    normalized === "decimal" ||
    normalized === "real" ||
    normalized === "double precision" ||
    normalized === "float4" ||
    normalized === "float8"
  );
}

export function isBooleanType(pgType: string): boolean {
  const normalized = pgType.toLowerCase();
  return normalized === "boolean" || normalized === "bool";
}

export function isJsonType(pgType: string): boolean {
  const normalized = pgType.toLowerCase();
  return normalized === "json" || normalized === "jsonb";
}

export function parseAndValidateCellValue(
  raw: string,
  column: DbColumnMetadata,
  treatEmptyAsNull = true
): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = raw.trim();

  if (treatEmptyAsNull && raw === "") {
    if (column.nullable) {
      return { ok: true, value: null };
    }
    return { ok: false, error: `${column.name} cannot be empty` };
  }

  if (isBooleanType(column.type)) {
    const lower = trimmed.toLowerCase();
    if (lower === "true" || lower === "t" || lower === "1") {
      return { ok: true, value: true };
    }
    if (lower === "false" || lower === "f" || lower === "0") {
      return { ok: true, value: false };
    }
    return { ok: false, error: "Expected boolean (true or false)" };
  }

  if (isNumericType(column.type)) {
    if (!trimmed) {
      return column.nullable
        ? { ok: true, value: null }
        : { ok: false, error: "Expected a numeric value" };
    }
    const num = Number(trimmed);
    if (!Number.isFinite(num)) {
      return { ok: false, error: `Expected a valid ${column.type} number` };
    }
    if (isIntegerType(column.type) && !Number.isInteger(num)) {
      return { ok: false, error: `Expected a whole integer for ${column.type}` };
    }
    return { ok: true, value: num };
  }

  if (isJsonType(column.type)) {
    try {
      const parsed = JSON.parse(raw);
      return { ok: true, value: parsed };
    } catch {
      return { ok: false, error: "Invalid JSON syntax" };
    }
  }

  if (column.enumValues && column.enumValues.length > 0) {
    if (!column.enumValues.includes(raw)) {
      return { ok: false, error: `Must be one of: ${column.enumValues.join(", ")}` };
    }
  }

  return { ok: true, value: raw };
}

export function valueToInputString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function extractPrimaryKeyWhere(
  row: Record<string, unknown>,
  columns: DbColumnMetadata[]
): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  for (const col of columns) {
    if (col.isPrimaryKey) {
      where[col.name] = row[col.name];
    }
  }
  return where;
}
