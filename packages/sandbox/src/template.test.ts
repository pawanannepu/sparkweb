import { describe, expect, it } from "vitest";
import {
  filterSourceFiles,
  isSourceFilePath,
  STARTER_TEMPLATE_FILES,
  toWebContainerFileSystemTree,
} from "./template";

describe("sandbox starter template and file tree utilities", () => {
  it("contains essential project files in starter template", () => {
    expect(STARTER_TEMPLATE_FILES["package.json"]).toBeDefined();
    expect(STARTER_TEMPLATE_FILES["vite.config.ts"]).toBeDefined();
    expect(STARTER_TEMPLATE_FILES["index.html"]).toBeDefined();
    expect(STARTER_TEMPLATE_FILES["src/App.tsx"]).toBeDefined();
    expect(STARTER_TEMPLATE_FILES["src/main.tsx"]).toBeDefined();
  });

  it("filters out node_modules and build cache files correctly", () => {
    expect(isSourceFilePath("src/App.tsx")).toBe(true);
    expect(isSourceFilePath("package.json")).toBe(true);
    expect(isSourceFilePath("node_modules/react/index.js")).toBe(false);
    expect(isSourceFilePath(".vite/deps/react.js")).toBe(false);
    expect(isSourceFilePath("dist/index.js")).toBe(false);
    expect(isSourceFilePath("npm-debug.log")).toBe(false);
  });

  it("applies filterSourceFiles to remove unwanted directories", () => {
    const rawFiles = {
      "src/App.tsx": { content: "export default function App() {}" },
      "node_modules/foo/index.js": { content: "module.exports = {}" },
      "dist/bundle.js": { content: "bundle" },
    };

    const filtered = filterSourceFiles(rawFiles);
    expect(Object.keys(filtered)).toEqual(["src/App.tsx"]);
  });

  it("converts flat file map to recursive WebContainer file system tree", () => {
    const files = {
      "src/components/Card.tsx": { content: "export function Card() {}" },
      "index.html": { content: "<html/>" },
    };

    const tree = toWebContainerFileSystemTree(files);

    expect(tree["index.html"]).toBeDefined();
    const indexNode = tree["index.html"];
    expect(indexNode && "file" in indexNode).toBe(true);
    expect(tree.src).toBeDefined();
    const srcNode = tree.src;
    expect(srcNode && "directory" in srcNode).toBe(true);

    if (srcNode && "directory" in srcNode) {
      const srcDir = srcNode.directory;
      expect(srcDir.components).toBeDefined();
      const componentsNode = srcDir.components;
      expect(componentsNode && "directory" in componentsNode).toBe(true);

      if (componentsNode && "directory" in componentsNode) {
        const componentsDir = componentsNode.directory;
        expect(componentsDir["Card.tsx"]).toBeDefined();
        const cardNode = componentsDir["Card.tsx"];
        if (cardNode && "file" in cardNode) {
          expect(cardNode.file.contents).toBe("export function Card() {}");
        }
      }
    }
  });
});
