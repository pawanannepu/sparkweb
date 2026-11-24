import { relations } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { deployments } from "./deployments";
import { projectBranches } from "./project-branches";
import { promptThreads } from "./prompt-threads";
import { snapshots } from "./snapshots";

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    slug: text("slug").notNull(),
    isTemplate: boolean("is_template").default(false).notNull(),
    forkedFromProjectId: uuid("forked_from_project_id").references((): AnyPgColumn => projects.id, {
      onDelete: "set null",
    }),
    currentSnapshotId: uuid("current_snapshot_id").references((): AnyPgColumn => snapshots.id, {
      onDelete: "set null",
    }),
    activeBranchId: uuid("active_branch_id").references((): AnyPgColumn => projectBranches.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [unique("projects_user_id_slug_unique").on(table.userId, table.slug)]
);

export const projectsRelations = relations(projects, ({ one, many }) => ({
  user: one(users, {
    fields: [projects.userId],
    references: [users.id],
  }),
  forkedFrom: one(projects, {
    fields: [projects.forkedFromProjectId],
    references: [projects.id],
    relationName: "projectForks",
  }),
  currentSnapshot: one(snapshots, {
    fields: [projects.currentSnapshotId],
    references: [snapshots.id],
    relationName: "projectCurrentSnapshot",
  }),
  activeBranch: one(projectBranches, {
    fields: [projects.activeBranchId],
    references: [projectBranches.id],
    relationName: "projectActiveBranch",
  }),
  branches: many(projectBranches, { relationName: "projectBranches" }),
  promptThreads: many(promptThreads),
  snapshots: many(snapshots, { relationName: "projectSnapshots" }),
  deployments: many(deployments),
}));
