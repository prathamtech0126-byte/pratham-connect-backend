import "dotenv/config";
import { poolSecond } from "../config/databaseConnectionSecond";

/**
 * Adds journey timeline enum values used by modules journey (idempotent).
 *
 * Usage: npm run migrate:module-journey-event-types
 */
async function apply() {
  if (!poolSecond) {
    throw new Error("DATABASE_URL_SECOND is not configured");
  }

  console.log("Applying modules migration: journey_event_type_enum values...");

  for (const value of ["TEAM_ROUTED", "CLIENT_TRANSFERRED"]) {
    await poolSecond.query(`
      DO $$ BEGIN
        ALTER TYPE journey_event_type_enum ADD VALUE '${value}';
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);
    console.log(`  ✓ ${value}`);
  }

  console.log("✓ journey_event_type_enum migration applied successfully.");
  await poolSecond.end();
  process.exit(0);
}

apply().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
