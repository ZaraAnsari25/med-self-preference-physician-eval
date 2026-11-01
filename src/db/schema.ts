import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

// ---------------------------------------------------------------------------
// Study content (physician-visible text, no model identity)
// ---------------------------------------------------------------------------

/** One unit physicians evaluate: a Real-POCQi question or (later) a MedSP1000 scenario at k turns. */
export const items = pgTable("items", {
  itemId: text("item_id").primaryKey(),
  /** Which study the item belongs to; studies are graded separately. */
  study: text("study", { enum: ["real_pocqi", "medsp1000"] }).notNull().default("real_pocqi"),
  /** Original question / scenario ID from the research repository. */
  sourceQuestionId: text("source_question_id").notNull(),
  sourceDataset: text("source_dataset").notNull(),
  itemType: text("item_type", { enum: ["single_turn", "multi_turn"] }).notNull(),
  specialty: text("specialty"),
  questionText: text("question_text").notNull(),
  /** Any additional context the original judges also received (none for Real-POCQi). */
  context: jsonb("context"),
  /** Visible turn count for multi-turn items; null for single-turn. */
  turnCount: integer("turn_count"),
  /** Position in the frozen study sample (0-based); also the default queue order. */
  sampleIndex: integer("sample_index").notNull(),
  provenance: jsonb("provenance").notNull(),
  importedAt: ts("imported_at").notNull().defaultNow(),
});

