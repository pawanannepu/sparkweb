import { relations } from "drizzle-orm";
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { projects } from "./projects";

export type DomainRecordType = "cname" | "apex";
export type DomainVerificationStatus = "unconfigured" | "pending" | "verified" | "failed";
export type DomainSslStatus = "unconfigured" | "pending" | "active" | "failed";

export const projectDomains = pgTable("project_domains", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .unique()
    .references(() => projects.id, { onDelete: "cascade" }),
  subdomain: text("subdomain").notNull().unique(),
  customDomain: text("custom_domain").unique(),
  recordType: text("record_type").$type<DomainRecordType>(),
  verificationToken: text("verification_token"),
  verificationStatus: text("verification_status")
    .$type<DomainVerificationStatus>()
    .default("unconfigured")
    .notNull(),
  sslStatus: text("ssl_status").$type<DomainSslStatus>().default("unconfigured").notNull(),
  providerHostnameId: text("provider_hostname_id"),
  failureReason: text("failure_reason"),
  lastCheckedAt: timestamp("last_checked_at", { mode: "date" }),
  verifiedAt: timestamp("verified_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const projectDomainsRelations = relations(projectDomains, ({ one }) => ({
  project: one(projects, {
    fields: [projectDomains.projectId],
    references: [projects.id],
    relationName: "projectDomain",
  }),
}));
