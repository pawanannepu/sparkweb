CREATE TABLE "project_queries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"sql" text NOT NULL,
	"description" text,
	"is_favorite" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_queries" ADD CONSTRAINT "project_queries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_queries_project_id_created_at_idx" ON "project_queries" USING btree ("project_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "project_queries_project_id_is_favorite_idx" ON "project_queries" USING btree ("project_id","is_favorite");