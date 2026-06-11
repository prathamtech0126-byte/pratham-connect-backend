/**
 * Copy users from main CRM (DATABASE_URL) into modules DB (DATABASE_URL_SECOND).
 *
 * Maps legacy `users.role` varchar → `roles` table (run migrate:module-roles first).
 * Preserves `legacy_user_id` for manager hierarchy remapping.
 *
 * Usage: npm run migrate:module-users
 */
import "dotenv/config";
import { Pool } from "pg";

const mainPool = new Pool({ connectionString: process.env.DATABASE_URL });
const modulesPool = new Pool({ connectionString: process.env.DATABASE_URL_SECOND });

type LegacyUser = {
  id: number;
  emp_id: string | null;
  full_name: string;
  email: string;
  password_hash: string;
  role: string;
  role_id: number | null;
  manager_id: number | null;
  office_phone: string | null;
  personal_phone: string | null;
  designation: string | null;
  is_supervisor: boolean;
  status: boolean;
  created_at: Date | null;
};

async function assertModulesUsersTable(): Promise<void> {
  const { rows } = await modulesPool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'users'
     ) AS exists`
  );
  if (!rows[0]?.exists) {
    throw new Error(
      'Table "users" not found in modules DB. Run first: npm run db:push:modules'
    );
  }
}

async function mainUsersHasRoleIdColumn(): Promise<boolean> {
  const { rows } = await mainPool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'users'
         AND column_name = 'role_id'
     ) AS exists`
  );
  return rows[0]?.exists ?? false;
}

async function loadRoleMaps(): Promise<{
  byLegacyId: Map<number, string>;
  byName: Map<string, string>;
}> {
  const { rows } = await modulesPool.query<{
    id: string;
    name: string;
    legacy_role_id: number | null;
  }>(`SELECT id, name, legacy_role_id FROM roles`);

  const byLegacyId = new Map<number, string>();
  const byName = new Map<string, string>();
  for (const row of rows) {
    byName.set(row.name, row.id);
    if (row.legacy_role_id != null) {
      byLegacyId.set(row.legacy_role_id, row.id);
    }
  }
  return { byLegacyId, byName };
}

function resolveRoleId(
  user: LegacyUser,
  byLegacyId: Map<number, string>,
  byName: Map<string, string>
): string | null {
  if (user.role_id != null) {
    const fromId = byLegacyId.get(user.role_id);
    if (fromId) return fromId;
  }
  return byName.get(user.role.trim()) ?? null;
}

async function main() {
  await assertModulesUsersTable();

  const { byLegacyId, byName } = await loadRoleMaps();
  if (!byName.size) {
    throw new Error('No roles in modules DB. Run: npm run migrate:module-roles');
  }

  const hasRoleId = await mainUsersHasRoleIdColumn();
  const roleIdSelect = hasRoleId ? "role_id" : "NULL::bigint AS role_id";

  const { rows } = await mainPool.query<LegacyUser>(
    `SELECT id, emp_id, full_name, email, password_hash, role, ${roleIdSelect}, manager_id,
            office_phone, personal_phone, designation, is_supervisor, status, created_at
     FROM users
     ORDER BY id`
  );

  if (!rows.length) {
    console.log("No users in main CRM.");
    return;
  }

  let inserted = 0;
  let updated = 0;
  let skippedRole = 0;

  for (const row of rows) {
    const roleId = resolveRoleId(row, byLegacyId, byName);
    if (!roleId) {
      skippedRole++;
      console.warn(`Skipping user ${row.id} (${row.email}): unknown role "${row.role}"`);
      continue;
    }

    const result = await modulesPool.query(
      `INSERT INTO users (
         legacy_user_id, role_id, emp_id, full_name, email, password_hash,
         office_phone, personal_phone, designation, is_supervisor, is_active, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12, NOW()))
       ON CONFLICT (legacy_user_id) DO UPDATE SET
         role_id = EXCLUDED.role_id,
         emp_id = EXCLUDED.emp_id,
         full_name = EXCLUDED.full_name,
         email = EXCLUDED.email,
         password_hash = EXCLUDED.password_hash,
         office_phone = EXCLUDED.office_phone,
         personal_phone = EXCLUDED.personal_phone,
         designation = EXCLUDED.designation,
         is_supervisor = EXCLUDED.is_supervisor,
         is_active = EXCLUDED.is_active
       RETURNING (xmax = 0) AS inserted`,
      [
        row.id,
        roleId,
        row.emp_id,
        row.full_name,
        row.email,
        row.password_hash,
        row.office_phone,
        row.personal_phone,
        row.designation,
        row.is_supervisor ?? false,
        row.status ?? true,
        row.created_at,
      ]
    );
    if (result.rows[0]?.inserted) inserted++;
    else updated++;
  }

  const { rows: managerLinks } = await mainPool.query<{
    id: number;
    manager_id: number | null;
  }>(`SELECT id, manager_id FROM users WHERE manager_id IS NOT NULL`);

  let managersLinked = 0;
  for (const link of managerLinks) {
    const result = await modulesPool.query(
      `UPDATE users AS u
       SET manager_id = mgr.id
       FROM users AS mgr
       WHERE u.legacy_user_id = $1
         AND mgr.legacy_user_id = $2`,
      [link.id, link.manager_id]
    );
    managersLinked += result.rowCount ?? 0;
  }

  console.log(
    `Done: ${inserted} inserted, ${updated} updated, ${skippedRole} skipped (unknown role).`
  );
  console.log(`Manager links updated: ${managersLinked}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await mainPool.end();
    await modulesPool.end();
  });
