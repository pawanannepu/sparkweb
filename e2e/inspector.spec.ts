import { expect, test } from "@playwright/test";

test.describe("Visual canvas inspector & direct styling", () => {
  // covers: AC-1
  test("toggles inspector mode in preview toolbar and displays active indicator", async ({
    page,
  }) => {
    await page.goto("/");

    const toggleBtn = page.getByLabel("Enable canvas inspect mode");
    await expect(toggleBtn).toBeVisible();
    expect(await toggleBtn.getAttribute("aria-pressed")).toBe("false");

    await toggleBtn.click();

    const exitBtn = page.getByLabel("Exit canvas inspect mode");
    await expect(exitBtn).toBeVisible();
    expect(await exitBtn.getAttribute("aria-pressed")).toBe("true");

    await exitBtn.click();
    await expect(page.getByLabel("Enable canvas inspect mode")).toBeVisible();
  });

  // covers: AC-3, AC-4
  test("receives simulated element selection bridge event and opens inspector panel with controls", async ({
    page,
  }) => {
    await page.goto("/");

    // Enable inspector mode
    const toggleBtn = page.getByLabel("Enable canvas inspect mode");
    await toggleBtn.click();

    // Dispatch PREVIEW_ELEMENT_SELECT bridge message
    await page.evaluate(() => {
      window.postMessage(
        {
          protocol: "sparkweb:bridge:v1",
          type: "PREVIEW_ELEMENT_SELECT",
          source: "sparkweb:sandbox",
          payload: {
            selector: "#hero-title",
            tagName: "h1",
            rect: { top: 120, left: 80, width: 350, height: 48 },
            source: { file: "src/App.tsx", line: 36, column: 13 },
            classes: ["text-xl", "font-bold", "tracking-tight", "text-white"],
            styles: {},
            textContent: "Sparkweb App",
            isEditable: true,
            isLeafTextOnly: true,
          },
          timestamp: Date.now(),
        },
        "*"
      );
    });

    const inspectorPanel = page
      .locator("aside[aria-label='Visual Canvas Inspector Panel']")
      .first();
    await expect(inspectorPanel).toBeVisible();

    // Check tag name and source location
    await expect(inspectorPanel.getByText("<h1>")).toBeVisible();
    await expect(inspectorPanel.getByText("App.tsx:36")).toBeVisible();

    // Check text input
    const textInput = inspectorPanel.locator("#inspector-element-text-input");
    await expect(textInput).toBeVisible();
    expect(await textInput.inputValue()).toBe("Sparkweb App");

    // Check typography and spacing controls
    await expect(inspectorPanel.getByText("Typography")).toBeVisible();
    await expect(inspectorPanel.getByText("Spacing")).toBeVisible();
  });

  // covers: AC-7
  test("renders read only badge and disables direct edits for non-workspace elements", async ({
    page,
  }) => {
    await page.goto("/");

    await page.evaluate(() => {
      window.postMessage(
        {
          protocol: "sparkweb:bridge:v1",
          type: "PREVIEW_ELEMENT_SELECT",
          source: "sparkweb:sandbox",
          payload: {
            selector: ".external-button",
            tagName: "button",
            rect: { top: 200, left: 80, width: 120, height: 36 },
            source: { file: "node_modules/@radix-ui/react-slot/index.js", line: 42, column: 3 },
            classes: ["btn-external"],
            styles: {},
            textContent: "External Button",
            isEditable: false,
            isLeafTextOnly: false,
          },
          timestamp: Date.now(),
        },
        "*"
      );
    });

    const inspectorPanel = page
      .locator("aside[aria-label='Visual Canvas Inspector Panel']")
      .first();
    await expect(inspectorPanel).toBeVisible();

    await expect(inspectorPanel.getByText("Read only element")).toBeVisible();
    await expect(inspectorPanel.getByText("external / unmapped")).toBeVisible();
  });

  // covers: AC-4
  test("closes inspector panel and clears selection when close button is clicked", async ({
    page,
  }) => {
    await page.goto("/");

    await page.evaluate(() => {
      window.postMessage(
        {
          protocol: "sparkweb:bridge:v1",
          type: "PREVIEW_ELEMENT_SELECT",
          source: "sparkweb:sandbox",
          payload: {
            selector: "#hero-title",
            tagName: "h1",
            rect: { top: 120, left: 80, width: 350, height: 48 },
            source: { file: "src/App.tsx", line: 36, column: 13 },
            classes: ["text-xl"],
            styles: {},
            textContent: "Sparkweb App",
            isEditable: true,
            isLeafTextOnly: true,
          },
          timestamp: Date.now(),
        },
        "*"
      );
    });

    const inspectorPanel = page
      .locator("aside[aria-label='Visual Canvas Inspector Panel']")
      .first();
    await expect(inspectorPanel).toBeVisible();

    const closeBtn = inspectorPanel.getByLabel("Close inspector");
    await closeBtn.click();

    // After close, panel should not be showing the element
    await expect(inspectorPanel.getByText("<h1>")).not.toBeVisible();
  });
});
