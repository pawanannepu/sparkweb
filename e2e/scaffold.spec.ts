import { expect, test } from "@playwright/test";

test.describe("Scaffold navigation and headers", () => {
  test("workbench loads with builder shell and preview container (covers: AC-1)", async ({
    page,
  }) => {
    // Act
    await page.goto("/");

    // Assert
    await expect(page.getByText("sparkweb", { exact: true })).toBeVisible();
    await expect(page.getByText("Demo Application")).toBeVisible();
    await expect(page.getByTitle("Sparkweb Live Preview")).toBeVisible();
  });

  test("sandbox route returns credentialless and same-origin headers (covers: AC-2)", async ({
    page,
    request,
  }) => {
    // Act - verify HTTP response headers on the sandbox route
    const response = await request.get("/sandbox");
    expect(response.status()).toBe(200);

    const headers = response.headers();
    expect(headers["cross-origin-embedder-policy"]).toBe("credentialless");
    expect(headers["cross-origin-opener-policy"]).toBe("same-origin");

    // Act - visit the page in the browser
    await page.goto("/sandbox");

    // Assert UI elements
    await expect(
      page.getByRole("heading", { name: "Isolated Sandbox Preview Runner" })
    ).toBeVisible();
    await expect(page.getByText("Cross-Origin-Embedder-Policy: credentialless")).toBeVisible();
  });
});
