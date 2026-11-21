CREATE TYPE "public"."challan_status" AS ENUM('issued', 'cancelled');--> statement-breakpoint
CREATE TABLE "challan_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"challan_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"po_line_id" uuid NOT NULL,
	"description" text NOT NULL,
	"hsn_code" text NOT NULL,
	"unit" "product_unit" NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"rate" numeric(14, 2) NOT NULL,
	"discount_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"gst_rate" numeric(5, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "challan_line_quantity_chk" CHECK ("challan_line"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "delivery_challan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"challan_date" date NOT NULL,
	"consignee_name" text NOT NULL,
	"consignee_gstin" text,
	"consignee_address" text,
	"consignee_state_code" text NOT NULL,
	"buyer_name" text NOT NULL,
	"buyer_gstin" text,
	"buyer_address" text,
	"buyer_state_code" text NOT NULL,
	"tax_mode" "tax_mode" NOT NULL,
	"mode_terms_of_payment" text,
	"reference_no_date" text,
	"other_references" text,
	"buyers_order_no_date" text,
	"dispatch_doc_no" text,
	"dispatched_through" text,
	"destination" text,
	"terms_of_delivery" text,
	"vehicle_no" text,
	"driver_name" text,
	"driver_phone" text,
	"show_prices" boolean DEFAULT false NOT NULL,
	"status" "challan_status" DEFAULT 'issued' NOT NULL,
	"override_reason" text,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"cancelled_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_challan_number_unique" UNIQUE("number"),
	CONSTRAINT "delivery_challan_cancel_chk" CHECK ("delivery_challan"."status" = 'issued' OR ("delivery_challan"."cancelled_at" IS NOT NULL AND "delivery_challan"."cancel_reason" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "challan_line" ADD CONSTRAINT "challan_line_challan_id_delivery_challan_id_fk" FOREIGN KEY ("challan_id") REFERENCES "public"."delivery_challan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challan_line" ADD CONSTRAINT "challan_line_po_line_id_po_line_id_fk" FOREIGN KEY ("po_line_id") REFERENCES "public"."po_line"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_challan" ADD CONSTRAINT "delivery_challan_purchase_order_id_purchase_order_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_challan" ADD CONSTRAINT "delivery_challan_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_challan" ADD CONSTRAINT "delivery_challan_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_challan" ADD CONSTRAINT "delivery_challan_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "challan_line_no_idx" ON "challan_line" USING btree ("challan_id","line_no");--> statement-breakpoint
CREATE INDEX "challan_line_po_line_idx" ON "challan_line" USING btree ("po_line_id");--> statement-breakpoint
CREATE INDEX "delivery_challan_po_idx" ON "delivery_challan" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE INDEX "delivery_challan_customer_idx" ON "delivery_challan" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "delivery_challan_status_idx" ON "delivery_challan" USING btree ("status");--> statement-breakpoint
CREATE INDEX "delivery_challan_date_idx" ON "delivery_challan" USING btree ("challan_date");