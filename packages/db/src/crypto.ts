import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { SnapshotFilesMap } from "./schema/snapshots";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;
const KEY_LENGTH_BYTES = 32;

export interface EncryptedPayload {
  encryptedKey: string;
  iv: string;
  authTag: string;
}

export function resolveMasterEncryptionKey(overrideKey?: string): Buffer {
  const keySource = overrideKey ?? process.env.SPARK_ENCRYPTION_KEY;
  if (!keySource) {
    throw new Error(
      "Master encryption key is missing. Set SPARK_ENCRYPTION_KEY environment variable (32 bytes / 64 hex characters)."
    );
  }

  const trimmed = keySource.trim();

  // If provided as 64 character hex string
  if (trimmed.length === 64 && /^[0-9a-fA-F]+$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }

  // If provided as UTF-8 string of 32 characters
  const rawBuf = Buffer.from(trimmed, "utf8");
  if (rawBuf.length === KEY_LENGTH_BYTES) {
    return rawBuf;
  }

  // Derive 32-byte key via SHA-256 if arbitrary length string is provided
  return createHash("sha256").update(rawBuf).digest();
}

export function encryptApiKey(rawKey: string, masterKeyInput?: string): EncryptedPayload {
  if (!rawKey || typeof rawKey !== "string") {
    throw new Error("Cannot encrypt empty or invalid raw API key");
  }

  const keyBuffer = resolveMasterEncryptionKey(masterKeyInput);
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, keyBuffer, iv);

  let encrypted = cipher.update(rawKey, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  return {
    encryptedKey: encrypted,
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
  };
}

export function decryptApiKey(payload: EncryptedPayload, masterKeyInput?: string): string {
  const { encryptedKey, iv, authTag } = payload;
  if (!encryptedKey || !iv || !authTag) {
    throw new Error(
      "Missing required encryption fields: encryptedKey, iv, and authTag are all required"
    );
  }

  const keyBuffer = resolveMasterEncryptionKey(masterKeyInput);
  const ivBuffer = Buffer.from(iv, "hex");
  const authTagBuffer = Buffer.from(authTag, "hex");

  if (authTagBuffer.length !== AUTH_TAG_LENGTH_BYTES) {
    throw new Error("Invalid authentication tag length");
  }

  const decipher = createDecipheriv(ALGORITHM, keyBuffer, ivBuffer);
  decipher.setAuthTag(authTagBuffer);

  let decrypted = decipher.update(encryptedKey, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

export function extractKeyHint(rawKey: string): string {
  if (!rawKey || typeof rawKey !== "string") {
    return "****";
  }

  const trimmed = rawKey.trim();
  if (trimmed.length <= 8) {
    return `***${trimmed.slice(-2)}`;
  }

  // Support vendor prefixes like sk-or-v1, sk-ant, sk-proj, sk, gsk
  if (trimmed.startsWith("sk-or-")) {
    return `sk-or-...${trimmed.slice(-4)}`;
  }
  if (trimmed.startsWith("sk-ant-")) {
    return `sk-ant-...${trimmed.slice(-4)}`;
  }
  if (trimmed.startsWith("sk-proj-")) {
    return `sk-proj-...${trimmed.slice(-4)}`;
  }
  if (trimmed.startsWith("sk-")) {
    return `sk-...${trimmed.slice(-4)}`;
  }
  if (trimmed.startsWith("gsk_")) {
    return `gsk_...${trimmed.slice(-4)}`;
  }

  const firstUnderscoreIndex = trimmed.indexOf("_");
  if (firstUnderscoreIndex > 0 && firstUnderscoreIndex <= 8) {
    const prefix = trimmed.slice(0, firstUnderscoreIndex);
    return `${prefix}_...${trimmed.slice(-4)}`;
  }

  const firstDashIndex = trimmed.indexOf("-");
  if (firstDashIndex > 0 && firstDashIndex <= 8) {
    const prefix = trimmed.slice(0, firstDashIndex);
    return `${prefix}-...${trimmed.slice(-4)}`;
  }

  // Default fallback: first 3 characters + '...' + last 4 characters
  return `${trimmed.slice(0, 3)}...${trimmed.slice(-4)}`;
}

export function computeSnapshotTreeHash(files: SnapshotFilesMap): string {
  const hash = createHash("sha256");

  // Canonical alphabetical ordering of normalized relative file paths
  const sortedPaths = Object.keys(files).sort();

  for (const path of sortedPaths) {
    const file = files[path];
    if (!file) continue;

    hash.update(path);
    hash.update("\0");
    hash.update(file.isBinary ? "1" : "0");
    hash.update("\0");
    hash.update(String(Buffer.byteLength(file.content, "utf8")));
    hash.update("\0");
    hash.update(file.content);
    hash.update("\n");
  }

  return hash.digest("hex");
}
