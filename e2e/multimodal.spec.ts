import { expect, test } from "@playwright/test";

const NOW = "2026-11-28T00:00:00.000Z";
const PROJECT_ID = "00000000-0000-0000-0000-000000000001";
const THREAD_ID = "00000000-0000-0000-0000-000000000002";
const OUTLINE_ID = "00000000-0000-0000-0000-000000000020";

const SAMPLE_OUTLINE_PAYLOAD = {
  appSummary: "Analytics workspace seeded from design reference",
  palette: [{ id: "pal-1", role: "Primary", hex: "#2563EB", usage: "Primary actions" }],
  typography: {
    headingFont: "Plus Jakarta Sans",
    bodyFont: "Inter",
    scaleNotes: "Tight display headings",
  },
  layoutSections: [
    { id: "sec-1", name: "Header", description: "Top navigation", enabled: true },
    { id: "sec-2", name: "Pricing", description: "Subscription tiers", enabled: true },
  ],
  componentHierarchy: [{ id: "comp-1", name: "AppShell", role: "Root shell", enabled: true }],
  additionalNotes: "",
};

// 1x1 transparent PNG
const TINY_PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

test.describe("Multi modal generation from images and design links", () => {
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
          window.addEventListener("message", function (event) {
            var msg = event.data;
            if (msg && msg.type === "PREVIEW_HEALTH_CHECK") {
              window.parent.postMessage({
                protocol: "sparkweb:bridge:v1",
                type: "PREVIEW_HEALTH_STATUS",
                source: "sparkweb:sandbox",
                payload: { healthy: true },
                timestamp: Date.now()
              }, "*");
            }
          });
        </script></body></html>`,
      });
    });

    await page.route("**/api/keys", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          keys: [{ provider: "openrouter", keyHint: "sk-o...1234", updatedAt: NOW }],
          envProviders: [],
        }),
      });
    });

    await page.route("**/api/ai/models*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          configuredProviders: ["openrouter"],
          openRouterKeyBudget: {
            hasKey: true,
            freeOnly: false,
            limitUsd: null,
            remainingUsd: null,
            isFreeTier: false,
          },
          providerModels: {
            openrouter: [
              {
                id: "deepseek/deepseek-r1",
                name: "DeepSeek R1",
                provider: "openrouter",
                tier: "paid",
                supportsVision: false,
                badge: "OR",
              },
              {
                id: "openai/gpt-4o",
                name: "GPT-4o",
                provider: "openrouter",
                tier: "paid",
                supportsVision: true,
                badge: "OR",
              },
            ],
            anthropic: [],
            openai: [],
            gemini: [],
          },
        }),
      });
    });

    await page.route("**/api/projects/*/threads/*/state", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          threadId: THREAD_ID,
          messages: [],
          attachmentsByMessageId: {},
          pendingAttachments: [],
          outlines: [],
        }),
      });
    });
  });

  // covers: AC-2, AC-3, AC-4, AC-6, AC-8, AC-9
  test("uploads image, enforces vision model gating and one-click switch, extracts editable outline, and builds app", async ({
    page,
  }) => {
    const attachmentId = "00000000-0000-0000-0000-000000000010";
    let outlineState = {
      id: OUTLINE_ID,
      projectId: PROJECT_ID,
      threadId: THREAD_ID,
      sourceMessageId: "00000000-0000-0000-0000-000000000030",
      clonedFromOutlineId: null,
      outlineMessageId: "00000000-0000-0000-0000-000000000031",
      buildMessageId: null,
      status: "ready",
      modelId: "openai/gpt-4o",
      extractedOutline: SAMPLE_OUTLINE_PAYLOAD,
      editedOutline: null as typeof SAMPLE_OUTLINE_PAYLOAD | null,
      createdAt: NOW,
      updatedAt: NOW,
    };

    await page.route("**/api/projects/*/attachments", async (route) => {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          id: attachmentId,
          projectId: PROJECT_ID,
          threadId: THREAD_ID,
          messageId: null,
          kind: "image",
          sourceUrl: null,
          fileName: "mockup.png",
          mimeType: "image/png",
          sizeBytes: TINY_PNG_BYTES.byteLength,
          width: 1,
          height: 1,
          previewUrl: `/api/projects/${PROJECT_ID}/attachments/${attachmentId}`,
          urlSnapshot: null,
          createdAt: NOW,
        }),
      });
    });

    await page.route(`**/api/projects/*/attachments/${attachmentId}`, async (route) => {
      await route.fulfill({
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "X-Content-Type-Options": "nosniff",
        },
        body: TINY_PNG_BYTES,
      });
    });

    await page.route("**/api/projects/*/outlines", async (route) => {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          outline: outlineState,
          userMessage: {
            id: "00000000-0000-0000-0000-000000000030",
            threadId: THREAD_ID,
            seq: 1,
            role: "user",
            content:
              "Build an application matching the attached design reference and extracted outline.",
            toolCalls: null,
            snapshotId: null,
            status: "completed",
            createdAt: NOW,
          },
          outlineMessage: {
            id: "00000000-0000-0000-0000-000000000031",
            threadId: THREAD_ID,
            seq: 2,
            role: "assistant",
            content: SAMPLE_OUTLINE_PAYLOAD.appSummary,
            toolCalls: null,
            snapshotId: null,
            status: "completed",
            createdAt: NOW,
          },
          attachments: [],
        }),
      });
    });

    await page.route(`**/api/projects/*/outlines/${OUTLINE_ID}`, async (route) => {
      const body = route.request().postDataJSON() as {
        editedOutline?: typeof SAMPLE_OUTLINE_PAYLOAD;
      };
      outlineState = {
        ...outlineState,
        editedOutline: body.editedOutline ?? null,
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ outline: outlineState }),
      });
    });

    let generatePayload: Record<string, unknown> | null = null;
    await page.route("**/api/projects/*/generate", async (route) => {
      generatePayload = route.request().postDataJSON() as Record<string, unknown>;
      const sse = [
        'event: plan\ndata: {"messageId":"00000000-0000-0000-0000-000000000099","steps":[{"id":"step-1","title":"Analyze","status":"completed"},{"id":"step-2","title":"Build","status":"completed"},{"id":"step-3","title":"Verify","status":"pending"}]}\n\n',
        'event: file_op\ndata: {"path":"src/App.tsx","op":"write","content":"export default function App() { return <h1>Built</h1>; }"}\n\n',
        'event: finish\ndata: {"messageId":"00000000-0000-0000-0000-000000000099"}\n\n',
      ].join("");
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "text/event-stream; charset=utf-8" },
        body: sse,
      });
    });

    await page.route("**/api/projects/*/snapshots", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: "snap-mm-e2e", treeHash: "hash-mm-e2e" }),
      });
    });

    await page.goto("/");

    // Select non-vision text model first
    await page.locator("button[aria-label='Select AI model']:visible").first().click();
    await page.getByRole("menuitem", { name: /DeepSeek R1/i }).click();

    // Upload image via file input
    await page.getByLabel("Upload design reference images").first().setInputFiles({
      name: "mockup.png",
      mimeType: "image/png",
      buffer: TINY_PNG_BYTES,
    });

    await expect(page.getByText("mockup.png").first()).toBeVisible();
    await expect(
      page.getByText("DeepSeek R1 does not support image inputs.").first()
    ).toBeVisible();
    await expect(page.locator("button:has-text('Extract Outline'):visible").first()).toBeDisabled();

    // One-click switch to GPT-4o unlocks submission
    await page.locator("button:has-text('Switch to GPT-4o'):visible").first().click();
    const extractBtn = page.locator("button:has-text('Extract Outline'):visible").first();
    await expect(extractBtn).toBeEnabled();
    await extractBtn.click();

    // DesignOutlineCard appears and allows inline editing before Build App
    const visibleSummary = page.getByLabel("Application Summary").first();
    await expect(visibleSummary).toHaveValue(SAMPLE_OUTLINE_PAYLOAD.appSummary);
    await visibleSummary.fill("Customized Workspace");

    await page.locator("button:has-text('Build App'):visible").first().click();

    await expect(page.getByText("Locked for build").first()).toBeVisible();
    await expect(page.getByText("GENERATION COMPLETE").first()).toBeVisible({ timeout: 10000 });
    expect(generatePayload).toMatchObject({
      outlineId: OUTLINE_ID,
      model: "openai/gpt-4o",
    });
  });

  // covers: AC-5, AC-7
  test("preserves typed prompt and attached image when URL extraction fails with 422", async ({
    page,
  }) => {
    const attachmentId = "00000000-0000-0000-0000-000000000011";

    await page.route("**/api/projects/*/attachments", async (route) => {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          id: attachmentId,
          projectId: PROJECT_ID,
          threadId: THREAD_ID,
          messageId: null,
          kind: "image",
          sourceUrl: null,
          fileName: "sketch.png",
          mimeType: "image/png",
          sizeBytes: TINY_PNG_BYTES.byteLength,
          width: 1,
          height: 1,
          previewUrl: `/api/projects/${PROJECT_ID}/attachments/${attachmentId}`,
          urlSnapshot: null,
          createdAt: NOW,
        }),
      });
    });

    await page.route(`**/api/projects/*/attachments/${attachmentId}`, async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "image/png" },
        body: TINY_PNG_BYTES,
      });
    });

    await page.route("**/api/projects/*/outlines", async (route) => {
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Private or loopback URLs cannot be inspected.",
          code: "URL_INVALID_SSRF",
          suggestion: "Enter a public URL or upload a screenshot instead.",
        }),
      });
    });

    await page.goto("/");

    await page.locator("button[aria-label='Select AI model']:visible").first().click();
    await page.getByRole("menuitem", { name: /GPT-4o/i }).click();

    await page.getByLabel("Upload design reference images").first().setInputFiles({
      name: "sketch.png",
      mimeType: "image/png",
      buffer: TINY_PNG_BYTES,
    });

    const promptBox = page
      .locator("textarea[placeholder*='Add optional instructions']:visible")
      .first();
    await promptBox.fill("Keep my layout notes");

    await page.locator("button[aria-label='Add website design URL']:visible").first().click();
    await page
      .locator("input[aria-label='Reference website URL']:visible")
      .first()
      .fill("http://127.0.0.1:3000");

    await page.locator("button:has-text('Extract Outline'):visible").first().click();

    await expect(
      page.getByText("Private or loopback URLs cannot be inspected.").first()
    ).toBeVisible();
    await expect(page.getByText("sketch.png").first()).toBeVisible();
    await expect(promptBox).toHaveValue("Keep my layout notes");
  });
});
