CREATE TABLE "actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position_id" uuid,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"amount_wei" numeric(78,0),
	"requested_by" text DEFAULT 'ui' NOT NULL,
	"tx_id" uuid,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "actions_type_check" CHECK ("actions"."type" IN ('delegate', 'undelegate', 'claim', 'compound', 'sync_validators')),
	CONSTRAINT "actions_status_check" CHECK ("actions"."status" IN ('pending', 'running', 'done', 'failed', 'skipped')),
	CONSTRAINT "actions_requested_by_check" CHECK ("actions"."requested_by" IN ('ui', 'engine'))
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"gas_reserve_wei" numeric(78,0) NOT NULL,
	"max_gas_price_wei" numeric(78,0) NOT NULL,
	"min_interval_sec" integer NOT NULL,
	"r_floor_wei" numeric(78,0) NOT NULL,
	"check_min_sec" integer NOT NULL,
	"check_max_sec" integer NOT NULL,
	"validator_sync_sec" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_settings_single_row_check" CHECK ("app_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ip" text NOT NULL,
	"success" boolean NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "position_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"position_id" uuid NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	"principal_wei" numeric(78,0) NOT NULL,
	"pending_wei" numeric(78,0) NOT NULL,
	"apr_est" double precision,
	"r_star_wei" numeric(78,0),
	"gas_price_wei" numeric(78,0) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"validator_id" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"strategy" text DEFAULT 'optimal' NOT NULL,
	"threshold_wei" numeric(78,0),
	"cron_expr" text,
	"min_reward_wei" numeric(78,0),
	"next_run_at" timestamp with time zone,
	"principal_wei" numeric(78,0) DEFAULT 0 NOT NULL,
	"pending_wei" numeric(78,0) DEFAULT 0 NOT NULL,
	"liquid_wei" numeric(78,0),
	"chain_synced_at" timestamp with time zone,
	"apr_est" double precision,
	"r_star_wei" numeric(78,0),
	"eta_sec" integer,
	"next_check_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_check_at" timestamp with time zone,
	"last_compound_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"last_run_result" text,
	"claim_only" boolean DEFAULT false NOT NULL,
	"backoff_level" integer DEFAULT 0 NOT NULL,
	"last_failure_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "positions_wallet_validator_unique" UNIQUE("wallet_id","validator_id"),
	CONSTRAINT "positions_strategy_check" CHECK ("positions"."strategy" IN ('optimal', 'threshold', 'schedule'))
);
--> statement-breakpoint
CREATE TABLE "txs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"position_id" uuid,
	"action_id" uuid,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"hash" text NOT NULL,
	"signed_raw" text NOT NULL,
	"nonce" integer NOT NULL,
	"from_address" text NOT NULL,
	"to_address" text NOT NULL,
	"value_wei" numeric(78,0) NOT NULL,
	"gas_limit" bigint NOT NULL,
	"gas_price_wei" numeric(78,0) NOT NULL,
	"gas_used" bigint,
	"block_number" bigint,
	"event_delegated_wei" numeric(78,0),
	"event_undelegated_wei" numeric(78,0),
	"event_claimed_wei" numeric(78,0),
	"error" text,
	"broadcast_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "txs_hash_unique" UNIQUE("hash"),
	CONSTRAINT "txs_kind_check" CHECK ("txs"."kind" IN ('delegate', 'undelegate', 'claim', 'compound_delegate', 'compound_claim')),
	CONSTRAINT "txs_status_check" CHECK ("txs"."status" IN ('signed', 'broadcast', 'confirmed', 'reverted', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "validators" (
	"validator_id" integer PRIMARY KEY NOT NULL,
	"share_address" text NOT NULL,
	"signer" text NOT NULL,
	"name" text,
	"image_url" text,
	"status" smallint NOT NULL,
	"commission_bps" integer NOT NULL,
	"infra_commission_bps" integer NOT NULL,
	"self_stake_wei" numeric(78,0) NOT NULL,
	"delegated_wei" numeric(78,0) NOT NULL,
	"total_supply_wei" numeric(78,0) NOT NULL,
	"min_delegated_wei" numeric(78,0) NOT NULL,
	"delegation_enabled" boolean NOT NULL,
	"paused" boolean NOT NULL,
	"is_official_pool" boolean NOT NULL,
	"in_minimal_set" boolean NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "validators_share_address_unique" UNIQUE("share_address")
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"address" text NOT NULL,
	"encrypted_key" text NOT NULL,
	"balance_wei" numeric(78,0),
	"balance_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_address_unique" UNIQUE("address")
);
--> statement-breakpoint
CREATE TABLE "worker_heartbeat" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"instance_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_tick_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tick_count" bigint DEFAULT 0 NOT NULL,
	"chain_id" integer,
	"block_number" bigint,
	"gas_price_wei" numeric(78,0),
	"dry_run" boolean NOT NULL,
	"version" text NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worker_heartbeat_single_row_check" CHECK ("worker_heartbeat"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_snapshots" ADD CONSTRAINT "position_snapshots_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_validator_id_validators_validator_id_fk" FOREIGN KEY ("validator_id") REFERENCES "public"."validators"("validator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "txs" ADD CONSTRAINT "txs_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "txs" ADD CONSTRAINT "txs_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "txs" ADD CONSTRAINT "txs_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "actions_status_created_at_idx" ON "actions" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "login_attempts_ip_attempted_at_idx" ON "login_attempts" USING btree ("ip","attempted_at");--> statement-breakpoint
CREATE INDEX "position_snapshots_position_id_taken_at_idx" ON "position_snapshots" USING btree ("position_id","taken_at");--> statement-breakpoint
CREATE INDEX "txs_wallet_id_nonce_idx" ON "txs" USING btree ("wallet_id","nonce");--> statement-breakpoint
CREATE INDEX "txs_position_id_created_at_idx" ON "txs" USING btree ("position_id","created_at");