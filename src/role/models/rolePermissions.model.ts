import { db } from "../../config/databaseConnection";
import { roles } from "../../rbac/schemas/role.schema";
import { permissions } from "../../rbac/schemas/permission.schema";
import { rolePermissions } from "../../rbac/schemas/rolePermission.schema";
import { eq, inArray, and } from "drizzle-orm";

export async function listPermissionsForRole(roleId: number) {
  const role = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.id, roleId))
    .limit(1);
  if (role.length === 0) return null;

  return db
    .select({
      id: permissions.id,
      name: permissions.name,
      description: permissions.description,
    })
    .from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(eq(rolePermissions.roleId, roleId))
    .orderBy(permissions.name);
}

export async function setRolePermissions(
  roleId: number,
  permissionIds: number[]
): Promise<void> {
  const [role] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.id, roleId))
    .limit(1);
  if (!role) {
    throw new Error("Role not found");
  }

  const uniqueIds = [...new Set(permissionIds)];
  if (uniqueIds.length === 0) {
    await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    return;
  }

  const existing = await db
    .select({ id: permissions.id })
    .from(permissions)
    .where(inArray(permissions.id, uniqueIds));
  if (existing.length !== uniqueIds.length) {
    throw new Error("One or more permission IDs are invalid");
  }

  await db.transaction(async (tx) => {
    await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    await tx.insert(rolePermissions).values(
      uniqueIds.map((permissionId) => ({ roleId, permissionId }))
    );
  });
}

export async function addRolePermission(roleId: number, permissionId: number) {
  const [role] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.id, roleId))
    .limit(1);
  if (!role) throw new Error("Role not found");

  const [perm] = await db
    .select({ id: permissions.id })
    .from(permissions)
    .where(eq(permissions.id, permissionId))
    .limit(1);
  if (!perm) throw new Error("Permission not found");

  await db
    .insert(rolePermissions)
    .values({ roleId, permissionId })
    .onConflictDoNothing();
}

export async function removeRolePermission(roleId: number, permissionId: number) {
  const deleted = await db
    .delete(rolePermissions)
    .where(
      and(
        eq(rolePermissions.roleId, roleId),
        eq(rolePermissions.permissionId, permissionId)
      )
    )
    .returning({ roleId: rolePermissions.roleId });
  return deleted.length > 0;
}
