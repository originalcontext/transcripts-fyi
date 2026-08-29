CREATE TABLE "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"resource" text NOT NULL,
	"target" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
