/**
 * Best-effort sync from main CRM → modules DB.
 * Failures are logged; main CRM requests are never rolled back (shadow mode).
 */
import { pool } from "../../config/databaseConnection";
import {
  getPoolSecond,
  isModulesDbConfigured,
} from "../../config/databaseConnectionSecond";
import {
  buildNextClientCode,
  enrollmentYearFromDate,
  getOrgPrefix,
  resolveBranchCode,
} from "../clients/utils/clientCode";
import { ensureClientJourneyOnEnrollment } from "../journey/services/clientJourney.service";
import { emitClientEnrolledEvent, ensureClientEnrolledTimelineEvent } from "../journey/services/journeyEvent.service";
import { getVisaCaseBySaleId } from "../visaCase/models/visaCase.model";
import { ensureVisaCaseForSale } from "../visaCase/services/visaCase.service";
import {
  checkVisaCaseEligibility,
  listCandidateSaleTypeIdsForVisaSync,
} from "../visaCase/services/visaCaseEligibility.service";
import { invalidateModulesCachesOnWrite } from "../cache/invalidate";

export type SyncEligibleVisaCasesResult = {
  candidateSaleTypes: number;
  visaCasesCreated: number;
};

export type SyncClientFromMainResult = {
  clientUuid: string;
  isNew: boolean;
};

export type SyncClientAfterSaveResult = {
  modulesClientId: string | null;
  isNewInModules: boolean;
  visaCases: SyncEligibleVisaCasesResult;
  syncError?: string;
};

const PLACEHOLDER_DOB = "1990-01-01";
const PLACEHOLDER_PASSPORT_EXPIRY = "2099-12-31";
const DEFAULT_ISSUING_COUNTRY = "India";

