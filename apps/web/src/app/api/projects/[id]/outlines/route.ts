import {
  acquireOutlineExtractionLease,
  createExtractedOutlineTurn,
  db,
  getPendingAttachmentsByIds,
  releaseOutlineExtractionLease,
  resolveOrCreateProjectThread,
} from "@spark/db";
import {
  type AiModelOption,
  type AiProvider,
  DEFAULT_MULTIMODAL_PROMPT,
  DIRECT_MODELS,
  isAiProvider,
  isDirectModelVisionCapable,
  MAX_DESIGN_IMAGES,
  OPENROUTER_DEFAULT_MODELS,
  resolveModelProvider,
} from "@spark/shared";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveProviderApiKey } from "@/lib/ai-provider";
import { getCurrentUser } from "@/lib/auth";
import {
  type ExtractionImageInput,
  extractDesignOutline,
} from "@/lib/multimodal/outline-extractor";
import {
  handleMultimodalRouteError,
  serializeDesignAttachment,
  serializeDesignOutline,
  serializePromptMessage,
} from "@/lib/multimodal/serializers";
import { extractDesignFromUrl, UrlExtractionError } from "@/lib/multimodal/url-extractor";
import { getOpenRouterModelsCacheMap, getProviderModelsCacheMap } from "@/lib/openrouter-cache";
import { getArtifactStore } from "@/lib/publishing/deploy-service";
import { isValidUuid } from "@/lib/utils";

export const dynamic = "force-dynamic";

const CreateOutlineRequestSchema = z.object({
  prompt: z.string().max(10_000).optional(),
  threadId: z.string().optional(),
  model: z.string().min(1).max(200).optional(),
  provider: z.string().optional(),
  visionOverride: z.boolean().optional(),
  attachmentIds: z.array(z.string()).max(MAX_DESIGN_IMAGES).optional(),
  sourceUrl: z.string().max(2048).optional(),
});

