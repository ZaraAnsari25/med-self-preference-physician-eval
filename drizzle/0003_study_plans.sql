CREATE TABLE "study_plans" (
	"plan_id" text PRIMARY KEY NOT NULL,
	"study" text NOT NULL,
	"seed" text NOT NULL,
	"physician_count" integer NOT NULL,
	"calibration_count" integer NOT NULL,
	"graders_per_case" integer NOT NULL,
	"block_size" integer NOT NULL,
	"design" jsonb NOT NULL,
	"transfers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "study_plans_study_unique" UNIQUE("study")
);
--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "plan_id" text;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "plan_slot" integer;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "plan_block" integer;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "is_calibration" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "transferred_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "specialty" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "years_in_practice" integer;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_plan_id_study_plans_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."study_plans"("plan_id") ON DELETE no action ON UPDATE no action;