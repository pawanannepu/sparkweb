import { relations } from "drizzle-orm";
import {
  type AnyPgColumn,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { snapshots } from "./snapshots";

export const promptThreads = pgTable("prompt_threads", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").default("Main thread").notNull(),
  outlineLockExpiresAt: timestamp("outline_lock_expires_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const promptMessages = pgTable(
  "prompt_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => promptThreads.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    role: text("role").$type<"user" | "assistant" | "system">().notNull(),
    content: text("content").notNull(),
    toolCalls: jsonb("tool_calls"),
    snapshotId: uuid("snapshot_id").references((): AnyPgColumn => snapshots.id, {
      onDelete: "set null",
    }),
    status: text("status")
      .$type<"pending" | "streaming" | "completed" | "failed">()
      .default("completed")
      .notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [unique("prompt_messages_thread_id_seq_unique").on(table.threadId, table.seq)]
);

export const promptThreadsRelations = relations(promptThreads, ({ one, many }) => ({
  project: one(projects, {
    fields: [promptThreads.projectId],
    references: [projects.id],
  }),
  messages: many(promptMessages),
}));

export const promptMessagesRelations = relations(promptMessages, ({ one }) => ({
  thread: one(promptThreads, {
    fields: [promptMessages.threadId],
    references: [promptThreads.id],
  }),
  snapshot: one(snapshots, {
    fields: [promptMessages.snapshotId],
    references: [snapshots.id],
  }),
}));
