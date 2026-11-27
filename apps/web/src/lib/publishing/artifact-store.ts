import { createHash, createHmac } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ArtifactObject, ArtifactStore, ArtifactUploadSummary } from "./types";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".data": "application/octet-stream",
  ".sql": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

export function inferContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

function normalizeArtifactKey(rawKey: string): string {
  const cleaned = rawKey.replace(/^\/+/, "").replace(/\\/g, "/");
  if (!cleaned || cleaned.includes("..") || cleaned.includes("\0")) {
    throw new Error(`Invalid artifact key: ${rawKey}`);
  }
  return cleaned;
}

async function collectFilesRecursively(
  rootDir: string,
  currentDir = rootDir
): Promise<Array<{ relativePath: string; fullPath: string }>> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const results: Array<{ relativePath: string; fullPath: string }> = [];

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectFilesRecursively(rootDir, fullPath);
      results.push(...nested);
    } else if (entry.isFile()) {
      const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, "/");
      results.push({ relativePath, fullPath });
    }
  }

  return results;
}

export class LocalFsArtifactStore implements ArtifactStore {
  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = path.resolve(
      /*turbopackIgnore: true*/
      baseDir || process.env.LOCAL_ARTIFACTS_DIR || path.join(os.tmpdir(), "sparkweb-artifacts")
    );
  }

  private resolveSafePath(key: string): string {
    const normalized = normalizeArtifactKey(key);
    const resolved = path.resolve(this.baseDir, normalized);
    if (resolved !== this.baseDir && !resolved.startsWith(`${this.baseDir}${path.sep}`)) {
      throw new Error(`Artifact path escapes storage root: ${key}`);
    }
    return resolved;
  }

  async putObject(key: string, body: Uint8Array, _contentType: string): Promise<void> {
    const targetPath = this.resolveSafePath(key);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, body);
  }

  async uploadDirectory(prefix: string, localDirPath: string): Promise<ArtifactUploadSummary> {
    const normalizedPrefix = normalizeArtifactKey(prefix).replace(/\/+$/, "");
    const files = await collectFilesRecursively(localDirPath);
    let totalBytes = 0;

    for (const file of files) {
      const body = await readFile(file.fullPath);
      totalBytes += body.byteLength;
      const key = `${normalizedPrefix}/${file.relativePath}`;
      await this.putObject(key, body, inferContentType(file.relativePath));
    }

    return {
      fileCount: files.length,
      totalBytes,
    };
  }

  async getObject(key: string): Promise<ArtifactObject | null> {
    const targetPath = this.resolveSafePath(key);
    try {
      const buffer = await readFile(targetPath);
      return {
        body: new Uint8Array(buffer),
        contentType: inferContentType(key),
        size: buffer.byteLength,
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw err;
    }
  }

  async deleteObject(key: string): Promise<void> {
    const targetPath = this.resolveSafePath(key);
    await rm(targetPath, { force: true });
  }

  async deletePrefix(prefix: string): Promise<void> {
    const targetDir = this.resolveSafePath(prefix.replace(/\/+$/, ""));
    await rm(targetDir, { recursive: true, force: true });
  }
}

export interface S3ArtifactStoreConfig {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
}

function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

/**
 * S3-compatible object store implementation (for Cloudflare R2 and S3) using
 * AWS Signature V4 over standard Fetch without extra SDK dependencies.
 */
export class S3ArtifactStore implements ArtifactStore {
  private readonly endpoint: URL;
  private readonly bucket: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;
  private readonly region: string;

  constructor(config: S3ArtifactStoreConfig) {
    this.endpoint = new URL(config.endpoint);
    this.bucket = config.bucket;
    this.accessKeyId = config.accessKeyId;
    this.secretAccessKey = config.secretAccessKey;
    this.region = config.region || "auto";
  }

  private signRequest(
    method: "GET" | "PUT" | "DELETE",
    objectPath: string,
    query: Record<string, string>,
    payload: Uint8Array | string,
    extraHeaders: Record<string, string> = {}
  ): { url: string; headers: Record<string, string> } {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);

    const encodedPath = objectPath
      .split("/")
      .map((seg) => encodeRfc3986(seg))
      .join("/");
    const canonicalUri = encodedPath.startsWith("/") ? encodedPath : `/${encodedPath}`;

