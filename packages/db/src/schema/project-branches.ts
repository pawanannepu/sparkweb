import { relations } from "drizzle-orm";
import { type AnyPgColumn, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { snapshots } from "./snapshots";

export const projectBranches = pgTable(
  "project_branches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    headSnapshotId: uuid("head_snapshot_id").references((): AnyPgColumn => snapshots.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [unique("project_branches_project_id_name_unique").on(table.projectId, table.name)]
);

export const projectBranchesRelations = relations(projectBranches, ({ one, many }) => ({
  project: one(projects, {
    fields: [projectBranches.projectId],
    references: [projects.id],
    relationName: "projectBranches",
  }),
  headSnapshot: one(snapshots, {
    fields: [projectBranches.headSnapshotId],
    references: [snapshots.id],
    relationName: "branchHeadSnapshot",
  }),
  snapshots: many(snapshots, { relationName: "branchSnapshots" }),
}));
