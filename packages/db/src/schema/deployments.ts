import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { snapshots } from "./snapshots";

export type DeploymentStatus = "queued" | "building" | "active" | "failed" | "retired";
export type DeploymentTrigger = "manual" | "rollback";

export const deployments = pgTable(
  "deployments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    snapshotId: uuid("snapshot_id").references(() => snapshots.id, { onDelete: "set null" }),
    subdomain: text("subdomain").notNull(),
    customDomain: text("custom_domain"),
    status: text("status").$type<DeploymentStatus>().default("queued").notNull(),
    deploymentUrl: text("deployment_url").notNull(),
    artifactKey: text("artifact_key"),
    buildLogs: text("build_logs"),
    buildDurationMs: integer("build_duration_ms"),
    errorMessage: text("error_message"),
    trigger: text("trigger").$type<DeploymentTrigger>().default("manual").notNull(),
    promotedFromDeploymentId: uuid("promoted_from_deployment_id").references(
      (): AnyPgColumn => deployments.id,
      { onDelete: "set null" }
    ),
    retiredAt: timestamp("retired_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("deployments_project_id_created_at_idx").on(table.projectId, table.createdAt.desc()),
    uniqueIndex("deployments_one_active_per_project_idx")
      .on(table.projectId)
      .where(sql`${table.status} = 'active'`),
  ]
);

export const deploymentsRelations = relations(deployments, ({ one }) => ({
  project: one(projects, {
    fields: [deployments.projectId],
    references: [projects.id],
    relationName: "projectDeployments",
  }),
  snapshot: one(snapshots, {
    fields: [deployments.snapshotId],
    references: [snapshots.id],
  }),
  promotedFrom: one(deployments, {
    fields: [deployments.promotedFromDeploymentId],
    references: [deployments.id],
    relationName: "deploymentPromotions",
  }),
}));
