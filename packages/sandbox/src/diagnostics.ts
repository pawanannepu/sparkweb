import type { HealingCategory, PreviewErrorPayload } from "@spark/shared";

// Pure JavaScript synchronous SHA-256 implementation
function pureSha256(ascii: string): string {
  function rightRotate(value: number, amount: number) {
    return (value >>> amount) | (value << (32 - amount));
  }

  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  let i = 0;
  let j = 0;

  const words: number[] = [];
  const asciiBitLength = ascii.length * 8;

  // Initial hash values (first 32 bits of the fractional parts of the square roots of the first 8 primes 2..19)
  const hash: number[] = [];
  const k: number[] = [];

  let primeCounter = 0;
  const isComposite: Record<number, boolean> = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (let composite = candidate * candidate; composite < 312; composite += candidate) {
        isComposite[composite] = true;
      }
      if (primeCounter < 8) {
        hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      }
      k[primeCounter] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
      primeCounter++;
    }
  }

  // Pre-processing (Padding)
  for (i = 0; i < ascii.length; i++) {
    j = ascii.charCodeAt(i);
    words[i >> 2] |= j << ((3 - (i % 4)) * 8);
  }
  words[ascii.length >> 2] |= 0x80 << ((3 - (ascii.length % 4)) * 8);
  words[(((asciiBitLength + 64) >> 9) << 4) + 15] = asciiBitLength;

  // Process the hash in successive 512-bit chunks
  for (let chunk = 0; chunk < words.length; chunk += 16) {
    const w: number[] = [];
    for (i = 0; i < 16; i++) {
      w[i] = words[chunk + i] || 0;
    }
    for (i = 16; i < 64; i++) {
      const s0 =
        rightRotate(w[i - 15] || 0, 7) ^ rightRotate(w[i - 15] || 0, 18) ^ ((w[i - 15] || 0) >>> 3);
      const s1 =
        rightRotate(w[i - 2] || 0, 17) ^ rightRotate(w[i - 2] || 0, 19) ^ ((w[i - 2] || 0) >>> 10);
      w[i] = ((((w[i - 16] || 0) + s0) | 0) + (((w[i - 7] || 0) + s1) | 0)) | 0;
    }

    let a = hash[0] || 0;
    let b = hash[1] || 0;
    let c = hash[2] || 0;
    let d = hash[3] || 0;
    let e = hash[4] || 0;
    let f = hash[5] || 0;
    let g = hash[6] || 0;
    let h = hash[7] || 0;

    for (i = 0; i < 64; i++) {
      const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (((((((h + S1) | 0) + ch) | 0) + (k[i] || 0)) | 0) + (w[i] || 0)) | 0;
      const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    hash[0] = (hash[0] + a) | 0;
    hash[1] = (hash[1] + b) | 0;
    hash[2] = (hash[2] + c) | 0;
    hash[3] = (hash[3] + d) | 0;
    hash[4] = (hash[4] + e) | 0;
    hash[5] = (hash[5] + f) | 0;
    hash[6] = (hash[6] + g) | 0;
    hash[7] = (hash[7] + h) | 0;
  }

  // Produce the final hash value (big-endian) as a hex string
  let result = "";
  for (i = 0; i < 8; i++) {
    for (j = 3; j >= 0; j--) {
      const bVal = ((hash[i] || 0) >> (j * 8)) & 255;
      result += (bVal < 16 ? "0" : "") + bVal.toString(16);
    }
  }
  return result;
}

export function sha256(input: string): string {
  // Use node:crypto if available in environment
  try {
    if (typeof process !== "undefined" && process.versions?.node) {
      // Dynamic require or import if present
      const nodeCrypto = (
        globalThis as unknown as {
          _nodeCrypto?: {
            createHash: (algo: string) => {
              update: (data: string) => { digest: (encoding: string) => string };
            };
          };
        }
      )._nodeCrypto;
      if (nodeCrypto) {
        return nodeCrypto.createHash("sha256").update(input).digest("hex");
      }
    }
  } catch {
    // Fall back to pure implementation
  }
  return pureSha256(input);
}

