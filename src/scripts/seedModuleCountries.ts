/**
 * Seed countries into the modules DB (DATABASE_URL_SECOND).
 * Safe to re-run — upserts on iso_code.
 *
 * Prerequisite: npm run db:push:modules
 *
 * Usage: npm run seed:module-countries
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { dbSecond } from "../config/databaseConnectionSecond";
import { poolSecond } from "../config/databaseConnectionSecond";
import { countries } from "../modules/countries/schemas/countries.schema";

const MODULE_COUNTRIES = [
  { name: "Canada", isoCode: "CA" },
  { name: "Australia", isoCode: "AU" },
  { name: "USA", isoCode: "US" },
  { name: "UK", isoCode: "GB" },
  { name: "Finland", isoCode: "FI" },
  { name: "Germany", isoCode: "DE" },
  { name: "Japan", isoCode: "JP" },
  { name: "South Korea", isoCode: "KR" },
  { name: "China", isoCode: "CN" },
  { name: "Dubai", isoCode: "AE" },
] as const;

async function seedModuleCountries(): Promise<void> {
  console.log("Seeding countries into modules DB…\n");

  await dbSecond
    .insert(countries)
    .values(
      MODULE_COUNTRIES.map((c) => ({
        name: c.name,
        isoCode: c.isoCode,
        isActive: true,
      }))
    )
    .onConflictDoUpdate({
      target: countries.isoCode,
      set: {
        name: sql`excluded.name`,
        isActive: true,
        updatedAt: sql`now()`,
      },
    });

  const rows = await dbSecond
    .select({
      name: countries.name,
      isoCode: countries.isoCode,
    })
    .from(countries)
    .orderBy(countries.name);

  console.log(`Done — ${rows.length} countries in modules DB:\n`);
  for (const row of rows) {
    console.log(`  ${row.name} (${row.isoCode})`);
  }
}

seedModuleCountries()
  .catch((err) => {
    console.error("Failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await poolSecond.end();
  });
