CREATE TYPE "public"."import_job_status" AS ENUM('uploaded', 'processing', 'needs_review', 'approved', 'failed');--> statement-breakpoint
CREATE TYPE "public"."import_row_kind" AS ENUM('new', 'changed', 'unchanged', 'error', 'removed');--> statement-breakpoint
CREATE TYPE "public"."import_source_type" AS ENUM('excel', 'pdf');--> statement-breakpoint
CREATE TYPE "public"."price_list_status" AS ENUM('draft', 'published', 'superseded');--> statement-breakpoint
CREATE TABLE "brand" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"distributor_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "design" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid,
	"source_file_id" uuid,
	"reference_file_id" uuid,
	"source_name" text NOT NULL,
	"source_type" "import_source_type" DEFAULT 'excel' NOT NULL,
	"status" "import_job_status" DEFAULT 'uploaded' NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"error_summary" text,
	"defaults" jsonb NOT NULL,
	"created_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_row" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"raw" jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	"kind" "import_row_kind" NOT NULL,
	"message" text,
	"accepted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_row_error_not_accepted_chk" CHECK ("import_row"."kind" <> 'error' OR NOT "import_row"."accepted")
);
--> statement-breakpoint
CREATE TABLE "price_group" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"price_list_id" uuid NOT NULL,
	"size_label" text NOT NULL,
	"length_mm" integer,
	"width_mm" integer,
	"finish" text NOT NULL,
	"pieces_per_box" integer NOT NULL,
	"sqft_per_box" numeric(12, 3) NOT NULL,
	"rate_per_box" numeric(14, 2) NOT NULL,
	"rate_per_sqft" numeric(14, 2) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_group_rates_chk" CHECK ("price_group"."rate_per_box" > 0 AND "price_group"."rate_per_sqft" >= 0),
	CONSTRAINT "price_group_packing_chk" CHECK ("price_group"."pieces_per_box" > 0 AND "price_group"."sqft_per_box" > 0)
);
--> statement-breakpoint
CREATE TABLE "price_group_design" (
	"price_group_id" uuid NOT NULL,
	"design_id" uuid NOT NULL,
	CONSTRAINT "price_group_design_price_group_id_design_id_pk" PRIMARY KEY("price_group_id","design_id")
);
--> statement-breakpoint
CREATE TABLE "price_list" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"label" text,
	"effective_from" date NOT NULL,
	"source_file_id" uuid,
	"reference_file_id" uuid,
	"status" "price_list_status" DEFAULT 'draft' NOT NULL,
	"import_job_id" uuid,
	"imported_by" uuid,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "brand_id" uuid;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "design_id" uuid;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "price_group_id" uuid;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "cost_per_unit" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "margin_percent" numeric(8, 2);--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "cost_review_needed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "previous_cost_per_unit" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "business_profile" ADD COLUMN "default_hsn_code" text;--> statement-breakpoint
ALTER TABLE "business_profile" ADD COLUMN "default_gst_rate" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "brand" ADD CONSTRAINT "brand_distributor_id_distributor_id_fk" FOREIGN KEY ("distributor_id") REFERENCES "public"."distributor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design" ADD CONSTRAINT "design_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_source_file_id_file_id_fk" FOREIGN KEY ("source_file_id") REFERENCES "public"."file"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_reference_file_id_file_id_fk" FOREIGN KEY ("reference_file_id") REFERENCES "public"."file"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_job_id_import_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."import_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_group" ADD CONSTRAINT "price_group_price_list_id_price_list_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_list"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_group_design" ADD CONSTRAINT "price_group_design_price_group_id_price_group_id_fk" FOREIGN KEY ("price_group_id") REFERENCES "public"."price_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_group_design" ADD CONSTRAINT "price_group_design_design_id_design_id_fk" FOREIGN KEY ("design_id") REFERENCES "public"."design"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list" ADD CONSTRAINT "price_list_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list" ADD CONSTRAINT "price_list_source_file_id_file_id_fk" FOREIGN KEY ("source_file_id") REFERENCES "public"."file"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list" ADD CONSTRAINT "price_list_reference_file_id_file_id_fk" FOREIGN KEY ("reference_file_id") REFERENCES "public"."file"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list" ADD CONSTRAINT "price_list_imported_by_user_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brand_name_idx" ON "brand" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "brand_distributor_idx" ON "brand" USING btree ("distributor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "design_brand_name_idx" ON "design" USING btree ("brand_id",lower("name"));--> statement-breakpoint
CREATE INDEX "import_job_created_idx" ON "import_job" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "import_row_job_idx" ON "import_row" USING btree ("job_id","row_number");--> statement-breakpoint
CREATE INDEX "price_group_list_idx" ON "price_group" USING btree ("price_list_id","sort_order");--> statement-breakpoint
CREATE INDEX "price_group_design_design_idx" ON "price_group_design" USING btree ("design_id");--> statement-breakpoint
CREATE INDEX "price_list_brand_idx" ON "price_list" USING btree ("brand_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "price_list_one_published_idx" ON "price_list" USING btree ("brand_id") WHERE "price_list"."status" = 'published';--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_design_id_design_id_fk" FOREIGN KEY ("design_id") REFERENCES "public"."design"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_price_group_id_price_group_id_fk" FOREIGN KEY ("price_group_id") REFERENCES "public"."price_group"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_brand_design_idx" ON "product" USING btree ("brand_id","design_id");--> statement-breakpoint
CREATE INDEX "product_cost_review_idx" ON "product" USING btree ("cost_review_needed");--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_cost_chk" CHECK ("product"."cost_per_unit" IS NULL OR "product"."cost_per_unit" >= 0);