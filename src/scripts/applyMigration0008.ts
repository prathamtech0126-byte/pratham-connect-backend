import "dotenv/config";
import { db } from "../config/databaseConnection";
import { sql } from "drizzle-orm";

async function apply() {
  console.log("Applying migration 0008...");

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "other_products" (
      "id"            serial PRIMARY KEY NOT NULL,
      "product_id"    varchar(100) NOT NULL,
      "name"          varchar(255) NOT NULL,
      "category"      varchar(50) NOT NULL,
      "product_name"  varchar(100) NOT NULL,
      "form_type"     varchar(100) NOT NULL,
      "description"   text,
      "is_active"     boolean DEFAULT true NOT NULL,
      "display_order" integer DEFAULT 0,
      "metadata"      text,
      "created_at"    timestamp DEFAULT now() NOT NULL,
      "updated_at"    timestamp DEFAULT now() NOT NULL,
      CONSTRAINT "other_products_product_id_unique" UNIQUE("product_id"),
      CONSTRAINT "other_products_product_name_unique" UNIQUE("product_name")
    )
  `);
  console.log("✓ Created table other_products");

  console.log("Migration 0008 applied successfully.");
  process.exit(0);
}

apply().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
