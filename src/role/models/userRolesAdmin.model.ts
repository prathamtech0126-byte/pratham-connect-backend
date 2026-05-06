import { db } from "../../config/databaseConnection";
import { users } from "../../schemas/users.schema";
import { roles } from "../../schemas/role.schema";
import { userRoles } from "../../schemas/userRole.schema";
import { eq } from "drizzle-orm";
import { isRole, type Role } from "../../types/role";
import { replaceUserPrimaryRoleLink } from "../../utils/rbacSync";

export async function listRolesForUser(userId: number) {
  const [u] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u) return null;

  return db
    .select({
      id: roles.id,
      name: roles.name,
      description: roles.description,
    })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, userId))
    .orderBy(roles.name);
}

/**
 * Sets the user's primary application role (updates `users.role`, `users.role_id`, `user_roles`).
 * Only names listed in `src/types/role.ts` are allowed so JWT / middleware stay consistent.
 */
export async function setUserPrimaryRoleByRoleId(
  userId: number,
  roleId: number
): Promise<void> {
  const [roleRow] = await db
    .select({ id: roles.id, name: roles.name })
    .from(roles)
    .where(eq(roles.id, roleId))
    .limit(1);
  if (!roleRow) {
    throw new Error("Role not found");
  }
  if (!isRole(roleRow.name)) {
    throw new Error(
      "This role name is not registered in the application role list; extend ROLES or remove this row from `roles` before assigning."
    );
  }

  const [user] = await db
    .select({
      id: users.id,
      managerId: users.managerId,
      isSupervisor: users.isSupervisor,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) {
    throw new Error("User not found");
  }

  const roleName = roleRow.name as Role;
  const needsManager = roleName === "counsellor" || roleName === "telecaller";
  if (needsManager && user.managerId == null) {
    throw new Error(
      "Counsellor and telecaller must have a manager assigned. Update the user with a manager first."
    );
  }

  const patch: Partial<typeof users.$inferInsert> = {
    role: roleName,
    roleId: roleRow.id,
  };

  if (!needsManager) {
    patch.managerId = null;
  }
  patch.isSupervisor = roleName === "manager" ? user.isSupervisor : false;

  await db.transaction(async (tx) => {
    await tx.update(users).set(patch).where(eq(users.id, userId));
    await replaceUserPrimaryRoleLink(tx, userId, roleName);
  });
}
