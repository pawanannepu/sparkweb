CREATE TABLE "design_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"message_id" uuid,
	"kind" text NOT NULL,
	"storage_key" text,
	"source_url" text,
	"file_name" text,
	"mime_type" text,
	"size_bytes" integer,
	"width" integer,
	"height" integer,
	"url_snapshot" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "design_outlines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"source_message_id" uuid,
	"cloned_from_outline_id" uuid,
	"outline_message_id" uuid,
	"build_message_id" uuid,
	"status" text NOT NULL,
	"model_id" text NOT NULL,
	"extracted_outline" jsonb NOT NULL,
	"edited_outline" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prompt_threads" ADD COLUMN "outline_lock_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "design_attachments" ADD CONSTRAINT "design_attachments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_attachments" ADD CONSTRAINT "design_attachments_thread_id_prompt_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."prompt_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_attachments" ADD CONSTRAINT "design_attachments_message_id_prompt_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."prompt_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_outlines" ADD CONSTRAINT "design_outlines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_outlines" ADD CONSTRAINT "design_outlines_thread_id_prompt_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."prompt_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_outlines" ADD CONSTRAINT "design_outlines_source_message_id_prompt_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."prompt_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_outlines" ADD CONSTRAINT "design_outlines_cloned_from_outline_id_design_outlines_id_fk" FOREIGN KEY ("cloned_from_outline_id") REFERENCES "public"."design_outlines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_outlines" ADD CONSTRAINT "design_outlines_outline_message_id_prompt_messages_id_fk" FOREIGN KEY ("outline_message_id") REFERENCES "public"."prompt_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_outlines" ADD CONSTRAINT "design_outlines_build_message_id_prompt_messages_id_fk" FOREIGN KEY ("build_message_id") REFERENCES "public"."prompt_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "design_attachments_thread_id_created_at_idx" ON "design_attachments" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "design_attachments_message_id_idx" ON "design_attachments" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "design_outlines_thread_id_created_at_idx" ON "design_outlines" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "design_outlines_source_message_unique_idx" ON "design_outlines" USING btree ("source_message_id") WHERE "design_outlines"."source_message_id" IS NOT NULL AND "design_outlines"."cloned_from_outline_id" IS NULL;