/**
 * Makes incentive_records.rule_sale_type_id nullable so that Approve/Reject
 * actions work even when no rule configurations have been set up yet.
 *
 * Usage:
 *   npm run migrate:nullable-rule-sale-type
 */
import "dotenv/config";
import { db } from "../config/databaseConnection";
import { sql } from "drizzle-orm";

async function apply() {
  console.log("=== Making incentive_records.rule_sale_type_id nullable ===\n");

  try {
    await db.execute(sql`
      ALTER TABLE incentive_records
        ALTER COLUMN rule_sale_type_id DROP NOT NULL
    `);
    console.log("✓ rule_sale_type_id is now nullable");
  } catch (err: any) {
    if (err?.message?.includes("does not exist") || err?.message?.includes("already")) {
      console.log("  (skip) column already nullable or does not exist");
    } else {
      console.error("✗ FAILED:", err?.message ?? err);
      throw err;
    }
  }

  console.log("\nDone.");
  process.exit(0);
}

apply().catch((err) => {
  console.error(err);
  process.exit(1);
});
