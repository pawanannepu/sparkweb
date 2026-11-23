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
  "plugins/spark-inspector.js": {
    content: `export default function sparkInspector() {
  return {
    name: "vite-plugin-spark-inspector",
    transform(code, id) {
      if (!id.match(/\\.[jt]sx$/) || id.includes("node_modules") || id.includes("spark-inspector-client")) {
        return null;
      }
      const cleanPath = id.replace(/^[./]+/, "").split("?")[0];
      let line = 1;
      let col = 1;
      let inString = false;
      let stringChar = "";
      let inComment = false;
      let result = "";

      for (let i = 0; i < code.length; i++) {
        const ch = code[i];
        const next = code[i + 1] || "";

        if (ch === "\\n") {
          line++;
          col = 1;
        } else {
          col++;
        }

        if (!inString && !inComment) {
          if (ch === "/" && next === "/") {
            inComment = true;
          } else if (ch === '"' || ch === "'" || ch === "\`") {
            inString = true;
            stringChar = ch;
          } else if (ch === "<" && /[a-zA-Z]/.test(next)) {
            const match = code.slice(i).match(/^<([a-zA-Z][a-zA-Z0-9_.-]*)/);
            if (match) {
              const tagName = match[1];
              const tagLen = match[0].length;
              const locAttr = \` data-source-loc="\${cleanPath}:\${line}:\${col}"\`;
              result += \`<\${tagName}\${locAttr}\`;
              i += tagLen - 1;
              col += tagLen - 1;
              continue;
            }
          }
        } else if (inString) {
          if (ch === stringChar && code[i - 1] !== "\\\\") {
            inString = false;
          }
        } else if (inComment) {
          if (ch === "\\n") {
            inComment = false;
          }
        }

        result += ch;
      }

      return { code: result, map: null };
    },
  };
}
`,
  },
  "vite.config.ts": {
    content: `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import sparkInspector from "./plugins/spark-inspector.js";

export default defineConfig({
  plugins: [react(), sparkInspector()],
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
  "src/spark-inspector-client.ts": {
    content: `// In-app DOM canvas inspector client script
let isInspectActive = false;
let hoveredElement: HTMLElement | null = null;
let selectedElement: HTMLElement | null = null;
let overlayContainer: HTMLDivElement | null = null;
let hoverBox: HTMLDivElement | null = null;
let hoverBadge: HTMLDivElement | null = null;
let selectBox: HTMLDivElement | null = null;

function postToParent(type: string, payload: Record<string, unknown> = {}) {
  if (window.parent && window.parent !== window) {
    window.parent.postMessage(
      {
        protocol: "sparkweb:bridge:v1",
        type,
        source: "sparkweb:sandbox",
        payload,
        timestamp: Date.now(),
      },
      "*"
    );
  }
}

function ensureOverlays() {
  if (overlayContainer) return;
  overlayContainer = document.createElement("div");
  overlayContainer.id = "spark-inspector-overlay";
  overlayContainer.style.position = "fixed";
  overlayContainer.style.inset = "0";
  overlayContainer.style.pointerEvents = "none";
  overlayContainer.style.zIndex = "2147483647";
  overlayContainer.style.overflow = "visible";

  // Hover bounding box
  hoverBox = document.createElement("div");
  hoverBox.style.position = "absolute";
  hoverBox.style.pointerEvents = "none";
  hoverBox.style.border = "1.5px dashed #6366f1";
  hoverBox.style.backgroundColor = "rgba(99, 102, 241, 0.08)";
  hoverBox.style.display = "none";
  hoverBox.style.transition = "all 0.08s ease-out";
  hoverBox.style.boxSizing = "border-box";

  // Hover info badge
  hoverBadge = document.createElement("div");
  hoverBadge.style.position = "absolute";
  hoverBadge.style.top = "-24px";
  hoverBadge.style.left = "0";
  hoverBadge.style.backgroundColor = "#4f46e5";
  hoverBadge.style.color = "#ffffff";
  hoverBadge.style.fontSize = "10px";
  hoverBadge.style.fontWeight = "600";
  hoverBadge.style.fontFamily = "ui-monospace, monospace";
  hoverBadge.style.padding = "2px 6px";
  hoverBadge.style.borderRadius = "4px";
  hoverBadge.style.whiteSpace = "nowrap";
  hoverBadge.style.boxShadow = "0 2px 4px rgba(0,0,0,0.3)";
  hoverBox.appendChild(hoverBadge);

  // Selection bounding box
  selectBox = document.createElement("div");
  selectBox.style.position = "absolute";
  selectBox.style.pointerEvents = "none";
  selectBox.style.border = "2px solid #818cf8";
  selectBox.style.backgroundColor = "rgba(129, 140, 248, 0.12)";
  selectBox.style.display = "none";
  selectBox.style.boxSizing = "border-box";

  overlayContainer.appendChild(hoverBox);
  overlayContainer.appendChild(selectBox);
  document.body.appendChild(overlayContainer);
}

function updateElementOverlay(el: HTMLElement | null, box: HTMLDivElement | null, badge?: HTMLDivElement | null) {
  if (!el || !box) {
    if (box) box.style.display = "none";
    return;
  }
  const rect = el.getBoundingClientRect();
  box.style.display = "block";
  box.style.top = \`\${rect.top}px\`;
  box.style.left = \`\${rect.left}px\`;
  box.style.width = \`\${rect.width}px\`;
  box.style.height = \`\${rect.height}px\`;

  if (badge) {
    const tagName = el.tagName.toLowerCase();
    const classPreview = el.className && typeof el.className === "string" ? \` .\${el.className.split(" ")[0]}\` : "";
    badge.textContent = \`<\${tagName}\${classPreview}> \${Math.round(rect.width)} × \${Math.round(rect.height)}\`;
  }
}

function getRelevantStyles(el: HTMLElement): Record<string, string> {
  const cs = window.getComputedStyle(el);
  return {
    backgroundColor: cs.backgroundColor,
    color: cs.color,
    fontSize: cs.fontSize,
    fontWeight: cs.fontWeight,
    textAlign: cs.textAlign,
    lineHeight: cs.lineHeight,
    paddingTop: cs.paddingTop,
    paddingRight: cs.paddingRight,
    paddingBottom: cs.paddingBottom,
    paddingLeft: cs.paddingLeft,
    marginTop: cs.marginTop,
    marginRight: cs.marginRight,
    marginBottom: cs.marginBottom,
    marginLeft: cs.marginLeft,
    display: cs.display,
    flexDirection: cs.flexDirection,
    justifyContent: cs.justifyContent,
    alignItems: cs.alignItems,
    borderRadius: cs.borderRadius,
    borderWidth: cs.borderWidth,
    borderColor: cs.borderColor,
    gap: cs.gap,
  };
}

function parseSourceLoc(el: HTMLElement) {
  const raw = el.getAttribute("data-source-loc");
  if (!raw) return undefined;
  const parts = raw.split(":");
  if (parts.length >= 3) {
    return {
      file: parts[0] || "",
      line: parseInt(parts[1] || "1", 10),
      column: parseInt(parts[2] || "1", 10),
    };
  }
  return undefined;
}

function isLeafTextNode(el: HTMLElement): boolean {
  if (el.children.length > 0) return false;
  return Boolean(el.textContent && el.textContent.trim().length > 0);
}

function handleMouseMove(e: MouseEvent) {
  if (!isInspectActive) return;
  const target = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
  if (!target || target === document.body || target === document.documentElement || overlayContainer?.contains(target)) {
    hoveredElement = null;
    updateElementOverlay(null, hoverBox, hoverBadge);
    return;
  }

  hoveredElement = target;
  updateElementOverlay(target, hoverBox, hoverBadge);

  const rect = target.getBoundingClientRect();
  postToParent("PREVIEW_ELEMENT_HOVER", {
    rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
    tagName: target.tagName.toLowerCase(),
    classes: typeof target.className === "string" ? target.className.split(/\\s+/).filter(Boolean) : [],
  });
}

function handleClick(e: MouseEvent) {
  if (!isInspectActive) return;
  e.preventDefault();
  e.stopPropagation();

  const target = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
  if (!target || target === document.body || overlayContainer?.contains(target)) return;

  selectedElement = target;
  updateElementOverlay(target, selectBox);

  const rect = target.getBoundingClientRect();
  const source = parseSourceLoc(target);
  const classes = typeof target.className === "string" ? target.className.split(/\\s+/).filter(Boolean) : [];
  const styles = getRelevantStyles(target);
  const isLeaf = isLeafTextNode(target);
  const isEditable = Boolean(source?.file?.startsWith("src/"));
  const selector = target.getAttribute("data-source-loc")
    ? \`[data-source-loc="\${target.getAttribute("data-source-loc")}"]\`
    : target.id
      ? \`#\${target.id}\`
      : target.tagName.toLowerCase();

  postToParent("PREVIEW_ELEMENT_SELECT", {
    selector,
    tagName: target.tagName.toLowerCase(),
    rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
    source,
    classes,
    styles,
    textContent: target.textContent || "",
    isEditable,
    isLeafTextOnly: isLeaf,
  });
}

function handleDblClick(e: MouseEvent) {
  if (!isInspectActive) return;
  const target = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
  if (!target || !isLeafTextNode(target)) return;

  const source = parseSourceLoc(target);
  if (!source?.file?.startsWith("src/")) return;

  e.preventDefault();
  e.stopPropagation();

  target.contentEditable = "true";
  target.focus();

  const commit = () => {
    target.contentEditable = "false";
    const text = target.textContent || "";
    const selector = target.getAttribute("data-source-loc")
      ? \`[data-source-loc="\${target.getAttribute("data-source-loc")}"]\`
      : target.tagName.toLowerCase();

    postToParent("PREVIEW_UPDATE_TEXT", {
      selector,
      text,
    });
  };

  const onKeyDown = (ke: KeyboardEvent) => {
    if (ke.key === "Enter" && !ke.shiftKey) {
      ke.preventDefault();
      target.blur();
    }
  };

  target.addEventListener("blur", commit, { once: true });
  target.addEventListener("keydown", onKeyDown);
}

function handleScrollOrResize() {
  if (hoveredElement) updateElementOverlay(hoveredElement, hoverBox, hoverBadge);
  if (selectedElement) updateElementOverlay(selectedElement, selectBox);
}

// Window Message Listener for Host Commands
window.addEventListener("message", (event: MessageEvent) => {
  const data = event.data;
  if (!data || typeof data !== "object" || data.protocol !== "sparkweb:bridge:v1") return;

  if (data.type === "PREVIEW_INSPECT_MODE") {
    isInspectActive = Boolean(data.payload?.enabled);
    ensureOverlays();
    if (isInspectActive) {
      window.addEventListener("mousemove", handleMouseMove, true);
      window.addEventListener("click", handleClick, true);
      window.addEventListener("dblclick", handleDblClick, true);
      window.addEventListener("scroll", handleScrollOrResize, true);
      window.addEventListener("resize", handleScrollOrResize);
    } else {
      window.removeEventListener("mousemove", handleMouseMove, true);
      window.removeEventListener("click", handleClick, true);
      window.removeEventListener("dblclick", handleDblClick, true);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
      hoveredElement = null;
      selectedElement = null;
      if (hoverBox) hoverBox.style.display = "none";
      if (selectBox) selectBox.style.display = "none";
    }
  } else if (data.type === "PREVIEW_INJECT_STYLES") {
    const payload = data.payload as { selector?: string; styles?: Record<string, string> };
    let el = selectedElement;
    if (payload.selector && (!el || !el.matches(payload.selector))) {
      el = document.querySelector(payload.selector) as HTMLElement | null;
    }
    if (el && payload.styles) {
      el.setAttribute("data-spark-temp-style", "true");
      for (const [k, v] of Object.entries(payload.styles)) {
        (el.style as unknown as Record<string, string>)[k] = v;
      }
      updateElementOverlay(el, selectBox);
    }
  } else if (data.type === "PREVIEW_UPDATE_TEXT") {
    const payload = data.payload as { selector?: string; text?: string };
    let el = selectedElement;
    if (payload.selector && (!el || !el.matches(payload.selector))) {
      el = document.querySelector(payload.selector) as HTMLElement | null;
    }
    if (el && typeof payload.text === "string") {
      el.textContent = payload.text;
      updateElementOverlay(el, selectBox);
    }
  }
});

// Vite HMR Support
// @ts-ignore
if (import.meta && (import.meta as any).hot) {
  // @ts-ignore
  (import.meta as any).hot.on("vite:afterUpdate", () => {
    document.querySelectorAll("[data-spark-temp-style]").forEach((el) => {
      el.removeAttribute("data-spark-temp-style");
    });
    if (selectedElement) {
      updateElementOverlay(selectedElement, selectBox);
    }
    postToParent("PREVIEW_HMR_COMPLETE", { timestamp: Date.now() });
  });
}
`,
  },
  "src/main.tsx": {
    content: `import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import "./spark-inspector-client";

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
