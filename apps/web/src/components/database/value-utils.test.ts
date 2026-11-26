import type { DbColumnMetadata } from "@spark/shared";
import { describe, expect, it } from "vitest";
import {
  extractPrimaryKeyWhere,
  isBooleanType,
  isIntegerType,
  isJsonType,
  isNumericType,
  parseAndValidateCellValue,
  valueToInputString,
} from "./value-utils";

function makeColumn(overrides: Partial<DbColumnMetadata> = {}): DbColumnMetadata {
  return {
    name: "col",
    type: "text",
    nullable: false,
    isPrimaryKey: false,
    isIdentity: false,
    defaultValue: null,
    ...overrides,
  };
}

describe("database value-utils", () => {
  it("classifies PostgreSQL integer, numeric, boolean, and json type aliases", () => {
    expect(isIntegerType("int4")).toBe(true);
    expect(isIntegerType("SERIAL")).toBe(true);
    expect(isIntegerType("numeric")).toBe(false);

    expect(isNumericType("integer")).toBe(true);
    expect(isNumericType("double precision")).toBe(true);
    expect(isNumericType("text")).toBe(false);

    expect(isBooleanType("boolean")).toBe(true);
    expect(isBooleanType("bool")).toBe(true);
    expect(isBooleanType("text")).toBe(false);

    expect(isJsonType("json")).toBe(true);
    expect(isJsonType("jsonb")).toBe(true);
    expect(isJsonType("text")).toBe(false);
  });

  // covers: AC-5
  it("handles empty string validation for nullable vs non-nullable columns", () => {
    const nullableCol = makeColumn({ name: "bio", nullable: true });
    const requiredCol = makeColumn({ name: "email", nullable: false });

    expect(parseAndValidateCellValue("", nullableCol, true)).toEqual({ ok: true, value: null });
    expect(parseAndValidateCellValue("", requiredCol, true)).toEqual({
      ok: false,
      error: "email cannot be empty",
    });
    expect(parseAndValidateCellValue("", requiredCol, false)).toEqual({ ok: true, value: "" });
  });

  // covers: AC-5
  it("parses boolean, integer, decimal, json, and enum cell values with type errors", () => {
    const boolCol = makeColumn({ name: "active", type: "bool" });
    expect(parseAndValidateCellValue("t", boolCol)).toEqual({ ok: true, value: true });
    expect(parseAndValidateCellValue("0", boolCol)).toEqual({ ok: true, value: false });
    expect(parseAndValidateCellValue("yes", boolCol).ok).toBe(false);

    const intCol = makeColumn({ name: "qty", type: "int4" });
    expect(parseAndValidateCellValue("42", intCol)).toEqual({ ok: true, value: 42 });
    expect(parseAndValidateCellValue("3.14", intCol).ok).toBe(false);
    expect(parseAndValidateCellValue("Infinity", intCol).ok).toBe(false);

    const numCol = makeColumn({ name: "price", type: "numeric" });
    expect(parseAndValidateCellValue("19.95", numCol)).toEqual({ ok: true, value: 19.95 });
    expect(parseAndValidateCellValue("abc", numCol).ok).toBe(false);

    const jsonCol = makeColumn({ name: "meta", type: "jsonb" });
    expect(parseAndValidateCellValue('{"a":1}', jsonCol)).toEqual({ ok: true, value: { a: 1 } });
    expect(parseAndValidateCellValue("{bad", jsonCol)).toEqual({
      ok: false,
      error: "Invalid JSON syntax",
    });

    const enumCol = makeColumn({
      name: "status",
      type: "task_status",
      enumValues: ["todo", "done"],
    });
    expect(parseAndValidateCellValue("done", enumCol)).toEqual({ ok: true, value: "done" });
    expect(parseAndValidateCellValue("archived", enumCol)).toEqual({
      ok: false,
      error: "Must be one of: todo, done",
    });
  });

  // covers: AC-5
  it("formats cell values for inputs and extracts single or composite primary keys", () => {
    expect(valueToInputString(null)).toBe("");
    expect(valueToInputString(undefined)).toBe("");
    expect(valueToInputString({ ok: true })).toBe('{"ok":true}');
    expect(valueToInputString(123)).toBe("123");

    const compositeCols: DbColumnMetadata[] = [
      makeColumn({ name: "org_id", isPrimaryKey: true }),
      makeColumn({ name: "user_id", isPrimaryKey: true }),
      makeColumn({ name: "role", isPrimaryKey: false }),
    ];
    expect(extractPrimaryKeyWhere({ org_id: 1, user_id: 9, role: "admin" }, compositeCols)).toEqual(
      { org_id: 1, user_id: 9 }
    );
    expect(
      extractPrimaryKeyWhere({ role: "admin" }, [makeColumn({ name: "role", isPrimaryKey: false })])
    ).toEqual({});
  });
});
