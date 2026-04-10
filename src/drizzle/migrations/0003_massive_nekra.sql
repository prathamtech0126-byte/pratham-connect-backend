CREATE TABLE "checklists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visa_category_id" uuid NOT NULL,
	"country_id" uuid,
	"title" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"sub_type" varchar(100),
	"description" text,
	"display_order" integer DEFAULT 0,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "checklists_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "countries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"code" varchar(10) NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "countries_name_unique" UNIQUE("name"),
	CONSTRAINT "countries_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "document_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"notes" text,
	"is_mandatory" boolean DEFAULT true,
	"is_conditional" boolean DEFAULT false,
	"condition_text" varchar(255),
	"quantity_note" varchar(100),
	"display_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "document_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"checklist_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"display_order" integer DEFAULT 0,
	"is_conditional" boolean DEFAULT false,
	"condition_text" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "visa_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"description" text,
	"display_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "visa_categories_name_unique" UNIQUE("name"),
	CONSTRAINT "visa_categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "checklists" ADD CONSTRAINT "checklists_visa_category_id_visa_categories_id_fk" FOREIGN KEY ("visa_category_id") REFERENCES "public"."visa_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklists" ADD CONSTRAINT "checklists_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_items" ADD CONSTRAINT "document_items_section_id_document_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."document_sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_sections" ADD CONSTRAINT "document_sections_checklist_id_checklists_id_fk" FOREIGN KEY ("checklist_id") REFERENCES "public"."checklists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_checklists_visa_category" ON "checklists" USING btree ("visa_category_id");--> statement-breakpoint
CREATE INDEX "idx_checklists_country" ON "checklists" USING btree ("country_id");--> statement-breakpoint
CREATE INDEX "idx_checklists_is_active" ON "checklists" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_checklists_active_visa_category" ON "checklists" USING btree ("is_active","visa_category_id");--> statement-breakpoint
CREATE INDEX "idx_document_items_section" ON "document_items" USING btree ("section_id");--> statement-breakpoint
CREATE INDEX "idx_document_sections_checklist" ON "document_sections" USING btree ("checklist_id");