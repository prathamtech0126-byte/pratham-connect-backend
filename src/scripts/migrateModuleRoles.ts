/**
 * Copy roles from main CRM (DATABASE_URL) into modules DB (DATABASE_URL_SECOND).
 *
 * Sources (main CRM):
 *   1. `roles` table — if it exists (optional; many envs only have users.role varchar)
 *   2. Distinct `users.role` varchar values
 *
 * Prerequisite: npm run db:push:modules
 *
 * Usage: npm run migrate:module-roles
 */
import "dotenv/config";
import { Pool } from "pg";

const mainPool = new Pool({ connectionString: process.env.DATABASE_URL });
const modulesPool = new Pool({ connectionString: process.env.DATABASE_URL_SECOND });

type LegacyRole = {
  id: number;
  name: string;
  description: string | null;
  created_at: Date | null;
};

async function assertModulesRolesTable(): Promise<void> {
  const { rows } = await modulesPool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'roles'
     ) AS exists`
  );
  if (!rows[0]?.exists) {
    throw new Error(
      'Table "roles" not found in modules DB. Run first: npm run db:push:modules'
    );
  }
}

async function loadLegacyRoles(): Promise<LegacyRole[]> {
  const { rows: hasTable } = await mainPool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'roles'
     ) AS exists`
  );
  if (!hasTable[0]?.exists) {
    console.log('Main CRM has no "roles" table — using users.role strings only.');
    return [];
  }

  const { rows } = await mainPool.query<LegacyRole>(
    `SELECT id, name, description, created_at FROM roles ORDER BY id`
  );
  return rows;
}

async function main() {
  await assertModulesRolesTable();

  const legacyRoles = await loadLegacyRoles();

  const { rows: roleStrings } = await mainPool.query<{ role: string }>(
    `SELECT DISTINCT role FROM users
     WHERE role IS NOT NULL AND TRIM(role) <> ''
     ORDER BY role`
  );

  const names = new Set<string>();
  for (const row of legacyRoles) names.add(row.name.trim());
  for (const row of roleStrings) names.add(row.role.trim());

  if (!names.size) {
    console.log("No roles found in main CRM.");
    return;
  }

  let inserted = 0;
  let updated = 0;

  for (const row of legacyRoles) {
    const result = await modulesPool.query(
      `INSERT INTO roles (legacy_role_id, name, description, level, permissions, is_active, created_at)
       VALUES ($1, $2, $3, 0, '{}'::jsonb, true, COALESCE($4, NOW()))
       ON CONFLICT (name) DO UPDATE SET
         legacy_role_id = COALESCE(EXCLUDED.legacy_role_id, roles.legacy_role_id),
         description = COALESCE(EXCLUDED.description, roles.description)
       RETURNING (xmax = 0) AS inserted`,
      [row.id, row.name.trim(), row.description, row.created_at]
    );
    if (result.rows[0]?.inserted) inserted++;
    else updated++;
  }

  for (const row of roleStrings) {
    const name = row.role.trim();
    const result = await modulesPool.query(
      `INSERT INTO roles (name, level, permissions, is_active)
       VALUES ($1, 0, '{}'::jsonb, true)
       ON CONFLICT (name) DO NOTHING
       RETURNING (xmax = 0) AS inserted`,
      [name]
    );
    if (result.rows[0]?.inserted) inserted++;
  }

  console.log(
    `Done: ${inserted} inserted, ${updated} updated (${names.size} unique role names).`
  );
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
