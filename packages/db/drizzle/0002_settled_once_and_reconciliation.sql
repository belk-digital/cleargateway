CREATE TABLE "reconciliation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"trigger" text NOT NULL,
	"status" text NOT NULL,
	"mismatch_count" integer DEFAULT 0 NOT NULL,
	"report" jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_tx_settled_once" ON "ledger_transactions" USING btree ("intent_id") WHERE "ledger_transactions"."kind" = 'payment_settled';