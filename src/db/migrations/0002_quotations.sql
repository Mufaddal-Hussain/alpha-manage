CREATE TYPE "public"."product_status" AS ENUM('active', 'discontinued');--> statement-breakpoint
CREATE TYPE "public"."product_unit" AS ENUM('box', 'sqft', 'piece');--> statement-breakpoint
CREATE TYPE "public"."quotation_layout" AS ENUM('gst_quotation', 'estimate');--> statement-breakpoint
CREATE TYPE "public"."quotation_line_kind" AS ENUM('product', 'charge');--> statement-breakpoint
CREATE TYPE "public"."quotation_status" AS ENUM('draft', 'sent', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."tax_mode" AS ENUM('intra', 'inter');--> statement-breakpoint
CREATE TABLE "charge_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"hsn_sac_code" text NOT NULL,
	"gst_rate" numeric(5, 2) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "charge_type_gst_rate_chk" CHECK ("charge_type"."gst_rate" >= 0 AND "charge_type"."gst_rate" <= 100)
);
--> statement-breakpoint
CREATE TABLE "product" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"size_label" text,
	"finish" text,
	"unit" "product_unit" NOT NULL,
	"pieces_per_box" integer,
	"sqft_per_box" numeric(12, 3),
	"hsn_code" text NOT NULL,
	"gst_rate" numeric(5, 2) NOT NULL,
	"selling_price_per_unit" numeric(14, 2),
	"status" "product_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_gst_rate_chk" CHECK ("product"."gst_rate" >= 0 AND "product"."gst_rate" <= 100),
	CONSTRAINT "product_selling_price_chk" CHECK ("product"."selling_price_per_unit" IS NULL OR "product"."selling_price_per_unit" >= 0),
	CONSTRAINT "product_sqft_per_box_chk" CHECK ("product"."sqft_per_box" IS NULL OR "product"."sqft_per_box" > 0),
	CONSTRAINT "product_box_needs_packing_chk" CHECK ("product"."unit" <> 'box' OR "product"."sqft_per_box" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "quotation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text,
	"customer_id" uuid NOT NULL,
	"status" "quotation_status" DEFAULT 'draft' NOT NULL,
	"current_revision_id" uuid,
	"created_by" uuid,
	"approved_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotation_number_unique" UNIQUE("number"),
	CONSTRAINT "quotation_number_chk" CHECK ("quotation"."status" = 'draft' OR "quotation"."number" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "quotation_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"kind" "quotation_line_kind" DEFAULT 'product' NOT NULL,
	"product_id" uuid,
	"charge_type_id" uuid,
	"description" text NOT NULL,
	"hsn_code" text NOT NULL,
	"unit" "product_unit" NOT NULL,
	"pieces_per_box" integer,
	"sqft_per_box" numeric(12, 3),
	"quantity" numeric(12, 3) NOT NULL,
	"quantity_alt" numeric(12, 3),
	"rate" numeric(14, 2) NOT NULL,
	"discount_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"taxable_value" numeric(14, 2) NOT NULL,
	"gst_rate" numeric(5, 2) NOT NULL,
	"cgst_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"sgst_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"igst_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"line_total" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotation_line_quantity_chk" CHECK ("quotation_line"."quantity" > 0),
	CONSTRAINT "quotation_line_discount_chk" CHECK ("quotation_line"."discount_percent" >= 0 AND "quotation_line"."discount_percent" <= 100)
);
--> statement-breakpoint
CREATE TABLE "quotation_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quotation_id" uuid NOT NULL,
	"revision_no" integer NOT NULL,
	"quotation_date" date NOT NULL,
	"valid_until" date NOT NULL,
	"bill_to_name" text NOT NULL,
	"bill_to_gstin" text,
	"bill_to_address" text,
	"bill_to_state_code" text NOT NULL,
	"ship_to_name" text,
	"ship_to_address" text,
	"ship_to_state_code" text,
	"site_contact_name" text,
	"site_contact_phone" text,
	"place_of_supply_state_code" text NOT NULL,
	"tax_mode" "tax_mode" NOT NULL,
	"layout" "quotation_layout" DEFAULT 'gst_quotation' NOT NULL,
	"terms_text" text,
	"advance_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"subtotal" numeric(14, 2) DEFAULT '0' NOT NULL,
	"cgst_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"sgst_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"igst_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"round_off" numeric(14, 2) DEFAULT '0' NOT NULL,
	"grand_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total_in_words" text,
	"notes" text,
	"issued_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"pdf_file_id" uuid,
	"pdf_layout" "quotation_layout",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotation_revision_dates_chk" CHECK ("quotation_revision"."valid_until" >= "quotation_revision"."quotation_date"),
	CONSTRAINT "quotation_revision_advance_chk" CHECK ("quotation_revision"."advance_amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_current_revision_id_quotation_revision_id_fk" FOREIGN KEY ("current_revision_id") REFERENCES "public"."quotation_revision"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_line" ADD CONSTRAINT "quotation_line_revision_id_quotation_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."quotation_revision"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_line" ADD CONSTRAINT "quotation_line_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_line" ADD CONSTRAINT "quotation_line_charge_type_id_charge_type_id_fk" FOREIGN KEY ("charge_type_id") REFERENCES "public"."charge_type"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_revision" ADD CONSTRAINT "quotation_revision_quotation_id_quotation_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_revision" ADD CONSTRAINT "quotation_revision_pdf_file_id_file_id_fk" FOREIGN KEY ("pdf_file_id") REFERENCES "public"."file"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_name_idx" ON "product" USING btree ("name");--> statement-breakpoint
CREATE INDEX "quotation_customer_idx" ON "quotation" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "quotation_status_idx" ON "quotation" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "quotation_line_no_idx" ON "quotation_line" USING btree ("revision_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "quotation_revision_no_idx" ON "quotation_revision" USING btree ("quotation_id","revision_no");