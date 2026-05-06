import { db } from "../../config/databaseConnection";
import { permissions } from "../../schemas/permission.schema";
import { rolePermissions } from "../../schemas/rolePermission.schema";
import { eq, sql } from "drizzle-orm";

const PERM_NAME_PATTERN = /^[a-z][a-z0-9_:._-]{1,99}$/i;

export function assertValidPermissionName(name: string): void {
  const n = name.trim();
  if (!n || n.length > 100) {
    throw new Error("Permission name must be 1–100 characters");
  }
  if (!PERM_NAME_PATTERN.test(n)) {
    throw new Error(
      "Permission name must start with a letter and use allowed characters (e.g. reports:view)"
    );
  }
}

export async function listPermissions() {
  return db
    .select({
      id: permissions.id,
      name: permissions.name,
      description: permissions.description,
    })
    .from(permissions)
    .orderBy(permissions.name);
}

export async function getPermissionById(permissionId: number) {
  const [row] = await db
    .select({
      id: permissions.id,
      name: permissions.name,
      description: permissions.description,
    })
    .from(permissions)
    .where(eq(permissions.id, permissionId))
    .limit(1);
  return row ?? null;
}

export async function createPermission(input: {
  name: string;
  description?: string | null;
}) {
  assertValidPermissionName(input.name);
  const name = input.name.trim();
  const [created] = await db
    .insert(permissions)
    .values({
      name,
      description: input.description?.trim() || null,
    })
    .returning({
      id: permissions.id,
      name: permissions.name,
      description: permissions.description,
    });
  return created;
}

export async function updatePermission(
  permissionId: number,
  input: { name?: string; description?: string | null }
) {
  if (input.name !== undefined) {
    assertValidPermissionName(input.name);
  }
  const patch: Partial<typeof permissions.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.description !== undefined) {
    patch.description =
      input.description === null || input.description === ""
        ? null
        : input.description.trim();
  }
  if (Object.keys(patch).length === 0) {
    throw new Error("No fields to update");
  }
  const [updated] = await db
    .update(permissions)
    .set(patch)
    .where(eq(permissions.id, permissionId))
    .returning({
      id: permissions.id,
      name: permissions.name,
      description: permissions.description,
    });
  return updated ?? null;
}

export async function countRolesUsingPermission(permissionId: number): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(rolePermissions)
    .where(eq(rolePermissions.permissionId, permissionId));
  return row?.c ?? 0;
}

export async function deletePermission(permissionId: number): Promise<boolean> {
  const linked = await countRolesUsingPermission(permissionId);
  if (linked > 0) {
    throw new Error(
      `Cannot delete permission: still granted to ${linked} role link(s). Remove from roles first.`
    );
  }
  const deleted = await db
    .delete(permissions)
    .where(eq(permissions.id, permissionId))
    .returning({ id: permissions.id });
  return deleted.length > 0;
}