const logSyncError = (label: string, error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[modulesSync] ${label}:`, message);
};

/** Shadow sync is on when DATABASE_URL_SECOND is set (opt-out via MODULES_SYNC_ENABLED=false). */
export const isModulesSyncEnabled = (): boolean => {
  if (!isModulesDbConfigured()) return false;
  if (process.env.MODULES_SYNC_ENABLED === "false") return false;
  return true;
};

async function ensureDefaultCountryId(): Promise<string> {
  const result = await getPoolSecond().query<{ id: string }>(
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

/** One passport per person in modules DB — mirrors main CRM passport_details. */
async function upsertPersonPassport(
  personId: string,
  countryId: string,
  passportNumber: string,
  fallbackCreatedAt: Date
): Promise<void> {
  const pool = getPoolSecond();
  const pType = passportType(passportNumber);

  await pool.query(`DELETE FROM passports WHERE person_id = $1::uuid`, [personId]);

  await pool.query(
    `INSERT INTO passports (
       person_id, country_id, passport_number, passport_type,
       passport_expiry_date, passport_issuing_country, created_at, updated_at
     ) VALUES ($1::uuid, $2::uuid, $3, $4::passport_type, $5::date, $6, $7, NOW())`,
    [
      personId,
      countryId,
      passportNumber,
      pType,
      PLACEHOLDER_PASSPORT_EXPIRY,
      DEFAULT_ISSUING_COUNTRY,
      fallbackCreatedAt,
    ]
  );
}

async function nextClientCodeForBranch(
  branchCode: string,
  enrollmentDate: string
): Promise<string> {
  const year = enrollmentYearFromDate(enrollmentDate);
  const pattern = `${getOrgPrefix()}-${branchCode.toUpperCase()}-CLI-${year}-%`;

  const { rows } = await getPoolSecond().query<{ max_seq: number | null }>(
    `SELECT MAX(CAST(split_part(client_code, '-', 5) AS integer)) AS max_seq
     FROM clients
     WHERE client_code LIKE $1`,
    [pattern]
  );

  const nextSequence = (rows[0]?.max_seq ?? 0) + 1;
  return buildNextClientCode(branchCode, enrollmentDate, nextSequence);
}

const titleCase = (value: string): string =>
  value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();

const parseCountryName = (
  saleTypeName: string,
  countryNames: string[]
): string | null => {
  const normalized = saleTypeName.trim();
  const sorted = [...countryNames].sort((a, b) => b.length - a.length);

  for (const country of sorted) {
    const prefix = `${country} `;
    if (normalized.toLowerCase().startsWith(prefix.toLowerCase())) {
      return country;
    }
    if (normalized.toLowerCase() === country.toLowerCase()) {
      return country;
    }
  }

  return null;
};

/** Upsert one visa category from main CRM into modules DB. */
async function syncVisaCategoryFromMain(
  legacyCategoryId: number
): Promise<string | null> {
  const { rows } = await pool.query<{
    id: number;
    name: string;
    description: string | null;
    created_at: Date | null;
  }>(
    `SELECT id, name, description, created_at
     FROM sale_type_category
     WHERE id = $1
     LIMIT 1`,
    [legacyCategoryId]
  );

  const row = rows[0];
  if (!row) return null;

  const name = titleCase(row.name.trim());
  const slug = row.name.trim().toLowerCase().replace(/\s+/g, "-");

  const result = await getPoolSecond().query<{ id: string }>(
    `INSERT INTO visa_categories
       (name, slug, description, legacy_category_id, display_order, created_at)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, NOW()))
     ON CONFLICT (legacy_category_id) DO UPDATE SET
       name = EXCLUDED.name,
       slug = EXCLUDED.slug,
       description = EXCLUDED.description,
       display_order = EXCLUDED.display_order,
       updated_at = NOW()
     RETURNING id`,
    [name, slug, row.description, row.id, row.id, row.created_at]
  );

  return result.rows[0]?.id ?? null;
}

/** Upsert one sale type from main CRM into modules DB (on demand). */
export async function syncSaleTypeFromMain(
  legacySaleTypeId: number
): Promise<string | null> {
  if (!isModulesSyncEnabled()) return null;

  try {
    const existing = await getPoolSecond().query<{ id: string }>(
      `SELECT id FROM sale_type WHERE legacy_sale_type_id = $1 LIMIT 1`,
      [legacySaleTypeId]
    );
    if (existing.rows[0]?.id) {
      return existing.rows[0].id;
    }

    const { rows } = await pool.query<{
      id: number;
      sale_type: string;
      category_id: number | null;
      is_core_product: boolean | null;
      created_at: Date | null;
    }>(
      `SELECT id, sale_type, category_id, is_core_product, created_at
       FROM sale_type
       WHERE id = $1
       LIMIT 1`,
      [legacySaleTypeId]
    );

    const row = rows[0];
    if (!row) return null;

    const visaCategoryId = row.category_id
      ? await syncVisaCategoryFromMain(row.category_id)
      : null;

    const { rows: countryIdRows } = await getPoolSecond().query<{
      id: string;
      name: string;
    }>(`SELECT id, name FROM countries WHERE is_active = true ORDER BY LENGTH(name) DESC`);
    const countryMap = new Map<string, string>();
    for (const countryRow of countryIdRows) {
      countryMap.set(countryRow.name.trim().toLowerCase(), countryRow.id);
    }

    const countryName = parseCountryName(
      row.sale_type,
      countryIdRows.map((countryRow) => countryRow.name)
    );
    const countryId = countryName
      ? (countryMap.get(countryName.toLowerCase()) ?? null)
      : null;

    const result = await getPoolSecond().query<{ id: string }>(
      `INSERT INTO sale_type
         (legacy_sale_type_id, sale_type, country_id, visa_category_id, is_core_product, created_at)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, NOW()))
       ON CONFLICT (legacy_sale_type_id) DO UPDATE SET
         sale_type = EXCLUDED.sale_type,
         country_id = EXCLUDED.country_id,
         visa_category_id = EXCLUDED.visa_category_id,
         is_core_product = EXCLUDED.is_core_product
       RETURNING id`,
      [
        row.id,
        row.sale_type,
        countryId,
        visaCategoryId,
        row.is_core_product ?? false,
        row.created_at,
      ]
    );

    return result.rows[0]?.id ?? null;
  } catch (error) {
    logSyncError(`syncSaleTypeFromMain(${legacySaleTypeId})`, error);
    return null;
  }
}

export async function syncClientFromMain(
  legacyClientId: number
): Promise<SyncClientFromMainResult | null> {
  if (!isModulesSyncEnabled()) return null;

  try {
    const { rows } = await pool.query<{
      id: number;
      counsellor_id: number;
      fullname: string;
      date: string;
      passport_details: string;
      transfered_to_counsellor_id: number | null;
      transfer_status: boolean | null;
      archived: boolean | null;
      created_at: Date | null;
    }>(
      `SELECT id, counsellor_id, fullname, date, passport_details,
              transfered_to_counsellor_id, transfer_status, archived, created_at
       FROM client_information
       WHERE id = $1
       LIMIT 1`,
      [legacyClientId]
    );

    const row = rows[0];
    if (!row) return null;

    const countryId = await ensureDefaultCountryId();
    const branchCode = resolveBranchCode(row.counsellor_id);
    const passportNumber = row.passport_details.trim();
    const personStatus = row.archived ? "inactive" : "active";

    const existing = await getPoolSecond().query<{
      id: string;
      person_id: string;
      client_code: string;
    }>(
      `SELECT id, person_id, client_code FROM clients WHERE legacy_client_id = $1 LIMIT 1`,
      [legacyClientId]
    );

    let personId = existing.rows[0]?.person_id ?? "";
    let clientUuid = existing.rows[0]?.id ?? "";
    const isNew = !existing.rows[0];

    if (existing.rows[0]) {
      await getPoolSecond().query(
        `UPDATE persons SET
           legacy_client_id = $2,
           full_name = $3,
           date_of_birth = $4::date,
           nationality_id = $5::uuid,
           status = $6::status,
           updated_at = NOW()
         WHERE id = $1::uuid`,
        [personId, legacyClientId, row.fullname, PLACEHOLDER_DOB, countryId, personStatus]
      );
    } else {
      const personResult = await getPoolSecond().query<{ id: string }>(
        `INSERT INTO persons (
           legacy_client_id, full_name, date_of_birth, nationality_id, status, created_at, updated_at
         ) VALUES ($1, $2, $3::date, $4::uuid, $5::status, $6, NOW())
         RETURNING id`,
        [
          legacyClientId,
          row.fullname,
          PLACEHOLDER_DOB,
          countryId,
          personStatus,
          row.created_at ?? new Date(),
        ]
      );
      personId = personResult.rows[0].id;
    }

    await upsertPersonPassport(
      personId,
      countryId,
      passportNumber,
      row.created_at ?? new Date()
    );

    const transferedId = row.transfer_status
      ? row.transfered_to_counsellor_id
      : null;

    if (existing.rows[0]) {
      await getPoolSecond().query(
        `UPDATE clients SET
           person_id = $2::uuid,
           branch_code = $3,
           enrollment_date = $4::date,
           transfer_status = $5,
           transfered_id = $6,
           updated_at = NOW()
         WHERE id = $1::uuid`,
        [
          clientUuid,
          personId,
          branchCode,
          row.date,
          row.transfer_status ?? false,
          transferedId,
        ]
      );
    } else {
      const clientCode = await nextClientCodeForBranch(branchCode, row.date);
      const clientResult = await getPoolSecond().query<{ id: string }>(
        `INSERT INTO clients (
           legacy_client_id, person_id, branch_code, client_code,
           enrollment_date, transfer_status, transfered_id, created_at, updated_at
         ) VALUES ($1, $2::uuid, $3, $4, $5::date, $6, $7, $8, NOW())
         RETURNING id`,
        [
          legacyClientId,
          personId,
          branchCode,
          clientCode,
          row.date,
          row.transfer_status ?? false,
          transferedId,
          row.created_at ?? new Date(),
        ]
      );
      clientUuid = clientResult.rows[0].id;

      await emitClientEnrolledEvent({
        clientId: clientUuid,
        actorId: row.counsellor_id,
        legacyClientId,
        enrolledAt: row.date ?? row.created_at ?? null,
        enrollmentDate: row.date,
        createdAt: row.created_at ?? null,
      });
    }

    await ensureClientEnrolledTimelineEvent({
      clientId: clientUuid,
      actorId: row.counsellor_id,
      legacyClientId,
      enrolledAt: row.date ?? row.created_at ?? null,
      enrollmentDate: row.date,
      createdAt: row.created_at ?? null,
    });

    await ensureClientJourneyOnEnrollment({
      clientId: clientUuid,
      stageUpdatedBy: row.counsellor_id,
    });

    if (row.transfer_status && row.transfered_to_counsellor_id && clientUuid) {
      await getPoolSecond().query(
        `INSERT INTO client_transfer_modules (
           client_id, from_user_id, to_user_id, created_at, updated_at
         )
         SELECT $1::uuid, $2::bigint, $3::bigint, NOW(), NOW()
         WHERE NOT EXISTS (
           SELECT 1 FROM client_transfer_modules
            WHERE client_id = $1::uuid
              AND from_user_id = $2::bigint
              AND to_user_id = $3::bigint
         )`,
        [clientUuid, row.counsellor_id, row.transfered_to_counsellor_id]
      );
    }

    console.log(
      `[modulesSync] syncClientFromMain(${legacyClientId}): person=${personId}, modulesClient=${clientUuid}, isNew=${isNew}`
    );

    await invalidateModulesCachesOnWrite({
      clientId: clientUuid,
      reason: isNew ? "modules-sync:client-created" : "modules-sync:client-updated",
    });

    return { clientUuid, isNew };
  } catch (error) {
    logSyncError(`syncClientFromMain(${legacyClientId})`, error);
    return null;
  }
}

/**
 * Create sale + visa case in modules DB (no eligibility gate).
 * Returns true when a new visa_cases row was created.
 */
export async function ensureSaleAndVisaCase(input: {
  legacyClientId: number;
  legacySaleTypeId: number;
  counsellorId: number;
}): Promise<boolean> {
  if (!isModulesSyncEnabled()) return false;

  try {
    const clientUuid =
      (await syncClientFromMain(input.legacyClientId))?.clientUuid ??
      (
        await getPoolSecond().query<{ id: string }>(
          `SELECT id FROM clients WHERE legacy_client_id = $1 LIMIT 1`,
          [input.legacyClientId]
        )
      ).rows[0]?.id;

    if (!clientUuid) return false;

    const saleTypeUuid = await syncSaleTypeFromMain(input.legacySaleTypeId);
    if (!saleTypeUuid) {
      logSyncError(
        `ensureSaleAndVisaCase missing sale type ${input.legacySaleTypeId}`,
        new Error("sale type not found in main CRM or modules DB")
      );
      return false;
    }

    const enrollmentResult = await getPoolSecond().query<{ enrollment_date: string }>(
      `SELECT enrollment_date FROM clients WHERE id = $1::uuid LIMIT 1`,
      [clientUuid]
    );
    const enrollmentDate = enrollmentResult.rows[0]?.enrollment_date;
    if (!enrollmentDate) return false;

    const clientCodeResult = await getPoolSecond().query<{ client_code: string }>(
      `SELECT client_code FROM clients WHERE id = $1::uuid LIMIT 1`,
      [clientUuid]
    );
    const clientCode = clientCodeResult.rows[0]?.client_code ?? "CLI";
    const saleIdString = `${clientCode}-ST${input.legacySaleTypeId}`;

    const saleResult = await getPoolSecond().query<{ id: string }>(
      `INSERT INTO sales (sale_id, client_id, sale_type_id, sale_date, created_at)
       VALUES ($1, $2::uuid, $3::uuid, $4::date, NOW())
       ON CONFLICT (client_id, sale_type_id) DO UPDATE SET sale_date = EXCLUDED.sale_date
       RETURNING id`,
      [saleIdString, clientUuid, saleTypeUuid, enrollmentDate]
    );

    const saleUuid = saleResult.rows[0]?.id;
    if (!saleUuid) return false;

    const existingVisaCase = await getVisaCaseBySaleId(saleUuid);
    await ensureVisaCaseForSale({
      clientId: clientUuid,
      saleId: saleUuid,
      userId: input.counsellorId,
    });

    return existingVisaCase == null;
  } catch (error) {
    logSyncError("ensureSaleAndVisaCase", error);
    return false;
  }
}

/**
 * Sync visa case when the client is enrolled and linked to the sale type
 * (payment or student application). No payment-stage checks for visitor/spouse.
 */
export async function syncVisaCaseIfEligible(input: {
  legacyClientId: number;
  legacySaleTypeId: number;
  counsellorId: number;
}): Promise<boolean> {
  if (!isModulesSyncEnabled()) return false;

  try {
    const eligibility = await checkVisaCaseEligibility(
      input.legacyClientId,
      input.legacySaleTypeId
    );
    if (!eligibility.eligible) return false;

    return ensureSaleAndVisaCase(input);
  } catch (error) {
    logSyncError("syncVisaCaseIfEligible", error);
    return false;
  }
}

/** Re-evaluate all visitor/spouse/student sale types for an enrolled client. */
export async function syncEligibleVisaCasesForClient(input: {
  legacyClientId: number;
  counsellorId: number;
}): Promise<SyncEligibleVisaCasesResult> {
  if (!isModulesSyncEnabled()) {
    return { candidateSaleTypes: 0, visaCasesCreated: 0 };
  }

  try {
    const saleTypeIds = await listCandidateSaleTypeIdsForVisaSync(
      input.legacyClientId
    );
    let visaCasesCreated = 0;

    for (const legacySaleTypeId of saleTypeIds) {
      const created = await syncVisaCaseIfEligible({
        legacyClientId: input.legacyClientId,
        legacySaleTypeId,
        counsellorId: input.counsellorId,
      });
      if (created) visaCasesCreated += 1;
    }

    return {
      candidateSaleTypes: saleTypeIds.length,
      visaCasesCreated,
    };
  } catch (error) {
    logSyncError("syncEligibleVisaCasesForClient", error);
    return { candidateSaleTypes: 0, visaCasesCreated: 0 };
  }
}

/**
 * Sync main-CRM client → modules DB (person, client, passport, journey)
 * and evaluate visa-case eligibility. Awaited on client create/update so both
 * databases are in sync before the API responds.
 */
export async function syncClientAfterMainSave(input: {
  legacyClientId: number;
  counsellorId: number;
}): Promise<SyncClientAfterSaveResult> {
  const emptyVisaCases = { candidateSaleTypes: 0, visaCasesCreated: 0 };

  if (!isModulesSyncEnabled()) {
    return {
      modulesClientId: null,
      isNewInModules: false,
      visaCases: emptyVisaCases,
    };
  }

  try {
    const syncResult = await syncClientFromMain(input.legacyClientId);
    let visaCases = emptyVisaCases;

    if (
      syncResult &&
      Number.isFinite(input.counsellorId) &&
      input.counsellorId > 0
    ) {
      visaCases = await syncEligibleVisaCasesForClient({
        legacyClientId: input.legacyClientId,
        counsellorId: input.counsellorId,
      });
    }

    return {
      modulesClientId: syncResult?.clientUuid ?? null,
      isNewInModules: syncResult?.isNew ?? false,
      visaCases,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logSyncError("syncClientAfterMainSave", error);
    return {
      modulesClientId: null,
      isNewInModules: false,
      visaCases: emptyVisaCases,
      syncError: message,
    };
  }
}

/** Fire-and-forget wrapper used from non-critical background paths. */
export const runModulesSync = (task: () => Promise<unknown>) => {
  if (!isModulesSyncEnabled()) return;
  void task().catch((error) => logSyncError("background task", error));
};
