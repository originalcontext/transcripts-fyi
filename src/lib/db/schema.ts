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
