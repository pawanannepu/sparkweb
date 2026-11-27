import { z } from "zod";

export const MAX_DESIGN_IMAGES = 4;
export const MAX_DESIGN_URLS = 1;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION_PX = 1568;
export const ALLOWED_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export const DEFAULT_MULTIMODAL_PROMPT =
  "Build an application matching the attached design reference and extracted outline.";

export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

export const UrlSnapshotSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  headings: z.array(z.string()).max(20),
  colors: z.array(z.string()).max(16),
  fonts: z.array(z.string()).max(8),
  landmarkCount: z.number().int().min(0),
});

export type UrlSnapshot = z.infer<typeof UrlSnapshotSchema>;

export const DesignAttachmentKindSchema = z.enum(["image", "url"]);
export type DesignAttachmentKind = z.infer<typeof DesignAttachmentKindSchema>;

export interface DesignAttachmentDto {
  id: string;
  projectId: string;
  threadId: string;
  messageId: string | null;
  kind: DesignAttachmentKind;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  previewUrl: string | null;
  sourceUrl: string | null;
  urlSnapshot: UrlSnapshot | null;
  createdAt: string;
}

export const HexColorSchema = z
  .string()
  .trim()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, {
    message: "Expected a valid hex color such as #2563EB",
  });

export const DesignOutlinePaletteItemSchema = z.object({
  id: z.string().min(1),
  role: z.string().min(1).max(80),
  hex: HexColorSchema,
  usage: z.string().max(240),
});

export const DesignOutlineTypographySchema = z.object({
  headingFont: z.string().min(1).max(120),
  bodyFont: z.string().min(1).max(120),
  monoFont: z.string().max(120).optional(),
  scaleNotes: z.string().max(500),
});

export const DesignOutlineLayoutSectionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  description: z.string().max(600),
  enabled: z.boolean(),
});

export const DesignOutlineComponentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  role: z.string().max(300),
  parentId: z.string().min(1).optional(),
  enabled: z.boolean(),
});

export const DesignOutlinePayloadSchema = z.object({
  appSummary: z.string().min(1).max(2000),
  palette: z.array(DesignOutlinePaletteItemSchema).min(1).max(16),
  typography: DesignOutlineTypographySchema,
  layoutSections: z.array(DesignOutlineLayoutSectionSchema).min(1).max(24),
  componentHierarchy: z.array(DesignOutlineComponentSchema).min(1).max(40),
  additionalNotes: z.string().max(2000),
});

export type DesignOutlinePaletteItem = z.infer<typeof DesignOutlinePaletteItemSchema>;
export type DesignOutlineTypography = z.infer<typeof DesignOutlineTypographySchema>;
export type DesignOutlineLayoutSection = z.infer<typeof DesignOutlineLayoutSectionSchema>;
export type DesignOutlineComponent = z.infer<typeof DesignOutlineComponentSchema>;
export type DesignOutlinePayload = z.infer<typeof DesignOutlinePayloadSchema>;

export const DesignOutlineStatusSchema = z.enum(["ready", "confirmed", "superseded"]);
export type DesignOutlineStatus = z.infer<typeof DesignOutlineStatusSchema>;

export interface DesignOutlineDto {
  id: string;
  projectId: string;
  threadId: string;
  sourceMessageId: string | null;
  clonedFromOutlineId: string | null;
  outlineMessageId: string | null;
  buildMessageId: string | null;
  status: DesignOutlineStatus;
  modelId: string;
  extractedOutline: DesignOutlinePayload;
  editedOutline: DesignOutlinePayload | null;
  createdAt: string;
  updatedAt: string;
}

export interface ThreadMessageDto {
  id: string;
  threadId: string;
  seq: number;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls: unknown;
  snapshotId: string | null;
  status: "pending" | "streaming" | "completed" | "failed";
  createdAt: string;
}

export interface ThreadStateResponse {
  threadId: string;
  messages: ThreadMessageDto[];
  attachmentsByMessageId: Record<string, DesignAttachmentDto[]>;
  pendingAttachments: DesignAttachmentDto[];
  outlines: DesignOutlineDto[];
}

export type OutlineExtractionErrorCode =
  | "URL_BLOCKED"
  | "URL_TIMEOUT"
  | "URL_INVALID_SSRF"
  | "URL_INVALID_MIME"
  | "URL_JS_SHELL"
  | "URL_TOO_LARGE"
  | "URL_FETCH_FAILED"
  | "VISION_MODEL_REQUIRED"
  | "OUTLINE_LEASE_ACTIVE"
  | "OUTLINE_INVALID_PAYLOAD";

/** Normalizes 3-digit hex values like `#abc` to `#aabbcc` for HTML color inputs. */
export function normalizeHexColor(hex: string): string {
  const trimmed = hex.trim();
  const shortMatch = trimmed.match(/^#([0-9a-fA-F]{3})$/);
  if (shortMatch?.[1]) {
    const [r, g, b] = shortMatch[1].split("");
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return trimmed.slice(0, 7).toUpperCase();
}

export function getEffectiveOutlinePayload(
  outline: Pick<DesignOutlineDto, "extractedOutline" | "editedOutline">
): DesignOutlinePayload {
  return outline.editedOutline ?? outline.extractedOutline;
}

/**
 * Formats a confirmed design outline into structured text context for Stage 2 code generation.
 * Filters out disabled layout sections and disabled components per AC-9.
 */
export function formatConfirmedOutlineForPrompt(payload: DesignOutlinePayload): string {
  const paletteLines = payload.palette.map(
    (swatch) => `- ${swatch.role}: ${swatch.hex} (${swatch.usage})`
  );

  const enabledSections = payload.layoutSections.filter((section) => section.enabled);
  const sectionLines = enabledSections.map(
    (section) => `- ${section.name}: ${section.description}`
  );

  const enabledComponents = payload.componentHierarchy.filter((comp) => comp.enabled);
  const enabledIds = new Set(enabledComponents.map((c) => c.id));
  const componentLines = enabledComponents.map((comp) => {
    const parent =
      comp.parentId && enabledIds.has(comp.parentId)
        ? enabledComponents.find((p) => p.id === comp.parentId)?.name
        : undefined;
    return `- ${comp.name}${parent ? ` (inside ${parent})` : ""}: ${comp.role}`;
  });

  const parts = [
    `Confirmed Design Outline:`,
    `Summary: ${payload.appSummary}`,
    `Color Palette:\n${paletteLines.join("\n")}`,
    `Typography:\n- Heading Font: ${payload.typography.headingFont}\n- Body Font: ${payload.typography.bodyFont}${payload.typography.monoFont ? `\n- Mono Font: ${payload.typography.monoFont}` : ""}\n- Scale Notes: ${payload.typography.scaleNotes}`,
    `Enabled Layout Sections (${enabledSections.length}):\n${sectionLines.length > 0 ? sectionLines.join("\n") : "- None selected"}`,
    `Enabled Component Hierarchy (${enabledComponents.length}):\n${componentLines.length > 0 ? componentLines.join("\n") : "- None selected"}`,
  ];

  if (payload.additionalNotes.trim()) {
    parts.push(`Additional Creator Notes:\n${payload.additionalNotes.trim()}`);
  }

  return parts.join("\n\n");
}
