CREATE TABLE IF NOT EXISTS "admin_credentials" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_credentials_single_row_check" CHECK ("admin_credentials"."id" = 1)
);
