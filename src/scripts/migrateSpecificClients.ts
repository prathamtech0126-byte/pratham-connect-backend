/**
 * Targeted migration: inserts only specific client IDs from the old DB into the new DB.
 * Does NOT touch any existing records in the new DB.
 *
 * Usage:
 *   ts-node src/scripts/migrateSpecificClients.ts
 *
 * To change the client IDs, edit TARGET_CLIENT_IDS below.
 */

import "dotenv/config";
import { Pool } from "pg";
import {
  enrollmentYearFromDate,
  formatClientCode,
  getOrgPrefix,
  resolveBranchCode,
} from "../modules/clients/utils/clientCode";

const mainPool = new Pool({ connectionString: process.env.DATABASE_URL });
const modulesPool = new Pool({ connectionString: process.env.DATABASE_URL_SECOND });

const TARGET_CLIENT_IDS = [1057, 1058, 1061, 1063, 1065, 1066, 1067];

const PLACEHOLDER_DOB = "1990-01-01";
const PLACEHOLDER_PASSPORT_EXPIRY = "2099-12-31";
const DEFAULT_ISSUING_COUNTRY = "India";

type ClientRow = {
  id: number;
  counsellor_id: number;
  fullname: string;
  date: string;
  passport_details: string;
  lead_type_id: number;
  transfered_to_counsellor_id: number | null;
  transfer_status: boolean | null;
  archived: boolean | null;
  created_at: Date | null;
};

