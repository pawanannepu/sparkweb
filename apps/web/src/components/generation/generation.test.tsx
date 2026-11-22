import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { FileOperation, PlanStep, PreviewErrorPayload } from "@spark/shared";
import { GenerationProgressCard } from "./GenerationProgressCard";
import { PreviewErrorBanner } from "./PreviewErrorBanner";
import { PromptComposer } from "./PromptComposer";

describe("PromptComposer Component", () => {
  it("renders composer with textarea, model selector, and generate button", () => {
    const onSubmit = vi.fn();
    render(<PromptComposer onSubmit={onSubmit} />);

    expect(
      screen.getByPlaceholderText(/Describe the application or component/i)
    ).toBeInTheDocument();
    expect(screen.getByText("Claude 3.7 Sonnet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /generate/i })).toBeInTheDocument();
  });

  it("submits prompt when clicking Generate button", () => {
    const onSubmit = vi.fn();
    render(<PromptComposer onSubmit={onSubmit} />);

    const textarea = screen.getByPlaceholderText(/Describe the application or component/i);
    fireEvent.change(textarea, { target: { value: "Build a chat interface" } });

    const generateBtn = screen.getByRole("button", { name: /generate/i });
    fireEvent.click(generateBtn);

    expect(onSubmit).toHaveBeenCalledWith("Build a chat interface", "claude-3-7-sonnet");
  });

  it("renders stop button and disables input when isStreaming is true", () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    render(<PromptComposer onSubmit={onSubmit} onCancel={onCancel} isStreaming={true} />);

    const stopBtn = screen.getByRole("button", { name: /stop/i });
    expect(stopBtn).toBeInTheDocument();

    fireEvent.click(stopBtn);
    expect(onCancel).toHaveBeenCalled();
  });
});

describe("GenerationProgressCard Component", () => {
  it("renders milestones and file operations", () => {
    const steps: PlanStep[] = [
      { id: "1", title: "Analyze prompt", status: "completed" },
      { id: "2", title: "Generate component files", status: "running" },
    ];
    const ops: FileOperation[] = [
      { path: "src/App.tsx", op: "write", status: "completed", diff: "+ added header" },
    ];

    render(<GenerationProgressCard isStreaming={true} planSteps={steps} fileOperations={ops} />);

    expect(screen.getByText("Analyze prompt")).toBeInTheDocument();
    expect(screen.getByText("Generate component files")).toBeInTheDocument();
    expect(screen.getByText("src/App.tsx")).toBeInTheDocument();
    expect(screen.getByText("Generation In Progress")).toBeInTheDocument();
  });

  it("toggles diff view when clicking Show diff", () => {
    const ops: FileOperation[] = [
      { path: "src/App.tsx", op: "write", status: "completed", diff: "+ added header" },
    ];

    render(<GenerationProgressCard isStreaming={false} planSteps={[]} fileOperations={ops} />);

    const toggleBtn = screen.getByRole("button", { name: /show diff/i });
    fireEvent.click(toggleBtn);

    expect(screen.getByText(/\+ added header/i)).toBeInTheDocument();
  });
});

describe("PreviewErrorBanner Component", () => {
  it("renders compilation error message with location metadata", () => {
    const error: PreviewErrorPayload = {
      message: "Unexpected token in JSX element",
      filename: "src/App.tsx",
      line: 14,
      column: 3,
    };
    const onDismiss = vi.fn();

    render(<PreviewErrorBanner error={error} onDismiss={onDismiss} />);

    expect(screen.getByText("Preview Compilation Warning")).toBeInTheDocument();
    expect(screen.getByText("src/App.tsx:14")).toBeInTheDocument();
    expect(screen.getByText(/Unexpected token in JSX element/i)).toBeInTheDocument();

    const dismissBtn = screen.getByRole("button", { name: /dismiss/i });
    fireEvent.click(dismissBtn);
    expect(onDismiss).toHaveBeenCalled();
  });
});