    const sortedQueryKeys = Object.keys(query).sort();
    const canonicalQuery = sortedQueryKeys
      .map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(query[k] ?? "")}`)
      .join("&");

    const payloadHash = sha256Hex(payload);
    const headersMap: Record<string, string> = {
      host: this.endpoint.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      ...Object.fromEntries(
        Object.entries(extraHeaders).map(([k, v]) => [k.toLowerCase(), v.trim()])
      ),
    };

    const sortedHeaderKeys = Object.keys(headersMap).sort();
    const canonicalHeaders = sortedHeaderKeys.map((k) => `${k}:${headersMap[k]}\n`).join("");
    const signedHeaders = sortedHeaderKeys.join(";");

    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQuery,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");

    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join("\n");

    const kDate = hmacSha256(`AWS4${this.secretAccessKey}`, dateStamp);
    const kRegion = hmacSha256(kDate, this.region);
    const kService = hmacSha256(kRegion, "s3");
    const kSigning = hmacSha256(kService, "aws4_request");
    const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");

    const authorization = `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const baseUrl = `${this.endpoint.origin}${canonicalUri}`;
    const fullUrl = canonicalQuery ? `${baseUrl}?${canonicalQuery}` : baseUrl;

    return {
      url: fullUrl,
      headers: {
        ...headersMap,
        Authorization: authorization,
      },
    };
  }

  async putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
    const normalizedKey = normalizeArtifactKey(key);
    const signed = this.signRequest("PUT", `/${this.bucket}/${normalizedKey}`, {}, body, {
      "content-type": contentType,
    });
    const res = await fetch(signed.url, {
      method: "PUT",
      headers: signed.headers,
      body: Buffer.from(body),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`S3 putObject failed (${res.status}): ${errText}`);
    }
  }

  async uploadDirectory(prefix: string, localDirPath: string): Promise<ArtifactUploadSummary> {
    const normalizedPrefix = normalizeArtifactKey(prefix).replace(/\/+$/, "");
    const files = await collectFilesRecursively(localDirPath);
    let totalBytes = 0;

    for (const file of files) {
      const body = await readFile(file.fullPath);
      totalBytes += body.byteLength;
      const key = `${normalizedPrefix}/${file.relativePath}`;
      await this.putObject(key, body, inferContentType(file.relativePath));
    }

    return { fileCount: files.length, totalBytes };
  }

  async getObject(key: string): Promise<ArtifactObject | null> {
    const normalizedKey = normalizeArtifactKey(key);
    const signed = this.signRequest("GET", `/${this.bucket}/${normalizedKey}`, {}, "");
    const res = await fetch(signed.url, {
      method: "GET",
      headers: signed.headers,
    });
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      throw new Error(`S3 getObject failed (${res.status})`);
    }
    const arrayBuffer = await res.arrayBuffer();
    const body = new Uint8Array(arrayBuffer);
    return {
      body,
      contentType: res.headers.get("content-type") || inferContentType(normalizedKey),
      size: body.byteLength,
    };
  }

  async deleteObject(key: string): Promise<void> {
    const normalizedKey = normalizeArtifactKey(key);
    const delSigned = this.signRequest("DELETE", `/${this.bucket}/${normalizedKey}`, {}, "");
    const delRes = await fetch(delSigned.url, {
      method: "DELETE",
      headers: delSigned.headers,
    });
    if (!delRes.ok && delRes.status !== 404) {
      throw new Error(`S3 deleteObject failed (${delRes.status}) for ${normalizedKey}`);
    }
  }

  async deletePrefix(prefix: string): Promise<void> {
    const normalizedPrefix = normalizeArtifactKey(prefix).replace(/\/+$/, "");
    let continuationToken: string | undefined;

    do {
      const query: Record<string, string> = {
        "list-type": "2",
        prefix: `${normalizedPrefix}/`,
      };
      if (continuationToken) {
        query["continuation-token"] = continuationToken;
      }

      const signed = this.signRequest("GET", `/${this.bucket}`, query, "");
      const res = await fetch(signed.url, { method: "GET", headers: signed.headers });
      if (!res.ok) {
        throw new Error(`S3 listObjectsV2 failed (${res.status})`);
      }
      const xml = await res.text();
      const keys = Array.from(xml.matchAll(/<Key>([^<]+)<\/Key>/g)).map((m) => m[1] || "");

      for (const objKey of keys) {
        if (!objKey) continue;
        const delSigned = this.signRequest("DELETE", `/${this.bucket}/${objKey}`, {}, "");
        const delRes = await fetch(delSigned.url, {
          method: "DELETE",
          headers: delSigned.headers,
        });
        if (!delRes.ok && delRes.status !== 404) {
          throw new Error(`S3 deleteObject failed (${delRes.status}) for ${objKey}`);
        }
      }

      const tokenMatch = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml);
      continuationToken = tokenMatch?.[1];
    } while (continuationToken);
  }
}