export function computeErrorFingerprint(
  category: HealingCategory,
  filename?: string,
  message?: string
): string {
  const sanitizedMessage = (message || "")
    .replace(/:\d+:\d+/g, "")
    .replace(/\(\d+:\d+\)/g, "")
    .replace(/\b\d+:\d+\b/g, "")
    .replace(/0x[a-fA-F0-9]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  const normalizedPath = (filename || "")
    .replace(/^[./]+/, "")
    .trim()
    .toLowerCase();
  return sha256(`${category}:${normalizedPath}:${sanitizedMessage}`);
}

export function classifyErrorCategory(rawOutput: string): HealingCategory {
  const lower = rawOutput.toLowerCase();
  if (
    lower.includes("failed to resolve import") ||
    lower.includes("cannot find module") ||
    lower.includes("does not provide an export named") ||
    lower.includes("failed to resolve entry for package") ||
    lower.includes("failed to load url") ||
    lower.includes("unresolved import") ||
    lower.includes("module not found")
  ) {
    return "import";
  }
  if (
    lower.includes("syntaxerror") ||
    lower.includes("unexpected token") ||
    lower.includes("parsing error") ||
    lower.includes("expected corresponding jsx closing tag") ||
    lower.includes("unterminated string") ||
    lower.includes("jsx element has no corresponding closing tag") ||
    lower.includes("expected ';'") ||
    lower.includes("unexpected identifier")
  ) {
    return "syntax";
  }
  if (
    lower.includes("transform failed") ||
    lower.includes("failed to compile") ||
    lower.includes("error during build") ||
    lower.includes("typescript error") ||
    /ts\d+:/.test(lower) ||
    lower.includes("vite error") ||
    (lower.includes("plugin") && lower.includes("failed"))
  ) {
    return "compiler";
  }
  return "runtime";
}

export function parsePreviewDiagnostic(rawOutput: string): PreviewErrorPayload {
  const category = classifyErrorCategory(rawOutput);

  let filename: string | undefined;
  let line: number | undefined;
  let column: number | undefined;

  // Check loc pattern like src/App.tsx:14:2 or (src/App.tsx:14:2)
  const locMatch = rawOutput.match(
    /(?:at\s+|[\s"'(]|^)([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+):(\d+):(\d+)/
  );
  if (locMatch) {
    filename = locMatch[1];
    line = parseInt(locMatch[2] || "0", 10);
    column = parseInt(locMatch[3] || "0", 10);
  } else {
    // Check pattern with (line:col) like /src/App.tsx: Unexpected token (14:2)
    const altLocMatch = rawOutput.match(
      /(?:[\s"'(]|^)([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+).*?\((\d+):(\d+)\)/
    );
    if (altLocMatch) {
      filename = altLocMatch[1];
      line = parseInt(altLocMatch[2] || "0", 10);
      column = parseInt(altLocMatch[3] || "0", 10);
    } else {
      // Check from "src/App.tsx" pattern
      const fromMatch = rawOutput.match(/from\s+["']([^"']+\.[a-zA-Z0-9]+)["']/);
      if (fromMatch) {
        filename = fromMatch[1];
      } else {
        const fileOnlyMatch = rawOutput.match(/(?:in|file:?)\s+([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)/i);
        if (fileOnlyMatch) {
          filename = fileOnlyMatch[1];
        }
      }
    }
  }

  if (filename) {
    filename = filename.replace(/^[./]+/, "");
  }

  const fingerprint = computeErrorFingerprint(category, filename, rawOutput);

  return {
    message: rawOutput.trim(),
    filename,
    line: line && !Number.isNaN(line) ? line : undefined,
    column: column && !Number.isNaN(column) ? column : undefined,
    category,
    errorFingerprint: fingerprint,
  };
}

export function createPreviewErrorPayload(params: {
  message: string;
  filename?: string;
  line?: number;
  column?: number;
  stack?: string;
  category?: HealingCategory;
}): PreviewErrorPayload {
  const category =
    params.category || classifyErrorCategory(`${params.message} ${params.stack || ""}`);
  const filename = params.filename ? params.filename.replace(/^[./]+/, "") : undefined;
  const fingerprint = computeErrorFingerprint(category, filename, params.message);

  return {
    message: params.message.trim(),
    filename,
    line: params.line,
    column: params.column,
    stack: params.stack,
    category,
    errorFingerprint: fingerprint,
  };
}
