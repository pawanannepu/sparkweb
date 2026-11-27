import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@spark/db";
import { describe, expect, it } from "vitest";
import {
  handlePublishingRouteError,
  serializeDeployment,
  serializeProjectDomain,
} from "./serializers";

describe("publishing serializers and error mapper", () => {
  // covers: AC-2, AC-6
  it("serializes deployment and project domain timestamps to ISO strings", () => {
    const now = new Date("2026-11-26T12:00:00.000Z");
    const serializedDep = serializeDeployment({
      id: "dep-1",
      projectId: "proj-1",
      snapshotId: null,
      subdomain: "demo",
      customDomain: null,
      status: "active",
      deploymentUrl: "http://demo.localhost:3000",
      artifactKey: "deployments/proj-1/dep-1",
      buildLogs: "done",
      buildDurationMs: 100,
      errorMessage: null,
      trigger: "manual",
      promotedFromDeploymentId: null,
      retiredAt: null,
      createdAt: now,
      updatedAt: now,
    });
    expect(serializedDep.createdAt).toBe("2026-11-26T12:00:00.000Z");
    expect(serializedDep.retiredAt).toBeNull();

    const serializedDom = serializeProjectDomain({
      id: "dom-1",
      projectId: "proj-1",
      subdomain: "demo",
      customDomain: "app.example.com",
      recordType: "cname",
      verificationToken: "spark-verify=abc",
      verificationStatus: "verified",
      sslStatus: "active",
      providerHostnameId: "cf-1",
      failureReason: null,
      lastCheckedAt: now,
      verifiedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    expect(serializedDom.verifiedAt).toBe("2026-11-26T12:00:00.000Z");
    expect("providerHostnameId" in serializedDom).toBe(false);
  });

  // covers: AC-2, AC-6, AC-7
  it("maps domain errors to HTTP status codes and masks unknown errors as 500", async () => {
    class RateLimitError extends DomainError {
      readonly statusCode = 429;
      readonly code = "RATE_LIMIT";
    }

    expect(handlePublishingRouteError(new NotFoundError("missing"), "fallback").status).toBe(404);
    expect(handlePublishingRouteError(new ForbiddenError("denied"), "fallback").status).toBe(403);
    expect(handlePublishingRouteError(new ConflictError("busy"), "fallback").status).toBe(409);
    expect(handlePublishingRouteError(new ValidationError("bad"), "fallback").status).toBe(422);
    expect(handlePublishingRouteError(new RateLimitError("rate"), "fallback").status).toBe(429);

    const unknownRes = handlePublishingRouteError(new Error("boom"), "Something failed");
    expect(unknownRes.status).toBe(500);
    expect(await unknownRes.json()).toEqual({ error: "Something failed", message: "boom" });
  });
});
