import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BuilderShell, BuilderWorkbench, ChatPanel, PreviewFrame, PreviewToolbar } from "./index";

describe("Layout Components", () => {
  it("renders PreviewToolbar and handles device changes, reload, and inspect toggle", async () => {
    const handleDeviceChange = vi.fn();
    const handleReload = vi.fn();
    const handleNavigate = vi.fn();
    const handleToggleInspect = vi.fn();

    render(
      <PreviewToolbar
        activeDevice="desktop"
        onDeviceChange={handleDeviceChange}
        onReload={handleReload}
        onNavigate={handleNavigate}
        currentPath="/users"
        isConnected={true}
        sandboxUrl="http://127.0.0.1:3000/sandbox"
        isInspectMode={false}
        onToggleInspect={handleToggleInspect}
      />
    );

    expect(screen.getByLabelText("Connected")).toBeInTheDocument();

    // Inspect toggle button
    const inspectBtn = screen.getByLabelText("Enable canvas inspect mode");
    await userEvent.click(inspectBtn);
    expect(handleToggleInspect).toHaveBeenCalledTimes(1);

    // Click Mobile preset button
    const mobileBtn = screen.getByLabelText("Mobile viewport");
    await userEvent.click(mobileBtn);
    expect(handleDeviceChange).toHaveBeenCalledWith("mobile");

    // Click Reload button
    const reloadBtn = screen.getByLabelText("Reload preview");
    await userEvent.click(reloadBtn);
    expect(handleReload).toHaveBeenCalledTimes(1);

    // Enter navigation in address bar
    const addressInput = screen.getByLabelText("Preview address bar");
    expect(addressInput).toHaveValue("/users");

    await userEvent.clear(addressInput);
    await userEvent.type(addressInput, "/settings{enter}");
    expect(handleNavigate).toHaveBeenCalledWith("/settings");
  });

  it("renders PreviewFrame with proper sandbox permissions", () => {
    render(<PreviewFrame src="http://127.0.0.1:3000/sandbox" device="desktop" />);
    const iframe = screen.getByTitle("Sparkweb Live Preview") as HTMLIFrameElement;
    expect(iframe).toBeInTheDocument();
    expect(iframe.getAttribute("sandbox")).toBe(
      "allow-scripts allow-same-origin allow-forms allow-popups"
    );
  });

  it("renders ChatPanel with title and triggers collapse callback", async () => {
    const handleCollapse = vi.fn();
    render(
      <ChatPanel title="Test Assistant" onCollapse={handleCollapse}>
        <p>Chat contents</p>
      </ChatPanel>
    );

    expect(screen.getByText("Test Assistant")).toBeInTheDocument();
    expect(screen.getByText("Chat contents")).toBeInTheDocument();

    const collapseBtn = screen.getByLabelText("Collapse chat panel (Cmd+B)");
    await userEvent.click(collapseBtn);
    expect(handleCollapse).toHaveBeenCalledTimes(1);
  });

  it("renders BuilderShell with brand, project badge, and theme trigger", () => {
    render(
      <BuilderShell projectName="Analytics Studio">
        <div>Workspace Area</div>
      </BuilderShell>
    );

    expect(screen.getByText("sparkweb")).toBeInTheDocument();
    expect(screen.getByText("Analytics Studio")).toBeInTheDocument();
    expect(screen.getByLabelText("Toggle theme")).toBeInTheDocument();
    expect(screen.getByRole("banner")).toHaveClass("relative", "z-40");
  });

  it("renders BuilderWorkbench and toggles mobile view on switcher click (AC-5)", async () => {
    render(
      <BuilderWorkbench
        chatContent={
          <ChatPanel title="Chat Assistant">
            <p>Chat Pane Content</p>
          </ChatPanel>
        }
        previewContent={<div>Preview Pane Content</div>}
      />
    );

    // Check desktop & mobile content rendered
    expect(screen.getAllByText("Chat Pane Content").length).toBeGreaterThan(0);

    const switchBtn = screen.getByRole("button", { name: "Switch to Live Preview" });
    await userEvent.click(switchBtn);
    expect(screen.getAllByText("Preview Pane Content").length).toBeGreaterThan(0);
  });

  it("collapses and restores chat panel via Cmd+B shortcut and ignores active inputs (AC-3)", async () => {
    render(
      <div>
        <input data-testid="test-input" placeholder="typing prompt" />
        <BuilderWorkbench
          chatContent={
            <ChatPanel title="Prompt Assistant">
              <p>Chat Pane Content</p>
            </ChatPanel>
          }
          previewContent={<div>Preview Pane Content</div>}
        />
      </div>
    );

    // Initial state: Chat panel is expanded
    expect(screen.getAllByText("Prompt Assistant").length).toBeGreaterThan(0);

    // Focus input: Cmd+B should be ignored while typing
    const input = screen.getByTestId("test-input");
    input.focus();
    expect(document.activeElement).toBe(input);

    fireEvent.keyDown(window, { key: "b", metaKey: true });
    expect(screen.queryByLabelText("Expand chat panel (Cmd+B)")).not.toBeInTheDocument();

    // Blur input: Cmd+B collapses chat panel
    input.blur();
    fireEvent.keyDown(window, { key: "b", metaKey: true });
    expect(screen.getByLabelText("Expand chat panel (Cmd+B)")).toBeInTheDocument();

    // Press Cmd+B again: chat panel restores and expand button disappears
    fireEvent.keyDown(window, { key: "b", metaKey: true });
    expect(screen.queryByLabelText("Expand chat panel (Cmd+B)")).not.toBeInTheDocument();
    expect(screen.getAllByText("Prompt Assistant").length).toBeGreaterThan(0);
  });

  // covers: AC-4, AC-5
  it("renders desktop panels including inspector panel when open", () => {
    const { container } = render(
      <BuilderWorkbench
        chatContent={
          <ChatPanel title="Chat">
            <p>Content</p>
          </ChatPanel>
        }
        previewContent={<div>Preview</div>}
        inspectorContent={<div>Inspector Controls</div>}
        isInspectorOpen={true}
      />
    );

    const chatPanel = container.querySelector("#chat-panel");
    const previewPanel = container.querySelector("#preview-panel");
    const inspectorPanel = container.querySelector("#inspector-panel");

    expect(chatPanel).toBeInTheDocument();
    expect(previewPanel).toBeInTheDocument();
    expect(inspectorPanel).toBeInTheDocument();
    expect(screen.getAllByText("Inspector Controls").length).toBeGreaterThan(0);
  });
});
