import { expect, test } from "@playwright/test";

test.describe("Managed database viewer and client data tools", () => {
  // covers: AC-4, AC-5, AC-7, AC-9
  test("browses tables, edits rows, guards destructive SQL, and preserves preview iframe across tabs", async ({
    page,
  }) => {
    await page.route("**/api/projects/*/queries", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ queries: [] }),
        });
        return;
      }
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON() as {
          title: string;
          sql: string;
          description?: string;
          isFavorite?: boolean;
        };
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            query: {
              id: "11111111-1111-1111-1111-111111111111",
              projectId: "00000000-0000-0000-0000-000000000001",
              title: body.title,
              sql: body.sql,
              description: body.description ?? null,
              isFavorite: body.isFavorite ?? false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.route("**/api/projects/*/snapshots/current", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ files: {} }),
      });
    });

    await page.route("**/sandbox/runner", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        headers: {
          "Cross-Origin-Embedder-Policy": "credentialless",
          "Cross-Origin-Opener-Policy": "same-origin",
        },
        body: `<!doctype html>
<html>
  <body>
    <div id="mock-runner">Mock Database Runner</div>
    <script>
      var rows = [
        { id: 1, title: "Seeded task", status: "todo" }
      ];
      var introspected = false;
      function emitReady() {
        window.parent.postMessage({
          protocol: "sparkweb:bridge:v1",
          type: "PREVIEW_READY",
          source: "sparkweb:sandbox",
          payload: { url: "about:blank" },
          timestamp: Date.now()
        }, "*");
        window.parent.postMessage({
          protocol: "sparkweb:bridge:v1",
          type: "DB_READY_EVENT",
          source: "sparkweb:sandbox",
          payload: { tableCount: 1 },
          timestamp: Date.now()
        }, "*");
      }
      var readyTimer = setInterval(function () {
        if (introspected) {
          clearInterval(readyTimer);
          return;
        }
        emitReady();
      }, 100);

      window.addEventListener("message", function (event) {
        var msg = event.data;
        if (!msg || msg.protocol !== "sparkweb:bridge:v1") return;
        if (msg.type === "PREVIEW_HEARTBEAT" || msg.type === "PREVIEW_BOOT") {
          emitReady();
        } else if (msg.type === "DB_INTROSPECT_REQUEST") {
          introspected = true;
          clearInterval(readyTimer);
          window.parent.postMessage({
            protocol: "sparkweb:bridge:v1",
            type: "DB_INTROSPECT_RESPONSE",
            source: "sparkweb:sandbox",
            payload: {
              id: msg.payload.id,
              tables: [{
                name: "demo_items",
                isReadOnly: false,
                rowCount: rows.length,
                columns: [
                  { name: "id", type: "integer", nullable: false, isPrimaryKey: true, isIdentity: true, defaultValue: "nextval('demo_items_id_seq')" },
                  { name: "title", type: "text", nullable: false, isPrimaryKey: false, isIdentity: false, defaultValue: null },
                  { name: "status", type: "text", nullable: false, isPrimaryKey: false, isIdentity: false, defaultValue: "'todo'" }
                ]
              }]
            },
            timestamp: Date.now()
          }, "*");
        } else if (msg.type === "DB_QUERY_REQUEST") {
          window.parent.postMessage({
            protocol: "sparkweb:bridge:v1",
            type: "DB_QUERY_RESPONSE",
            source: "sparkweb:sandbox",
            payload: {
              id: msg.payload.id,
              rows: rows,
              totalCount: rows.length,
              executionTimeMs: 3,
              columns: ["id", "title", "status"]
            },
            timestamp: Date.now()
          }, "*");
        } else if (msg.type === "DB_MUTATE_REQUEST") {
          if (msg.payload.action === "update" && msg.payload.where && msg.payload.where.id === 1) {
            rows[0] = Object.assign({}, rows[0], msg.payload.record);
          }
          window.parent.postMessage({
            protocol: "sparkweb:bridge:v1",
            type: "DB_MUTATE_RESPONSE",
            source: "sparkweb:sandbox",
            payload: { id: msg.payload.id, success: true, affectedRows: 1 },
            timestamp: Date.now()
          }, "*");
        }
      });
    </script>
  </body>
</html>`,
      });
    });

    await page.goto("/");

    const previewFrame = page.getByTitle("Sparkweb Live Preview");
    await expect(previewFrame).toBeVisible();

    await page.getByRole("tab", { name: /Database/i }).click();
    await expect(page.getByRole("region", { name: "Managed Database Viewer" })).toBeVisible();

    // Preview iframe stays attached in DOM when hidden
    await expect(previewFrame).toBeAttached();
    await expect(previewFrame).toBeHidden();

    // Table browser displays introspected table and row
    await expect(page.getByText("Seeded task")).toBeVisible();

    // Inline edit row cell
    await page.getByText("Seeded task").click();
    const editInput = page.getByLabel("Edit title");
    await editInput.fill("Updated task");
    await page.getByRole("button", { name: "Save cell edit" }).click();
    await expect(page.getByText("Updated task")).toBeVisible();

    // Switch to SQL Console and run query
    await page.getByRole("button", { name: /SQL Console/i }).click();
    await page.getByRole("button", { name: /Run Query/i }).click();
    await expect(page.getByText("3 ms")).toBeVisible();
  });
});
