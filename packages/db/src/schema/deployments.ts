import { relations } from "drizzle-orm";
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { snapshots } from "./snapshots";

export type DeploymentStatus = "queued" | "building" | "active" | "failed" | "retired";

export const deployments = pgTable("deployments", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  snapshotId: uuid("snapshot_id")
    .notNull()
    .references(() => snapshots.id, { onDelete: "cascade" }),
  subdomain: text("subdomain").notNull().unique(),
  customDomain: text("custom_domain").unique(),
  status: text("status").$type<DeploymentStatus>().default("queued").notNull(),
  deploymentUrl: text("deployment_url").notNull(),
  buildLogs: text("build_logs"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const deploymentsRelations = relations(deployments, ({ one }) => ({
  project: one(projects, {
    fields: [deployments.projectId],
    references: [projects.id],
  }),
  snapshot: one(snapshots, {
    fields: [deployments.snapshotId],
    references: [snapshots.id],
  }),
}));
