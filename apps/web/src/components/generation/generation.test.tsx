import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import {
  type AiModelOption,
  type DesignAttachmentDto,
  type DesignOutlineDto,
  type FileOperation,
  type HealingTelemetry,
  MAX_IMAGE_BYTES,
  type PlanStep,
  type PreviewErrorPayload,
} from "@spark/shared";
import { DesignOutlineCard } from "./DesignOutlineCard";
import { GenerationProgressCard } from "./GenerationProgressCard";
import { PreviewErrorBanner } from "./PreviewErrorBanner";
import { PromptComposer } from "./PromptComposer";

function makeAttachment(overrides: Partial<DesignAttachmentDto> = {}): DesignAttachmentDto {
  return {
    id: "att-1",
    projectId: "proj-1",
    threadId: "thread-1",
    messageId: null,
    kind: "image",
    sourceUrl: null,
    fileName: "mockup.png",
    mimeType: "image/png",
    sizeBytes: 2048,
    width: 800,
    height: 600,
    previewUrl: "/api/projects/proj-1/attachments/att-1",
    urlSnapshot: null,
    createdAt: "2026-11-28T00:00:00.000Z",
    ...overrides,
  };
}

function makeOutline(overrides: Partial<DesignOutlineDto> = {}): DesignOutlineDto {
  return {
    id: "outline-1",
    projectId: "proj-1",
    threadId: "thread-1",
    sourceMessageId: "msg-1",
    clonedFromOutlineId: null,
    outlineMessageId: "msg-2",
    buildMessageId: null,
    status: "ready",
    modelId: "openrouter/free",
    extractedOutline: {
      appSummary: "Initial summary",
      palette: [{ id: "p1", role: "Primary", hex: "#2563EB", usage: "Primary buttons" }],
      typography: { headingFont: "Inter", bodyFont: "Inter", scaleNotes: "Clean scale" },
      layoutSections: [
        { id: "s1", name: "Hero", description: "Hero section", enabled: true },
        { id: "s2", name: "Pricing", description: "Pricing tiers", enabled: true },
      ],
      componentHierarchy: [{ id: "c1", name: "AppShell", role: "Root shell", enabled: true }],
      additionalNotes: "",
    },
    editedOutline: null,
    createdAt: "2026-11-28T00:00:00.000Z",
    updatedAt: "2026-11-28T00:00:00.000Z",
    ...overrides,
  };
}

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

  it("keeps the custom model visionOverride checkbox mounted after enabling it with attached images", async () => {
    const user = userEvent.setup();
    render(
      <PromptComposer
        projectId="proj-1"
        selectedModel="custom/my-experimental-vision-model:free"
        pendingAttachments={[
          {
            id: "att-1",
            projectId: "proj-1",
            threadId: "thread-1",
            messageId: null,
            kind: "image",
            sourceUrl: null,
            fileName: "mockup.png",
            mimeType: "image/png",
            sizeBytes: 1024,
            width: 800,
            height: 600,
            previewUrl: "/api/projects/proj-1/attachments/att-1",
            urlSnapshot: null,
            createdAt: "2026-11-28T00:00:00.000Z",
          },
        ]}
        onSubmit={vi.fn()}
      />
    );

    const submitBtn = screen.getByRole("button", { name: /extract outline/i });
    const overrideCheckbox = screen.getByLabelText(
      /Override: treat custom model ID as vision capable/i
    );

    expect(submitBtn).toBeDisabled();
    expect(overrideCheckbox).not.toBeChecked();

    await user.click(overrideCheckbox);

    expect(overrideCheckbox).toBeInTheDocument();
    expect(overrideCheckbox).toBeChecked();
    expect(submitBtn).toBeEnabled();

    await user.click(overrideCheckbox);
    expect(overrideCheckbox).not.toBeChecked();
    expect(submitBtn).toBeDisabled();
  });

  // covers: AC-2, AC-4
  it("uploads a valid image via file picker, renders thumbnail chip, and removes pending upload", async () => {
    const user = userEvent.setup();
    const uploaded = makeAttachment({ id: "att-upload-1", fileName: "wireframe.png" });
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/projects/proj-1/attachments" && init?.method === "POST") {
        return Promise.resolve(
          new Response(JSON.stringify(uploaded), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      if (url === "/api/projects/proj-1/attachments/att-1" && init?.method === "DELETE") {
        return Promise.resolve(
          new Response(JSON.stringify({ deleted: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const onAttachmentUploaded = vi.fn();
    const onAttachmentRemoved = vi.fn();
    const { rerender } = render(
      <PromptComposer
        projectId="proj-1"
        threadId="thread-1"
        pendingAttachments={[]}
        onAttachmentUploaded={onAttachmentUploaded}
        onAttachmentRemoved={onAttachmentRemoved}
        onSubmit={vi.fn()}
      />
    );

    const fileInput = screen.getByLabelText("Upload design reference images") as HTMLInputElement;
    const pngFile = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "wireframe.png", {
      type: "image/png",
    });
    await user.upload(fileInput, pngFile);

    await waitFor(() => {
      expect(onAttachmentUploaded).toHaveBeenCalledWith(uploaded);
    });

    rerender(
      <PromptComposer
        projectId="proj-1"
        threadId="thread-1"
        pendingAttachments={[makeAttachment()]}
        onAttachmentUploaded={onAttachmentUploaded}
        onAttachmentRemoved={onAttachmentRemoved}
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByAltText("mockup.png")).toHaveAttribute(
      "src",
      "/api/projects/proj-1/attachments/att-1"
    );
    expect(screen.getByText(/800×600 · 2 KB/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove mockup.png" }));
    await waitFor(() => {
      expect(onAttachmentRemoved).toHaveBeenCalledWith("att-1");
    });
    vi.unstubAllGlobals();
  });

  // covers: AC-2, AC-7
  it("handles drag and drop, clipboard paste, and rejects invalid file type, oversized file, or >4 image limit", async () => {
    const uploaded = makeAttachment({ id: "att-pasted", fileName: "pasted.webp" });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(uploaded), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const onAttachmentUploaded = vi.fn();
    const { rerender } = render(
      <PromptComposer
        projectId="proj-1"
        pendingAttachments={[]}
        onAttachmentUploaded={onAttachmentUploaded}
        onSubmit={vi.fn()}
      />
    );

    // Unsupported file type via drop
    const composerRegion = screen.getByRole("region", { name: "Prompt composer" });
    const badFile = new File(["<svg></svg>"], "vector.svg", { type: "image/svg+xml" });
    fireEvent.drop(composerRegion, { dataTransfer: { files: [badFile], types: ["Files"] } });
    expect(screen.getByRole("alert")).toHaveTextContent(
      '"vector.svg" is not a supported PNG, JPEG, or WebP image.'
    );

    // Oversized file (>5 MB) via drop
    const hugeFile = new File([new Uint8Array(MAX_IMAGE_BYTES + 10)], "huge.png", {
      type: "image/png",
    });
    fireEvent.drop(composerRegion, { dataTransfer: { files: [hugeFile], types: ["Files"] } });
    expect(screen.getByRole("alert")).toHaveTextContent(
      '"huge.png" exceeds the 5 MB image upload limit.'
    );

    // Clipboard paste of valid WebP image
    const webpFile = new File([new Uint8Array([0x52, 0x49, 0x46, 0x46])], "pasted.webp", {
      type: "image/webp",
    });
    const textarea = screen.getByPlaceholderText(/Describe the application or component/i);
    fireEvent.paste(textarea, {
      clipboardData: {
        items: [{ kind: "file", type: "image/webp", getAsFile: () => webpFile }],
      },
    });
    await waitFor(() => {
      expect(onAttachmentUploaded).toHaveBeenCalledWith(uploaded);
    });

    // Reject 5th image when 4 are already pending
    rerender(
      <PromptComposer
        projectId="proj-1"
        pendingAttachments={[
          makeAttachment({ id: "a1", fileName: "1.png" }),
          makeAttachment({ id: "a2", fileName: "2.png" }),
          makeAttachment({ id: "a3", fileName: "3.png" }),
          makeAttachment({ id: "a4", fileName: "4.png" }),
        ]}
        onAttachmentUploaded={onAttachmentUploaded}
        onSubmit={vi.fn()}
      />
    );
    const fifthFile = new File([new Uint8Array([1, 2, 3])], "5.png", { type: "image/png" });
    fireEvent.drop(composerRegion, { dataTransfer: { files: [fifthFile], types: ["Files"] } });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "You can attach up to 4 images per extraction."
    );
    vi.unstubAllGlobals();
  });

  // covers: AC-3
  it("shows vision model switcher or missing key prompt when non-vision model is selected with images", async () => {
    const user = userEvent.setup();
    const textOnlyModel: AiModelOption = {
      id: "deepseek/deepseek-r1",
      name: "DeepSeek R1",
      provider: "openrouter",
      tier: "paid",
      supportsVision: false,
      badge: "OR",
    };
    const visionModel: AiModelOption = {
      id: "openai/gpt-4o",
      name: "GPT-4o",
      provider: "openrouter",
      tier: "paid",
      supportsVision: true,
      badge: "OR",
    };

    const onModelChange = vi.fn();
    const onOpenApiKeys = vi.fn();
    const { rerender } = render(
      <PromptComposer
        projectId="proj-1"
        selectedModel={textOnlyModel.id}
        onModelChange={onModelChange}
        openRouterModels={[textOnlyModel, visionModel]}
        directModels={[]}
        configuredProviders={["openai"]}
        onOpenApiKeys={onOpenApiKeys}
        pendingAttachments={[makeAttachment()]}
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "DeepSeek R1 does not support image inputs."
    );
    expect(screen.getByRole("button", { name: /extract outline/i })).toBeDisabled();

    // When no vision provider key is configured, shows Add a vision provider key button
    const addKeyBtn = screen.getByRole("button", { name: /Add a vision provider key/i });
    await user.click(addKeyBtn);
    expect(onOpenApiKeys).toHaveBeenCalledTimes(1);

    // When openrouter is configured, shows one-click vision switcher button
    rerender(
      <PromptComposer
        projectId="proj-1"
        selectedModel={textOnlyModel.id}
        onModelChange={onModelChange}
        openRouterModels={[textOnlyModel, visionModel]}
        directModels={[]}
        configuredProviders={["openrouter"]}
        onOpenApiKeys={onOpenApiKeys}
        pendingAttachments={[makeAttachment()]}
        onSubmit={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: /Switch to GPT-4o/i }));
    expect(onModelChange).toHaveBeenCalledWith("openai/gpt-4o");
  });

  // covers: AC-2, AC-3, AC-7
  it("allows URL-only submission on text model with blank prompt and preserves inputs when extraction fails", async () => {
    const user = userEvent.setup();
    const textOnlyModel: AiModelOption = {
      id: "deepseek/deepseek-r1",
      name: "DeepSeek R1",
      provider: "openrouter",
      tier: "paid",
      supportsVision: false,
      badge: "OR",
    };

    const onSubmitMultimodal = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    render(
      <PromptComposer
        projectId="proj-1"
        selectedModel={textOnlyModel.id}
        openRouterModels={[textOnlyModel]}
        directModels={[]}
        onSubmitMultimodal={onSubmitMultimodal}
        onSubmit={vi.fn()}
      />
    );

    const urlToggle = screen.getByRole("button", { name: "Add website design URL" });
    expect(urlToggle).toHaveAttribute("aria-expanded", "false");
    await user.click(urlToggle);
    expect(urlToggle).toHaveAttribute("aria-expanded", "true");

    const urlInput = screen.getByLabelText("Reference website URL");
    await user.type(urlInput, "https://example.com");

    const extractBtn = screen.getByRole("button", { name: /extract outline/i });
    expect(extractBtn).toBeEnabled();
    await user.click(extractBtn);

    await waitFor(() => {
      expect(onSubmitMultimodal).toHaveBeenCalledWith({
        prompt: "",
        model: "deepseek/deepseek-r1",
        attachmentIds: [],
        sourceUrl: "https://example.com",
        visionOverride: undefined,
      });
    });

    // Because first call returned false, URL input remains preserved for retry
    expect(urlInput).toHaveValue("https://example.com");

    // Second call returns true -> clears URL input
    await user.click(extractBtn);
    await waitFor(() => {
      expect(screen.queryByLabelText("Reference website URL")).not.toBeInTheDocument();
    });
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

describe("DesignOutlineCard Component", () => {
  it("clears Saving changes indicator when Build App cancels the pending PATCH debounce", () => {
    const basePayload: DesignOutlineDto["extractedOutline"] = {
      appSummary: "Initial summary",
      palette: [{ id: "p1", role: "Primary", hex: "#2563EB", usage: "Primary buttons" }],
      typography: { headingFont: "Inter", bodyFont: "Inter", scaleNotes: "Clean scale" },
      layoutSections: [{ id: "s1", name: "Hero", description: "Hero section", enabled: true }],
      componentHierarchy: [{ id: "c1", name: "AppShell", role: "Root shell", enabled: true }],
      additionalNotes: "",
    };

    const readyOutline: DesignOutlineDto = {
      id: "outline-1",
      projectId: "proj-1",
      threadId: "thread-1",
      sourceMessageId: "msg-1",
      clonedFromOutlineId: null,
      outlineMessageId: "msg-2",
      buildMessageId: null,
      status: "ready",
      modelId: "openrouter/free",
      extractedOutline: basePayload,
      editedOutline: null,
      createdAt: "2026-11-28T00:00:00.000Z",
      updatedAt: "2026-11-28T00:00:00.000Z",
    };

    const onBuildOutline = vi.fn();
    const { rerender } = render(
      <DesignOutlineCard
        projectId="proj-1"
        outline={readyOutline}
        onOutlineUpdated={vi.fn()}
        onOutlineCloned={vi.fn()}
        onBuildOutline={onBuildOutline}
      />
    );

    const summaryInput = screen.getByLabelText("Application Summary");
    fireEvent.change(summaryInput, { target: { value: "Updated before debounce" } });
    expect(screen.getByText("Saving changes...")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /build app/i }));
    expect(onBuildOutline).toHaveBeenCalledTimes(1);

    rerender(
      <DesignOutlineCard
        projectId="proj-1"
        outline={{
          ...readyOutline,
          status: "confirmed",
          editedOutline: { ...basePayload, appSummary: "Updated before debounce" },
        }}
        onOutlineUpdated={vi.fn()}
        onOutlineCloned={vi.fn()}
        onBuildOutline={onBuildOutline}
      />
    );

    expect(screen.queryByText("Saving changes...")).not.toBeInTheDocument();
    expect(screen.getByText("Locked for build")).toBeInTheDocument();
  });

  // covers: AC-8
  it("debounces PATCH edits across palette, typography, sections, components, and notes", async () => {
    vi.useFakeTimers();
    const outline = makeOutline();
    const updatedOutline = makeOutline({
      editedOutline: {
        ...outline.extractedOutline,
        appSummary: "Refined Tracker",
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ outline: updatedOutline }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const onOutlineUpdated = vi.fn();
    render(
      <DesignOutlineCard
        projectId="proj-1"
        outline={outline}
        onOutlineUpdated={onOutlineUpdated}
        onOutlineCloned={vi.fn()}
        onBuildOutline={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("Application Summary"), {
      target: { value: "Refined Tracker" },
    });
    fireEvent.change(screen.getByLabelText("Hex code for Primary"), {
      target: { value: "#10B981" },
    });
    fireEvent.change(screen.getByLabelText("Heading Font"), {
      target: { value: "Plus Jakarta Sans" },
    });
    fireEvent.click(screen.getByLabelText("Pricing"));
    fireEvent.click(screen.getByLabelText("AppShell"));
    fireEvent.change(screen.getByLabelText("Additional Notes"), {
      target: { value: "Keep high contrast" },
    });

    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/projects/proj-1/outlines/outline-1");
    expect(init?.method).toBe("PATCH");
    const sentBody = JSON.parse(String(init?.body)) as {
      editedOutline: DesignOutlineDto["extractedOutline"];
    };
    expect(sentBody.editedOutline.appSummary).toBe("Refined Tracker");
    expect(sentBody.editedOutline.palette[0]?.hex).toBe("#10B981");
    expect(sentBody.editedOutline.typography.headingFont).toBe("Plus Jakarta Sans");
    expect(sentBody.editedOutline.layoutSections[1]?.enabled).toBe(false);
    expect(sentBody.editedOutline.componentHierarchy[0]?.enabled).toBe(false);
    expect(sentBody.editedOutline.additionalNotes).toBe("Keep high contrast");
    expect(onOutlineUpdated).toHaveBeenCalledWith(updatedOutline);

    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // covers: AC-8, AC-9
  it("disables Build App when all sections are disabled and surfaces PATCH errors via alert", async () => {
    vi.useFakeTimers();
    const outline = makeOutline({
      extractedOutline: {
        ...makeOutline().extractedOutline,
        layoutSections: [{ id: "s1", name: "Hero", description: "Hero section", enabled: true }],
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Only ready outlines can be edited" }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <DesignOutlineCard
        projectId="proj-1"
        outline={outline}
        onOutlineUpdated={vi.fn()}
        onOutlineCloned={vi.fn()}
        onBuildOutline={vi.fn()}
      />
    );

    fireEvent.click(screen.getByLabelText("Hero"));
    expect(screen.getByRole("button", { name: /build app/i })).toBeDisabled();

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Only ready outlines can be edited");
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // covers: AC-8
  it("resets editedOutline back to extractedOutline when clicking Reset", async () => {
    const user = userEvent.setup();
    const base = makeOutline();
    const edited = makeOutline({
      editedOutline: { ...base.extractedOutline, appSummary: "Edited summary" },
    });
    const resetResponse = makeOutline({ editedOutline: null });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ outline: resetResponse }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const onOutlineUpdated = vi.fn();
    render(
      <DesignOutlineCard
        projectId="proj-1"
        outline={edited}
        onOutlineUpdated={onOutlineUpdated}
        onOutlineCloned={vi.fn()}
        onBuildOutline={vi.fn()}
      />
    );

    expect(screen.getByLabelText("Application Summary")).toHaveValue("Edited summary");

    await user.click(screen.getByRole("button", { name: /reset/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/projects/proj-1/outlines/outline-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: true }),
      });
    });
    expect(screen.getByLabelText("Application Summary")).toHaveValue("Initial summary");
    expect(onOutlineUpdated).toHaveBeenCalledWith(resetResponse);
    vi.unstubAllGlobals();
  });

  // covers: AC-9
  it("locks confirmed outlines as read-only and clones to a new draft via Clone to New Draft", async () => {
    const user = userEvent.setup();
    const confirmed = makeOutline({
      status: "confirmed",
      clonedFromOutlineId: "outline-0",
    });
    const cloned = makeOutline({
      id: "outline-2",
      status: "ready",
      clonedFromOutlineId: "outline-1",
      sourceMessageId: null,
    });
    const outlineMessage = {
      id: "msg-cloned",
      threadId: "thread-1",
      seq: 5,
      role: "assistant" as const,
      content: "Initial summary",
      toolCalls: null,
      snapshotId: null,
      status: "completed" as const,
      createdAt: "2026-11-28T00:00:00.000Z",
    };

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ outline: cloned, outlineMessage }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const onOutlineCloned = vi.fn();
    render(
      <DesignOutlineCard
        projectId="proj-1"
        outline={confirmed}
        onOutlineUpdated={vi.fn()}
        onOutlineCloned={onOutlineCloned}
        onBuildOutline={vi.fn()}
      />
    );

    expect(screen.getByText("Cloned draft")).toBeInTheDocument();
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
    expect(screen.getByLabelText("Application Summary")).toBeDisabled();
    expect(screen.getByLabelText("Hex code for Primary")).toBeDisabled();
    expect(screen.queryByRole("button", { name: /build app/i })).not.toBeInTheDocument();

    const cloneBtn = screen.getByRole("button", { name: /clone to new draft/i });
    await user.click(cloneBtn);

    await waitFor(() => {
      expect(onOutlineCloned).toHaveBeenCalledWith(cloned, outlineMessage);
    });
    vi.unstubAllGlobals();
  });
});
