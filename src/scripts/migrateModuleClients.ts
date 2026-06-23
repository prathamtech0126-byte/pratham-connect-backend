/**
 * Migrate client_information + client_payment (main CRM)
 * → persons, passports, clients, client_transfer_modules, client_sale_modules (modules DB).
 *
 * Client code format: PRA-VAD-CLI-2026-000001
 *   {ORG}-{BRANCH}-CLI-{enrollment_year}-{sequence}
 *
 * Usage: npm run migrate:module-clients
 *
 * Env:
 *   CLIENT_CODE_ORG_PREFIX=PRA   (default)
 *   DEFAULT_BRANCH_CODE=VAD      (default)
 *   CLIENT_BRANCH_MAP={"34":"VAD","22":"AHM"}  (optional counsellor → branch)
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

function buildClientCodeMap(rows: ClientRow[]): Map<number, { code: string; branch: string }> {
  const orgPrefix = getOrgPrefix();
  const counters = new Map<string, number>();
  const sorted = [...rows].sort((a, b) => {
    const branchA = resolveBranchCode(a.counsellor_id);
    const branchB = resolveBranchCode(b.counsellor_id);
    const yearA = enrollmentYearFromDate(a.date);
    const yearB = enrollmentYearFromDate(b.date);
    if (branchA !== branchB) return branchA.localeCompare(branchB);
    if (yearA !== yearB) return yearA - yearB;
    const dateA = new Date(a.date).getTime();
    const dateB = new Date(b.date).getTime();
    if (dateA !== dateB) return dateA - dateB;
    return a.id - b.id;
  });

  const result = new Map<number, { code: string; branch: string }>();
  for (const row of sorted) {
    const branchCode = resolveBranchCode(row.counsellor_id);
    const year = enrollmentYearFromDate(row.date);
    const key = `${branchCode}:${year}`;
    const next = (counters.get(key) ?? 0) + 1;
    counters.set(key, next);
    result.set(row.id, {
      branch: branchCode,
      code: formatClientCode({
        orgPrefix,
        branchCode,
        enrollmentYear: year,
        sequence: next,
      }),
    });
  }
  return result;
}

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

async function resolveLeadId(
  clientId: number,
  passportDetails: string
): Promise<number | null> {
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

async function main() {
  const countryId = await ensureDefaultCountry();

  const { rows: clients } = await mainPool.query<ClientRow>(
    `SELECT id, counsellor_id, fullname, date, passport_details, lead_type_id,
            transfered_to_counsellor_id, transfer_status, archived, created_at
     FROM client_information
     ORDER BY id`
  );

  if (!clients.length) {
    console.log("No client_information rows in main CRM.");
    return;
  }

  const clientCodeMap = buildClientCodeMap(clients);

  let personsCreated = 0;
  let personsUpdated = 0;
  let passportsCreated = 0;
  let passportsUpdated = 0;
  let clientsCreated = 0;
  let clientsUpdated = 0;
  let transfersCreated = 0;
  for (const row of clients) {
    const legacyId = row.id;
    const { code: clientCode, branch: branchCode } = clientCodeMap.get(legacyId)!;
    const passportNumber = row.passport_details.trim();
    const leadId = await resolveLeadId(legacyId, passportNumber);
    const personStatus = row.archived ? "inactive" : "active";

    const existingClient = await modulesPool.query<{
      id: string;
      person_id: string;
    }>(
      `SELECT id, person_id FROM clients WHERE legacy_client_id = $1 LIMIT 1`,
      [legacyId]
    );

    let personId = "";
    let clientUuid = "";

    if (existingClient.rows[0]) {
      personId = existingClient.rows[0].person_id;
      clientUuid = existingClient.rows[0].id;

      await modulesPool.query(
        `UPDATE persons SET
           legacy_client_id = $2,
           full_name = $3,
           date_of_birth = $4::date,
           nationality_id = $5::uuid,
           status = $6::status,
           updated_at = NOW()
         WHERE id = $1::uuid`,
        [personId, legacyId, row.fullname, PLACEHOLDER_DOB, countryId, personStatus]
      );
      personsUpdated++;
    } else {
      const personResult = await modulesPool.query<{ id: string }>(
        `INSERT INTO persons (
           legacy_client_id, full_name, date_of_birth, nationality_id, status, created_at, updated_at
         ) VALUES ($1, $2, $3::date, $4::uuid, $5::status, $6, NOW())
         RETURNING id`,
        [
          legacyId,
          row.fullname,
          PLACEHOLDER_DOB,
          countryId,
          personStatus,
          row.created_at ?? new Date(),
        ]
      );
      personId = personResult.rows[0].id;
      personsCreated++;
    }

    const passportResult = await modulesPool.query<{ inserted: boolean }>(
      `INSERT INTO passports (
         person_id, country_id, passport_number, passport_type,
         passport_expiry_date, passport_issuing_country, created_at, updated_at
       ) VALUES ($1::uuid, $2::uuid, $3, $4::passport_type, $5::date, $6, $7, NOW())
       ON CONFLICT (passport_number) DO UPDATE SET
         person_id = EXCLUDED.person_id,
         country_id = EXCLUDED.country_id,
         passport_type = EXCLUDED.passport_type,
         passport_expiry_date = EXCLUDED.passport_expiry_date,
         passport_issuing_country = EXCLUDED.passport_issuing_country,
         updated_at = NOW()
       RETURNING (xmax = 0) AS inserted`,
      [
        personId,
        countryId,
        passportNumber,
        passportType(passportNumber),
        PLACEHOLDER_PASSPORT_EXPIRY,
        DEFAULT_ISSUING_COUNTRY,
        row.created_at ?? new Date(),
      ]
    );
    if (passportResult.rows[0]?.inserted) passportsCreated++;
    else passportsUpdated++;

    const transferedId = row.transfer_status
      ? row.transfered_to_counsellor_id
      : null;

    if (existingClient.rows[0]) {
      await modulesPool.query(
        `UPDATE clients SET
           person_id = $2::uuid,
           lead_id = $3,
           branch_code = $4,
           client_code = $5,
           enrollment_date = $6::date,
           transfer_status = $7,
           transfered_id = $8,
           updated_at = NOW()
         WHERE id = $1::uuid`,
        [
          clientUuid,
          personId,
          leadId,
          branchCode,
          clientCode,
          row.date,
          row.transfer_status ?? false,
          transferedId,
        ]
      );
      clientsUpdated++;
    } else {
      const clientResult = await modulesPool.query<{ id: string }>(
        `INSERT INTO clients (
           legacy_client_id, person_id, lead_id, branch_code, client_code,
           enrollment_date, transfer_status, transfered_id, created_at, updated_at
         ) VALUES ($1, $2::uuid, $3, $4, $5, $6::date, $7, $8, $9, NOW())
         RETURNING id`,
        [
          legacyId,
          personId,
          leadId,
          branchCode,
          clientCode,
          row.date,
          row.transfer_status ?? false,
          transferedId,
          row.created_at ?? new Date(),
        ]
      );
      clientUuid = clientResult.rows[0].id;
      clientsCreated++;
    }

    if (row.transfer_status && row.transfered_to_counsellor_id) {
      const transferResult = await modulesPool.query(
        `INSERT INTO client_transfer_modules (
           client_id, from_user_id, to_user_id, created_at, updated_at
         )
         SELECT $1::uuid, $2::bigint, $3::bigint, $4, NOW()
         WHERE NOT EXISTS (
           SELECT 1 FROM client_transfer_modules
           WHERE client_id = $1::uuid
             AND from_user_id = $2::bigint
             AND to_user_id = $3::bigint
         )
         RETURNING id`,
        [
          clientUuid,
          row.counsellor_id,
          row.transfered_to_counsellor_id,
          row.created_at ?? new Date(),
        ]
      );
      if (transferResult.rowCount) transfersCreated++;
    }

    // Client sale type → modules `sales` table (one per client).
    // Run: npm run migrate:module-sales
  }

  console.log(`Persons: ${personsCreated} created, ${personsUpdated} updated.`);
  console.log(
    `Passports: ${passportsCreated} created, ${passportsUpdated} updated.`
  );
  console.log(`Clients: ${clientsCreated} created, ${clientsUpdated} updated.`);
  console.log(`Transfers: ${transfersCreated} new rows.`);
  console.log(`Total source clients: ${clients.length}.`);
  console.log(`Run npm run migrate:module-sales to create sales from client_payment.`);
  console.log(
    `Client code format: ${getOrgPrefix()}-{BRANCH}-CLI-{enrollment_year}-{sequence}`
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
