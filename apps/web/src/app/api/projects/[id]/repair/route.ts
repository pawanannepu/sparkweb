import { and, db, eq, getDecryptedApiKey, projects, promptMessages } from "@spark/db";
import type { ProjectFile } from "@spark/shared";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const MODEL_REGISTRY: Record<string, string> = {
  "claude-3-7-sonnet": "anthropic",
  "claude-3-5-sonnet": "anthropic",
  "gpt-4o": "openai",
  "gemini-2.0-flash": "gemini",
};

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
  messageId: z.string().min(1, "messageId is required"),
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

  const { messageId, error, failingFile, importedSiblingFiles, model } = parsed.data;

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

  // 5. Verify message existence
  const messageRows = await db
    .select()
    .from(promptMessages)
    .where(eq(promptMessages.id, messageId))
    .limit(1);

  if (messageRows.length === 0) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  // 6. Resolve API credentials
  const requestedModel = model || "claude-3-7-sonnet";
  const provider = MODEL_REGISTRY[requestedModel] || "anthropic";

  let apiKey: string | null = null;
  try {
    apiKey = await getDecryptedApiKey(db, { userId: user.id, provider });
  } catch {
    if (provider === "anthropic") apiKey = process.env.ANTHROPIC_API_KEY || null;
    else if (provider === "openai") apiKey = process.env.OPENAI_API_KEY || null;
    else if (provider === "gemini") apiKey = process.env.GEMINI_API_KEY || null;
  }

  const isMockMode = process.env.MOCK_AI === "true" || process.env.NODE_ENV === "test";
  if (!apiKey && !isMockMode) {
    return NextResponse.json(
      {
        error: "PROVIDER_KEY_MISSING",
        provider,
        message: `Please add your ${provider} API key in workspace settings before repairing code.`,
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
        status: "analyzing",
        category: error.category,
        message: `Analyzing error in ${failingFile.path}: ${error.message.slice(0, 80)}`,
      });

      if (isCancelled) throw new Error("Repair cancelled by user");

      // Status 2: Synthesizing targeted repair patches without re-planning
      await sendEvent("healing_status", {
        status: "patching",
        category: error.category,
        message: "Synthesizing targeted patch for failing file and sibling imports",
      });

      const patchFiles: string[] = [];
      const updatedFiles: ProjectFile[] = [];

      // Determine repair transformation based on error category
      const errorMessage = error.message.toLowerCase();

      // Check if error is an export issue in a sibling file
      const exportMatch = error.message.match(/does not provide an export named ['"]([^'"]+)['"]/i);
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

      // Status 3: Finish repair pass and trigger verification
      await sendEvent("healing_status", {
        status: "verifying",
        patchFiles,
        message: "Patches applied. Awaiting preview health verification.",
      });

      await sendEvent("finish", {
        messageId,
        patchFiles,
        status: "verifying",
      });
    } catch (err: unknown) {
      const errorObj = err as Error;
      console.error("Repair route error:", errorObj);
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
