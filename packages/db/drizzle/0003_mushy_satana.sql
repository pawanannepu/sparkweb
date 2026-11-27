CREATE TABLE "project_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"subdomain" text NOT NULL,
	"custom_domain" text,
	"record_type" text,
	"verification_token" text,
	"verification_status" text DEFAULT 'unconfigured' NOT NULL,
	"ssl_status" text DEFAULT 'unconfigured' NOT NULL,
	"provider_hostname_id" text,
	"failure_reason" text,
	"last_checked_at" timestamp,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_domains_project_id_unique" UNIQUE("project_id"),
	CONSTRAINT "project_domains_subdomain_unique" UNIQUE("subdomain"),
	CONSTRAINT "project_domains_custom_domain_unique" UNIQUE("custom_domain")
);
--> statement-breakpoint
ALTER TABLE "deployments" DROP CONSTRAINT "deployments_subdomain_unique";--> statement-breakpoint
ALTER TABLE "deployments" DROP CONSTRAINT "deployments_custom_domain_unique";--> statement-breakpoint
ALTER TABLE "deployments" DROP CONSTRAINT "deployments_snapshot_id_snapshots_id_fk";
--> statement-breakpoint
ALTER TABLE "deployments" ALTER COLUMN "snapshot_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "artifact_key" text;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "build_duration_ms" integer;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "error_message" text;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "trigger" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "promoted_from_deployment_id" uuid;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "retired_at" timestamp;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "active_deployment_id" uuid;--> statement-breakpoint
ALTER TABLE "project_domains" ADD CONSTRAINT "project_domains_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_promoted_from_deployment_id_deployments_id_fk" FOREIGN KEY ("promoted_from_deployment_id") REFERENCES "public"."deployments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_active_deployment_id_deployments_id_fk" FOREIGN KEY ("active_deployment_id") REFERENCES "public"."deployments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deployments_project_id_created_at_idx" ON "deployments" USING btree ("project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "deployments_one_active_per_project_idx" ON "deployments" USING btree ("project_id") WHERE "deployments"."status" = 'active';