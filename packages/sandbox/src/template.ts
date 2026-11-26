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
  optimizeDeps: {
    exclude: ["@electric-sql/pglite"],
  },
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

// Window Runtime Error Listeners
window.addEventListener("error", (event) => {
  postToParent("PREVIEW_ERROR", {
    message: event.message || "Uncaught runtime error",
    filename: event.filename ? event.filename.split("?")[0].replace(/^[./]+/, "") : undefined,
    line: event.lineno,
    column: event.colno,
    stack: event.error?.stack,
  });
});

window.addEventListener("unhandledrejection", (event) => {
  postToParent("PREVIEW_ERROR", {
    message: event.reason?.message || String(event.reason) || "Unhandled promise rejection",
    stack: event.reason?.stack,
  });
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

  // @ts-ignore
  (import.meta as any).hot.on("vite:error", (errPayload: any) => {
    const err = errPayload?.err || errPayload;
    postToParent("PREVIEW_ERROR", {
      message: err?.message || "Vite compilation error",
      filename: (err?.id || err?.loc?.file || "").split("?")[0].replace(/^[./]+/, ""),
      line: err?.loc?.line,
      column: err?.loc?.column,
      stack: err?.stack,
    });
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
import "./spark-db-bridge";

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
  "src/spark-db-bridge.ts": {
    content: `// In-app PGlite bridge client for Sparkweb Managed Database Viewer
import { getRawDb } from "./lib/db";

const BRIDGE_PROTOCOL = "sparkweb:bridge:v1";
const DB_TIMEOUT_MS = 10_000;

function postToParent(type: string, payload: Record<string, unknown> = {}) {
  if (window.parent && window.parent !== window) {
    window.parent.postMessage(
      {
        protocol: BRIDGE_PROTOCOL,
        type,
        source: "sparkweb:sandbox",
        payload,
        timestamp: Date.now(),
      },
      "*"
    );
  }
}

export function notifyDbMutated(origin: "app" | "viewer", table?: string) {
  postToParent("DB_MUTATED_EVENT", { origin, ...(table ? { table } : {}) });
  window.dispatchEvent(
    new CustomEvent("spark:db-mutated", {
      detail: { origin, table },
    })
  );
}

function quoteIdent(id: string): string {
  if (!id) throw new Error("SQL identifier cannot be empty");
  return \`"\${id.replace(/"/g, '""')}"\`;
}

function toSqlLiteral(value: unknown, colType?: string): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return \`'\${value.toISOString().replace(/'/g, "''")}'\`;
  if (value instanceof Uint8Array) {
    const hex = Array.from(value).map((b) => b.toString(16).padStart(2, "0")).join("");
    return \`'\\\\x\${hex}'::bytea\`;
  }
  if (typeof value === "object") {
    const json = JSON.stringify(value).replace(/'/g, "''");
    return colType && colType.includes("json") ? \`'\${json}'::\${colType}\` : \`'\${json}'\`;
  }
  return \`'\${String(value).replace(/'/g, "''")}'\`;
}

function serializeRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (v instanceof Date) out[k] = v.toISOString();
      else if (typeof v === "bigint") out[k] = v.toString();
      else if (v instanceof Uint8Array) out[k] = Array.from(v);
      else out[k] = v;
    }
    return out;
  });
}

function detectWriteTable(rawSql: string): { isWrite: boolean; table?: string } {
  const cleaned = rawSql
    .replace(/--[^\\n]*/g, " ")
    .replace(/\\/\\*[\\s\\S]*?\\*\\//g, " ")
    .replace(/'(?:''|[^'])*'/g, "''")
    .trim();
  if (!cleaned) return { isWrite: false };
  const match = cleaned.match(
    /\\b(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM|TRUNCATE\\s+(?:TABLE\\s+)?|CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?|ALTER\\s+TABLE|DROP\\s+TABLE(?:\\s+IF\\s+EXISTS)?)\\s+(?:"?public"?\\.)?"?([a-zA-Z_][a-zA-Z0-9_$]*)"?/i
  );
  if (match) return { isWrite: true, table: match[2] };
  if (/\\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\\b/i.test(cleaned)) {
    return { isWrite: true };
  }
  return { isWrite: false };
}

async function withTimeout<T>(promise: Promise<T>, ms = DB_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(\`Query timed out after \${Math.round(ms / 1000)} seconds\`)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function introspectTables() {
  const db = await getRawDb();
  const tablesRes = await db.query<{ table_name: string }>(
    \`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name ASC\`
  );
  const colsRes = await db.query<{
    table_name: string;
    column_name: string;
    data_type: string;
    udt_name: string;
    is_nullable: string;
    column_default: string | null;
    is_identity: string;
  }>(
    \`SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default, is_identity FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name ASC, ordinal_position ASC\`
  );
  const pkRes = await db.query<{ table_name: string; column_name: string }>(
    \`SELECT c.relname AS table_name, a.attname AS column_name FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey) WHERE n.nspname = 'public' AND i.indisprimary\`
  );
  const enumRes = await db.query<{ type_name: string; enum_label: string }>(
    \`SELECT t.typname AS type_name, e.enumlabel AS enum_label FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' ORDER BY t.typname ASC, e.enumsortorder ASC\`
  );

  const pkByTable = new Map<string, Set<string>>();
  for (const r of pkRes.rows) {
    const s = pkByTable.get(r.table_name) ?? new Set<string>();
    s.add(r.column_name);
    pkByTable.set(r.table_name, s);
  }

  const enumsByType = new Map<string, string[]>();
  for (const r of enumRes.rows) {
    const list = enumsByType.get(r.type_name) ?? [];
    list.push(r.enum_label);
    enumsByType.set(r.type_name, list);
  }

  const colsByTable = new Map<string, any[]>();
  for (const c of colsRes.rows) {
    const isPrimaryKey = Boolean(pkByTable.get(c.table_name)?.has(c.column_name));
    const isIdentity = c.is_identity === "YES" || Boolean(c.column_default?.startsWith("nextval("));
    const resolvedType = c.data_type === "USER-DEFINED" ? c.udt_name : c.data_type;
    const enumValues = enumsByType.get(c.udt_name);
    const list = colsByTable.get(c.table_name) ?? [];
    list.push({
      name: c.column_name,
      type: resolvedType,
      nullable: c.is_nullable === "YES",
      isPrimaryKey,
      isIdentity,
      defaultValue: c.column_default,
      ...(enumValues ? { enumValues } : {}),
    });
    colsByTable.set(c.table_name, list);
  }

  const tables = [];
  for (const t of tablesRes.rows) {
    const cols = colsByTable.get(t.table_name) ?? [];
    let rowCount = 0;
    try {
      const cnt = await db.query<{ count: number }>(\`SELECT COUNT(*)::int AS count FROM \${quoteIdent(t.table_name)}\`);
      rowCount = Number(cnt.rows[0]?.count ?? 0);
    } catch {
      rowCount = 0;
    }
    tables.push({
      name: t.table_name,
      isReadOnly: !cols.some((c) => c.isPrimaryKey),
      rowCount,
      columns: cols,
    });
  }
  return tables;
}

async function handleQuery(payload: any) {
  const start = performance.now();
  try {
    const db = await getRawDb();
    return await withTimeout((async () => {
      await db.exec("SET statement_timeout = '10s'");
      if (payload.rawSql !== undefined) {
        const trimmed = String(payload.rawSql).trim();
        if (!trimmed) {
          return { id: payload.id, rows: [], totalCount: 0, executionTimeMs: 0, columns: [], error: "SQL query cannot be empty" };
        }
        let results;
        if (payload.readOnly) {
          await db.exec("BEGIN");
          try {
            await db.exec("SET TRANSACTION READ ONLY");
            results = await db.exec(trimmed);
            await db.exec("COMMIT");
          } catch (txErr) {
            try { await db.exec("ROLLBACK"); } catch {}
            throw txErr;
          }
        } else {
          results = await db.exec(trimmed);
          const writeInfo = detectWriteTable(trimmed);
          if (writeInfo.isWrite) {
            notifyDbMutated("viewer", writeInfo.table);
          }
        }
        const last = results[results.length - 1];
        const rows = serializeRows((last?.rows as Record<string, unknown>[]) ?? []);
        const columns = last?.fields?.map((f) => f.name) ?? (rows[0] ? Object.keys(rows[0]) : []);
        return {
          id: payload.id,
          rows,
          totalCount: rows.length,
          executionTimeMs: Math.round(performance.now() - start),
          columns,
          affectedRows: last?.affectedRows,
        };
      }

      const tableName = String(payload.table || "");
      const colRes = await db.query<{ column_name: string }>(
        \`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position ASC\`,
        [tableName]
      );
      const validCols = colRes.rows.map((r) => r.column_name);
      if (validCols.length === 0) throw new Error(\`Table "\${tableName}" not found\`);

      const safeTable = quoteIdent(tableName);
      const page = Math.max(1, Number(payload.page) || 1);
      const pageSize = Math.min(Math.max(1, Number(payload.pageSize) || 25), 200);
      const offset = (page - 1) * pageSize;
      const params: unknown[] = [];
      let whereClause = "";
      const search = typeof payload.search === "string" ? payload.search.trim() : "";
      if (search) {
        params.push(\`%\${search}%\`);
        whereClause = \`WHERE (\${validCols.map((c) => \`CAST(\${quoteIdent(c)} AS TEXT) ILIKE $1\`).join(" OR ")})\`;
      }
      let orderClause = "";
      if (payload.sortColumn && validCols.includes(payload.sortColumn)) {
        orderClause = \`ORDER BY \${quoteIdent(payload.sortColumn)} \${payload.sortDirection === "desc" ? "DESC" : "ASC"}\`;
      }
      const countRes = await db.query<{ total: number }>(\`SELECT COUNT(*)::int AS total FROM \${safeTable} \${whereClause}\`, params);
      const totalCount = Number(countRes.rows[0]?.total ?? 0);
      const dataRes = await db.query(
        \`SELECT * FROM \${safeTable} \${whereClause} \${orderClause} LIMIT $\${params.length + 1} OFFSET $\${params.length + 2}\`,
        [...params, pageSize, offset]
      );
      return {
        id: payload.id,
        rows: serializeRows(dataRes.rows as Record<string, unknown>[]),
        totalCount,
        executionTimeMs: Math.round(performance.now() - start),
        columns: validCols,
      };
    })());
  } catch (err: any) {
    return {
      id: payload.id,
      rows: [],
      totalCount: 0,
      executionTimeMs: Math.round(performance.now() - start),
      error: err?.message || "Query execution failed",
    };
  }
}

async function handleMutate(payload: any) {
  if (payload.readOnly) {
    return { id: payload.id, success: false, affectedRows: 0, error: "Database is in read-only mode during active generation" };
  }
  try {
    const db = await getRawDb();
    const tables = await introspectTables();
    const tableMeta = tables.find((t) => t.name === payload.table);
    if (!tableMeta) throw new Error(\`Table "\${payload.table}" not found\`);

    const validCols = new Set(tableMeta.columns.map((c: any) => c.name));
    const pkCols = tableMeta.columns.filter((c: any) => c.isPrimaryKey).map((c: any) => c.name);
    const safeTable = quoteIdent(payload.table);

    if (payload.action === "insert") {
      const entries = Object.entries(payload.record || {}).filter(([k, v]) => validCols.has(k) && v !== undefined);
      let res;
      if (entries.length === 0) {
        res = await db.query(\`INSERT INTO \${safeTable} DEFAULT VALUES RETURNING *\`);
      } else {
        const colsSql = entries.map(([k]) => quoteIdent(k)).join(", ");
        const placeholders = entries.map((_, i) => \`$\${i + 1}\`).join(", ");
        res = await db.query(\`INSERT INTO \${safeTable} (\${colsSql}) VALUES (\${placeholders}) RETURNING *\`, entries.map(([, v]) => v));
      }
      notifyDbMutated("viewer", payload.table);
      return { id: payload.id, success: true, affectedRows: res.affectedRows ?? res.rows.length ?? 1 };
    }

    if (tableMeta.isReadOnly || pkCols.length === 0) {
      throw new Error(\`Table "\${payload.table}" has no primary key and is read only\`);
    }
    const whereEntries = Object.entries(payload.where || {}).filter(([k]) => pkCols.includes(k));
    if (whereEntries.length === 0 || whereEntries.length !== pkCols.length) {
      throw new Error("Mutations require complete primary key values in WHERE clause");
    }

    if (payload.action === "update") {
      const updateEntries = Object.entries(payload.record || {}).filter(([k, v]) => validCols.has(k) && v !== undefined);
      if (updateEntries.length === 0) throw new Error("No columns provided for update");
      const setSql = updateEntries.map(([k], i) => \`\${quoteIdent(k)} = $\${i + 1}\`).join(", ");
      const whereSql = whereEntries.map(([k], i) => \`\${quoteIdent(k)} = $\${updateEntries.length + i + 1}\`).join(" AND ");
      const res = await db.query(
        \`UPDATE \${safeTable} SET \${setSql} WHERE \${whereSql}\`,
        [...updateEntries.map(([, v]) => v), ...whereEntries.map(([, v]) => v)]
      );
      notifyDbMutated("viewer", payload.table);
      return { id: payload.id, success: true, affectedRows: res.affectedRows ?? 1 };
    }

    if (payload.action === "delete") {
      const whereSql = whereEntries.map(([k], i) => \`\${quoteIdent(k)} = $\${i + 1}\`).join(" AND ");
      const res = await db.query(\`DELETE FROM \${safeTable} WHERE \${whereSql}\`, whereEntries.map(([, v]) => v));
      notifyDbMutated("viewer", payload.table);
      return { id: payload.id, success: true, affectedRows: res.affectedRows ?? 1 };
    }

    throw new Error(\`Unsupported action: \${payload.action}\`);
  } catch (err: any) {
    return { id: payload.id, success: false, affectedRows: 0, error: err?.message || "Mutation failed" };
  }
}

async function handleExportSeed(payload: any) {
  try {
    const db = await getRawDb();
    const tables = await introspectTables();
    if (tables.length === 0) {
      return { id: payload.id, sql: "-- No tables found in public schema\\n", tableCount: 0, rowCount: 0 };
    }
    const fkRes = await db.query<{ child_table: string; parent_table: string }>(
      \`SELECT DISTINCT tc.table_name AS child_table, ccu.table_name AS parent_table FROM information_schema.table_constraints tc JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public' AND ccu.table_schema = 'public'\`
    );
    const deps = new Map<string, Set<string>>();
    for (const t of tables) deps.set(t.name, new Set());
    for (const fk of fkRes.rows) {
      if (fk.child_table !== fk.parent_table && deps.has(fk.child_table) && deps.has(fk.parent_table)) {
        deps.get(fk.child_table)?.add(fk.parent_table);
      }
    }
    const ordered: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const visit = (name: string) => {
      if (visited.has(name) || visiting.has(name)) return;
      visiting.add(name);
      for (const p of Array.from(deps.get(name) ?? []).sort()) visit(p);
      visiting.delete(name);
      visited.add(name);
      ordered.push(name);
    };
    for (const t of [...tables].map((x) => x.name).sort()) visit(t);

    const tableMap = new Map(tables.map((t) => [t.name, t]));
    const lines = ["-- Sparkweb generated database seed", \`-- Exported at \${new Date().toISOString()}\`, ""];
    let rowCount = 0;

    for (const tableName of ordered) {
      const meta = tableMap.get(tableName);
      if (!meta || meta.columns.length === 0) continue;
      const pkCols = meta.columns.filter((c: any) => c.isPrimaryKey).map((c: any) => c.name);
      const orderSql = pkCols.length > 0 ? \`ORDER BY \${pkCols.map((c: string) => quoteIdent(c)).join(", ")} ASC\` : "";
      const dataRes = await db.query(\`SELECT * FROM \${quoteIdent(tableName)} \${orderSql}\`);
      if (dataRes.rows.length > 0) {
        lines.push(\`-- Table: \${tableName} (\${dataRes.rows.length} rows)\`);
        const colsSql = meta.columns.map((c: any) => quoteIdent(c.name)).join(", ");
        const suffix = pkCols.length > 0 ? " ON CONFLICT DO NOTHING" : "";
        for (const row of dataRes.rows as Record<string, unknown>[]) {
          const valsSql = meta.columns.map((c: any) => toSqlLiteral(row[c.name], c.type)).join(", ");
          lines.push(\`INSERT INTO \${quoteIdent(tableName)} (\${colsSql}) VALUES (\${valsSql})\${suffix};\`);
          rowCount++;
        }
        lines.push("");
      }
      for (const col of meta.columns) {
        if (col.isIdentity) {
          const escT = tableName.replace(/'/g, "''");
          const escC = col.name.replace(/'/g, "''");
          const qT = quoteIdent(tableName);
          const qC = quoteIdent(col.name);
          lines.push(\`SELECT setval(pg_get_serial_sequence('\${escT}', '\${escC}'), COALESCE((SELECT MAX(\${qC}) FROM \${qT}), 1), (SELECT COUNT(*) > 0 FROM \${qT}));\`);
        }
      }
    }

    const sql = \`\${lines.join("\\n").trimEnd()}\\n\`;
    if (new TextEncoder().encode(sql).byteLength > 500 * 1024) {
      throw new Error("Exported seed.sql exceeds the 500KB limit");
    }
    return { id: payload.id, sql, tableCount: ordered.length, rowCount };
  } catch (err: any) {
    return { id: payload.id, sql: "", tableCount: 0, rowCount: 0, error: err?.message || "Failed to export seed data" };
  }
}

window.addEventListener("message", async (event: MessageEvent) => {
  const data = event.data;
  if (!data || typeof data !== "object" || data.protocol !== BRIDGE_PROTOCOL) return;

  if (data.type === "DB_INTROSPECT_REQUEST") {
    try {
      const tables = await introspectTables();
      postToParent("DB_INTROSPECT_RESPONSE", { id: data.payload?.id, tables });
    } catch (err: any) {
      postToParent("DB_INTROSPECT_RESPONSE", { id: data.payload?.id, tables: [], error: err?.message || "Introspection failed" });
    }
  } else if (data.type === "DB_QUERY_REQUEST") {
    const res = await handleQuery(data.payload || {});
    postToParent("DB_QUERY_RESPONSE", res);
  } else if (data.type === "DB_MUTATE_REQUEST") {
    const res = await handleMutate(data.payload || {});
    postToParent("DB_MUTATE_RESPONSE", res);
  } else if (data.type === "DB_EXPORT_SEED_REQUEST") {
    const res = await handleExportSeed(data.payload || {});
    postToParent("DB_EXPORT_SEED_RESPONSE", res);
  }
});

// Emit DB_READY_EVENT once PGlite initializes
getRawDb()
  .then(async () => {
    const tables = await introspectTables();
    postToParent("DB_READY_EVENT", { tableCount: tables.length });
  })
  .catch(() => {
    postToParent("DB_READY_EVENT", { tableCount: 0 });
  });
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

let rawDbInstance: PGlite | null = null;
let wrappedDbInstance: PGlite | null = null;
let initPromise: Promise<PGlite> | null = null;
let seedReplayed = false;
let seedReplayPromise: Promise<boolean> | null = null;

function detectAppWrite(sqlText: string): { isWrite: boolean; isCreateTable: boolean; table?: string } {
  const cleaned = sqlText
    .replace(/--[^\\n]*/g, " ")
    .replace(/\\/\\*[\\s\\S]*?\\*\\//g, " ")
    .replace(/'(?:''|[^'])*'/g, "''")
    .trim();
  if (!cleaned) return { isWrite: false, isCreateTable: false };
  const isCreateTable = /\\bCREATE\\s+(?:TEMP\\s+|TEMPORARY\\s+)?TABLE\\b/i.test(cleaned);
  const match = cleaned.match(
    /\\b(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM|TRUNCATE\\s+(?:TABLE\\s+)?|CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?|ALTER\\s+TABLE|DROP\\s+TABLE(?:\\s+IF\\s+EXISTS)?)\\s+(?:"?public"?\\.)?"?([a-zA-Z_][a-zA-Z0-9_$]*)"?/i
  );
  if (match) return { isWrite: true, isCreateTable, table: match[2] };
  if (/\\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\\b/i.test(cleaned)) {
    return { isWrite: true, isCreateTable };
  }
  return { isWrite: false, isCreateTable };
}

function emitAppMutation(table?: string) {
  if (typeof window === "undefined") return;
  if (window.parent && window.parent !== window) {
    window.parent.postMessage(
      {
        protocol: "sparkweb:bridge:v1",
        type: "DB_MUTATED_EVENT",
        source: "sparkweb:sandbox",
        payload: { origin: "app", ...(table ? { table } : {}) },
        timestamp: Date.now(),
      },
      "*"
    );
  }
  window.dispatchEvent(
    new CustomEvent("spark:db-mutated", { detail: { origin: "app", table } })
  );
}

function extractSeedTables(seedSql: string): string[] {
  const tables = new Set<string>();
  const regex = /\\bINSERT\\s+INTO\\s+(?:"?public"?\\.)?(?:"((?:[^"]|"")+)"|([a-zA-Z_][a-zA-Z0-9_$]*))/gi;
  let match = regex.exec(seedSql);
  while (match !== null) {
    const tableName = match[1] ? match[1].replace(/""/g, '"') : match[2];
    if (tableName) tables.add(tableName);
    match = regex.exec(seedSql);
  }
  return Array.from(tables);
}

async function fetchSeedSql(): Promise<string | null> {
  if (typeof fetch !== "function") return null;
  try {
    const res = await fetch("/seed.sql", { cache: "no-store" });
    if (!res.ok) return null;
    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("text/html")) return null;
    const text = await res.text();
    const trimmed = text.trim();
    if (!trimmed || trimmed.startsWith("<")) return null;
    return trimmed;
  } catch {
    return null;
  }
}

export async function replaySeedIfPresent(dbArg?: PGlite): Promise<boolean> {
  if (seedReplayed) return false;
  if (seedReplayPromise) return seedReplayPromise;

  seedReplayPromise = (async () => {
    try {
      const target = dbArg ?? (await getRawDb());
      const seedSql = await fetchSeedSql();
      if (!seedSql) return false;

      const requiredTables = extractSeedTables(seedSql);
      if (requiredTables.length === 0) {
        seedReplayed = true;
        return false;
      }

      const existingRes = await target.query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
      );
      const existingSet = new Set(existingRes.rows.map((r) => r.table_name));
      if (!requiredTables.every((tbl) => existingSet.has(tbl))) {
        return false;
      }

      await target.exec(seedSql);
      seedReplayed = true;
      emitAppMutation();
      return true;
    } catch (err) {
      console.warn("Failed to replay seed.sql:", err);
      return false;
    } finally {
      seedReplayPromise = null;
    }
  })();

  return seedReplayPromise;
}

export async function getRawDb(): Promise<PGlite> {
  if (rawDbInstance) return rawDbInstance;
  if (!initPromise) {
    initPromise = (async () => {
      const instance = new PGlite();
      await instance.waitReady;
      rawDbInstance = instance;
      return instance;
    })();
  }
  return initPromise;
}

export async function getDb(): Promise<PGlite> {
  if (wrappedDbInstance) return wrappedDbInstance;
  const raw = await getRawDb();

  wrappedDbInstance = new Proxy(raw, {
    get(target, prop, receiver) {
      if (prop === "exec") {
        return async (sql: string) => {
          const result = await target.exec(sql);
          const write = detectAppWrite(sql);
          if (write.isCreateTable && !seedReplayed) {
            await replaySeedIfPresent(target);
          }
          if (write.isWrite) {
            emitAppMutation(write.table);
          }
          return result;
        };
      }
      if (prop === "query") {
        return async (sql: string, params?: any[]) => {
          const result = await target.query(sql, params);
          const write = detectAppWrite(sql);
          if (write.isCreateTable && !seedReplayed) {
            await replaySeedIfPresent(target);
          }
          if (write.isWrite) {
            emitAppMutation(write.table);
          }
          return result;
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  return wrappedDbInstance;
}
`,
  },
  "src/App.tsx": {
    content: `import React, { useState, useEffect, useCallback } from "react";
import { Sparkles, Database, Plus } from "lucide-react";
import { getDb, replaySeedIfPresent } from "./lib/db";

export default function App() {
  const [count, setCount] = useState(0);
  const [dbStatus, setDbStatus] = useState<string>("Initializing PGlite...");
  const [itemCount, setItemCount] = useState<number>(0);

  const refreshItems = useCallback(async () => {
    try {
      const db = await getDb();
      const res = await db.query<{ total: number }>("SELECT COUNT(*)::int AS total FROM demo_items");
      setItemCount(Number(res.rows[0]?.total ?? 0));
    } catch {
      // Ignore if table not yet created
    }
  }, []);

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
        await replaySeedIfPresent();
        setDbStatus("PGlite WASM database ready");
        await refreshItems();
      } catch (err: any) {
        setDbStatus("Database: " + (err?.message || "Ready"));
      }
    }
    initDb();

    const onDbMutated = () => {
      refreshItems();
    };
    window.addEventListener("spark:db-mutated", onDbMutated);
    return () => window.removeEventListener("spark:db-mutated", onDbMutated);
  }, [refreshItems]);

  const handleAddSampleItem = async () => {
    const next = count + 1;
    setCount(next);
    try {
      const db = await getDb();
      await db.query("INSERT INTO demo_items (name) VALUES ($1)", [\`Item #\${next}\`]);
      await refreshItems();
    } catch {
      // Ignore
    }
  };

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
            <span className="text-sm font-medium text-slate-300">Demo Records</span>
            <span className="rounded-lg bg-indigo-500/10 px-2.5 py-1 font-mono text-sm font-semibold text-indigo-400">
              {itemCount}
            </span>
          </div>
          <button
            onClick={handleAddSampleItem}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-500 active:scale-[0.98]"
          >
            <Plus className="h-4 w-4" /> Add Demo Record
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

/**
 * Upgrade snapshots created with the legacy pre-fix starter `src/lib/db.ts`
 * (which ran `seed.sql` via `import.meta.glob` inside `getRawDb()` before
 * tables were created) to the fixed post-DDL seed replay template.
 */
export function upgradeLegacyDbTemplate(files: SnapshotFilesMap): SnapshotFilesMap {
  const dbEntry = files["src/lib/db.ts"];
  const latestDbEntry = STARTER_TEMPLATE_FILES["src/lib/db.ts"];
  if (!dbEntry || !latestDbEntry) {
    return files;
  }

  const content = dbEntry.content;
  const isLegacyBrokenDbTemplate =
    content.includes('import.meta.glob("/seed.sql"') &&
    content.includes("await replaySeedIfPresent(instance);");

  if (!isLegacyBrokenDbTemplate) {
    return files;
  }

  return {
    ...files,
    "src/lib/db.ts": latestDbEntry,
  };
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