/** Original model output, verbatim. Physician-visible text only. */
export const responses = pgTable(
  "responses",
  {
    responseId: text("response_id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => items.itemId),
    contentFormat: text("content_format", { enum: ["markdown", "transcript"] }).notNull(),
    responseText: text("response_text").notNull(),
    /** Structured turns for multi-turn conversations (role + content only). */
    transcript: jsonb("transcript"),
  },
  (t) => [index("responses_item_idx").on(t.itemId)],
);

// ---------------------------------------------------------------------------
// Protected analysis-only tables. Never read by physician-facing code paths.
// ---------------------------------------------------------------------------

export const responseProvenance = pgTable("response_provenance", {
  responseId: text("response_id")
    .primaryKey()
    .references(() => responses.responseId),
  generatorModel: text("generator_model").notNull(),
  generatorFamily: text("generator_family").notNull(),
  generationId: text("generation_id").notNull().unique(),
  generationKey: text("generation_key"),
  runId: text("run_id"),
  experimentId: text("experiment_id"),
  responseTextSha256: text("response_text_sha256").notNull(),
  metadata: jsonb("metadata").notNull(),
});

export const llmJudgments = pgTable(
  "llm_judgments",
  {
    judgmentId: text("judgment_id").notNull(),
    itemId: text("item_id")
      .notNull()
      .references(() => items.itemId),
    responseId: text("response_id")
      .notNull()
      .references(() => responses.responseId),
    judgingCondition: text("judging_condition").notNull(),
    experimentId: text("experiment_id").notNull(),
    judgeModel: text("judge_model").notNull(),
    judgeFamily: text("judge_family").notNull(),
    generatorModel: text("generator_model").notNull(),
    /** Label the judge saw for this response (e.g. "response-3"). */
    judgePresentationLabel: text("judge_presentation_label").notNull(),
    originalRank: smallint("original_rank"),
    accuracy: real("accuracy"),
    clinicalUtility: real("clinical_utility"),
    sourceQuality: real("source_quality"),
    verifiability: real("verifiability"),
    completeness: real("completeness"),
  },
  (t) => [
    primaryKey({ columns: [t.judgmentId, t.responseId] }),
    index("llm_judgments_item_idx").on(t.itemId),
  ],
);

// ---------------------------------------------------------------------------
// Reviewers, sessions, settings
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  userId: text("user_id").primaryKey(),
  /** Pseudonymous ID used in all research exports (e.g. "R001"). */
  reviewerCode: text("reviewer_code").notNull().unique(),
  username: text("username").notNull().unique(),
  displayName: text("display_name"),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["reviewer", "admin"] }).notNull(),
  /** Determines the reviewer's Williams-square row offset for presentation order. */
  reviewerSlot: integer("reviewer_slot").notNull(),
  active: boolean("active").notNull().default(true),
  /** Physician background, recorded by the study team for analysis covariates. */
  specialty: text("specialty"),
  yearsInPractice: integer("years_in_practice"),
  /** Per-study instruction acknowledgement: { [study]: ISO timestamp }. */
  instructionsAck: jsonb("instructions_ack").$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.userId, { onDelete: "cascade" }),
  createdAt: ts("created_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Assignments and physician evaluations
// ---------------------------------------------------------------------------

export const assignments = pgTable(
  "assignments",
  {
    assignmentId: text("assignment_id").primaryKey(),
    reviewerId: text("reviewer_id")
      .notNull()
      .references(() => users.userId),
    itemId: text("item_id")
      .notNull()
      .references(() => items.itemId),
    study: text("study", { enum: ["real_pocqi", "medsp1000"] }).notNull().default("real_pocqi"),
    /** 0-based position in the reviewer's queue for this study. */
    queuePosition: integer("queue_position").notNull(),
    /** Response IDs in display order; index 0 is shown as "Response A". */
    presentationOrder: jsonb("presentation_order").$type<string[]>().notNull(),
    status: text("status", { enum: ["not_started", "in_progress", "complete"] })
      .notNull()
      .default("not_started"),
    rankingConfirmedAt: ts("ranking_confirmed_at"),
    rankingModified: boolean("ranking_modified").notNull().default(false),
    /** Instrument configuration in force when last saved (for burden comparisons). */
    instrumentConfig: jsonb("instrument_config"),
    activeMs: integer("active_ms").notNull().default(0),
    revision: integer("revision").notNull().default(0),
    /** Set when the assignment was created by a study plan. */
    planId: text("plan_id").references(() => studyPlans.planId),
    /** 1-based plan position (P1..PN) the assignment belongs to. */
    planSlot: integer("plan_slot"),
    /** 1-based block number; null for calibration cases and manual assignments. */
    planBlock: integer("plan_block"),
    isCalibration: boolean("is_calibration").notNull().default(false),
    /** Set when this (unfinished) assignment was handed to a replacement physician. */
    transferredAt: ts("transferred_at"),
    assignedAt: ts("assigned_at").notNull().defaultNow(),
    startedAt: ts("started_at"),
    completedAt: ts("completed_at"),
    lastSavedAt: ts("last_saved_at"),
    submittedAt: ts("submitted_at"),
  },
  (t) => [
    uniqueIndex("assignments_reviewer_item_uq").on(t.reviewerId, t.itemId),
    uniqueIndex("assignments_reviewer_study_position_uq").on(t.reviewerId, t.study, t.queuePosition),
  ],
);

/** One applied assignment plan per study (see src/lib/plan.ts). */
export const studyPlans = pgTable("study_plans", {
  planId: text("plan_id").primaryKey(),
  study: text("study", { enum: ["real_pocqi", "medsp1000"] }).notNull().unique(),
  seed: text("seed").notNull(),
  physicianCount: integer("physician_count").notNull(),
  calibrationCount: integer("calibration_count").notNull(),
  gradersPerCase: integer("graders_per_case").notNull(),
  blockSize: integer("block_size").notNull(),
  /** The full generated plan: calibration items, blocks, slots and queues. */
  design: jsonb("design").notNull(),
  /** Slot hand-overs: [{ slot, fromReviewerId, toReviewerId, at, moved }]. */
  transfers: jsonb("transfers").$type<SlotTransfer[]>().notNull().default(sql`'[]'::jsonb`),
  appliedAt: ts("applied_at").notNull().defaultNow(),
});

export interface SlotTransfer {
  slot: number;
  fromReviewerId: string;
  toReviewerId: string;
  at: string;
  moved: number;
}

/** One row per (assignment, response): rank, rubric scores and error annotation. */
export const responseEvaluations = pgTable(
  "response_evaluations",
  {
    assignmentId: text("assignment_id")
      .notNull()
      .references(() => assignments.assignmentId),
    responseId: text("response_id")
      .notNull()
      .references(() => responses.responseId),
    displayLabel: text("display_label").notNull(),
    finalRank: smallint("final_rank"),
    accuracy: smallint("accuracy"),
    clinicalUtility: smallint("clinical_utility"),
    sourceQuality: smallint("source_quality"),
    verifiability: smallint("verifiability"),
    completeness: smallint("completeness"),
    errorFlag: text("error_flag", { enum: ["yes", "no", "uncertain"] }),
    errorCategories: jsonb("error_categories").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    errorNote: text("error_note").notNull().default(""),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.assignmentId, t.responseId] })],
);

/** Append-only log of every accepted save, so no evaluation state is ever lost. */
export const saveEvents = pgTable(
  "save_events",
  {
    eventId: text("event_id").primaryKey(),
    assignmentId: text("assignment_id")
      .notNull()
      .references(() => assignments.assignmentId),
    revision: integer("revision").notNull(),
    state: jsonb("state").notNull(),
    savedAt: ts("saved_at").notNull().defaultNow(),
  },
  (t) => [index("save_events_assignment_idx").on(t.assignmentId)],
);
