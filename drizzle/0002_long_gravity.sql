ALTER TABLE "runs" ALTER COLUMN "status" SET DEFAULT 'working';--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "list_cost_cents" integer DEFAULT 0 NOT NULL;