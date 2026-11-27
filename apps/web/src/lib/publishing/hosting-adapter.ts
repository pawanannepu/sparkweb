import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { HostRouteRecord } from "@spark/shared";
import type { CustomHostnameRegistration, HostingAdapter } from "./types";

const localRoutesFileLocks = new Map<string, Promise<void>>();

function normalizeHostKey(hostname: string): string {
  return hostname.toLowerCase().trim().replace(/:\d+$/, "");
}

export class LocalDevHostingAdapter implements HostingAdapter {
  private readonly routesFilePath: string;
  private readonly customHostnames = new Map<string, { id: string; hostname: string }>();

  constructor(routesFilePath?: string) {
    this.routesFilePath = path.resolve(
      /*turbopackIgnore: true*/
      routesFilePath ||
        process.env.LOCAL_ROUTES_FILE ||
        path.join(os.tmpdir(), "sparkweb-host-routes.json")
    );
  }

  private async withFileLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = localRoutesFileLocks.get(this.routesFilePath) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    localRoutesFileLocks.set(this.routesFilePath, queued);

    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (localRoutesFileLocks.get(this.routesFilePath) === queued) {
        localRoutesFileLocks.delete(this.routesFilePath);
      }
    }
  }

  private async readRoutesMap(): Promise<Record<string, HostRouteRecord>> {
    try {
      const raw = await readFile(this.routesFilePath, "utf-8");
      const parsed = JSON.parse(raw) as Record<string, HostRouteRecord>;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  private async writeRoutesMap(routes: Record<string, HostRouteRecord>): Promise<void> {
    const dir = path.dirname(this.routesFilePath);
    await mkdir(dir, { recursive: true });
    const tempFile = path.join(dir, `${path.basename(this.routesFilePath)}.${randomUUID()}.tmp`);
    await writeFile(tempFile, JSON.stringify(routes, null, 2), "utf-8");
    await rename(tempFile, this.routesFilePath);
  }

  async putRoute(hostname: string, route: HostRouteRecord): Promise<void> {
    await this.withFileLock(async () => {
      const routes = await this.readRoutesMap();
      routes[`host:${normalizeHostKey(hostname)}`] = route;
      await this.writeRoutesMap(routes);
    });
  }

  async getRoute(hostname: string): Promise<HostRouteRecord | null> {
    return this.withFileLock(async () => {
      const routes = await this.readRoutesMap();
      return routes[`host:${normalizeHostKey(hostname)}`] ?? null;
    });
  }

  async deleteRoute(hostname: string): Promise<void> {
    await this.withFileLock(async () => {
      const routes = await this.readRoutesMap();
      delete routes[`host:${normalizeHostKey(hostname)}`];
      await this.writeRoutesMap(routes);
    });
  }

  async syncCustomHostname(hostname: string): Promise<CustomHostnameRegistration> {
    const normalized = normalizeHostKey(hostname);
    const existing = Array.from(this.customHostnames.values()).find(
      (item) => item.hostname === normalized
    );
    const id = existing?.id ?? `local-hostname-${randomUUID()}`;
    this.customHostnames.set(id, { id, hostname: normalized });
    return {
      providerHostnameId: id,
      sslStatus: "active",
      failureReason: null,
    };
  }

  async getCustomHostnameStatus(providerHostnameId: string): Promise<CustomHostnameRegistration> {
    return {
      providerHostnameId,
      sslStatus: "active",
      failureReason: null,
    };
  }

  async deleteCustomHostname(providerHostnameId: string): Promise<void> {
    this.customHostnames.delete(providerHostnameId);
  }
}

export interface CloudflareSaasConfig {
  apiToken: string;
  accountId: string;
  zoneId: string;
  kvNamespaceId: string;
}

interface CloudflareApiResponse<T> {
  success: boolean;
  result: T;
  errors?: Array<{ code: number; message: string }>;
}

interface CloudflareCustomHostnameResult {
  id: string;
  hostname: string;
  ssl?: {
    status?: string;
    validation_errors?: Array<{ message?: string }>;
  };
}

function mapCloudflareSslStatus(status?: string): "pending" | "active" | "failed" {
  if (status === "active") return "active";
  if (
    status === "validation_timed_out" ||
    status === "deleted" ||
    status === "expired" ||
    status === "failed"
  ) {
    return "failed";
  }
  return "pending";
}

export class CloudflareSaasHostingAdapter implements HostingAdapter {
  private readonly apiToken: string;
  private readonly accountId: string;
  private readonly zoneId: string;
  private readonly kvNamespaceId: string;

  constructor(config: CloudflareSaasConfig) {
    this.apiToken = config.apiToken;
    this.accountId = config.accountId;
    this.zoneId = config.zoneId;
    this.kvNamespaceId = config.kvNamespaceId;
  }

  private get authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiToken}`,
      "Content-Type": "application/json",
    };
  }

  async putRoute(hostname: string, route: HostRouteRecord): Promise<void> {
    const key = encodeURIComponent(`host:${normalizeHostKey(hostname)}`);
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/storage/kv/namespaces/${this.kvNamespaceId}/values/${key}`;
    const res = await fetch(url, {
      method: "PUT",
      headers: this.authHeaders,
      body: JSON.stringify(route),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Cloudflare KV putRoute failed (${res.status}): ${text}`);
    }
  }

  async getRoute(hostname: string): Promise<HostRouteRecord | null> {
    const key = encodeURIComponent(`host:${normalizeHostKey(hostname)}`);
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/storage/kv/namespaces/${this.kvNamespaceId}/values/${key}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.apiToken}` },
    });
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      throw new Error(`Cloudflare KV getRoute failed (${res.status})`);
    }
    return (await res.json()) as HostRouteRecord;
  }

  async deleteRoute(hostname: string): Promise<void> {
    const key = encodeURIComponent(`host:${normalizeHostKey(hostname)}`);
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/storage/kv/namespaces/${this.kvNamespaceId}/values/${key}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${this.apiToken}` },
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Cloudflare KV deleteRoute failed (${res.status})`);
    }
  }

  async syncCustomHostname(hostname: string): Promise<CustomHostnameRegistration> {
    const normalized = normalizeHostKey(hostname);
    const listUrl = `https://api.cloudflare.com/client/v4/zones/${this.zoneId}/custom_hostnames?hostname=${encodeURIComponent(normalized)}`;
    const listRes = await fetch(listUrl, {
      method: "GET",
      headers: this.authHeaders,
    });
    if (listRes.ok) {
      const listData = (await listRes.json()) as CloudflareApiResponse<
        CloudflareCustomHostnameResult[]
      >;
      const existing = listData.result?.[0];
      if (existing) {
        return {
          providerHostnameId: existing.id,
          sslStatus: mapCloudflareSslStatus(existing.ssl?.status),
          failureReason: existing.ssl?.validation_errors?.[0]?.message ?? null,
        };
      }
    }

    const createUrl = `https://api.cloudflare.com/client/v4/zones/${this.zoneId}/custom_hostnames`;
    const createRes = await fetch(createUrl, {
      method: "POST",
      headers: this.authHeaders,
      body: JSON.stringify({
        hostname: normalized,
        ssl: {
          method: "txt",
          type: "dv",
        },
      }),
    });

    const data = (await createRes.json()) as CloudflareApiResponse<CloudflareCustomHostnameResult>;
    if (!createRes.ok || !data.success) {
      const errMsg = data.errors?.[0]?.message || `HTTP ${createRes.status}`;
      throw new Error(`Cloudflare custom hostname creation failed: ${errMsg}`);
    }

    return {
      providerHostnameId: data.result.id,
      sslStatus: mapCloudflareSslStatus(data.result.ssl?.status),
      failureReason: data.result.ssl?.validation_errors?.[0]?.message ?? null,
    };
  }

  async getCustomHostnameStatus(providerHostnameId: string): Promise<CustomHostnameRegistration> {
    const url = `https://api.cloudflare.com/client/v4/zones/${this.zoneId}/custom_hostnames/${providerHostnameId}`;
    const res = await fetch(url, {
      method: "GET",
      headers: this.authHeaders,
    });
    const data = (await res.json()) as CloudflareApiResponse<CloudflareCustomHostnameResult>;
    if (!res.ok || !data.success) {
      const errMsg = data.errors?.[0]?.message || `HTTP ${res.status}`;
      throw new Error(`Cloudflare custom hostname status check failed: ${errMsg}`);
    }
    return {
      providerHostnameId: data.result.id,
      sslStatus: mapCloudflareSslStatus(data.result.ssl?.status),
      failureReason: data.result.ssl?.validation_errors?.[0]?.message ?? null,
    };
  }

  async deleteCustomHostname(providerHostnameId: string): Promise<void> {
    const url = `https://api.cloudflare.com/client/v4/zones/${this.zoneId}/custom_hostnames/${providerHostnameId}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: this.authHeaders,
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Cloudflare custom hostname deletion failed (${res.status})`);
    }
  }
}
