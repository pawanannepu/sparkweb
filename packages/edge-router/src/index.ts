export interface EdgeKvNamespace {
  get(key: string, type: "json"): Promise<EdgeHostRoute | null>;
  get(key: string): Promise<string | null>;
}

export interface EdgeR2Object {
  body: ReadableStream<Uint8Array> | ArrayBuffer | string | null;
  httpMetadata?: {
    contentType?: string;
  };
}

export interface EdgeR2Bucket {
  get(key: string): Promise<EdgeR2Object | null>;
}

export interface EdgeHostRoute {
  deploymentId: string;
  projectId: string;
  artifactKey: string;
  updatedAt: string;
}

export interface EdgeRouterEnv {
  SPARK_ROUTES: EdgeKvNamespace;
  SPARK_ARTIFACTS: EdgeR2Bucket;
}

const CONTENT_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "application/javascript; charset=utf-8",
  mjs: "application/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  wasm: "application/wasm",
  data: "application/octet-stream",
  sql: "text/plain; charset=utf-8",
  txt: "text/plain; charset=utf-8",
};

function inferMimeType(relativePath: string): string {
  const lastDot = relativePath.lastIndexOf(".");
  if (lastDot === -1) return "application/octet-stream";
  const ext = relativePath.slice(lastDot + 1).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

function createSecurityHeaders(relativePath: string, contentType: string): Headers {
  const headers = new Headers();
  headers.set("Content-Type", contentType);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Frame-Options", "SAMEORIGIN");

  if (relativePath.startsWith("assets/")) {
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
  } else if (relativePath === "index.html") {
    headers.set("Cache-Control", "no-cache");
  } else {
    headers.set("Cache-Control", "public, max-age=300");
  }

  return headers;
}

function hasFileExtension(relativePath: string): boolean {
  const lastSlash = relativePath.lastIndexOf("/");
  const fileName = lastSlash === -1 ? relativePath : relativePath.slice(lastSlash + 1);
  return fileName.includes(".");
}

export async function handleEdgeRequest(request: Request, env: EdgeRouterEnv): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: createSecurityHeaders("index.html", "text/plain; charset=utf-8"),
    });
  }

  const url = new URL(request.url);
  const hostHeader = (request.headers.get("host") || url.hostname).toLowerCase().trim();
  const hostname = hostHeader.replace(/:\d+$/, "");

  const route = await env.SPARK_ROUTES.get(`host:${hostname}`, "json");
  if (!route?.artifactKey) {
    return new Response("Site not found", {
      status: 404,
      headers: createSecurityHeaders("index.html", "text/plain; charset=utf-8"),
    });
  }

  const cleanedPath = url.pathname.replace(/^\/+/, "");
  if (cleanedPath.includes("..") || cleanedPath.includes("\0")) {
    return new Response("Not found", {
      status: 404,
      headers: createSecurityHeaders("index.html", "text/plain; charset=utf-8"),
    });
  }

  const relativePath = cleanedPath || "index.html";
  const prefix = route.artifactKey.replace(/\/+$/, "");

  const asset = await env.SPARK_ARTIFACTS.get(`${prefix}/${relativePath}`);
  if (asset) {
    const contentType = asset.httpMetadata?.contentType || inferMimeType(relativePath);
    return new Response(request.method === "HEAD" ? null : asset.body, {
      status: 200,
      headers: createSecurityHeaders(relativePath, contentType),
    });
  }

  if (!hasFileExtension(relativePath)) {
    const indexAsset = await env.SPARK_ARTIFACTS.get(`${prefix}/index.html`);
    if (indexAsset) {
      return new Response(request.method === "HEAD" ? null : indexAsset.body, {
        status: 200,
        headers: createSecurityHeaders("index.html", "text/html; charset=utf-8"),
      });
    }
  }

  return new Response("Not found", {
    status: 404,
    headers: createSecurityHeaders("index.html", "text/plain; charset=utf-8"),
  });
}

export const edgeWorker = {
  fetch: handleEdgeRequest,
};
