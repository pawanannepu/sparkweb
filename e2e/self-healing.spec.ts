import { expect, test } from "@playwright/test";

test.describe("Self healing verification engine", () => {
  // covers: AC-4, AC-5, AC-7, AC-8
  test("displays preview error banner on runtime error and executes manual repair pass", async ({
    page,
  }) => {
    await page.route("**/sandbox/runner", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html>
<html>
  <body>
    <div id="mock-runner">Mock Sandbox Runner</div>
    <script>
      window.parent.postMessage({
        protocol: "sparkweb:bridge:v1",
        type: "PREVIEW_READY",
        source: "sparkweb:sandbox",
        payload: { url: "about:blank" },
        timestamp: Date.now()
      }, "*");
      window.addEventListener("message", function (event) {
        var msg = event.data;
        if (!msg || msg.protocol !== "sparkweb:bridge:v1") return;
        if (msg.type === "PREVIEW_HEALTH_CHECK") {
          window.parent.postMessage({
            protocol: "sparkweb:bridge:v1",
            type: "PREVIEW_HEALTH_STATUS",
            source: "sparkweb:sandbox",
            payload: { healthy: true },
            timestamp: Date.now()
          }, "*");
        }
      });
    </script>
  </body>
</html>`,
      });
    });

    await page.route("**/api/projects/*/repair", async (route) => {
      const sseBody = [
        'event: healing_status\ndata: {"messageId":"00000000-0000-0000-0000-000000000099","status":"patching"}\n\n',
        'event: file_op\ndata: {"path":"src/App.tsx","op":"write","content":"export default function App() { return <div>Healed</div>; }"}\n\n',
        'event: finish\ndata: {"messageId":"00000000-0000-0000-0000-000000000099","patchFiles":["src/App.tsx"]}\n\n',
      ].join("");

      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "text/event-stream; charset=utf-8" },
        body: sseBody,
      });
    });

    await page.route("**/api/projects/*/snapshots", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: "snap-healed-e2e",
            treeHash: "hash-healed-e2e",
            fileCount: 1,
            trigger: "repair",
            tag: null,
            createdAt: new Date().toISOString(),
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto("/");

    // Wait for sandbox bridge connection indicator before sending error
    await expect(page.getByTitle("Sparkweb Live Preview")).toBeVisible();

    // Simulate runtime error emitted from preview runner
    await page.evaluate(() => {
      window.postMessage(
        {
          protocol: "sparkweb:bridge:v1",
          type: "PREVIEW_ERROR",
          source: "sparkweb:sandbox",
          payload: {
            category: "runtime",
            message: "Uncaught ReferenceError: brokenValue is not defined",
            filename: "src/App.tsx",
            line: 12,
          },
          timestamp: Date.now(),
        },
        "*"
      );
    });

    const repairBtn = page.getByRole("button", { name: /Repair in sparkweb \(3 tries left\)/i });
    await expect(repairBtn).toBeVisible();

    await repairBtn.click();

    await expect(page.getByText(/Self healed successfully/i).first()).toBeVisible({
      timeout: 15000,
    });
  });

  // covers: AC-8
  test("allows dismissing preview error banner without triggering repair", async ({ page }) => {
    await page.goto("/");

    await page.evaluate(() => {
      window.postMessage(
        {
          protocol: "sparkweb:bridge:v1",
          type: "PREVIEW_ERROR",
          source: "sparkweb:sandbox",
          payload: {
            category: "syntax",
            message: "SyntaxError: Unexpected token",
            filename: "src/App.tsx",
          },
          timestamp: Date.now(),
        },
        "*"
      );
    });

    await expect(page.getByText("Preview Compilation Warning")).toBeVisible();
    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByText("Preview Compilation Warning")).not.toBeVisible();
  });
});
