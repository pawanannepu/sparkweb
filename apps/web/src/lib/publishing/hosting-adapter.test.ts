import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudflareSaasHostingAdapter } from "./hosting-adapter";

describe("CloudflareSaasHostingAdapter", () => {
  const adapter = new CloudflareSaasHostingAdapter({
    apiToken: "cf-token",
    accountId: "acc-1",
    zoneId: "zone-1",
    kvNamespaceId: "kv-1",
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // covers: AC-5
  it("writes, reads (including 404 null), and deletes KV route entries", async () => {
    const route = {
      deploymentId: "dep-1",
      projectId: "proj-1",
      artifactKey: "deployments/proj-1/dep-1",
      updatedAt: "2026-11-26T00:00:00.000Z",
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(route), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await adapter.putRoute("Demo.SparkApps.dev:443", route);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("/values/host%3Ademo.sparkapps.dev"),
      expect.objectContaining({ method: "PUT" })
    );

    expect(await adapter.getRoute("demo.sparkapps.dev")).toEqual(route);
    expect(await adapter.getRoute("missing.sparkapps.dev")).toBeNull();

    await adapter.deleteRoute("demo.sparkapps.dev");
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining("/values/host%3Ademo.sparkapps.dev"),
      expect.objectContaining({ method: "DELETE" })
    );
  });

  // covers: AC-6, AC-9
  it("reuses existing custom hostname or creates a new one, maps SSL status, and deletes hostname", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            result: [{ id: "cf-existing", hostname: "app.example.com", ssl: { status: "active" } }],
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, result: [] }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            result: {
              id: "cf-new",
              hostname: "new.example.com",
              ssl: { status: "pending_validation" },
            },
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            result: {
              id: "cf-new",
              hostname: "new.example.com",
              ssl: {
                status: "validation_timed_out",
                validation_errors: [{ message: "TXT not found" }],
              },
            },
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const reused = await adapter.syncCustomHostname("app.example.com");
    expect(reused).toEqual({
      providerHostnameId: "cf-existing",
      sslStatus: "active",
      failureReason: null,
    });

    const created = await adapter.syncCustomHostname("new.example.com");
    expect(created).toEqual({
      providerHostnameId: "cf-new",
      sslStatus: "pending",
      failureReason: null,
    });

    const status = await adapter.getCustomHostnameStatus("cf-new");
    expect(status).toEqual({
      providerHostnameId: "cf-new",
      sslStatus: "failed",
      failureReason: "TXT not found",
    });

    await expect(adapter.deleteCustomHostname("cf-new")).resolves.toBeUndefined();
  });
});
