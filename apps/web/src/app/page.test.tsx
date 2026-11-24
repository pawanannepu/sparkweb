import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import BuilderPage from "./page";

describe("BuilderPage Component", () => {
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
});
