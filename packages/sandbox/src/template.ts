import type { SnapshotFilesMap } from "@spark/shared";

export const STARTER_TEMPLATE_FILES: SnapshotFilesMap = {
  "package.json": {
    content: JSON.stringify(
      {
        name: "spark-app",
        private: true,
        version: "0.1.0",
        type: "module",
        scripts: {
          dev: "vite --host",
          build: "vite build",
          preview: "vite preview",
        },
        dependencies: {
          "@electric-sql/pglite": "^0.2.14",
          clsx: "^2.1.1",
          "lucide-react": "^0.475.0",
          react: "^19.0.0",
          "react-dom": "^19.0.0",
          "tailwind-merge": "^2.6.0",
        },
        devDependencies: {
          "@types/react": "^19.0.0",
          "@types/react-dom": "^19.0.0",
          "@vitejs/plugin-react": "^4.3.4",
          autoprefixer: "^10.4.20",
          postcss: "^8.4.49",
          tailwindcss: "^3.4.17",
          typescript: "^5.7.2",
          vite: "^6.0.7",
        },
      },
      null,
      2
    ),
  },
  "vite.config.ts": {
    content: `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
});
`,
  },
  "index.html": {
    content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Sparkweb App</title>
  </head>
  <body class="min-h-screen bg-slate-950 text-slate-100 antialiased">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
  },
  "src/main.tsx": {
    content: `import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

const rootElement = document.getElementById("root");
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
`,
  },
  "src/index.css": {
    content: `@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  margin: 0;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
`,
  },
  "src/lib/db.ts": {
    content: `import { PGlite } from "@electric-sql/pglite";

let dbInstance: PGlite | null = null;

export async function getDb(): Promise<PGlite> {
  if (!dbInstance) {
    dbInstance = new PGlite();
    await dbInstance.waitReady;
  }
  return dbInstance;
}
`,
  },
  "src/App.tsx": {
    content: `import React, { useState, useEffect } from "react";
import { Sparkles, Database, Plus } from "lucide-react";
import { getDb } from "./lib/db";

export default function App() {
  const [count, setCount] = useState(0);
  const [dbStatus, setDbStatus] = useState<string>("Initializing PGlite...");

  useEffect(() => {
    async function initDb() {
      try {
        const db = await getDb();
        await db.exec(\`
          CREATE TABLE IF NOT EXISTS demo_items (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        \`);
        setDbStatus("PGlite WASM database ready");
      } catch (err: any) {
        setDbStatus("Database: " + (err?.message || "Ready"));
      }
    }
    initDb();
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 p-6 text-slate-100">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/60 p-8 shadow-2xl backdrop-blur-sm">
        <div className="mb-6 flex items-center justify-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600/20 text-indigo-400 ring-1 ring-indigo-500/30">
            <Sparkles className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white">Sparkweb App</h1>
            <p className="text-xs text-slate-400">Live WebContainer sandbox preview</p>
          </div>
        </div>

        <div className="mb-6 space-y-4 rounded-xl border border-slate-800/80 bg-slate-950/50 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-300">Interactive Counter</span>
            <span className="rounded-lg bg-indigo-500/10 px-2.5 py-1 font-mono text-sm font-semibold text-indigo-400">
              {count}
            </span>
          </div>
          <button
            onClick={() => setCount((c) => c + 1)}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-500 active:scale-[0.98]"
          >
            <Plus className="h-4 w-4" /> Increment Counter
          </button>
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/40 px-3.5 py-2.5 text-xs text-slate-400">
          <Database className="h-4 w-4 text-emerald-400" />
          <span>{dbStatus}</span>
        </div>
      </div>
    </div>
  );
}
`,
  },
  "tailwind.config.js": {
    content: `/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
};
`,
  },
  "postcss.config.js": {
    content: `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
`,
  },
};

const EXCLUDED_PATTERNS = [
  /^node_modules(\/|$)/,
  /^\.vite(\/|$)/,
  /^dist(\/|$)/,
  /^\.next(\/|$)/,
  /\.log$/,
  /^coverage(\/|$)/,
];

export function isSourceFilePath(path: string): boolean {
  const normalized = path.replace(/^\.\//, "").replace(/^\/+/, "");
  return !EXCLUDED_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function filterSourceFiles(files: SnapshotFilesMap): SnapshotFilesMap {
  const result: SnapshotFilesMap = {};
  for (const [path, entry] of Object.entries(files)) {
    if (isSourceFilePath(path)) {
      result[path] = entry;
    }
  }
  return result;
}

export type WebContainerFileSystemTree = {
  [name: string]:
    | {
        file: {
          contents: string | Uint8Array;
        };
      }
    | {
        directory: WebContainerFileSystemTree;
      };
};

export function toWebContainerFileSystemTree(files: SnapshotFilesMap): WebContainerFileSystemTree {
  const root: WebContainerFileSystemTree = {};

  for (const [rawPath, entry] of Object.entries(files)) {
    const cleanPath = rawPath.replace(/^[./]+/, "");
    const parts = cleanPath.split("/").filter(Boolean);
    if (parts.length === 0) continue;

    let current = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!part) continue;
      if (!current[part] || !("directory" in current[part])) {
        current[part] = { directory: {} };
      }
      current = (current[part] as { directory: WebContainerFileSystemTree }).directory;
    }

    const fileName = parts[parts.length - 1];
    if (!fileName) continue;
    current[fileName] = {
      file: {
        contents: entry.content,
      },
    };
  }

  return root;
}
