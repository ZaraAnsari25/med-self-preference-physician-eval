DROP INDEX "assignments_reviewer_position_uq";--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "study" text DEFAULT 'real_pocqi' NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "study" text DEFAULT 'real_pocqi' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "instructions_ack" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_reviewer_study_position_uq" ON "assignments" USING btree ("reviewer_id","study","queue_position");--> statement-breakpoint
UPDATE "users" SET "instructions_ack" = jsonb_build_object('real_pocqi', to_json("instructions_acknowledged_at")#>>'{}') WHERE "instructions_acknowledged_at" IS NOT NULL;
--> statement-breakpoint
INSERT INTO "settings" ("key", "value") SELECT 'study_seed:real_pocqi', "value" FROM "settings" WHERE "key" = 'study_seed' ON CONFLICT DO NOTHING;
