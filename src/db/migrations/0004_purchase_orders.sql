CREATE TYPE "public"."purchase_order_status" AS ENUM('open', 'partially_delivered', 'delivered', 'cancelled');--> statement-breakpoint
CREATE TABLE "po_file" (
	"purchase_order_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "po_file_purchase_order_id_file_id_pk" PRIMARY KEY("purchase_order_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "po_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"quotation_line_id" uuid,
	"description" text NOT NULL,
	"hsn_code" text NOT NULL,
	"unit" "product_unit" NOT NULL,
	"quantity_ordered" numeric(12, 3) NOT NULL,
	"quantity_quoted" numeric(12, 3),
	"rate" numeric(14, 2) NOT NULL,
	"discount_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"gst_rate" numeric(5, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "po_line_quantity_chk" CHECK ("po_line"."quantity_ordered" > 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quotation_id" uuid NOT NULL,
	"quotation_revision_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"customer_po_number" text NOT NULL,
	"po_date" date NOT NULL,
	"advance_received" numeric(14, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"status" "purchase_order_status" DEFAULT 'open' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_order_advance_chk" CHECK ("purchase_order"."advance_received" >= 0),
	CONSTRAINT "purchase_order_number_chk" CHECK (length(btrim("purchase_order"."customer_po_number")) > 0)
);
--> statement-breakpoint
ALTER TABLE "po_file" ADD CONSTRAINT "po_file_purchase_order_id_purchase_order_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_file" ADD CONSTRAINT "po_file_file_id_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_line" ADD CONSTRAINT "po_line_purchase_order_id_purchase_order_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_line" ADD CONSTRAINT "po_line_quotation_line_id_quotation_line_id_fk" FOREIGN KEY ("quotation_line_id") REFERENCES "public"."quotation_line"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_quotation_id_quotation_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_quotation_revision_id_quotation_revision_id_fk" FOREIGN KEY ("quotation_revision_id") REFERENCES "public"."quotation_revision"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "po_file_file_idx" ON "po_file" USING btree ("file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "po_line_no_idx" ON "po_line" USING btree ("purchase_order_id","line_no");--> statement-breakpoint
CREATE INDEX "po_line_quotation_line_idx" ON "po_line" USING btree ("quotation_line_id");--> statement-breakpoint
CREATE INDEX "purchase_order_quotation_idx" ON "purchase_order" USING btree ("quotation_id");--> statement-breakpoint
CREATE INDEX "purchase_order_customer_idx" ON "purchase_order" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "purchase_order_status_idx" ON "purchase_order" USING btree ("status");--> statement-breakpoint
CREATE INDEX "purchase_order_customer_po_idx" ON "purchase_order" USING btree ("customer_id",lower("customer_po_number"));