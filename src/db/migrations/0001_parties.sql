CREATE TYPE "public"."customer_type" AS ENUM('individual', 'company');--> statement-breakpoint
CREATE TABLE "customer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "customer_type" NOT NULL,
	"display_name" text NOT NULL,
	"legal_name" text,
	"gstin" text,
	"pan" text,
	"state_code" text NOT NULL,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"pincode" text,
	"phone" text,
	"email" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_state_code_chk" CHECK ("customer"."state_code" ~ '^[0-9]{2}$'),
	CONSTRAINT "customer_gstin_format_chk" CHECK ("gstin" IS NULL OR "gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
	CONSTRAINT "customer_gstin_state_chk" CHECK ("customer"."gstin" IS NULL OR left("customer"."gstin", 2) = "customer"."state_code")
);
--> statement-breakpoint
CREATE TABLE "customer_address" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"label" text NOT NULL,
	"address_line1" text NOT NULL,
	"address_line2" text,
	"city" text,
	"pincode" text,
	"state_code" text NOT NULL,
	"is_default_shipping" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_address_state_code_chk" CHECK ("customer_address"."state_code" ~ '^[0-9]{2}$')
);
--> statement-breakpoint
CREATE TABLE "customer_contact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"role" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "distributor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"gstin" text,
	"phone" text,
	"email" text,
	"address" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "distributor_gstin_format_chk" CHECK ("gstin" IS NULL OR "gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$')
);
--> statement-breakpoint
ALTER TABLE "customer_address" ADD CONSTRAINT "customer_address_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_contact" ADD CONSTRAINT "customer_contact_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_display_name_idx" ON "customer" USING btree ("display_name");--> statement-breakpoint
CREATE INDEX "customer_gstin_idx" ON "customer" USING btree ("gstin");--> statement-breakpoint
CREATE INDEX "customer_address_customer_idx" ON "customer_address" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_address_one_default_idx" ON "customer_address" USING btree ("customer_id") WHERE "customer_address"."is_default_shipping";--> statement-breakpoint
CREATE INDEX "customer_contact_customer_idx" ON "customer_contact" USING btree ("customer_id");