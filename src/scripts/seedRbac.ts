import "dotenv/config";
import { db } from "../config/databaseConnection";
import { seedRolesAndBackfillUserRoles } from "../utils/rbacSync";

/**
 * 1. Ensure `roles` contains every name in `ROLES`.
 * 2. Backfill `user_roles` from `users.role` (one primary link per user).
 *
 * Prerequisites: tables exist (e.g. `npx drizzle-kit push`).
 */
async function main() {
  const result = await seedRolesAndBackfillUserRoles(db);
  console.log("✅ RBAC seed complete");
  console.log("   Role names ensured:", result.rolesSeeded);
  console.log("   Users linked in user_roles:", result.usersLinked);
  console.log("   Skipped (unknown role string):", result.skippedUsers);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ seed:rbac failed:", err);
  process.exit(1);
});
