import type { SnapshotFilesMap } from "@spark/shared";

const BUILDER_ONLY_FILES = new Set([
  "plugins/spark-inspector.js",
  "plugins/spark-inspector.ts",
  "src/spark-inspector-client.ts",
  "src/spark-inspector-client.tsx",
  "src/spark-inspector-client.js",
  "src/spark-db-bridge.ts",
  "src/spark-db-bridge.tsx",
  "src/spark-db-bridge.js",
]);

const MAIN_ENTRY_PATHS = new Set(["src/main.tsx", "src/main.ts", "src/main.jsx", "src/main.js"]);
const VITE_CONFIG_PATHS = new Set(["vite.config.ts", "vite.config.js", "vite.config.mjs"]);

const BUILDER_IMPORT_LINE_PATTERN =
  /^\s*import\s+(?:[^;]*?\s+from\s+)?["'](?:\.\.?\/)*(?:plugins\/spark-inspector(?:\.[jt]s)?|spark-inspector-client(?:\.[jt]sx?)?|spark-db-bridge(?:\.[jt]sx?)?)["']\s*;?\s*$/gm;

export function stripMainEntryContent(content: string): string {
  return content.replace(BUILDER_IMPORT_LINE_PATTERN, "").replace(/\n{3,}/g, "\n\n");
}

export function stripViteConfigContent(content: string): string {
  let updated = content.replace(BUILDER_IMPORT_LINE_PATTERN, "");

  // Remove sparkInspector() call from plugins array cleanly
  updated = updated
    .replace(/,\s*sparkInspector\s*\([^)]*\)\s*/g, "")
    .replace(/sparkInspector\s*\([^)]*\)\s*,\s*/g, "")
    .replace(/sparkInspector\s*\([^)]*\)/g, "");

  // Ensure base: "/"
  if (/\bbase\s*:\s*["'`][^"'`]*["'`]/.test(updated)) {
    updated = updated.replace(/\bbase\s*:\s*["'`][^"'`]*["'`]/, 'base: "/"');
  } else {
    updated = injectIntoDefineConfig(updated, '  base: "/",');
  }

  // Ensure worker: { format: "es" }
  if (/\bworker\s*:\s*\{[^}]*\}/.test(updated)) {
    updated = updated.replace(/\bworker\s*:\s*\{([^}]*)\}/, (_match, inner: string) => {
      if (/\bformat\s*:/.test(inner)) {
        return `worker: {${inner.replace(/\bformat\s*:\s*["'`][^"'`]*["'`]/, 'format: "es"')}}`;
      }
      const trimmed = inner.trim();
      const suffix = trimmed.length > 0 && !trimmed.endsWith(",") ? ", " : " ";
      return `worker: {${inner}${suffix}format: "es" }`;
    });
  } else {
    updated = injectIntoDefineConfig(updated, '  worker: { format: "es" },');
  }

  return updated.replace(/\n{3,}/g, "\n\n");
}

function injectIntoDefineConfig(content: string, lineToInject: string): string {
  const defineConfigMatch = /defineConfig\s*\(\s*\{/.exec(content);
  if (defineConfigMatch) {
    const insertIdx = defineConfigMatch.index + defineConfigMatch[0].length;
    return `${content.slice(0, insertIdx)}\n${lineToInject}${content.slice(insertIdx)}`;
  }

  const exportDefaultMatch = /export\s+default\s*\{/.exec(content);
  if (exportDefaultMatch) {
    const insertIdx = exportDefaultMatch.index + exportDefaultMatch[0].length;
    return `${content.slice(0, insertIdx)}\n${lineToInject}${content.slice(insertIdx)}`;
  }

  return content;
}

const DEFAULT_PRODUCTION_VITE_CONFIG = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/",
  worker: { format: "es" },
  plugins: [react()],
  optimizeDeps: {
    exclude: ["@electric-sql/pglite"],
  },
});
`;

/**
 * Produces an immutable copy of a snapshot file map stripped of builder-only
 * scripts, plugins, and imports, configured for static production Vite builds.
 */
export function prepareProductionFiles(files: SnapshotFilesMap): SnapshotFilesMap {
  const output: SnapshotFilesMap = {};
  let hasViteConfig = false;

  for (const [rawPath, entry] of Object.entries(files)) {
    const normalizedPath = rawPath.replace(/^\/+/, "");
    if (BUILDER_ONLY_FILES.has(normalizedPath)) {
      continue;
    }

    if (MAIN_ENTRY_PATHS.has(normalizedPath)) {
      output[normalizedPath] = {
        ...entry,
        content: stripMainEntryContent(entry.content),
      };
      continue;
    }

    if (VITE_CONFIG_PATHS.has(normalizedPath)) {
      hasViteConfig = true;
      output[normalizedPath] = {
        ...entry,
        content: stripViteConfigContent(entry.content),
      };
      continue;
    }

    output[normalizedPath] = { ...entry };
  }

  if (!hasViteConfig) {
    output["vite.config.ts"] = { content: DEFAULT_PRODUCTION_VITE_CONFIG };
  }

  return output;
}