async function ensureDefaultCountry(): Promise<string> {
  const result = await modulesPool.query<{ id: string }>(
    `INSERT INTO countries (name, iso_code, is_active)
     VALUES ($1, $2, true)
     ON CONFLICT (iso_code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [DEFAULT_ISSUING_COUNTRY, "IN"]
  );
  return result.rows[0].id;
}

function passportType(passportDetails: string): "passport" | "other" {
  const v = passportDetails.trim();
  if (!v || v.startsWith("LEAD-")) return "other";
  return "passport";
}

async function resolveLeadId(passportDetails: string): Promise<number | null> {
  const byPassport = await mainPool.query<{ lead_id: number }>(
    `SELECT lead_id FROM lead_student_profiles
     WHERE trim(passport_number) = trim($1)
     LIMIT 1`,
    [passportDetails]
  );
  if (byPassport.rows[0]?.lead_id) return byPassport.rows[0].lead_id;

  const leadMatch = passportDetails.match(/^LEAD-(\d+)-/);
  if (leadMatch) return Number(leadMatch[1]);

  return null;
}

/**
 * Finds the current max sequence number for a given branch+year in the new DB,
 * so we can continue from the next number without disturbing existing codes.
 */
async function getNextSequence(branchCode: string, year: number): Promise<number> {
  const orgPrefix = getOrgPrefix();
  const prefix = `${orgPrefix}-${branchCode}-CLI-${year}-`;

  const { rows } = await modulesPool.query<{ max_seq: string | null }>(
    `SELECT MAX(
       CAST(
         REGEXP_REPLACE(client_code, $1, '') AS integer
       )
     )::text AS max_seq
     FROM clients
     WHERE client_code LIKE $2`,
    [`^${prefix}`, `${prefix}%`]
  );

  return (Number(rows[0]?.max_seq ?? 0)) + 1;
}

async function main() {
  console.log(`\nTargeted client migration for IDs: ${TARGET_CLIENT_IDS.join(", ")}\n`);

  // 1. Verify none of these clients already exist in the new DB
  const { rows: alreadyExisting } = await modulesPool.query<{ legacy_client_id: number }>(
    `SELECT legacy_client_id FROM clients WHERE legacy_client_id = ANY($1::bigint[])`,
    [TARGET_CLIENT_IDS]
  );
  if (alreadyExisting.length > 0) {
    const existingIds = alreadyExisting.map((r) => r.legacy_client_id);
    console.log(`⚠️  These IDs already exist in the new DB and will be skipped: ${existingIds.join(", ")}`);
    const toProcess = TARGET_CLIENT_IDS.filter((id) => !existingIds.includes(id));
    if (!toProcess.length) {
      console.log("Nothing to migrate — all target clients already exist.");
      return;
    }
  }

  // 2. Fetch the target clients from old DB
  const { rows: clients } = await mainPool.query<ClientRow>(
    `SELECT id, counsellor_id, fullname, date, passport_details, lead_type_id,
            transfered_to_counsellor_id, transfer_status, archived, created_at
     FROM client_information
     WHERE id = ANY($1::int[])
     ORDER BY id`,
    [TARGET_CLIENT_IDS]
  );

  if (!clients.length) {
    console.log("No matching clients found in old DB.");
    return;
  }

  console.log(`Found ${clients.length} client(s) to migrate:\n`);
  for (const c of clients) {
    console.log(`  [${c.id}] ${c.fullname} — enrolled ${c.date}`);
  }
  console.log();

  const countryId = await ensureDefaultCountry();
  const orgPrefix = getOrgPrefix();

  // Track sequence counters per branch:year so we don't collide within this batch
  const sequenceCounters = new Map<string, number>();

  let personsCreated = 0;
  let passportsCreated = 0;
  let passportsUpdated = 0;
  let clientsCreated = 0;

  for (const row of clients) {
    // Skip if already exists (from the check above)
    const { rows: exists } = await modulesPool.query<{ id: string }>(
      `SELECT id FROM clients WHERE legacy_client_id = $1 LIMIT 1`,
      [row.id]
    );
    if (exists[0]) {
      console.log(`  [${row.id}] ${row.fullname} — already exists, skipping.`);
      continue;
    }

    const branchCode = resolveBranchCode(row.counsellor_id);
    const year = enrollmentYearFromDate(row.date);
    const seqKey = `${branchCode}:${year}`;

    // Get the next sequence for this branch+year (query DB once, then track in-memory)
    if (!sequenceCounters.has(seqKey)) {
      const nextSeq = await getNextSequence(branchCode, year);
      sequenceCounters.set(seqKey, nextSeq);
    }
    const sequence = sequenceCounters.get(seqKey)!;
    sequenceCounters.set(seqKey, sequence + 1);

    const clientCode = formatClientCode({ orgPrefix, branchCode, enrollmentYear: year, sequence });
    const passportNumber = row.passport_details.trim();
    const leadId = await resolveLeadId(passportNumber);
    const personStatus = row.archived ? "inactive" : "active";

    // Insert person
    const personResult = await modulesPool.query<{ id: string }>(
      `INSERT INTO persons (
         legacy_client_id, full_name, date_of_birth, nationality_id, status, created_at, updated_at
       ) VALUES ($1, $2, $3::date, $4::uuid, $5::status, $6, NOW())
       RETURNING id`,
      [row.id, row.fullname, PLACEHOLDER_DOB, countryId, personStatus, row.created_at ?? new Date()]
    );
    const personId = personResult.rows[0].id;
    personsCreated++;

    // Upsert passport
    const passportResult = await modulesPool.query<{ inserted: boolean }>(
      `INSERT INTO passports (
         person_id, country_id, passport_number, passport_type,
         passport_expiry_date, passport_issuing_country, created_at, updated_at
       ) VALUES ($1::uuid, $2::uuid, $3, $4::passport_type, $5::date, $6, $7, NOW())
       ON CONFLICT (passport_number) DO UPDATE SET
         person_id = EXCLUDED.person_id,
         updated_at = NOW()
       RETURNING (xmax = 0) AS inserted`,
      [
        personId, countryId, passportNumber,
        passportType(passportNumber), PLACEHOLDER_PASSPORT_EXPIRY,
        DEFAULT_ISSUING_COUNTRY, row.created_at ?? new Date(),
      ]
    );
    if (passportResult.rows[0]?.inserted) passportsCreated++;
    else passportsUpdated++;

    // Insert client
    const transferedId = row.transfer_status ? row.transfered_to_counsellor_id : null;
    const clientResult = await modulesPool.query<{ id: string }>(
      `INSERT INTO clients (
         legacy_client_id, person_id, lead_id, branch_code, client_code,
         enrollment_date, transfer_status, transfered_id, created_at, updated_at
       ) VALUES ($1, $2::uuid, $3, $4, $5, $6::date, $7, $8, $9, NOW())
       RETURNING id`,
      [
        row.id, personId, leadId, branchCode, clientCode,
        row.date, row.transfer_status ?? false, transferedId,
        row.created_at ?? new Date(),
      ]
    );
    const clientUuid = clientResult.rows[0].id;
    clientsCreated++;

    console.log(`  ✅ [${row.id}] ${row.fullname} → ${clientCode} (uuid: ${clientUuid})`);
  }

  console.log(`\n=== Done ===`);
  console.log(`Persons created  : ${personsCreated}`);
  console.log(`Passports created: ${passportsCreated}`);
  console.log(`Passports updated: ${passportsUpdated}`);
  console.log(`Clients created  : ${clientsCreated}`);
  console.log(`\nNext steps: run migrate:module-sales and migrate:module-visa-cases`);
  console.log(`to sync their payments and visa cases to the new DB.`);
}

main()
  .catch((err) => {
    console.error("Migration error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await mainPool.end();
    await modulesPool.end();
  });
