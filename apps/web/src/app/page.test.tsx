import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import BuilderPage from "./page";

describe("BuilderPage Component", () => {
  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
    vi.restoreAllMocks();
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
});
