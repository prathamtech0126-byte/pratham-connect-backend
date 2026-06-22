import { db } from "../../config/databaseConnection";
import { roles } from "../../rbac/schemas/role.schema";
import { userRoles } from "../../rbac/schemas/userRole.schema";
import { eq, sql } from "drizzle-orm";

const NAME_PATTERN = /^[a-z][a-z0-9_]{0,49}$/;

export function assertValidRoleName(name: string): void {
  const n = name.trim().toLowerCase();
  if (!n || n.length > 50) {
    throw new Error("Role name must be 1–50 characters");
  }
  if (!NAME_PATTERN.test(n)) {
    throw new Error(
      "Role name must be lowercase snake_case (letters, digits, underscore)"
    );
  }
}

export async function listRoles() {
  return db
    .select({
      id: roles.id,
      name: roles.name,
      description: roles.description,
      createdAt: roles.createdAt,
    })
    .from(roles)
    .orderBy(roles.name);
}

export async function getRoleById(roleId: number) {
  const [row] = await db
    .select({
      id: roles.id,
      name: roles.name,
      description: roles.description,
      createdAt: roles.createdAt,
    })
    .from(roles)
    .where(eq(roles.id, roleId))
    .limit(1);
  return row ?? null;
}

export async function createRole(input: {
  name: string;
  description?: string | null;
}) {
  assertValidRoleName(input.name);
  const name = input.name.trim().toLowerCase();
  const [created] = await db
    .insert(roles)
    .values({
      name,
      description: input.description?.trim() || null,
    })
    .returning({
      id: roles.id,
      name: roles.name,
      description: roles.description,
      createdAt: roles.createdAt,
    });
  return created;
}

export async function updateRole(
  roleId: number,
  input: { name?: string; description?: string | null }
) {
  if (input.name !== undefined) {
    assertValidRoleName(input.name);
  }
  const patch: Partial<typeof roles.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name.trim().toLowerCase();
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
    .update(roles)
    .set(patch)
    .where(eq(roles.id, roleId))
    .returning({
      id: roles.id,
      name: roles.name,
      description: roles.description,
      createdAt: roles.createdAt,
    });
  return updated ?? null;
}

export async function countUsersWithRole(roleId: number): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(userRoles)
    .where(eq(userRoles.roleId, roleId));
  return row?.c ?? 0;
}

export async function deleteRole(roleId: number): Promise<boolean> {
  const usersWith = await countUsersWithRole(roleId);
  if (usersWith > 0) {
    throw new Error(
      `Cannot delete role: ${usersWith} user(s) still have this role assigned`
    );
  }
  const deleted = await db.delete(roles).where(eq(roles.id, roleId)).returning({ id: roles.id });
  return deleted.length > 0;
}
