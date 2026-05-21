import "dotenv/config";
import { db } from "../config/databaseConnection";
import { sql } from "drizzle-orm";

async function apply() {
  console.log("Applying migration 0010: make slab_rules.max_slab nullable...");

  await db.execute(sql`
    ALTER TABLE "slab_rules"
    ALTER COLUMN "max_slab" DROP NOT NULL
  `);

  console.log("✓ Migration 0010 applied successfully.");
  process.exit(0);
}

apply().catch((err) => {
  console.error("Migration 0010 failed:", err);
  process.exit(1);
});
