CREATE TABLE "project_branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"head_snapshot_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_branches_project_id_name_unique" UNIQUE("project_id","name")
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "active_branch_id" uuid;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "file_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "trigger" text DEFAULT 'generation' NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "tag" text;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "restored_from_snapshot_id" uuid;--> statement-breakpoint
ALTER TABLE "project_branches" ADD CONSTRAINT "project_branches_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_branches" ADD CONSTRAINT "project_branches_head_snapshot_id_snapshots_id_fk" FOREIGN KEY ("head_snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_active_branch_id_project_branches_id_fk" FOREIGN KEY ("active_branch_id") REFERENCES "public"."project_branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_branch_id_project_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."project_branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_restored_from_snapshot_id_snapshots_id_fk" FOREIGN KEY ("restored_from_snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE set null ON UPDATE no action;