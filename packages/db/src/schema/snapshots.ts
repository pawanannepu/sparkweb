import { relations } from "drizzle-orm";
import { type AnyPgColumn, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { deployments } from "./deployments";
import { projects } from "./projects";
import { promptMessages } from "./prompt-threads";

export interface SnapshotFileEntry {
  content: string;
  isBinary?: boolean;
}

export type SnapshotFilesMap = Record<string, SnapshotFileEntry>;

export const snapshots = pgTable("snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  parentId: uuid("parent_id").references((): AnyPgColumn => snapshots.id, {
    onDelete: "set null",
  }),
  branchName: text("branch_name").default("main").notNull(),
  treeHash: text("tree_hash").notNull(),
  files: jsonb("files").$type<SnapshotFilesMap>().notNull(),
  message: text("message"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const snapshotsRelations = relations(snapshots, ({ one, many }) => ({
  project: one(projects, {
    fields: [snapshots.projectId],
    references: [projects.id],
    relationName: "projectSnapshots",
  }),
  parent: one(snapshots, {
    fields: [snapshots.parentId],
    references: [snapshots.id],
    relationName: "snapshotLineage",
  }),
  deployments: many(deployments),
  promptMessages: many(promptMessages),
}));
