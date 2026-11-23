import { describe, expect, it } from "vitest";
import { isWorkspaceFilePath, updateElementClasses, updateElementText } from "./ast-modifier";

describe("ast-modifier", () => {
  describe("isWorkspaceFilePath", () => {
    it("accepts workspace files within src", () => {
      expect(isWorkspaceFilePath("src/App.tsx")).toBe(true);
      expect(isWorkspaceFilePath("src/components/Button.tsx")).toBe(true);
      expect(isWorkspaceFilePath("./src/index.css")).toBe(true);
    });

    it("rejects path traversal and external modules", () => {
      expect(isWorkspaceFilePath("../outside.tsx")).toBe(false);
      expect(isWorkspaceFilePath("node_modules/react/index.js")).toBe(false);
      expect(isWorkspaceFilePath("src/../node_modules/foo")).toBe(false);
      expect(isWorkspaceFilePath("package.json")).toBe(false);
    });
  });

  describe("updateElementClasses", () => {
    it("updates existing Tailwind utility classes resolving conflicts cleanly", () => {
      const code = `import React from "react";

export default function Card() {
  return (
    <div className="p-4 bg-slate-900 text-white rounded-lg">
      <h1 className="text-xl font-bold">Hello</h1>
    </div>
  );
}`;

      const res = updateElementClasses(code, {
        source: { file: "src/Card.tsx", line: 5, column: 5 },
        newClasses: ["p-8", "bg-indigo-600"], // p-8 should override p-4, bg-indigo-600 should override bg-slate-900
      });

      expect(res.success).toBe(true);
      expect(res.code).toContain("p-8");
      expect(res.code).toContain("bg-indigo-600");
      expect(res.code).not.toContain("p-4");
      expect(res.code).not.toContain("bg-slate-900");
      expect(res.code).toContain("text-white");
      expect(res.code).toContain("rounded-lg");
      // Preserved formatting
      expect(res.code).toContain('import React from "react";');
    });

    it("adds className attribute if element did not have one", () => {
      const code = `export function Box() {
  return <div>Content</div>;
}`;

      const res = updateElementClasses(code, {
        source: { file: "src/Box.tsx", line: 2, column: 10 },
        newClasses: ["m-4", "flex"],
      });

      expect(res.success).toBe(true);
      expect(res.code).toContain('className="m-4 flex"');
      expect(res.code).toContain("Content");
    });

    // covers: AC-5
    it("replaces all classes when replaceAllClasses option is specified", () => {
      const code = `export function Badge() {
  return <span className="bg-red-500 text-white p-2">Error</span>;
}`;

      const res = updateElementClasses(code, {
        source: { file: "src/Badge.tsx", line: 2, column: 10 },
        replaceAllClasses: ["bg-emerald-500", "text-black", "px-3"],
      });

      expect(res.success).toBe(true);
      expect(res.code).toContain('className="bg-emerald-500 text-black px-3"');
      expect(res.code).not.toContain("bg-red-500");
      expect(res.code).not.toContain("text-white");
    });

    // covers: AC-5
    it("preserves comments, indentation, and imports across AST modifications", () => {
      const code = `// Top-level license header comment
import React from "react";

/* Component JSDoc */
export function Header() {
  // Inner comment before return
  return (
    <header className="p-4 bg-slate-900">
      {/* JSX child comment */}
      <h1 className="text-xl">Title</h1>
    </header>
  );
}`;

      const res = updateElementClasses(code, {
        source: { file: "src/Header.tsx", line: 8, column: 5 },
        newClasses: ["p-8"],
      });

      expect(res.success).toBe(true);
      expect(res.code).toContain("// Top-level license header comment");
      expect(res.code).toContain("/* Component JSDoc */");
      expect(res.code).toContain("// Inner comment before return");
      expect(res.code).toContain("{/* JSX child comment */");
      expect(res.code).toContain("p-8");
      expect(res.code).toContain("bg-slate-900");
      expect(res.code).not.toContain("p-4");
    });

    // covers: AC-5
    it("handles syntax errors in source code gracefully without throwing", () => {
      const invalidCode = "export function Broken() { return <div className=; }";

      const res = updateElementClasses(invalidCode, {
        source: { file: "src/Broken.tsx", line: 1, column: 1 },
        newClasses: ["p-4"],
      });

      expect(res.success).toBe(false);
      expect(res.code).toBe(invalidCode);
    });
  });

  describe("updateElementText", () => {
    it("updates static text on leaf node", () => {
      const code = `export function Heading() {
  return (
    <h1 className="text-xl">Original Title</h1>
  );
}`;

      const res = updateElementText(code, {
        source: { file: "src/Heading.tsx", line: 3, column: 5 },
        text: "Updated Title",
      });

      expect(res.success).toBe(true);
      expect(res.code).toContain("Updated Title");
      expect(res.code).not.toContain("Original Title");
    });

    // covers: AC-6
    it("inserts text into an empty leaf JSX element", () => {
      const code = `export function Empty() {
  return <h1></h1>;
}`;

      const res = updateElementText(code, {
        source: { file: "src/Empty.tsx", line: 2, column: 10 },
        text: "Brand New Heading",
      });

      expect(res.success).toBe(true);
      expect(res.code).toContain("Brand New Heading");
    });

    // covers: AC-6
    it("handles syntax errors gracefully in updateElementText without crashing", () => {
      const invalidCode = "export function Invalid() { <>>> }";

      const res = updateElementText(invalidCode, {
        source: { file: "src/Invalid.tsx", line: 1, column: 1 },
        text: "Test",
      });

      expect(res.success).toBe(false);
      expect(res.code).toBe(invalidCode);
    });

    it("refuses text modification when element contains child JSX elements or dynamic expressions", () => {
      const code = `export function Complex() {
  const dynamicVal = 42;
  return (
    <div>
      <span>Sub</span>
      {dynamicVal}
    </div>
  );
}`;

      const res = updateElementText(code, {
        source: { file: "src/Complex.tsx", line: 4, column: 5 },
        text: "Attempt to override",
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("dynamic JSX expressions or child elements");
    });
  });
});
