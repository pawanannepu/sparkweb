import { relations } from "drizzle-orm";
import {
  type AnyPgColumn,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { deployments } from "./deployments";
import { projectBranches } from "./project-branches";
import { projects } from "./projects";
import { promptMessages } from "./prompt-threads";

export interface SnapshotFileEntry {
  content: string;
  isBinary?: boolean;
}

export type SnapshotFilesMap = Record<string, SnapshotFileEntry>;

export const snapshotTriggerEnum = [
  "generation",
  "canvas",
  "repair",
  "manual",
  "rollback",
] as const;
export type SnapshotTrigger = (typeof snapshotTriggerEnum)[number];

export const snapshots = pgTable("snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  parentId: uuid("parent_id").references((): AnyPgColumn => snapshots.id, {
    onDelete: "set null",
  }),
  branchId: uuid("branch_id").references((): AnyPgColumn => projectBranches.id, {
    onDelete: "set null",
  }),
  branchName: text("branch_name").default("main").notNull(),
  treeHash: text("tree_hash").notNull(),
  files: jsonb("files").$type<SnapshotFilesMap>().notNull(),
  fileCount: integer("file_count").default(0).notNull(),
  message: text("message"),
  trigger: text("trigger").default("generation").notNull(),
  tag: text("tag"),
  restoredFromSnapshotId: uuid("restored_from_snapshot_id").references(
    (): AnyPgColumn => snapshots.id,
    {
      onDelete: "set null",
    }
  ),
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
  branch: one(projectBranches, {
    fields: [snapshots.branchId],
    references: [projectBranches.id],
    relationName: "branchSnapshots",
  }),
  restoredFrom: one(snapshots, {
    fields: [snapshots.restoredFromSnapshotId],
    references: [snapshots.id],
    relationName: "snapshotRestoredFrom",
  }),
  deployments: many(deployments),
  promptMessages: many(promptMessages),
}));
