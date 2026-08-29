import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Anthropic webhook deliveries we have already processed. `id` is the
 * webhook event id (per event, not per delivery — retries reuse it), so an
 * insert that conflicts is a duplicate and gets skipped.
 */
export const webhookEvents = pgTable("webhook_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  resource: text("resource").notNull(),
  target: text("target").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---- product ----------------------------------------------------------------
import { integer, jsonb, uniqueIndex } from "drizzle-orm/pg-core";

/** The universe. A subject is anything distilled longitudinally; today kind='ticker'. */
export const subjects = pgTable(
  "subjects",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    key: text("key").notNull(),
    displayName: text("display_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("subjects_kind_key").on(t.kind, t.key)],
);

/** One long-lived CMA session bound to a subject and a skill. */
export const runs = pgTable("runs", {
  id: text("id").primaryKey(),
  subjectId: text("subject_id").notNull().references(() => subjects.id),
  skill: text("skill").notNull(),
  target: text("target").notNull(),
  cmaSessionId: text("cma_session_id").notNull(),
  cmaAgentId: text("cma_agent_id").notNull(),
  cmaAgentVersion: integer("cma_agent_version").notNull(),
  cmaEnvironmentId: text("cma_environment_id").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Every result the agent posts. Append-only; latest = max(created_at). */
export const artifacts = pgTable("artifacts", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => runs.id),
  subjectId: text("subject_id").notNull().references(() => subjects.id),
  kind: text("kind").notNull(),
  content: text("content").notNull(),
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  cmaToolUseId: text("cma_tool_use_id").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
