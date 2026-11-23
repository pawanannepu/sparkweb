import * as babelParser from "@babel/parser";
import type { ElementSourceLocation } from "@spark/shared";
import * as recast from "recast";
import { twMerge } from "tailwind-merge";

const b = recast.types.builders;

export interface UpdateClassesOptions {
  source?: ElementSourceLocation;
  newClasses?: string[];
  removeClasses?: string[];
  replaceAllClasses?: string[];
}

export interface UpdateTextOptions {
  source?: ElementSourceLocation;
  text: string;
}

export function isWorkspaceFilePath(filePath: string): boolean {
  if (!filePath) return false;
  const normalized = filePath.replace(/\\/g, "/").trim();
  if (normalized.includes("..") || normalized.includes("node_modules")) {
    return false;
  }
  return normalized.startsWith("src/") || normalized.startsWith("./src/");
}

function parseAst(sourceCode: string) {
  return recast.parse(sourceCode, {
    parser: {
      parse(source: string) {
        return babelParser.parse(source, {
          sourceType: "module",
          plugins: ["jsx", "typescript"],
          tokens: true,
        });
      },
    },
  });
}

export function updateElementClasses(
  sourceCode: string,
  options: UpdateClassesOptions
): { code: string; success: boolean; modifiedClasses: string[] } {
  try {
    const ast = parseAst(sourceCode);
    let matched = false;
    let finalClassesList: string[] = [];

    recast.visit(ast, {
      visitJSXOpeningElement(path) {
        const node = path.node;
        const line = node.loc?.start?.line;

        // If source line is provided, check line match
        if (options.source?.line && line !== options.source.line) {
          this.traverse(path);
          return;
        }

        matched = true;
        if (!node.attributes) {
          node.attributes = [];
        }

        // Find className attribute
        const clsAttrIndex = node.attributes.findIndex(
          (attr: unknown) =>
            typeof attr === "object" &&
            attr !== null &&
            "type" in attr &&
            attr.type === "JSXAttribute" &&
            "name" in attr &&
            typeof attr.name === "object" &&
            attr.name !== null &&
            "name" in attr.name &&
            attr.name.name === "className"
        );

        if (clsAttrIndex >= 0) {
          const clsAttr = node.attributes[clsAttrIndex] as {
            value?: { type?: string; value?: string };
          };

          if (clsAttr.value && clsAttr.value.type === "StringLiteral") {
            const currentClasses = clsAttr.value.value
              ? clsAttr.value.value.split(/\s+/).filter(Boolean)
              : [];

            let nextClasses: string[];
            if (options.replaceAllClasses) {
              nextClasses = options.replaceAllClasses;
            } else {
              const toRemove = new Set(options.removeClasses || []);
              const filtered = currentClasses.filter((c) => !toRemove.has(c));
              const combined = [...filtered, ...(options.newClasses || [])].join(" ");
              // Merge conflicting Tailwind classes
              const merged = twMerge(combined);
              nextClasses = merged.split(/\s+/).filter(Boolean);
            }

            finalClassesList = nextClasses;
            clsAttr.value.value = nextClasses.join(" ");
          }
        } else {
          // No className attribute exists yet, add one
          let nextClasses: string[];
          if (options.replaceAllClasses) {
            nextClasses = options.replaceAllClasses;
          } else {
            const merged = twMerge((options.newClasses || []).join(" "));
            nextClasses = merged.split(/\s+/).filter(Boolean);
          }
          finalClassesList = nextClasses;
          const newAttr = b.jsxAttribute(
            b.jsxIdentifier("className"),
            b.stringLiteral(nextClasses.join(" "))
          );
          node.attributes.push(newAttr);
        }

        return false; // Stop traversal on match
      },
    });

    if (!matched) {
      return { code: sourceCode, success: false, modifiedClasses: [] };
    }

    const output = recast.print(ast).code;
    return { code: output, success: true, modifiedClasses: finalClassesList };
  } catch (err) {
    console.warn("AST class modification error:", err);
    return { code: sourceCode, success: false, modifiedClasses: [] };
  }
}

export function updateElementText(
  sourceCode: string,
  options: UpdateTextOptions
): { code: string; success: boolean; error?: string } {
  try {
    const ast = parseAst(sourceCode);
    let matched = false;
    let failedReason: string | undefined;

    recast.visit(ast, {
      visitJSXElement(path) {
        const opening = path.node.openingElement;
        const line = opening.loc?.start?.line;

        if (options.source?.line && line !== options.source.line) {
          this.traverse(path);
          return;
        }

        matched = true;
        if (!path.node.children) {
          path.node.children = [];
        }
        const children = path.node.children;

        // Check that children only contain static text
        const elementChildren = children.filter(
          (c: unknown) =>
            typeof c === "object" &&
            c !== null &&
            "type" in c &&
            (c.type === "JSXElement" || c.type === "JSXExpressionContainer")
        );

        if (elementChildren.length > 0) {
          failedReason = "Element contains dynamic JSX expressions or child elements";
          return false;
        }

        const textChildIndex = children.findIndex(
          (c: unknown) =>
            typeof c === "object" &&
            c !== null &&
            "type" in c &&
            (c.type === "JSXText" || c.type === "StringLiteral")
        );

        if (textChildIndex >= 0) {
          const textNode = children[textChildIndex] as { value?: string; raw?: string };
          textNode.value = options.text;
          textNode.raw = options.text;
        } else {
          // If empty children, push a new JSXText node
          children.push(b.jsxText(options.text));
        }

        return false;
      },
    });

    if (!matched) {
      return { code: sourceCode, success: false, error: "Target element not found" };
    }

    if (failedReason) {
      return { code: sourceCode, success: false, error: failedReason };
    }

    const output = recast.print(ast).code;
    return { code: output, success: true };
  } catch (err) {
    console.warn("AST text modification error:", err);
    return { code: sourceCode, success: false, error: "AST parse failed" };
  }
}
