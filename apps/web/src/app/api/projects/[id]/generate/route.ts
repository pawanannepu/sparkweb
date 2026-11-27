import {
  and,
  db,
  desc,
  eq,
  projects,
  promptMessages,
  promptThreads,
  snapshots,
  startOutlineBuildTransaction,
} from "@spark/db";
import {
  type FileOperation,
  type GenerationPlan,
  type PlanStep,
  type ProjectFile,
  type SnapshotFilesMap,
  STARTER_TEMPLATE_FILES,
} from "@spark/sandbox";
import {
  type AiProvider,
  type DesignOutlinePayload,
  DesignOutlinePayloadSchema,
  formatConfirmedOutlineForPrompt,
  getEffectiveOutlinePayload,
  isAiProvider,
  resolveModelProvider,
} from "@spark/shared";
import { generateText } from "ai";
import { type NextRequest, NextResponse } from "next/server";
import {
  createAiLanguageModel,
  parseGeneratedFilesPayload,
  resolveProviderApiKey,
} from "@/lib/ai-provider";
import { getCurrentUser } from "@/lib/auth";
import { handleMultimodalRouteError } from "@/lib/multimodal/serializers";
import { isValidUuid } from "@/lib/utils";

export const dynamic = "force-dynamic";

function buildGenerationPromptContext(currentFiles: SnapshotFilesMap): string {
  const relevantPaths = Object.keys(currentFiles)
    .filter(
      (filePath) =>
        filePath === "package.json" || filePath === "index.html" || filePath.startsWith("src/")
    )
    .slice(0, 15);

  return relevantPaths
    .map((filePath) => {
      const content = currentFiles[filePath]?.content || "";
      return `--- FILE: ${filePath} ---\n${content.slice(0, 6000)}`;
    })
    .join("\n\n");
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;

  // 1. Authenticate user
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Validate request body
  let body: {
    prompt?: string;
    threadId?: string;
    model?: string;
    provider?: string;
    activeFiles?: string[];
    outlineId?: string;
    editedOutline?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const outlineId = typeof body.outlineId === "string" ? body.outlineId.trim() : "";
  if (outlineId && !isValidUuid(outlineId)) {
    return NextResponse.json({ error: "Invalid outlineId" }, { status: 400 });
  }

  let validatedEditedOutline: DesignOutlinePayload | undefined;
  if (body.editedOutline !== undefined) {
    const parsedOutline = DesignOutlinePayloadSchema.safeParse(body.editedOutline);
    if (!parsedOutline.success) {
      return NextResponse.json(
        { error: parsedOutline.error.issues[0]?.message ?? "Invalid editedOutline payload" },
        { status: 400 }
      );
    }
    validatedEditedOutline = parsedOutline.data;
  }

  let prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt && !outlineId) {
    return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
  }

  // 3. Verify project ownership
  const projectRows = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);

  const project = projectRows[0];
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // 4. Resolve model provider and API key
  const requestedModel =
    (typeof body.model === "string" && body.model.trim()) || "claude-3-7-sonnet";
  const explicitProvider: AiProvider | undefined =
    typeof body.provider === "string" && isAiProvider(body.provider) ? body.provider : undefined;
  const provider = resolveModelProvider(requestedModel, explicitProvider);

  const apiKey = await resolveProviderApiKey({ userId: user.id, provider });

  // Check if offline/mock generation is enabled or running in test mode
  const isMockMode = process.env.MOCK_AI === "true" || process.env.NODE_ENV === "test";

  if (!apiKey && !isMockMode) {
    return NextResponse.json(
      {
        error: "PROVIDER_KEY_MISSING",
        provider,
        message: `Please add your ${provider} API key in API Keys settings before generating code.`,
      },
      { status: 400 }
    );
  }

  // 5. Resolve prompt thread and confirm design outline (when building from outlineId)
  let threadId = body.threadId;
  let assistantMessageId: string | undefined;
  let confirmedOutlineContext: string | null = null;
  let confirmedOutlinePayload: DesignOutlinePayload | null = null;

  if (outlineId) {
    try {
      const started = await startOutlineBuildTransaction(db, {
        projectId,
        outlineId,
        userId: user.id,
        editedOutline: validatedEditedOutline,
      });
      threadId = started.threadId;
      assistantMessageId = started.assistantMessage.id;
      const effectiveOutline = getEffectiveOutlinePayload({
        extractedOutline: started.outline.extractedOutline,
        editedOutline: started.outline.editedOutline,
      });
      confirmedOutlinePayload = effectiveOutline;
      confirmedOutlineContext = formatConfirmedOutlineForPrompt(effectiveOutline);
      if (!prompt) {
        prompt = started.sourceUserContent || effectiveOutline.appSummary;
      }
    } catch (err) {
      return handleMultimodalRouteError(err, "Failed to lock design outline for build");
    }
  } else {
    if (!threadId) {
      const existingThreads = await db
        .select({ id: promptThreads.id })
        .from(promptThreads)
        .where(eq(promptThreads.projectId, projectId))
        .orderBy(promptThreads.createdAt)
        .limit(1);

      if (existingThreads.length > 0 && existingThreads[0]) {
        threadId = existingThreads[0].id;
      } else {
        const createdThread = await db
          .insert(promptThreads)
          .values({
            projectId,
            title: "Main thread",
          })
          .returning();
        threadId = createdThread[0]?.id;
      }
    }

    if (!threadId) {
      return NextResponse.json({ error: "Failed to resolve prompt thread" }, { status: 500 });
    }

    // 6. Record user message
    const lastMessages = await db
      .select({ seq: promptMessages.seq })
      .from(promptMessages)
      .where(eq(promptMessages.threadId, threadId))
      .orderBy(desc(promptMessages.seq))
      .limit(1);

    const nextSeq = (lastMessages[0]?.seq ?? 0) + 1;

    await db.insert(promptMessages).values({
      threadId,
      seq: nextSeq,
      role: "user",
      content: prompt,
      status: "completed",
    });

    // 7. Create assistant message in streaming state
    const assistantResult = await db
      .insert(promptMessages)
      .values({
        threadId,
        seq: nextSeq + 1,
        role: "assistant",
        content: "",
        status: "streaming",
      })
      .returning();

    assistantMessageId = assistantResult[0]?.id;
  }

  // 8. Ingest current file tree
  let currentFiles: SnapshotFilesMap = { ...STARTER_TEMPLATE_FILES };
  if (project.currentSnapshotId) {
    const snapRows = await db
      .select({ files: snapshots.files })
      .from(snapshots)
      .where(eq(snapshots.id, project.currentSnapshotId))
      .limit(1);
    if (snapRows[0]?.files) {
      currentFiles = { ...snapRows[0].files };
    }
  }

  // 9. Prepare Server Sent Events response stream
  const responseStream = new TransformStream();
  const writer = responseStream.writable.getWriter();
  const encoder = new TextEncoder();

  const sendEvent = async (type: string, data: unknown) => {
    try {
      const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
      await writer.write(encoder.encode(payload));
    } catch {
      // Stream write error (e.g. client aborted)
    }
  };

  // Run generation loop asynchronously
  (async () => {
    let isCancelled = false;
    req.signal.addEventListener("abort", () => {
      isCancelled = true;
    });

    try {
      // Stage 1: Planning pass
      const planSteps: PlanStep[] = [
        {
          id: "step-1",
          title: `Analyze requirements for: "${prompt.slice(0, 40)}${prompt.length > 40 ? "..." : ""}"`,
          status: "completed",
        },
        {
          id: "step-2",
          title: "Synthesize UI components and responsive styling",
          status: "running",
        },
        {
          id: "step-3",
          title: "Verify client state and hot module replacement",
          status: "pending",
        },
      ];

      await sendEvent("plan", {
        messageId: assistantMessageId,
        steps: planSteps,
      });

      if (isCancelled) {
        throw new Error("Generation cancelled by user");
      }

      // Stage 2: Code Generation & Streaming file operations
      const generatedFiles: ProjectFile[] = [];
      const fileOps: FileOperation[] = [];
      let generationSummary = `Synthesized requested changes for "${prompt}". Code generation complete.`;
      let totalTokens = 1240;

      if (!isMockMode && apiKey) {
        const aiResult = await generateText({
          model: createAiLanguageModel(provider, requestedModel, apiKey),
          abortSignal: req.signal,
          system: [
            "You are Spark, an expert full-stack React + TypeScript + Tailwind CSS engineer inside the sparkweb live Vite sandbox.",
            "Generate clean, working, self-contained application code using React 19, TypeScript, Tailwind CSS classes, and lucide-react icons (only use packages already in package.json unless updating package.json).",
            "Do NOT modify plugins/spark-inspector.js or vite.config.ts unless explicitly required.",
            "Respond ONLY with valid JSON matching this exact schema (no markdown prose outside JSON):",
            '{ "summary": "brief description of what was built", "files": [{ "path": "src/App.tsx", "content": "full file source..." }] }',
          ].join("\n"),
          prompt: [
            `User request:\n${prompt}`,
            confirmedOutlineContext ? `\n${confirmedOutlineContext}` : "",
            "",
            "Current project files:",
            buildGenerationPromptContext(currentFiles),
          ]
            .filter(Boolean)
            .join("\n"),
        });

        const parsedOutput = parseGeneratedFilesPayload(aiResult.text);
        if (!parsedOutput || parsedOutput.files.length === 0) {
          throw new Error(
            "Model response did not contain valid generated file updates. Please try again or pick another model."
          );
        }

        if (parsedOutput.summary) {
          generationSummary = parsedOutput.summary;
        }
        if (typeof aiResult.usage?.totalTokens === "number") {
          totalTokens = aiResult.usage.totalTokens;
        }

        for (const file of parsedOutput.files) {
          generatedFiles.push(file);
          fileOps.push({
            path: file.path,
            op: "write",
            status: "completed",
            diff: `+ updated ${file.path} via ${requestedModel}`,
          });
          await sendEvent("file_op", {
            path: file.path,
            op: "write",
            content: file.content,
          });
        }
      } else {
        // Deterministic mock / test generation
        const lowerPrompt = prompt.toLowerCase();
        let updatedAppContent = currentFiles["src/App.tsx"]?.content || "";

        if (confirmedOutlinePayload) {
          const primaryHex = JSON.stringify(confirmedOutlinePayload.palette[0]?.hex ?? "#4F46E5");
          const enabledSections = confirmedOutlinePayload.layoutSections
            .filter((s) => s.enabled)
            .map((s) => s.name);
          const safeSummaryJson = JSON.stringify(confirmedOutlinePayload.appSummary);
          const safeFontFamilyJson = JSON.stringify(
            `${confirmedOutlinePayload.typography.headingFont}, sans-serif`
          );
          const safeSectionsJson = JSON.stringify(enabledSections);

          updatedAppContent = `import React, { useState } from "react";
import { Sparkles, CheckCircle2 } from "lucide-react";

const SECTIONS: string[] = ${safeSectionsJson};
const APP_SUMMARY = ${safeSummaryJson};
const PRIMARY_HEX = ${primaryHex};
const HEADING_FONT = ${safeFontFamilyJson};

export default function App() {
  const [activeSection, setActiveSection] = useState(SECTIONS[0] ?? "Overview");

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-2xl bg-slate-900/80 border border-slate-800 rounded-2xl p-8 shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div
            className="h-10 w-10 rounded-xl flex items-center justify-center text-white"
            style={{ backgroundColor: PRIMARY_HEX }}
          >
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white" style={{ fontFamily: HEADING_FONT }}>
              {APP_SUMMARY}
            </h1>
            <p className="text-xs text-slate-400">Built from confirmed design outline</p>
          </div>
        </div>
        <div className="grid gap-3 mt-6">
          {SECTIONS.map((section) => (
            <button
              key={section}
              type="button"
              onClick={() => setActiveSection(section)}
              className="flex items-center justify-between p-3 rounded-xl border border-slate-800 bg-slate-950/70 text-left hover:border-slate-700 transition"
            >
              <span className="text-sm font-medium text-slate-200">{section}</span>
              {activeSection === section && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}`;
        } else if (lowerPrompt.includes("todo") || lowerPrompt.includes("task")) {
          updatedAppContent = `import React, { useState } from "react";
import { CheckSquare, Plus, Trash2, Sparkles } from "lucide-react";

interface Todo {
  id: number;
  text: string;
  completed: boolean;
}

export default function App() {
  const [todos, setTodos] = useState<Todo[]>([
    { id: 1, text: "Explore Sparkweb live preview", completed: true },
    { id: 2, text: "Build next application feature", completed: false }
  ]);
  const [input, setInput] = useState("");

  const addTodo = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    setTodos([...todos, { id: Date.now(), text: input.trim(), completed: false }]);
    setInput("");
  };

  const toggleTodo = (id: number) => {
    setTodos(todos.map(t => t.id === id ? { ...t, completed: !t.completed } : t));
  };

  const deleteTodo = (id: number) => {
    setTodos(todos.filter(t => t.id !== id));
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md bg-slate-900/70 border border-slate-800 rounded-2xl p-6 shadow-2xl backdrop-blur-md">
        <div className="flex items-center gap-3 mb-6">
          <div className="h-10 w-10 rounded-xl bg-indigo-600/20 text-indigo-400 flex items-center justify-center ring-1 ring-indigo-500/30">
            <CheckSquare className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">Tasks & Todos</h1>
            <p className="text-xs text-slate-400">Generated with Sparkweb</p>
          </div>
        </div>

        <form onSubmit={addTodo} className="flex gap-2 mb-6">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Add a new task..."
            className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <button type="submit" className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg px-3.5 py-2 text-sm font-medium transition flex items-center gap-1">
            <Plus className="h-4 w-4" /> Add
          </button>
        </form>

        <div className="space-y-2">
          {todos.map(todo => (
            <div key={todo.id} className="flex items-center justify-between p-3 rounded-lg bg-slate-950/60 border border-slate-800/80">
              <span
                onClick={() => toggleTodo(todo.id)}
                className={\`text-sm cursor-pointer select-none flex-1 \${todo.completed ? "line-through text-slate-500" : "text-slate-200"}\`}
              >
                {todo.text}
              </span>
              <button onClick={() => deleteTodo(todo.id)} className="text-slate-500 hover:text-rose-400 p-1 transition">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}`;
        } else {
          updatedAppContent = `import React, { useState } from "react";
import { Sparkles, Zap, Heart, RefreshCw } from "lucide-react";

export default function App() {
  const [likes, setLikes] = useState(0);
  const [promptSummary] = useState("${prompt.replace(/"/g, '\\"')}");

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-lg bg-slate-900/80 border border-slate-800 rounded-2xl p-8 shadow-2xl backdrop-blur-md text-center">
        <div className="h-12 w-12 rounded-xl bg-indigo-600/20 text-indigo-400 flex items-center justify-center ring-1 ring-indigo-500/30 mx-auto mb-4">
          <Sparkles className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">Live Generated Application</h1>
        <p className="text-sm text-slate-400 mb-6 font-mono bg-slate-950/80 p-3 rounded-lg border border-slate-800">
          "{promptSummary}"
        </p>

        <div className="flex items-center justify-center gap-4">
          <button
            onClick={() => setLikes(l => l + 1)}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-xl font-medium transition active:scale-95 shadow-lg shadow-indigo-600/20"
          >
            <Heart className={\`h-4 w-4 \${likes > 0 ? "fill-rose-400 text-rose-400" : ""}\`} />
            Applaud ({likes})
          </button>
        </div>
      </div>
    </div>
  );
}`;
        }

        generatedFiles.push({
          path: "src/App.tsx",
          content: updatedAppContent,
        });

        fileOps.push({
          path: "src/App.tsx",
          op: "write",
          status: "completed",
          diff: `+ updated App component matching prompt`,
        });

        await sendEvent("file_op", {
          path: "src/App.tsx",
          op: "write",
          content: updatedAppContent,
        });
      }

      // Stream text chunk
      await sendEvent("text", {
        chunk: generationSummary,
      });

      // Stage 3: Snapshot Persistence & Finish
      if (planSteps[1]) planSteps[1].status = "completed";
      if (planSteps[2]) planSteps[2].status = "completed";
      await sendEvent("plan", {
        messageId: assistantMessageId,
        steps: planSteps,
      });

      if (isCancelled) {
        throw new Error("Generation cancelled by user");
      }

      // Update assistant message with generation metadata; persistence of snapshot
      // is deferred until the client verifies health in the live preview (AC-2)
      if (assistantMessageId) {
        const generationMeta: GenerationPlan = {
          plan: planSteps,
          fileOperations: fileOps,
          model: requestedModel,
          provider,
          totalTokens,
        };

        await db
          .update(promptMessages)
          .set({
            content: generationSummary,
            status: "streaming",
            toolCalls: generationMeta as unknown as Record<string, unknown>,
          })
          .where(eq(promptMessages.id, assistantMessageId));
      }

      // Emit finish event with messageId for deferred snapshot verification (AC-2)
      await sendEvent("finish", {
        messageId: assistantMessageId,
      });
    } catch (err: unknown) {
      const errorObj = err as Error;
      console.error("Generation stream error:", errorObj);

      if (assistantMessageId) {
        await db
          .update(promptMessages)
          .set({
            status: "failed",
            toolCalls: { error: errorObj?.message || "Generation error" },
          })
          .where(eq(promptMessages.id, assistantMessageId));
      }

      await sendEvent("error", {
        message: errorObj?.message || "An error occurred during code generation",
      });
    } finally {
      await writer.close();
    }
  })();

  return new Response(responseStream.readable, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