function resolveCachedModelVisionCapability(provider: AiProvider, modelId: string): boolean {
  const openRouterDefaults = OPENROUTER_DEFAULT_MODELS.find((m) => m.id === modelId);
  if (openRouterDefaults) return openRouterDefaults.supportsVision;

  const directDefault = DIRECT_MODELS.find((m) => m.id === modelId);
  if (directDefault) return directDefault.supportsVision;

  for (const entry of getOpenRouterModelsCacheMap().values()) {
    const found = entry.models.find((m: AiModelOption) => m.id === modelId);
    if (found) return found.supportsVision;
  }

  for (const entry of getProviderModelsCacheMap().values()) {
    const found = entry.models.find((m: AiModelOption) => m.id === modelId);
    if (found) return found.supportsVision;
  }

  return isDirectModelVisionCapable(provider, modelId);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;

  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isValidUuid(projectId)) {
    return NextResponse.json({ error: "Invalid project ID" }, { status: 400 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsedBody = CreateOutlineRequestSchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: parsedBody.error.issues[0]?.message ?? "Invalid outline extraction request",
      },
      { status: 400 }
    );
  }

  const body = parsedBody.data;
  const trimmedPrompt = body.prompt?.trim() ?? "";
  const trimmedUrl = body.sourceUrl?.trim() ?? "";
  const attachmentIds = body.attachmentIds ?? [];

  if (body.threadId && !isValidUuid(body.threadId)) {
    return NextResponse.json({ error: "Invalid thread ID" }, { status: 400 });
  }

  for (const attachmentId of attachmentIds) {
    if (!isValidUuid(attachmentId)) {
      return NextResponse.json(
        { error: `Invalid attachment ID: ${attachmentId}` },
        { status: 400 }
      );
    }
  }

  if (!trimmedPrompt && attachmentIds.length === 0 && !trimmedUrl) {
    return NextResponse.json(
      { error: "Provide a prompt, at least one image, or a website URL." },
      { status: 400 }
    );
  }

  const requestedModel = body.model?.trim() || "claude-3-7-sonnet";
  const explicitProvider = body.provider && isAiProvider(body.provider) ? body.provider : undefined;
  const provider = resolveModelProvider(requestedModel, explicitProvider);

  if (attachmentIds.length > 0 && !body.visionOverride) {
    const supportsVision = resolveCachedModelVisionCapability(provider, requestedModel);
    if (!supportsVision) {
      return NextResponse.json(
        {
          error:
            "The selected model does not support image inputs. Switch to a vision-capable model or enable the vision override.",
          code: "VISION_MODEL_REQUIRED",
        },
        { status: 400 }
      );
    }
  }

  const isMockMode = process.env.MOCK_AI === "true" || process.env.NODE_ENV === "test";
  const apiKey = await resolveProviderApiKey({ userId: user.id, provider });

  if (!apiKey && !isMockMode) {
    return NextResponse.json(
      {
        error: "PROVIDER_KEY_MISSING",
        provider,
        message: `Please add your ${provider} API key in API Keys settings before extracting a design outline.`,
      },
      { status: 400 }
    );
  }

  let acquiredThreadId: string | null = null;
  try {
    const thread = await resolveOrCreateProjectThread(db, {
      projectId,
      userId: user.id,
      threadId: body.threadId,
    });

    await acquireOutlineExtractionLease(db, {
      projectId,
      threadId: thread.id,
      userId: user.id,
    });
    acquiredThreadId = thread.id;

    // Validate pending image attachments before fetching external URLs or running model inference
    const pendingAttachments = await getPendingAttachmentsByIds(db, {
      projectId,
      threadId: thread.id,
      attachmentIds,
    });

    const urlResult = trimmedUrl ? await extractDesignFromUrl(trimmedUrl) : null;

    const artifactStore = getArtifactStore();
    const images: ExtractionImageInput[] = [];
    for (const att of pendingAttachments) {
      if (!att.storageKey) continue;
      const obj = await artifactStore.getObject(att.storageKey);
      if (!obj) {
        return NextResponse.json(
          { error: `Uploaded image ${att.fileName ?? att.id} could not be found in storage.` },
          { status: 404 }
        );
      }
      images.push({
        fileName: att.fileName ?? "design-reference",
        mimeType: att.mimeType ?? obj.contentType ?? "image/png",
        buffer: Buffer.from(obj.body),
      });
    }

    const effectivePrompt = trimmedPrompt || DEFAULT_MULTIMODAL_PROMPT;

    const extractedOutline = await extractDesignOutline({
      provider,
      modelId: requestedModel,
      apiKey,
      isMockMode,
      promptText: effectivePrompt,
      images,
      urlSnapshot: urlResult?.snapshot ?? null,
      sanitizedUrlContextXml: urlResult?.sanitizedContextXml ?? null,
      abortSignal: req.signal,
    });

    const turn = await createExtractedOutlineTurn(db, {
      projectId,
      threadId: thread.id,
      userId: user.id,
      promptText: effectivePrompt,
      modelId: requestedModel,
      attachmentIds: pendingAttachments.map((a) => a.id),
      sourceUrl: urlResult?.finalUrl ?? null,
      urlSnapshot: urlResult?.snapshot ?? null,
      extractedOutline,
    });

    return NextResponse.json(
      {
        outline: serializeDesignOutline(turn.outline),
        userMessage: serializePromptMessage(turn.userMessage),
        outlineMessage: serializePromptMessage(turn.outlineMessage),
        attachments: turn.attachments.map(serializeDesignAttachment),
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof UrlExtractionError) {
      return NextResponse.json(
        {
          error: err.message,
          code: err.code,
          suggestion: err.suggestion,
        },
        { status: err.statusCode }
      );
    }
    return handleMultimodalRouteError(err, "Failed to extract design outline");
  } finally {
    if (acquiredThreadId) {
      await releaseOutlineExtractionLease(db, { threadId: acquiredThreadId }).catch(() => {});
    }
  }
}
