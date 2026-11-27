import { randomBytes } from "node:crypto";
import dns from "node:dns/promises";
import { isIP } from "node:net";
import { ValidationError } from "@spark/db";
import type { DnsInstructions, DomainRecordType } from "@spark/shared";

const HOSTNAME_REGEX = /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

const VERIFY_RATE_LIMIT_MAX = 5;
const VERIFY_RATE_LIMIT_WINDOW_MS = 60_000;

const verifyAttemptTimestamps = new Map<string, number[]>();

export function checkVerifyRateLimit(
  projectId: string,
  now = Date.now()
): { allowed: boolean; retryAfterSeconds: number } {
  const windowStart = now - VERIFY_RATE_LIMIT_WINDOW_MS;
  const recent = (verifyAttemptTimestamps.get(projectId) ?? []).filter((ts) => ts > windowStart);

  if (recent.length >= VERIFY_RATE_LIMIT_MAX) {
    const oldest = recent[0] ?? now;
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((oldest + VERIFY_RATE_LIMIT_WINDOW_MS - now) / 1000)
    );
    verifyAttemptTimestamps.set(projectId, recent);
    return { allowed: false, retryAfterSeconds };
  }

  recent.push(now);
  verifyAttemptTimestamps.set(projectId, recent);
  return { allowed: true, retryAfterSeconds: 0 };
}

export function resetVerifyRateLimitForTests(): void {
  verifyAttemptTimestamps.clear();
}

export function generateVerificationToken(): string {
  return `spark-verify=${randomBytes(16).toString("hex")}`;
}

export function validateCustomDomainInput(rawDomain: string): {
  customDomain: string;
  recordType: DomainRecordType;
} {
  const normalized = rawDomain.trim().toLowerCase().replace(/\.+$/, "");

  if (
    !normalized ||
    normalized.includes("://") ||
    normalized.includes("/") ||
    normalized.includes(":")
  ) {
    throw new ValidationError("Enter a bare domain name without protocol, port, or path");
  }

  if (isIP(normalized) !== 0) {
    throw new ValidationError("IP addresses cannot be used as custom domains");
  }

  if (normalized === "localhost" || normalized.endsWith(".localhost")) {
    throw new ValidationError("Localhost domains cannot be registered as custom domains");
  }

  const platformHost = (process.env.PLATFORM_DOMAIN || "sparkapps.dev")
    .toLowerCase()
    .replace(/:\d+$/, "");
  const forbiddenBases = new Set([platformHost, "sparkapps.dev", "sparkweb.dev"]);
  for (const base of forbiddenBases) {
    if (normalized === base || normalized.endsWith(`.${base}`)) {
      throw new ValidationError(`Domains under ${base} are reserved by the platform`);
    }
  }

  if (!HOSTNAME_REGEX.test(normalized)) {
    throw new ValidationError(
      "Enter a valid fully qualified domain name (e.g. app.yourdomain.com)"
    );
  }

  const labels = normalized.split(".");
  const recordType: DomainRecordType = labels.length === 2 ? "apex" : "cname";

  return { customDomain: normalized, recordType };
}

export function buildDnsInstructions(
  customDomain: string,
  recordType: DomainRecordType,
  verificationToken: string
): DnsInstructions {
  const cnameTarget = process.env.PLATFORM_CNAME_TARGET || "edge.sparkapps.dev";
  const apexIp = process.env.PLATFORM_APEX_IP || "192.0.2.1";

  const routingRecord =
    recordType === "apex"
      ? {
          type: "A" as const,
          host: "@",
          value: apexIp,
          purpose: "Point apex domain traffic to Sparkweb edge",
        }
      : {
          type: "CNAME" as const,
          host: customDomain,
          value: cnameTarget,
          purpose: "Point subdomain traffic to Sparkweb edge",
        };

  return {
    customDomain,
    recordType,
    records: [
      {
        type: "TXT",
        host: `_sparkweb-verify.${customDomain}`,
        value: verificationToken,
        purpose: "Verify domain ownership before issuing SSL certificate",
      },
      routingRecord,
    ],
  };
}

export interface DnsPreCheckResult {
  txtVerified: boolean;
  routingVerified: boolean;
  failureReason: string | null;
}

export interface DnsResolverLike {
  resolveTxt(hostname: string): Promise<string[][]>;
  resolveCname(hostname: string): Promise<string[]>;
  resolve4(hostname: string): Promise<string[]>;
}

export async function verifyDomainDnsRecords(
  params: {
    customDomain: string;
    recordType: DomainRecordType;
    verificationToken: string;
  },
  resolver: DnsResolverLike = dns
): Promise<DnsPreCheckResult> {
  const txtHost = `_sparkweb-verify.${params.customDomain}`;
  let txtVerified = false;

  try {
    const txtRecords = await resolver.resolveTxt(txtHost);
    const flattened = txtRecords.map((chunks) => chunks.join("").trim());
    txtVerified = flattened.includes(params.verificationToken);
  } catch {
    txtVerified = false;
  }

  if (!txtVerified) {
    return {
      txtVerified: false,
      routingVerified: false,
      failureReason: `TXT record matching "${params.verificationToken}" not found at ${txtHost}`,
    };
  }

  let routingVerified = false;
  if (params.recordType === "cname") {
    const expectedTarget = (process.env.PLATFORM_CNAME_TARGET || "edge.sparkapps.dev")
      .toLowerCase()
      .replace(/\.+$/, "");
    try {
      const cnames = await resolver.resolveCname(params.customDomain);
      routingVerified = cnames.some(
        (target) => target.toLowerCase().replace(/\.+$/, "") === expectedTarget
      );
    } catch {
      routingVerified = false;
    }
  } else {
    const expectedIp = process.env.PLATFORM_APEX_IP;
    try {
      const ips = await resolver.resolve4(params.customDomain);
      routingVerified = expectedIp ? ips.includes(expectedIp) : ips.length > 0;
    } catch {
      routingVerified = false;
    }
  }

  return {
    txtVerified: true,
    routingVerified,
    failureReason: routingVerified
      ? null
      : `TXT ownership verified, waiting for ${params.recordType.toUpperCase()} DNS propagation on ${params.customDomain}`,
  };
}
