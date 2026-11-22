import { expect, test } from "@playwright/test";

test.describe("Core generation loop and live preview", () => {
  // covers: AC-1, AC-5
  test("submits prompt, renders live progress card, and commits snapshot", async ({ page }) => {
    // Navigate to workbench
    await page.goto("/");

    // Verify model selector defaults to Claude 3.7 Sonnet
    await expect(page.getByText("Claude 3.7 Sonnet").first()).toBeVisible();

    // Fill prompt in composer
    const textarea = page.locator("textarea:visible");
    await textarea.fill("Build an interactive task tracker");

    // Click Generate
    const generateBtn = page.locator("button:has-text('Generate'):visible");
    await generateBtn.click();

    // Verify finish message appears
    await expect(
      page
        .getByText(
          "All planned components and routes have been built and verified in the live preview"
        )
        .first()
    ).toBeVisible({ timeout: 15000 });

    // Verify progress card with checklist
    await expect(page.getByText("GENERATION COMPLETE").first()).toBeVisible();
    await expect(page.getByText("src/App.tsx").first()).toBeVisible();
  });

  // covers: AC-5
  test("toggles device viewports between desktop, tablet, and mobile", async ({ page }) => {
    await page.goto("/");

    const tabletBtn = page.locator("button[aria-label='Tablet viewport']:visible");
    await tabletBtn.click();

    const mobileBtn = page.locator("button[aria-label='Mobile viewport']:visible");
    await mobileBtn.click();

    const desktopBtn = page.locator("button[aria-label='Desktop viewport']:visible");
    await desktopBtn.click();

    await expect(page.getByTitle("Sparkweb Live Preview")).toBeVisible();
  });

  // covers: AC-7
  test("sandbox runner route enforces cross-origin isolation headers", async ({
    request,
    page,
  }) => {
    const response = await request.get("/sandbox/runner");
    expect(response.status()).toBe(200);

    const headers = response.headers();
    expect(headers["cross-origin-embedder-policy"]).toBe("credentialless");
    expect(headers["cross-origin-opener-policy"]).toBe("same-origin");

    await page.goto("/sandbox/runner");
    await expect(page.getByText("Sparkweb Sandbox")).toBeVisible();
    await expect(page.getByText("WebAssembly Node.js Runtime")).toBeVisible();
  });
});
