import { expect, test } from "@playwright/test";

const NOW = "2026-11-26T00:00:00.000Z";

function makeDomain(overrides: Record<string, unknown> = {}) {
  return {
    id: "dom-e2e-1",
    projectId: "00000000-0000-0000-0000-000000000001",
    subdomain: "demo-app",
    customDomain: null,
    recordType: null,
    verificationToken: null,
    verificationStatus: "unconfigured",
    sslStatus: "unconfigured",
    failureReason: null,
    lastCheckedAt: null,
    verifiedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeDeployment(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    projectId: "00000000-0000-0000-0000-000000000001",
    snapshotId: "22222222-2222-2222-2222-222222222222",
    subdomain: "demo-app",
    customDomain: null,
    status: "active",
    deploymentUrl: "http://demo-app.localhost:3000",
    artifactKey:
      "deployments/00000000-0000-0000-0000-000000000001/11111111-1111-1111-1111-111111111111",
    buildLogs: "Built in 0.9s",
    buildDurationMs: 900,
    errorMessage: null,
    trigger: "manual",
    promotedFromDeploymentId: null,
    retiredAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

test.describe("One click publishing and isolated live hosting", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/sandbox/runner", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><html><body><script>
          window.parent.postMessage({
            protocol: "sparkweb:bridge:v1",
            type: "PREVIEW_READY",
            source: "sparkweb:sandbox",
            payload: { url: "about:blank" },
            timestamp: Date.now()
          }, "*");
        </script></body></html>`,
      });
    });

    await page.route("**/api/projects/*/snapshots/current", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ files: {} }),
      });
    });
  });

  // covers: AC-2, AC-7, AC-10
  test("publishes a site with status polling, rolls back to a prior release, and unpublishes", async ({
    page,
  }) => {
    const domain = makeDomain();
    const oldRetired = makeDeployment({
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      status: "retired",
      retiredAt: NOW,
    });
    const newQueued = makeDeployment({
      id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      status: "queued",
      buildLogs: null,
      buildDurationMs: null,
    });
    const newActive = makeDeployment({
      id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      status: "active",
    });

    let activeDeployment: Record<string, unknown> | null = null;
    let items: Array<Record<string, unknown>> = [oldRetired];
    let pollStep = 0;

    await page.route("**/api/projects/*/deployments?*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          domain,
          activeDeployment,
          items,
          nextCursor: null,
        }),
      });
    });

    await page.route("**/api/projects/*/deployments", async (route) => {
      if (route.request().method() === "POST") {
        items = [newQueued, oldRetired];
        await route.fulfill({
          status: 202,
          contentType: "application/json",
          body: JSON.stringify({ deployment: newQueued, domain }),
        });
        return;
      }
      await route.continue();
    });

    await page.route(
      "**/api/projects/*/deployments/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      async (route) => {
        pollStep += 1;
        if (pollStep === 1) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              deployment: makeDeployment({
                id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                status: "building",
                buildLogs: null,
              }),
            }),
          });
          return;
        }
        activeDeployment = newActive;
        items = [newActive, oldRetired];
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ deployment: newActive }),
        });
      }
    );

    await page.route(
      "**/api/projects/*/deployments/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/rollback",
      async (route) => {
        const rolled = makeDeployment({
          id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
          status: "active",
          trigger: "rollback",
          promotedFromDeploymentId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        });
        activeDeployment = rolled;
        items = [rolled, makeDeployment({ ...newActive, status: "retired" }), oldRetired];
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ deployment: rolled, activeDeploymentId: rolled.id }),
        });
      }
    );

    await page.route("**/api/projects/*/deployments/unpublish", async (route) => {
      activeDeployment = null;
      items = items.map((d) => ({ ...d, status: d.status === "active" ? "retired" : d.status }));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ unpublished: true }),
      });
    });

    await page.goto("/");

    const publishTrigger = page.getByRole("button", { name: /^Publish$/i });
    await expect(publishTrigger).toBeVisible();
    await publishTrigger.click();

    await expect(page.getByText("Live Hosting")).toBeVisible();
    await expect(page.getByText("Unpublished")).toBeVisible();

    await page.getByRole("button", { name: /Publish Site/i }).click();

    // Polling transitions to Live and renders the isolated URL
    await expect(page.getByText("Live", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("http://demo-app.localhost:3000")).toBeVisible();

    // Roll back to prior release
    await page.getByRole("button", { name: /Roll back to release aaaaaaaa/i }).click();
    await expect(page.getByText("rollback", { exact: true })).toBeVisible();

    // Unpublish clears active status
    await page.getByRole("button", { name: /Unpublish/i }).click();
    await expect(page.getByText("Unpublished")).toBeVisible();
  });

  // covers: AC-3, AC-6, AC-10
  test("displays failed build logs and handles custom domain DNS setup with verify rate limit on mobile", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    const baseDomain = makeDomain();
    const failedDeployment = makeDeployment({
      id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
      status: "failed",
      errorMessage: "Vite build failed with exit code 1",
      buildLogs: "SyntaxError: Unexpected token in src/App.tsx",
      buildDurationMs: 1200,
    });

    await page.route("**/api/projects/*/deployments?*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          domain: baseDomain,
          activeDeployment: null,
          items: [failedDeployment],
          nextCursor: null,
        }),
      });
    });

    await page.route("**/api/projects/*/domain", async (route) => {
      const updated = makeDomain({
        customDomain: "app.example.com",
        recordType: "cname",
        verificationToken: "spark-verify=e2etoken1234",
        verificationStatus: "pending",
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          domain: updated,
          dnsInstructions: {
            customDomain: "app.example.com",
            recordType: "cname",
            records: [
              {
                type: "TXT",
                host: "_sparkweb-verify.app.example.com",
                value: "spark-verify=e2etoken1234",
                purpose: "Verify domain ownership",
              },
              {
                type: "CNAME",
                host: "app.example.com",
                value: "edge.sparkapps.dev",
                purpose: "Route traffic",
              },
            ],
          },
        }),
      });
    });

    await page.route("**/api/projects/*/domain/verify", async (route) => {
      await route.fulfill({
        status: 429,
        contentType: "application/json",
        headers: { "Retry-After": "45" },
        body: JSON.stringify({
          error: "Too many DNS verification attempts. Please wait a minute before retrying.",
        }),
      });
    });

    await page.goto("/");

    await page.getByRole("button", { name: /^Publish$/i }).click();
    await expect(page.getByText("Failed", { exact: true })).toBeVisible();
    await expect(page.getByText("Vite build failed with exit code 1")).toBeVisible();

    await page.getByRole("button", { name: /Build failed — view logs/i }).click();
    await expect(page.getByText("SyntaxError: Unexpected token in src/App.tsx")).toBeVisible();

    await page.getByRole("button", { name: /Domains/i }).click();
    await expect(page.getByRole("dialog", { name: /Domain & SSL Settings/i })).toBeVisible();

    await page.getByLabel("Custom Domain").fill("app.example.com");
    await page.getByRole("button", { name: "Connect" }).click();

    await expect(page.getByText("_sparkweb-verify.app.example.com")).toBeVisible();
    await expect(page.getByText("spark-verify=e2etoken1234")).toBeVisible();

    await page.getByRole("button", { name: /Verify DNS/i }).click();
    await expect(
      page.getByText("Too many DNS verification attempts. Please wait a minute before retrying.")
    ).toBeVisible();
  });
});
