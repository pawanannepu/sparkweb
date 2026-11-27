import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { promptMessages, promptThreads } from "./prompt-threads";

export type DesignAttachmentKind = "image" | "url";
export type DesignOutlineStatus = "ready" | "confirmed" | "superseded";

export interface UrlSnapshotRecord {
  title: string;
  description?: string;
  headings: string[];
  colors: string[];
  fonts: string[];
  landmarkCount: number;
}

export interface DesignOutlinePayloadRecord {
  appSummary: string;
  palette: Array<{ id: string; role: string; hex: string; usage: string }>;
  typography: {
    headingFont: string;
    bodyFont: string;
    monoFont?: string;
    scaleNotes: string;
  };
  layoutSections: Array<{ id: string; name: string; description: string; enabled: boolean }>;
  componentHierarchy: Array<{
    id: string;
    name: string;
    role: string;
    parentId?: string;
    enabled: boolean;
  }>;
  additionalNotes: string;
}

export const designAttachments = pgTable(
  "design_attachments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => promptThreads.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").references(() => promptMessages.id, { onDelete: "cascade" }),
    kind: text("kind").$type<DesignAttachmentKind>().notNull(),
    storageKey: text("storage_key"),
    sourceUrl: text("source_url"),
    fileName: text("file_name"),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),
    width: integer("width"),
    height: integer("height"),
    urlSnapshot: jsonb("url_snapshot").$type<UrlSnapshotRecord | null>(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("design_attachments_thread_id_created_at_idx").on(table.threadId, table.createdAt),
    index("design_attachments_message_id_idx").on(table.messageId),
  ]
);

export const designOutlines = pgTable(
  "design_outlines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => promptThreads.id, { onDelete: "cascade" }),
    sourceMessageId: uuid("source_message_id").references(() => promptMessages.id, {
      onDelete: "cascade",
    }),
    clonedFromOutlineId: uuid("cloned_from_outline_id").references(
      (): AnyPgColumn => designOutlines.id,
      { onDelete: "set null" }
    ),
    outlineMessageId: uuid("outline_message_id").references(() => promptMessages.id, {
      onDelete: "set null",
    }),
    buildMessageId: uuid("build_message_id").references(() => promptMessages.id, {
      onDelete: "set null",
    }),
    status: text("status").$type<DesignOutlineStatus>().notNull(),
    modelId: text("model_id").notNull(),
    extractedOutline: jsonb("extracted_outline").$type<DesignOutlinePayloadRecord>().notNull(),
    editedOutline: jsonb("edited_outline").$type<DesignOutlinePayloadRecord | null>(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("design_outlines_thread_id_created_at_idx").on(table.threadId, table.createdAt),
    uniqueIndex("design_outlines_source_message_unique_idx")
      .on(table.sourceMessageId)
      .where(sql`${table.sourceMessageId} IS NOT NULL AND ${table.clonedFromOutlineId} IS NULL`),
  ]
);

export const designAttachmentsRelations = relations(designAttachments, ({ one }) => ({
  project: one(projects, {
    fields: [designAttachments.projectId],
    references: [projects.id],
  }),
  thread: one(promptThreads, {
    fields: [designAttachments.threadId],
    references: [promptThreads.id],
  }),
  message: one(promptMessages, {
    fields: [designAttachments.messageId],
    references: [promptMessages.id],
  }),
}));

export const designOutlinesRelations = relations(designOutlines, ({ one }) => ({
  project: one(projects, {
    fields: [designOutlines.projectId],
    references: [projects.id],
  }),
  thread: one(promptThreads, {
    fields: [designOutlines.threadId],
    references: [promptThreads.id],
  }),
  sourceMessage: one(promptMessages, {
    fields: [designOutlines.sourceMessageId],
    references: [promptMessages.id],
    relationName: "outlineSourceMessage",
  }),
  outlineMessage: one(promptMessages, {
    fields: [designOutlines.outlineMessageId],
    references: [promptMessages.id],
    relationName: "outlineAssistantMessage",
  }),
  buildMessage: one(promptMessages, {
    fields: [designOutlines.buildMessageId],
    references: [promptMessages.id],
    relationName: "outlineBuildMessage",
  }),
  clonedFrom: one(designOutlines, {
    fields: [designOutlines.clonedFromOutlineId],
    references: [designOutlines.id],
    relationName: "outlineClones",
  }),
}));
