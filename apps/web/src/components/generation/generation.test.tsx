import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { FileOperation, HealingTelemetry, PlanStep, PreviewErrorPayload } from "@spark/shared";
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

  it("allows filtering OpenRouter free/paid models and picking a custom OpenRouter model ID", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<PromptComposer onSubmit={onSubmit} />);

    await user.click(screen.getByRole("button", { name: /select ai model/i }));

    // Filter by Free OpenRouter models
    await user.click(screen.getByRole("button", { name: "Free" }));
    expect(screen.getByText("Qwen 2.5 Coder 32B")).toBeInTheDocument();
    expect(screen.queryByText("Claude Sonnet 4")).not.toBeInTheDocument();

    // Enter a custom OpenRouter model slug and select it
    const searchInput = screen.getByLabelText(
      /Search AI models or enter custom OpenRouter model ID/i
    );
    await user.type(searchInput, "nvidia/llama-3.1-nemotron-70b-instruct:free");
    await user.click(
      screen.getByText(/Use custom: nvidia\/llama-3\.1-nemotron-70b-instruct:free/i)
    );

    const textarea = screen.getByPlaceholderText(/Describe the application or component/i);
    fireEvent.change(textarea, { target: { value: "Build a dashboard" } });
    await user.click(screen.getByRole("button", { name: /generate/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      "Build a dashboard",
      "nvidia/llama-3.1-nemotron-70b-instruct:free"
    );
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

  // covers: AC-5
  it("renders expandable self healing card with diagnostic summary and patch badges", () => {
    const telemetry: HealingTelemetry = {
      status: "healed",
      totalRepairs: 1,
      attempts: [
        {
          attemptIndex: 1,
          errorFingerprint: "fingerprint-123",
          category: "import",
          message: "Failed to resolve import lucide-react/icons/missing",
          filePath: "src/App.tsx",
          line: 4,
          column: 8,
          patchFiles: ["src/App.tsx"],
          status: "resolved",
          timestamp: Date.now(),
        },
      ],
    };

    render(
      <GenerationProgressCard
        isStreaming={false}
        planSteps={[]}
        fileOperations={[]}
        healingTelemetry={telemetry}
      />
    );

    expect(screen.getByText(/Self healed successfully/i)).toBeInTheDocument();
    expect(screen.getByText("Attempt #1")).toBeInTheDocument();
    expect(screen.getByText("import")).toBeInTheDocument();
    expect(screen.getByText(/Failed to resolve import/i)).toBeInTheDocument();
    expect(screen.getByText("src/App.tsx")).toBeInTheDocument();
    expect(screen.getByText("resolved")).toBeInTheDocument();
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

  // covers: AC-8
  it("renders interactive repair action with remaining retry count and handles clicks", () => {
    const error: PreviewErrorPayload = {
      message: "SyntaxError: Unexpected token",
      filename: "src/App.tsx",
      line: 12,
      category: "syntax",
    };
    const onRepair = vi.fn();

    render(
      <PreviewErrorBanner
        error={error}
        onRepair={onRepair}
        remainingRetries={2}
        isRepairing={false}
      />
    );

    expect(screen.getByText(/Repair in sparkweb \(2 tries left\)/i)).toBeInTheDocument();
    const repairBtn = screen.getByRole("button", { name: /repair in sparkweb/i });
    fireEvent.click(repairBtn);

    expect(onRepair).toHaveBeenCalledWith(error);
  });

  // covers: AC-8
  it("disables repair button when remaining retries is zero or isRepairing is true", () => {
    const error: PreviewErrorPayload = {
      message: "SyntaxError: Unexpected token",
      filename: "src/App.tsx",
    };
    const onRepair = vi.fn();

    const { rerender } = render(
      <PreviewErrorBanner
        error={error}
        onRepair={onRepair}
        remainingRetries={0}
        isRepairing={false}
      />
    );

    const zeroRetriesBtn = screen.getByRole("button", { name: /repair in sparkweb/i });
    expect(zeroRetriesBtn).toBeDisabled();

    rerender(
      <PreviewErrorBanner
        error={error}
        onRepair={onRepair}
        remainingRetries={3}
        isRepairing={true}
      />
    );

    const repairingBtn = screen.getByRole("button", { name: /repairing preview/i });
    expect(repairingBtn).toBeDisabled();
  });

  // covers: AC-5, AC-6
  it("toggles healing attempt details and renders exhausted warning on GenerationProgressCard", async () => {
    const user = userEvent.setup();
    const telemetry: HealingTelemetry = {
      status: "exhausted",
      totalRepairs: 3,
      attempts: [
        {
          attemptIndex: 1,
          errorFingerprint: "fp-1",
          category: "syntax",
          message: "Unexpected token in App.tsx",
          filePath: "src/App.tsx",
          patchFiles: ["src/App.tsx"],
          status: "unfixable",
          timestamp: Date.now(),
        },
      ],
    };

    render(
      <GenerationProgressCard
        isStreaming={false}
        planSteps={[]}
        fileOperations={[]}
        healingTelemetry={telemetry}
      />
    );

    expect(
      screen.getByText("Self healing attempts exhausted (3 attempt limit)")
    ).toBeInTheDocument();
    expect(screen.getByText("Unexpected token in App.tsx")).toBeInTheDocument();

    const hideBtn = screen.getByRole("button", { name: /hide details/i });
    await user.click(hideBtn);

    expect(screen.queryByText("Unexpected token in App.tsx")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /show details/i })).toBeInTheDocument();
  });

  // covers: AC-8 (accessibility)
  it("exposes accessible names and keyboard focus on PreviewErrorBanner action buttons", async () => {
    const user = userEvent.setup();
    const onRepair = vi.fn();
    const onDismiss = vi.fn();

    render(
      <PreviewErrorBanner
        error={{
          message: "Uncaught ReferenceError: chart is not defined",
          filename: "src/App.tsx",
          category: "runtime",
        }}
        onRepair={onRepair}
        onDismiss={onDismiss}
        remainingRetries={3}
      />
    );

    const repairBtn = screen.getByRole("button", { name: /repair in sparkweb \(3 tries left\)/i });
    const dismissBtn = screen.getByRole("button", { name: /dismiss/i });

    await user.tab();
    expect(repairBtn).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onRepair).toHaveBeenCalledTimes(1);

    await user.tab();
    expect(dismissBtn).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
