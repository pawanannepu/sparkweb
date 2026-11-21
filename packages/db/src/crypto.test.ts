import { describe, expect, it } from "vitest";
import {
  computeSnapshotTreeHash,
  decryptApiKey,
  encryptApiKey,
  extractKeyHint,
  resolveMasterEncryptionKey,
} from "./crypto";

describe("crypto helpers", () => {
  const testMasterKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  it("resolves valid 64 character hex master encryption key", () => {
    const key = resolveMasterEncryptionKey(testMasterKey);
    expect(key.length).toBe(32);
  });

  it("encrypts and decrypts API key with AES 256 GCM authentication tag", () => {
    const rawSecret = "sk-ant-api03-test-secret-key-123456789";

    const encrypted = encryptApiKey(rawSecret, testMasterKey);
    expect(encrypted.encryptedKey).toBeDefined();
    expect(encrypted.iv.length).toBe(24); // 12 bytes in hex = 24 chars
    expect(encrypted.authTag.length).toBe(32); // 16 bytes in hex = 32 chars
    expect(encrypted.encryptedKey).not.toContain(rawSecret);

    const decrypted = decryptApiKey(encrypted, testMasterKey);
    expect(decrypted).toBe(rawSecret);
  });

  it("fails to decrypt if ciphertext or auth tag is tampered", () => {
    const rawSecret = "sk-openai-super-secret-key";
    const encrypted = encryptApiKey(rawSecret, testMasterKey);

    // Tamper with authentication tag
    const tamperedTag =
      encrypted.authTag.slice(0, -2) + (encrypted.authTag.endsWith("0") ? "1" : "0");

    expect(() => decryptApiKey({ ...encrypted, authTag: tamperedTag }, testMasterKey)).toThrow();
  });

  it("extracts key hints safely without exposing secret material", () => {
    expect(extractKeyHint("sk-ant-api03-long-secret-key-9999")).toBe("sk-ant-...9999");
    expect(extractKeyHint("sk-proj-super-secret-key-4321")).toBe("sk-proj-...4321");
    expect(extractKeyHint("sk-openai-1234")).toBe("sk-...1234");
    expect(extractKeyHint("gsk_groq_key_5678")).toBe("gsk_...5678");
    expect(extractKeyHint("custom_vendor_key_1111")).toBe("custom_...1111");
    expect(extractKeyHint("short")).toBe("***rt");
    expect(extractKeyHint("")).toBe("****");
  });

  it("throws when resolving master key with empty input and missing env variable", () => {
    const originalEnv = process.env.SPARK_ENCRYPTION_KEY;
    delete process.env.SPARK_ENCRYPTION_KEY;

    try {
      expect(() => resolveMasterEncryptionKey()).toThrow("Master encryption key is missing");
    } finally {
      if (originalEnv) {
        process.env.SPARK_ENCRYPTION_KEY = originalEnv;
      }
    }
  });

  it("derives a valid 32 byte key from arbitrary length passphrase using SHA 256", () => {
    const derived = resolveMasterEncryptionKey("short-passphrase");
    expect(derived.length).toBe(32);
  });

  it("rejects encryption with empty or non string raw key", () => {
    expect(() => encryptApiKey("", testMasterKey)).toThrow("Cannot encrypt empty");
    // @ts-expect-error test invalid type
    expect(() => encryptApiKey(null, testMasterKey)).toThrow("Cannot encrypt empty");
  });

  it("rejects decryption with incomplete payload fields or invalid auth tag length", () => {
    expect(() =>
      decryptApiKey({ encryptedKey: "", iv: "1234", authTag: "5678" }, testMasterKey)
    ).toThrow("Missing required encryption fields");

    expect(() =>
      decryptApiKey(
        { encryptedKey: "deadbeef", iv: "0123456789abcdef01234567", authTag: "shorttag" },
        testMasterKey
      )
    ).toThrow("Invalid authentication tag length");
  });

  it("computes deterministic snapshot tree hash regardless of key insertion order", () => {
    const filesA = {
      "src/index.ts": { content: "console.log('hello');" },
      "package.json": { content: '{"name": "test"}' },
      "public/logo.svg": { content: "<svg></svg>", isBinary: false },
    };

    const filesB = {
      "package.json": { content: '{"name": "test"}' },
      "public/logo.svg": { content: "<svg></svg>", isBinary: false },
      "src/index.ts": { content: "console.log('hello');" },
    };

    const hashA = computeSnapshotTreeHash(filesA);
    const hashB = computeSnapshotTreeHash(filesB);

    expect(hashA).toBe(hashB);
    expect(hashA.length).toBe(64); // SHA-256 hex string

    // Modifying one byte changes the tree hash
    const filesC = {
      ...filesA,
      "src/index.ts": { content: "console.log('hello!');" },
    };
    const hashC = computeSnapshotTreeHash(filesC);
    expect(hashC).not.toBe(hashA);
  });
});
