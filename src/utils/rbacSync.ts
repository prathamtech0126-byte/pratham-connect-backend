import { eq } from "drizzle-orm";
import { db } from "../config/databaseConnection";
import { roles } from "../schemas/role.schema";
import { userRoles } from "../schemas/userRole.schema";
import { users } from "../schemas/users.schema";
import { ROLES, type Role, isRole } from "../types/role";

/** DB or Drizzle transaction — same insert/select/delete/update surface. */
type DbExecutor = Pick<typeof db, "insert" | "select" | "delete" | "update">;

/** Inserts missing rows in `roles` for every entry in `ROLES`. */
export async function ensureSystemRoles(executor: DbExecutor = db): Promise<void> {
  for (const name of ROLES) {
    await executor
      .insert(roles)
      .values({ name, description: null })
      .onConflictDoNothing({ target: roles.name });
  }
}

export async function getRoleIdByName(
  executor: DbExecutor,
  roleName: string
): Promise<number | undefined> {
  const [row] = await executor
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.name, roleName))
    .limit(1);
  return row?.id;
}

/**
 * Replaces junction rows for this user with a single link matching `users.role`.
 * Call after create/update user, inside the same transaction as the user row change.
 */
export async function replaceUserPrimaryRoleLink(
  executor: DbExecutor,
  userId: number,
  roleName: Role
): Promise<void> {
  const roleId = await getRoleIdByName(executor, roleName);
  if (roleId == null) {
    throw new Error(
      `Role "${roleName}" is missing from table "roles". Run: npm run seed:rbac`
    );
  }
  await executor.delete(userRoles).where(eq(userRoles.userId, userId));
  await executor.insert(userRoles).values({ userId, roleId });
  await executor
    .update(users)
    .set({ roleId })
    .where(eq(users.id, userId));
}

/** Seed roles table + backfill `user_roles` from `users.role` (skips unknown role strings). */
export async function seedRolesAndBackfillUserRoles(
  executor: DbExecutor = db
): Promise<{ rolesSeeded: number; usersLinked: number; skippedUsers: number }> {
  await ensureSystemRoles(executor);

  const allUsers = await executor
    .select({ id: users.id, role: users.role })
    .from(users);

  let usersLinked = 0;
  let skippedUsers = 0;

  for (const u of allUsers) {
    if (!isRole(u.role)) {
      skippedUsers += 1;
      continue;
    }
    const roleId = await getRoleIdByName(executor, u.role);
    if (roleId == null) {
      skippedUsers += 1;
      continue;
    }
    await executor.delete(userRoles).where(eq(userRoles.userId, u.id));
    await executor.insert(userRoles).values({ userId: u.id, roleId });
    await executor
      .update(users)
      .set({ roleId })
      .where(eq(users.id, u.id));
    usersLinked += 1;
  }

  return { rolesSeeded: ROLES.length, usersLinked, skippedUsers };
}
