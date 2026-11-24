import { describe, expect, it } from "vitest";
import {
  classifyErrorCategory,
  computeErrorFingerprint,
  createPreviewErrorPayload,
  parsePreviewDiagnostic,
  sha256,
} from "./diagnostics";

describe("Diagnostics Parser and Fingerprinting", () => {
  it("computes deterministic standard SHA-256 hashes", () => {
    // Standard test vectors
    expect(sha256("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    );
  });

  it("computes error fingerprint directly from category and normalized path", () => {
    const fp1 = computeErrorFingerprint(
      "syntax",
      "src/App.tsx",
      "SyntaxError: Unexpected token: 14:2"
    );
    const fp2 = computeErrorFingerprint(
      "syntax",
      "src/App.tsx",
      "SyntaxError: Unexpected token: 28:5"
    );
    expect(fp1).toBe(fp2);
  });

  it("classifies error categories accurately", () => {
    expect(
      classifyErrorCategory('Failed to resolve import "lucide-react/icons" from "src/App.tsx"')
    ).toBe("import");

    expect(classifyErrorCategory('SyntaxError: Unexpected token, expected ";" (14:2)')).toBe(
      "syntax"
    );

    expect(
      classifyErrorCategory("Transform failed with 1 error: TS2304: Cannot find name 'foo'")
    ).toBe("compiler");

    expect(classifyErrorCategory("Uncaught TypeError: Cannot read properties of undefined")).toBe(
      "runtime"
    );
  });

  it("produces identical error fingerprint despite line and column shifts", () => {
    // Error at line 14, column 2
    const error1 = "src/App.tsx:14:2: error: Unexpected token";
    // Error shifted to line 28, column 10 after previous edits
    const error2 = "src/App.tsx:28:10: error: Unexpected token";

    const parsed1 = parsePreviewDiagnostic(error1);
    const parsed2 = parsePreviewDiagnostic(error2);

    expect(parsed1.errorFingerprint).toBeDefined();
    expect(parsed2.errorFingerprint).toBeDefined();
    expect(parsed1.errorFingerprint).toBe(parsed2.errorFingerprint);
    expect(parsed1.category).toBe("syntax");
    expect(parsed2.category).toBe("syntax");
    expect(parsed1.filename).toBe("src/App.tsx");
    expect(parsed2.filename).toBe("src/App.tsx");
  });

  it("parses import error diagnostics with source file", () => {
    const raw =
      '[plugin:vite:import-analysis] Failed to resolve import "lucide-react/icons/missing" from "src/App.tsx". Does the file exist?';
    const parsed = parsePreviewDiagnostic(raw);

    expect(parsed.category).toBe("import");
    expect(parsed.filename).toBe("src/App.tsx");
    expect(parsed.errorFingerprint).toBeDefined();
  });

  it("creates structured preview error payload from runtime error", () => {
    const payload = createPreviewErrorPayload({
      message: "Uncaught ReferenceError: variableIsNotDefined is not defined",
      filename: "src/components/Card.tsx",
      line: 42,
      column: 5,
      stack:
        "ReferenceError: variableIsNotDefined is not defined\n at Card (src/components/Card.tsx:42:5)",
    });

    expect(payload.category).toBe("runtime");
    expect(payload.filename).toBe("src/components/Card.tsx");
    expect(payload.line).toBe(42);
    expect(payload.column).toBe(5);
    expect(payload.errorFingerprint).toBeDefined();
  });
});
