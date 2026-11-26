import { and, db, desc, eq, projects, promptMessages, promptThreads } from "@spark/db";
import { AI_PROVIDERS, type ProjectFile, resolveModelProvider } from "@spark/shared";
import { generateText } from "ai";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createAiLanguageModel,
  parseGeneratedFilesPayload,
  resolveProviderApiKey,
} from "@/lib/ai-provider";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// In-memory rate limiter: maximum 10 repair calls per minute per project (Key Invariant)
const projectRepairTimestamps = new Map<string, number[]>();

function checkRateLimit(projectId: string): boolean {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = 10;

  const timestamps = (projectRepairTimestamps.get(projectId) || []).filter(
    (t) => now - t < windowMs
  );
  if (timestamps.length >= maxRequests) {
    return false;
  }
  timestamps.push(now);
  projectRepairTimestamps.set(projectId, timestamps);
  return true;
}

const repairRequestSchema = z.object({
  messageId: z.string().min(1).optional(),
  error: z.object({
    message: z.string(),
    filename: z.string().optional(),
    line: z.number().optional(),
    column: z.number().optional(),
    stack: z.string().optional(),
    category: z.enum(["compiler", "runtime", "import", "syntax"]).optional(),
    errorFingerprint: z.string().optional(),
  }),
  failingFile: z.object({
    path: z.string().min(1),
    content: z.string(),
  }),
  importedSiblingFiles: z
    .array(
      z.object({
        path: z.string().min(1),
        content: z.string(),
      })
    )
    .optional()
    .default([]),
  model: z.string().optional(),
  provider: z.enum(AI_PROVIDERS).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;

  // 1. Authenticate user
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Validate request body
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = repairRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid repair request payload", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const {
    messageId,
    error,
    failingFile,
    importedSiblingFiles,
    model,
    provider: explicitProvider,
  } = parsed.data;

  // 3. Rate limiting check (AC-3 / Invariants: 10 per minute per project)
  if (!checkRateLimit(projectId)) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Maximum 10 repair requests per minute." },
      { status: 429 }
    );
  }

  // 4. Verify project ownership
  const projectRows = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);

  const project = projectRows[0];
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // 5. Verify message ownership or create a new assistant message for manual repair (AC-8)
  let resolvedMessageId = messageId;
  if (resolvedMessageId) {
    const messageRows = await db
      .select({ id: promptMessages.id })
      .from(promptMessages)
      .innerJoin(promptThreads, eq(promptMessages.threadId, promptThreads.id))
      .where(and(eq(promptMessages.id, resolvedMessageId), eq(promptThreads.projectId, projectId)))
      .limit(1);

    if (messageRows.length === 0) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }
  } else {
    let threadId: string | undefined;
    const existingThreads = await db
      .select({ id: promptThreads.id })
      .from(promptThreads)
      .where(eq(promptThreads.projectId, projectId))
      .orderBy(promptThreads.createdAt)
      .limit(1);

    if (existingThreads[0]) {
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

    if (!threadId) {
      return NextResponse.json({ error: "Failed to resolve prompt thread" }, { status: 500 });
    }

    const lastMessages = await db
      .select({ seq: promptMessages.seq })
      .from(promptMessages)
      .where(eq(promptMessages.threadId, threadId))
      .orderBy(desc(promptMessages.seq))
      .limit(1);

    const nextSeq = (lastMessages[0]?.seq ?? 0) + 1;
    const assistantResult = await db
      .insert(promptMessages)
      .values({
        threadId,
        seq: nextSeq,
        role: "assistant",
        content: `Manual repair pass for ${failingFile.path}`,
        status: "streaming",
      })
      .returning();

    resolvedMessageId = assistantResult[0]?.id;
    if (!resolvedMessageId) {
      return NextResponse.json({ error: "Failed to create repair message" }, { status: 500 });
    }
  }

  // 6. Resolve API credentials
  const requestedModel = model?.trim() || "claude-3-7-sonnet";
  const provider = resolveModelProvider(requestedModel, explicitProvider);

  const apiKey = await resolveProviderApiKey({ userId: user.id, provider });

  const isMockMode = process.env.MOCK_AI === "true" || process.env.NODE_ENV === "test";
  if (!apiKey && !isMockMode) {
    return NextResponse.json(
      {
        error: "PROVIDER_KEY_MISSING",
        provider,
        message: `Please add your ${provider} API key in API Keys settings before repairing code.`,
      },
      { status: 400 }
    );
  }

  // 7. Prepare Server Sent Events response stream
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

  (async () => {
    let isCancelled = false;
    req.signal.addEventListener("abort", () => {
      isCancelled = true;
    });

    try {
      // Status 1: Analyzing diagnostics and sibling files
      await sendEvent("healing_status", {
        messageId: resolvedMessageId,
        status: "analyzing",
        category: error.category,
        message: `Analyzing error in ${failingFile.path}: ${error.message.slice(0, 80)}`,
      });

      if (isCancelled) throw new Error("Repair cancelled by user");

      // Status 2: Synthesizing targeted repair patches without re-planning
      await sendEvent("healing_status", {
        messageId: resolvedMessageId,
        status: "patching",
        category: error.category,
        message: "Synthesizing targeted patch for failing file and sibling imports",
      });

      const patchFiles: string[] = [];
      const updatedFiles: ProjectFile[] = [];

      if (!isMockMode && apiKey) {
        const siblingContext = importedSiblingFiles
          .map((f) => `--- SIBLING FILE: ${f.path} ---\n${f.content.slice(0, 4000)}`)
          .join("\n\n");

        const aiRepair = await generateText({
          model: createAiLanguageModel(provider, requestedModel, apiKey),
          abortSignal: req.signal,
          system: [
            "You are Spark's automated repair engine. Fix ONLY the reported build/runtime error with minimal changes.",
            "Respond ONLY with valid JSON matching this schema:",
            '{ "summary": "brief fix summary", "files": [{ "path": "src/App.tsx", "content": "full corrected file content..." }] }',
          ].join("\n"),
          prompt: [
            `Error (${error.category || "runtime"}): ${error.message}`,
            error.line ? `Location: ${failingFile.path}:${error.line}:${error.column || 1}` : "",
            error.stack ? `Stack:\n${error.stack.slice(0, 1500)}` : "",
            "",
            `--- FAILING FILE: ${failingFile.path} ---\n${failingFile.content}`,
            siblingContext ? `\n${siblingContext}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        });

        const parsedRepair = parseGeneratedFilesPayload(aiRepair.text);
        if (!parsedRepair || parsedRepair.files.length === 0) {
          throw new Error("Repair model did not return valid patched files.");
        }

        for (const file of parsedRepair.files) {
          updatedFiles.push(file);
          patchFiles.push(file.path);
          await sendEvent("file_op", {
            path: file.path,
            op: "write",
            content: file.content,
            diff: `+ repaired ${error.category || "preview"} diagnostic via ${requestedModel}`,
          });
        }
      } else {
        // Determine deterministic repair transformation based on error category (mock/test mode)
        const errorMessage = error.message.toLowerCase();

        // Check if error is an export issue in a sibling file
        const exportMatch = error.message.match(
          /does not provide an export named ['"]([^'"]+)['"]/i
        );
        if (exportMatch && importedSiblingFiles.length > 0) {
          const missingExport = exportMatch[1];
          const sibling = importedSiblingFiles[0];
          if (sibling && missingExport) {
            const patchedSiblingContent = `${sibling.content}\nexport const ${missingExport} = () => null;\n`;
            updatedFiles.push({
              path: sibling.path,
              content: patchedSiblingContent,
            });
            patchFiles.push(sibling.path);

            await sendEvent("file_op", {
              path: sibling.path,
              op: "write",
              content: patchedSiblingContent,
              diff: `+ export const ${missingExport}`,
            });
          }
        }

        // Check failing file repair
        let patchedFailingContent = failingFile.content;

        if (errorMessage.includes("failed to resolve import") || error.category === "import") {
          // Fix unresolved import by cleaning or substituting specifier
          patchedFailingContent = failingFile.content
            .replace(/import\s+.*?from\s+["'][^"']*missing[^"']*["'];?/g, "")
            .replace(
              /import\s+.*?from\s+["']lucide-react\/icons\/[^"']+["'];?/g,
              'import { AlertCircle } from "lucide-react";'
            );
        } else if (errorMessage.includes("unexpected token") || error.category === "syntax") {
          // Fix syntax issues such as unterminated string or missing closing brackets
          if (!patchedFailingContent.includes("export default")) {
            patchedFailingContent = `${patchedFailingContent}\nexport default function App() { return <div>App</div>; }`;
          }
          // Remove trailing invalid characters or broken tags
          patchedFailingContent = patchedFailingContent
            .replace(/<\/[^>]*>$/, "")
            .replace(/;\s*;\s*$/, ";");
        } else {
          // General runtime error repair
          patchedFailingContent = failingFile.content;
        }

        // Always ensure the failing file is patched and streamed
        if (!patchFiles.includes(failingFile.path)) {
          updatedFiles.push({
            path: failingFile.path,
            content: patchedFailingContent,
          });
          patchFiles.push(failingFile.path);

          await sendEvent("file_op", {
            path: failingFile.path,
            op: "write",
            content: patchedFailingContent,
            diff: `+ repaired ${error.category || "preview"} diagnostic in ${failingFile.path}`,
          });
        }
      }

      // Status 3: Finish repair pass and trigger verification
      await sendEvent("healing_status", {
        messageId: resolvedMessageId,
        status: "verifying",
        patchFiles,
        message: "Patches applied. Awaiting preview health verification.",
      });

      await sendEvent("finish", {
        messageId: resolvedMessageId,
        patchFiles,
        status: "verifying",
      });
    } catch (err: unknown) {
      const errorObj = err as Error;
      console.error("Repair route error:", errorObj);
      if (resolvedMessageId) {
        try {
          await db
            .update(promptMessages)
            .set({
              status: "failed",
            })
            .where(eq(promptMessages.id, resolvedMessageId));
        } catch {
          // Ignore secondary DB failure while reporting repair error
        }
      }
      await sendEvent("error", {
        message: errorObj?.message || "Repair generation failed",
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
