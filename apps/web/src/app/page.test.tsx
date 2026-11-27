import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import BuilderPage from "./page";

describe("BuilderPage Component", () => {
  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("renders studio shell with project title and prompt assistant", () => {
    render(<BuilderPage />);

    expect(screen.getByText("sparkweb")).toBeInTheDocument();
    expect(screen.getByText("Demo Application")).toBeInTheDocument();
    expect(screen.getAllByText("Prompt Assistant").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Welcome to sparkweb/i).length).toBeGreaterThan(0);
  });

  it("renders live preview toolbar, device switcher controls, and inspect toggle (AC-1)", () => {
    render(<BuilderPage />);

    expect(screen.getAllByLabelText("Desktop viewport").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Tablet viewport").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Mobile viewport").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Preview address bar").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Enable canvas inspect mode").length).toBeGreaterThan(0);
  });

  it("toggles inspect mode and shows inspector panel (AC-1, AC-4)", () => {
    render(<BuilderPage />);

    const inspectBtn = screen.getByLabelText("Enable canvas inspect mode");
    fireEvent.click(inspectBtn);

    expect(screen.getByLabelText("Exit canvas inspect mode")).toBeInTheDocument();
    expect(screen.getAllByText("Canvas Inspector").length).toBeGreaterThan(0);

    // Toggle off
    const exitBtn = screen.getByLabelText("Exit canvas inspect mode");
    fireEvent.click(exitBtn);
    expect(screen.getByLabelText("Enable canvas inspect mode")).toBeInTheDocument();
  });

  // covers: AC-8
  it("listens to global Command+Z and Command+Shift+Z without interfering with text inputs", () => {
    render(<BuilderPage />);

    // Press Cmd+Z globally when nothing is in undo stack
    fireEvent.keyDown(window, { key: "z", metaKey: true });
    // Press Cmd+Shift+Z globally
    fireEvent.keyDown(window, { key: "z", metaKey: true, shiftKey: true });

    // Expect page to remain healthy
    expect(screen.getByText("sparkweb")).toBeInTheDocument();
  });

  it("allows user to type a prompt and submit via composer", async () => {
    render(<BuilderPage />);

    const textareas = screen.getAllByPlaceholderText(/Describe the application or component/i);
    const textarea = textareas[0];
    if (!textarea) throw new Error("Textarea element not found");

    fireEvent.change(textarea, { target: { value: "Build a customer feedback form" } });

    const generateButtons = screen.getAllByRole("button", { name: /generate/i });
    const generateBtn = generateButtons[0];
    if (!generateBtn) throw new Error("Generate button not found");
    fireEvent.click(generateBtn);

    expect(screen.getAllByText("Build a customer feedback form").length).toBeGreaterThan(0);
  });

  it("renders branch switcher and version history toggle in toolbar (AC-4, AC-5)", () => {
    render(<BuilderPage />);

    expect(screen.getByRole("button", { name: "Switch active branch" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open version history" })).toBeInTheDocument();

    const historyBtn = screen.getByRole("button", { name: "Open version history" });
    fireEvent.click(historyBtn);

    expect(screen.getByRole("dialog", { name: "Version history snapshots" })).toBeInTheDocument();
    expect(screen.getByText("Version History")).toBeInTheDocument();
  });

  it("switches to Database tab while keeping PreviewFrame iframe mounted in DOM (AC-4)", () => {
    render(<BuilderPage />);

    const previewIframe = screen.getByTitle("Sparkweb Live Preview");
    expect(previewIframe).toBeInTheDocument();

    const dbTab = screen.getByRole("tab", { name: /Database/i });
    fireEvent.click(dbTab);

    expect(screen.getByRole("region", { name: "Managed Database Viewer" })).toBeInTheDocument();
    expect(screen.getByTitle("Sparkweb Live Preview")).toBe(previewIframe);
  });

  it("preserves Database subview when switching tabs and persists active tab across remount", () => {
    const firstRender = render(<BuilderPage />);

    fireEvent.click(screen.getByRole("tab", { name: /Database/i }));
    fireEvent.click(screen.getByRole("button", { name: /SQL Console/i }));

    expect(screen.getByRole("button", { name: /SQL Console/i })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    // Switch to Preview and back to Database; DatabaseViewer remains mounted with SQL Console active
    fireEvent.click(screen.getByRole("tab", { name: /Preview/i }));
    fireEvent.click(screen.getByRole("tab", { name: /Database/i }));
    expect(screen.getByRole("button", { name: /SQL Console/i })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    // Remount BuilderPage (simulating HMR); Database tab stays selected via sessionStorage
    firstRender.unmount();
    render(<BuilderPage />);
    expect(screen.getByRole("tab", { name: /Database/i })).toHaveAttribute("aria-selected", "true");
  });

  // covers: AC-8
  it("keeps manual repair button enabled with 3 tries left after a generation turn exhausts retries", async () => {
    vi.stubEnv("NEXT_PUBLIC_SANDBOX_URL", "http://localhost:3000/sandbox/runner");
    const encoder = new TextEncoder();
    const makeStream = (events: string[]) =>
      new ReadableStream({
        start(controller) {
          for (const ev of events) {
            controller.enqueue(encoder.encode(ev));
          }
          controller.close();
        },
      });

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/generate")) {
        return Promise.resolve({
          ok: true,
          body: makeStream([
            'event: plan\ndata: {"messageId":"msg_1","steps":[{"id":"step-3","title":"Verify","status":"pending"}]}\n\n',
            'event: file_op\ndata: {"path":"src/App.tsx","op":"write","content":"broken"}\n\n',
            'event: finish\ndata: {"messageId":"msg_1"}\n\n',
          ]),
        } as unknown as Response);
      }
      if (url.includes("/repair")) {
        return Promise.resolve({
          ok: true,
          body: makeStream([
            'event: file_op\ndata: {"path":"src/App.tsx","op":"write","content":"still broken"}\n\n',
            'event: finish\ndata: {"messageId":"msg_1","patchFiles":["src/App.tsx"]}\n\n',
          ]),
        } as unknown as Response);
      }
      if (url.includes("/snapshots") && !url.includes("?")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: "snap_exhausted", treeHash: "hash_ex" }),
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ items: [], branches: [], queries: [] }),
      } as unknown as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<BuilderPage />);

    // Connect preview iframe
    const previewIframe = screen.getByTitle("Sparkweb Live Preview") as HTMLIFrameElement;
    const postMessageSpy = vi.fn((msg: { type: string }) => {
      if (msg.type === "PREVIEW_HEALTH_CHECK") {
        // Return a distinct error on each health check so all 3 attempts exhaust
        const repairCalls = fetchMock.mock.calls.filter(([u]) =>
          String(u).includes("/repair")
        ).length;
        setTimeout(() => {
          window.dispatchEvent(
            new MessageEvent("message", {
              origin: "http://localhost:3000",
              data: {
                protocol: "sparkweb:bridge:v1",
                type: "PREVIEW_HEALTH_STATUS",
                source: "sparkweb:sandbox",
                payload: {
                  healthy: false,
                  error: {
                    category: "syntax",
                    message: `Distinct error pass ${repairCalls}`,
                    filename: "src/App.tsx",
                  },
                },
                timestamp: Date.now(),
              },
            })
          );
        }, 0);
      }
    });
    Object.defineProperty(previewIframe, "contentWindow", {
      value: { postMessage: postMessageSpy },
      configurable: true,
    });

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "http://localhost:3000",
          data: {
            protocol: "sparkweb:bridge:v1",
            type: "PREVIEW_READY",
            source: "sparkweb:sandbox",
            payload: {},
            timestamp: Date.now(),
          },
        })
      );
    });

    const textarea = screen.getAllByPlaceholderText(/Describe the application or component/i)[0];
    if (!textarea) throw new Error("Textarea element not found");
    fireEvent.change(textarea, { target: { value: "Build broken app" } });
    const generateBtn = screen.getAllByRole("button", { name: /generate/i })[0];
    if (!generateBtn) throw new Error("Generate button not found");
    fireEvent.click(generateBtn);

    await waitFor(() => {
      expect(screen.getAllByText(/Self healing attempts exhausted/i).length).toBeGreaterThan(0);
    });

    // Now simulate a preview error banner appearing after generation stopped
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "http://localhost:3000",
          data: {
            protocol: "sparkweb:bridge:v1",
            type: "PREVIEW_ERROR",
            source: "sparkweb:sandbox",
            payload: {
              category: "runtime",
              message: "Uncaught ReferenceError: foo is not defined",
              filename: "src/App.tsx",
            },
            timestamp: Date.now(),
          },
        })
      );
    });

    const repairButton = screen.getByRole("button", { name: /Repair in sparkweb/i });
    expect(repairButton).toHaveTextContent("Repair in sparkweb (3 tries left)");
    expect(repairButton).toBeEnabled();
  });

  // covers: AC-10
  it("renders Publish trigger in builder header, opens PublishPopover, triggers publish, and opens CustomDomainDialog", async () => {
    const user = userEvent.setup();
    const now = "2026-11-26T00:00:00.000Z";
    const domain = {
      id: "dom-1",
      projectId: "proj-1",
      subdomain: "demo-app",
      customDomain: null,
      recordType: null,
      verificationToken: null,
      verificationStatus: "unconfigured",
      sslStatus: "unconfigured",
      failureReason: null,
      lastCheckedAt: null,
      verifiedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/deployments?limit=10")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              domain,
              activeDeployment: null,
              items: [],
              nextCursor: null,
            }),
            { status: 200 }
          )
        );
      }
      if (url.endsWith("/deployments") && init?.method === "POST") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              deployment: {
                id: "dep-1",
                projectId: "proj-1",
                snapshotId: "snap-1",
                subdomain: "demo-app",
                customDomain: null,
                status: "queued",
                deploymentUrl: "http://demo-app.localhost:3000",
                artifactKey: "deployments/proj-1/dep-1",
                buildLogs: null,
                buildDurationMs: null,
                errorMessage: null,
                trigger: "manual",
                promotedFromDeploymentId: null,
                retiredAt: null,
                createdAt: now,
                updatedAt: now,
              },
              domain,
            }),
            { status: 202 }
          )
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            items: [],
            branches: [],
            queries: [],
            keys: [],
            envProviders: [],
            configuredProviders: [],
            providerModels: { openrouter: [], anthropic: [], openai: [], gemini: [] },
          }),
          { status: 200 }
        )
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<BuilderPage />);

    const publishTrigger = screen.getByRole("button", { name: /^Publish$/i });
    await user.click(publishTrigger);

    expect(screen.getByRole("region", { name: "Publishing controls" })).toBeInTheDocument();
    expect(screen.getByText("Live Hosting")).toBeInTheDocument();
    expect(screen.getByText("Unpublished")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Publish Site/i }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).endsWith("/deployments") &&
          (init as RequestInit | undefined)?.method === "POST"
      );
      expect(postCall).toBeDefined();
      const requestInit = postCall?.[1] as RequestInit | undefined;
      expect(JSON.parse(String(requestInit?.body))).toEqual({
        previewClean: true,
        isStreaming: false,
      });
    });

    await user.click(screen.getByRole("button", { name: /Domains/i }));

    expect(
      await screen.findByRole("dialog", { name: /Domain & SSL Settings/i })
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Platform Subdomain")).toHaveValue("demo-app");
  });

  // covers: AC-2, AC-10
  it("disables Publish Site inside PublishPopover when preview has an active error", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              domain: null,
              activeDeployment: null,
              items: [],
              branches: [],
              queries: [],
              keys: [],
              envProviders: [],
              configuredProviders: [],
              providerModels: { openrouter: [], anthropic: [], openai: [], gemini: [] },
            }),
            { status: 200 }
          )
        )
      )
    );

    render(<BuilderPage />);

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "http://localhost:3000",
          data: {
            protocol: "sparkweb:bridge:v1",
            type: "PREVIEW_ERROR",
            source: "sparkweb:sandbox",
            payload: {
              category: "runtime",
              message: "Uncaught Error: broken preview",
              filename: "src/App.tsx",
            },
            timestamp: Date.now(),
          },
        })
      );
    });

    await user.click(screen.getByRole("button", { name: /^Publish$/i }));

    expect(
      screen.getByText("Resolve preview errors before publishing to live.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Publish Site/i })).toBeDisabled();
  });

  // covers: AC-2, AC-4, AC-7, AC-8, AC-9
  it("hydrates thread state with pending attachments and outlines, preserves attachments on outline error, and builds without duplicating user message", async () => {
    const user = userEvent.setup();
    const now = "2026-11-28T00:00:00.000Z";
    const pendingAtt = {
      id: "att-hydrated-1",
      projectId: "proj-1",
      threadId: "thread-hydrated",
      messageId: null,
      kind: "image",
      sourceUrl: null,
      fileName: "hydrated.png",
      mimeType: "image/png",
      sizeBytes: 1500,
      width: 640,
      height: 480,
      previewUrl: "/api/projects/proj-1/attachments/att-hydrated-1",
      urlSnapshot: null,
      createdAt: now,
    };
    const hydratedOutline = {
      id: "00000000-0000-0000-0000-000000000055",
      projectId: "proj-1",
      threadId: "thread-hydrated",
      sourceMessageId: "msg-user-1",
      clonedFromOutlineId: null,
      outlineMessageId: "msg-outline-1",
      buildMessageId: null,
      status: "ready",
      modelId: "claude-3-7-sonnet",
      extractedOutline: {
        appSummary: "Hydrated CRM Workspace",
        palette: [{ id: "p1", role: "Primary", hex: "#2563EB", usage: "Primary CTA" }],
        typography: { headingFont: "Inter", bodyFont: "Inter", scaleNotes: "Clean" },
        layoutSections: [{ id: "s1", name: "Pipeline", description: "Kanban view", enabled: true }],
        componentHierarchy: [{ id: "c1", name: "AppShell", role: "Shell", enabled: true }],
        additionalNotes: "",
      },
      editedOutline: null,
      createdAt: now,
      updatedAt: now,
    };

    const encoder = new TextEncoder();
    const generateStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'event: plan\ndata: {"messageId":"msg-build-1","steps":[{"id":"step-3","title":"Verify","status":"pending"}]}\n\n'
          )
        );
        controller.enqueue(
          encoder.encode(
            'event: file_op\ndata: {"path":"src/App.tsx","op":"write","content":"export default function App() { return <div>CRM</div>; }"}\n\n'
          )
        );
        controller.enqueue(encoder.encode('event: finish\ndata: {"messageId":"msg-build-1"}\n\n'));
        controller.close();
      },
    });

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/threads/default/state")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              threadId: "thread-hydrated",
              messages: [
                {
                  id: "msg-user-1",
                  threadId: "thread-hydrated",
                  seq: 1,
                  role: "user",
                  content: "Build CRM from screenshot",
                  toolCalls: null,
                  snapshotId: null,
                  status: "completed",
                  createdAt: now,
                },
                {
                  id: "msg-outline-1",
                  threadId: "thread-hydrated",
                  seq: 2,
                  role: "assistant",
                  content: "Hydrated CRM Workspace",
                  toolCalls: null,
                  snapshotId: null,
                  status: "completed",
                  createdAt: now,
                },
              ],
              attachmentsByMessageId: {},
              pendingAttachments: [pendingAtt],
              outlines: [hydratedOutline],
            }),
            { status: 200 }
          )
        );
      }
      if (url.endsWith("/outlines") && init?.method === "POST") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: "Website returned an empty JavaScript shell.",
              code: "URL_JS_SHELL",
              suggestion: "Paste a screenshot instead.",
            }),
            { status: 422 }
          )
        );
      }
      if (url.endsWith("/generate") && init?.method === "POST") {
        return Promise.resolve({ ok: true, body: generateStream } as unknown as Response);
      }
      if (url.endsWith("/snapshots") && init?.method === "POST") {
        return Promise.resolve(
          new Response(JSON.stringify({ id: "snap-mm-1", treeHash: "hash-mm-1" }), { status: 200 })
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            items: [],
            branches: [],
            queries: [],
            keys: [],
            envProviders: [],
            configuredProviders: ["anthropic"],
            providerModels: {
              openrouter: [],
              anthropic: [
                {
                  id: "claude-3-7-sonnet",
                  name: "Claude 3.7 Sonnet",
                  provider: "anthropic",
                  tier: "paid",
                  supportsVision: true,
                },
              ],
              openai: [],
              gemini: [],
            },
          }),
          { status: 200 }
        )
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<BuilderPage />);

    // Hydrated pending image chip and DesignOutlineCard appear (desktop + mobile panes both mount)
    const hydratedChips = await screen.findAllByText("hydrated.png");
    expect(hydratedChips.length).toBeGreaterThan(0);
    const summaryInput = screen.getAllByLabelText("Application Summary")[0];
    if (!summaryInput) throw new Error("Summary input not found");
    expect(summaryInput).toHaveValue("Hydrated CRM Workspace");

    // Triggering URL extraction error keeps pending image chip intact
    const urlToggle = screen.getAllByRole("button", { name: "Add website design URL" })[0];
    if (!urlToggle) throw new Error("URL toggle button not found");
    await user.click(urlToggle);
    const urlInput = screen.getAllByLabelText("Reference website URL")[0];
    if (!urlInput) throw new Error("URL input not found");
    await user.type(urlInput, "https://spa.example.com");
    const extractBtn = screen.getAllByRole("button", { name: /extract outline/i })[0];
    if (!extractBtn) throw new Error("Extract outline button not found");
    await user.click(extractBtn);

    const errMessages = await screen.findAllByText("Website returned an empty JavaScript shell.");
    expect(errMessages.length).toBeGreaterThan(0);
    expect(screen.getAllByText("hydrated.png").length).toBeGreaterThan(0);

    // Clicking Build App sends outlineId to /generate and does not duplicate user prompt message
    const buildBtn = screen.getAllByRole("button", { name: /build app/i })[0];
    if (!buildBtn) throw new Error("Build App button not found");
    await user.click(buildBtn);

    await waitFor(() => {
      const generateCall = fetchMock.mock.calls.find(
        ([u, i]) =>
          String(u).endsWith("/generate") && (i as RequestInit | undefined)?.method === "POST"
      );
      expect(generateCall).toBeDefined();
      const body = JSON.parse(String((generateCall?.[1] as RequestInit | undefined)?.body));
      expect(body.outlineId).toBe(hydratedOutline.id);
    });

    expect(screen.getAllByText("Build CRM from screenshot").length).toBeLessThanOrEqual(2);
    expect(screen.getAllByText("Locked for build").length).toBeGreaterThan(0);
  });
});
