CREATE TABLE "deposit_addresses" (
	"id" text PRIMARY KEY NOT NULL,
	"intent_id" text NOT NULL,
	"chain_id" integer NOT NULL,
	"address" text NOT NULL,
	"factory_address" text NOT NULL,
	"implementation_address" text NOT NULL,
	"salt" text NOT NULL,
	"creation_block" bigint NOT NULL,
	"scanned_through_block" bigint NOT NULL,
	"last_scanned_at" timestamp with time zone,
	"status" text DEFAULT 'awaiting_deposit' NOT NULL,
	"detected_amount" numeric(78,0) DEFAULT 0 NOT NULL,
	"confirmed_amount" numeric(78,0) DEFAULT 0 NOT NULL,
	"funded_at" timestamp with time zone,
	"sweep_tx_hash" text,
	"sweep_attempts" integer DEFAULT 0 NOT NULL,
	"swept_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deposit_transfers" (
	"id" text PRIMARY KEY NOT NULL,
	"deposit_address_id" text NOT NULL,
	"intent_id" text NOT NULL,
	"chain_id" integer NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_hash" text NOT NULL,
	"from_address" text NOT NULL,
	"amount" numeric(78,0) NOT NULL,
	"status" text DEFAULT 'detected' NOT NULL,
	"confirmations" integer DEFAULT 0 NOT NULL,
	"flagged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deposit_addresses" ADD CONSTRAINT "deposit_addresses_intent_id_payment_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_transfers" ADD CONSTRAINT "deposit_transfers_deposit_address_id_deposit_addresses_id_fk" FOREIGN KEY ("deposit_address_id") REFERENCES "public"."deposit_addresses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_transfers" ADD CONSTRAINT "deposit_transfers_intent_id_payment_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deposit_addresses_intent_uq" ON "deposit_addresses" USING btree ("intent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deposit_addresses_address_uq" ON "deposit_addresses" USING btree ("chain_id","address");--> statement-breakpoint
CREATE INDEX "deposit_addresses_open_idx" ON "deposit_addresses" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "deposit_transfers_log_uq" ON "deposit_transfers" USING btree ("chain_id","tx_hash","log_index");--> statement-breakpoint
CREATE INDEX "deposit_transfers_intent_idx" ON "deposit_transfers" USING btree ("intent_id","status");