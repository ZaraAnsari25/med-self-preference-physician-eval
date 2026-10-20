CREATE TABLE "assignments" (
	"assignment_id" text PRIMARY KEY NOT NULL,
	"reviewer_id" text NOT NULL,
	"item_id" text NOT NULL,
	"queue_position" integer NOT NULL,
	"presentation_order" jsonb NOT NULL,
	"status" text DEFAULT 'not_started' NOT NULL,
	"ranking_confirmed_at" timestamp with time zone,
	"ranking_modified" boolean DEFAULT false NOT NULL,
	"instrument_config" jsonb,
	"active_ms" integer DEFAULT 0 NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_saved_at" timestamp with time zone,
	"submitted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "items" (
	"item_id" text PRIMARY KEY NOT NULL,
	"source_question_id" text NOT NULL,
	"source_dataset" text NOT NULL,
	"item_type" text NOT NULL,
	"specialty" text,
	"question_text" text NOT NULL,
	"context" jsonb,
	"turn_count" integer,
	"sample_index" integer NOT NULL,
	"provenance" jsonb NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_judgments" (
	"judgment_id" text NOT NULL,
	"item_id" text NOT NULL,
	"response_id" text NOT NULL,
	"judging_condition" text NOT NULL,
	"experiment_id" text NOT NULL,
	"judge_model" text NOT NULL,
	"judge_family" text NOT NULL,
	"generator_model" text NOT NULL,
	"judge_presentation_label" text NOT NULL,
	"original_rank" smallint,
	"accuracy" real,
	"clinical_utility" real,
	"source_quality" real,
	"verifiability" real,
	"completeness" real,
	CONSTRAINT "llm_judgments_judgment_id_response_id_pk" PRIMARY KEY("judgment_id","response_id")
);
--> statement-breakpoint
CREATE TABLE "response_evaluations" (
	"assignment_id" text NOT NULL,
	"response_id" text NOT NULL,
	"display_label" text NOT NULL,
	"final_rank" smallint,
	"accuracy" smallint,
	"clinical_utility" smallint,
	"source_quality" smallint,
	"verifiability" smallint,
	"completeness" smallint,
	"error_flag" text,
	"error_categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_note" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "response_evaluations_assignment_id_response_id_pk" PRIMARY KEY("assignment_id","response_id")
);
--> statement-breakpoint
CREATE TABLE "response_provenance" (
	"response_id" text PRIMARY KEY NOT NULL,
	"generator_model" text NOT NULL,
	"generator_family" text NOT NULL,
	"generation_id" text NOT NULL,
	"generation_key" text,
	"run_id" text,
	"experiment_id" text,
	"response_text_sha256" text NOT NULL,
	"metadata" jsonb NOT NULL,
	CONSTRAINT "response_provenance_generation_id_unique" UNIQUE("generation_id")
);
--> statement-breakpoint
CREATE TABLE "responses" (
	"response_id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"content_format" text NOT NULL,
	"response_text" text NOT NULL,
	"transcript" jsonb
);
--> statement-breakpoint
CREATE TABLE "save_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"assignment_id" text NOT NULL,
	"revision" integer NOT NULL,
	"state" jsonb NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"user_id" text PRIMARY KEY NOT NULL,
	"reviewer_code" text NOT NULL,
	"username" text NOT NULL,
	"display_name" text,
	"password_hash" text NOT NULL,
	"role" text NOT NULL,
	"reviewer_slot" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"instructions_acknowledged_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_reviewer_code_unique" UNIQUE("reviewer_code"),
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_reviewer_id_users_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_item_id_items_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_judgments" ADD CONSTRAINT "llm_judgments_item_id_items_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_judgments" ADD CONSTRAINT "llm_judgments_response_id_responses_response_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."responses"("response_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_evaluations" ADD CONSTRAINT "response_evaluations_assignment_id_assignments_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("assignment_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_evaluations" ADD CONSTRAINT "response_evaluations_response_id_responses_response_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."responses"("response_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_provenance" ADD CONSTRAINT "response_provenance_response_id_responses_response_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."responses"("response_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_item_id_items_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "save_events" ADD CONSTRAINT "save_events_assignment_id_assignments_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("assignment_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_reviewer_item_uq" ON "assignments" USING btree ("reviewer_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_reviewer_position_uq" ON "assignments" USING btree ("reviewer_id","queue_position");--> statement-breakpoint
CREATE INDEX "llm_judgments_item_idx" ON "llm_judgments" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "responses_item_idx" ON "responses" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "save_events_assignment_idx" ON "save_events" USING btree ("assignment_id");