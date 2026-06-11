/**
 * Migrate main CRM product entity tables → modules payment entity tables.
 *
 * Source (DATABASE_URL):
 *   air_ticket, credit_card, forex_card, forex_fees, ielts, insurance,
 *   loan, sim_card, tution_fees, new_sell
 *
 * Target (DATABASE_URL_SECOND):
 *   Same table names under src/modules/payments/schemas/entities/
 *
 * client_id is resolved via client_product_payment:
 *   cpp.entity_type + cpp.entity_id → cpp.client_id (legacy bigint)
 *   → modules clients.id (uuid) via legacy_client_id
 *
 * Idempotent: upsert on legacy_entity_id (= old entity table primary key).
 *
 * Prerequisites:
 *   npm run db:push:modules
 *   npm run migrate:module-clients
 *
 * Usage: npm run migrate:module-product-entities
 */
import "dotenv/config";
import { Pool } from "pg";

const mainPool = new Pool({ connectionString: process.env.DATABASE_URL });
const modulesPool = new Pool({
  connectionString: process.env.DATABASE_URL_SECOND,
});

type EntityRow = {
  entity_id: number;
  legacy_client_id: number;
  created_at: Date | null;
  [key: string]: unknown;
};

type MigrationStats = {
  label: string;
  sourceTotal: number;
  linked: number;
  upserted: number;
  skippedNoClient: number;
  orphans: number;
};

async function loadClientUuidMap(): Promise<Map<number, string>> {
  const { rows } = await modulesPool.query<{
    legacy_client_id: number;
    id: string;
  }>(
    `SELECT legacy_client_id, id FROM clients WHERE legacy_client_id IS NOT NULL`
  );

  const map = new Map<number, string>();
  for (const row of rows) {
    map.set(Number(row.legacy_client_id), row.id);
  }
  return map;
}

async function countSourceRows(table: string): Promise<number> {
  const { rows } = await mainPool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM ${table}`
  );
  return Number(rows[0]?.count ?? 0);
}

async function countOrphans(table: string, entityType: string): Promise<number> {
  const { rows } = await mainPool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM ${table} e
     WHERE NOT EXISTS (
       SELECT 1 FROM client_product_payment cpp
       WHERE cpp.entity_type = $1 AND cpp.entity_id = e.id
     )`,
    [entityType]
  );
  return Number(rows[0]?.count ?? 0);
}

async function fetchLinkedRows(
  table: string,
  entityType: string,
  selectColumns: string
): Promise<EntityRow[]> {
  const { rows } = await mainPool.query<EntityRow>(
    `SELECT DISTINCT ON (e.id)
       e.id AS entity_id,
       cpp.client_id AS legacy_client_id,
       ${selectColumns}
     FROM ${table} e
     INNER JOIN client_product_payment cpp
       ON cpp.entity_type = $1 AND cpp.entity_id = e.id
     ORDER BY e.id, cpp.id`,
    [entityType]
  );
  return rows;
}

async function migrateAirTicket(
  clientMap: Map<number, string>
): Promise<MigrationStats> {
  const label = "air_ticket";
  const entityType = "airTicket_id";
  const sourceTotal = await countSourceRows(label);
  const orphans = await countOrphans(label, entityType);
  const rows = await fetchLinkedRows(
    label,
    entityType,
    `e.is_ticket_booked, e.amount, e.air_ticket_number, e.date, e.remark, e.created_at`
  );

  let upserted = 0;
  let skippedNoClient = 0;

  for (const row of rows) {
    const clientUuid = clientMap.get(Number(row.legacy_client_id));
    if (!clientUuid) {
      console.warn(
        `Skip ${label} ${row.entity_id}: client ${row.legacy_client_id} not in modules DB`
      );
      skippedNoClient++;
      continue;
    }

    await modulesPool.query(
      `INSERT INTO air_ticket (
         client_id, legacy_entity_id, is_ticket_booked, amount,
         air_ticket_number, date, remark, created_at
       ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (legacy_entity_id) DO UPDATE SET
         client_id = EXCLUDED.client_id,
         is_ticket_booked = EXCLUDED.is_ticket_booked,
         amount = EXCLUDED.amount,
         air_ticket_number = EXCLUDED.air_ticket_number,
         date = EXCLUDED.date,
         remark = EXCLUDED.remark,
         created_at = EXCLUDED.created_at`,
      [
        clientUuid,
        row.entity_id,
        row.is_ticket_booked ?? false,
        row.amount,
        row.air_ticket_number ?? null,
        row.date,
        row.remark ?? null,
        row.created_at ?? new Date(),
      ]
    );
    upserted++;
  }

  return {
    label,
    sourceTotal,
    linked: rows.length,
    upserted,
    skippedNoClient,
    orphans,
  };
}

async function migrateCreditCard(
  clientMap: Map<number, string>
): Promise<MigrationStats> {
  const label = "credit_card";
  const entityType = "creditCard_id";
  const sourceTotal = await countSourceRows(label);
  const orphans = await countOrphans(label, entityType);
  const rows = await fetchLinkedRows(
    label,
    entityType,
    `e.activated_status, e.card_plan, e.card_giving_date, e.card_activation_date,
     e.date, e.remark, e.created_at`
  );

  let upserted = 0;
  let skippedNoClient = 0;

  for (const row of rows) {
    const clientUuid = clientMap.get(Number(row.legacy_client_id));
    if (!clientUuid) {
      console.warn(
        `Skip ${label} ${row.entity_id}: client ${row.legacy_client_id} not in modules DB`
      );
      skippedNoClient++;
      continue;
    }

    await modulesPool.query(
      `INSERT INTO credit_card (
         client_id, legacy_entity_id, activated_status, card_plan,
         card_giving_date, card_activation_date, date, remark, created_at
       ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (legacy_entity_id) DO UPDATE SET
         client_id = EXCLUDED.client_id,
         activated_status = EXCLUDED.activated_status,
         card_plan = EXCLUDED.card_plan,
         card_giving_date = EXCLUDED.card_giving_date,
         card_activation_date = EXCLUDED.card_activation_date,
         date = EXCLUDED.date,
         remark = EXCLUDED.remark,
         created_at = EXCLUDED.created_at`,
      [
        clientUuid,
        row.entity_id,
        row.activated_status ?? false,
        row.card_plan ?? null,
        row.card_giving_date ?? null,
        row.card_activation_date ?? null,
        row.date ?? null,
        row.remark ?? null,
        row.created_at ?? new Date(),
      ]
    );
    upserted++;
  }

  return {
    label,
    sourceTotal,
    linked: rows.length,
    upserted,
    skippedNoClient,
    orphans,
  };
}

async function migrateForexCard(
  clientMap: Map<number, string>
): Promise<MigrationStats> {
  const label = "forex_card";
  const entityType = "forexCard_id";
  const sourceTotal = await countSourceRows(label);
  const orphans = await countOrphans(label, entityType);
  const rows = await fetchLinkedRows(
    label,
    entityType,
    `e.forex_card_status, e.date, e.remark, e.created_at`
  );

  let upserted = 0;
  let skippedNoClient = 0;

  for (const row of rows) {
    const clientUuid = clientMap.get(Number(row.legacy_client_id));
    if (!clientUuid) {
      console.warn(
        `Skip ${label} ${row.entity_id}: client ${row.legacy_client_id} not in modules DB`
      );
      skippedNoClient++;
      continue;
    }

    await modulesPool.query(
      `INSERT INTO forex_card (
         client_id, legacy_entity_id, forex_card_status, date, remark, created_at
       ) VALUES ($1::uuid, $2, $3, $4, $5, $6)
       ON CONFLICT (legacy_entity_id) DO UPDATE SET
         client_id = EXCLUDED.client_id,
         forex_card_status = EXCLUDED.forex_card_status,
         date = EXCLUDED.date,
         remark = EXCLUDED.remark,
         created_at = EXCLUDED.created_at`,
      [
        clientUuid,
        row.entity_id,
        row.forex_card_status ?? null,
        row.date ?? null,
        row.remark ?? null,
        row.created_at ?? new Date(),
      ]
    );
    upserted++;
  }

  return {
    label,
    sourceTotal,
    linked: rows.length,
    upserted,
    skippedNoClient,
    orphans,
  };
}

async function migrateForexFees(
  clientMap: Map<number, string>
): Promise<MigrationStats> {
  const label = "forex_fees";
  const entityType = "forexFees_id";
  const sourceTotal = await countSourceRows(label);
  const orphans = await countOrphans(label, entityType);
  const rows = await fetchLinkedRows(
    label,
    entityType,
    `e.side, e.date, e.amount, e.remark, e.created_at`
  );

  let upserted = 0;
  let skippedNoClient = 0;

  for (const row of rows) {
    const clientUuid = clientMap.get(Number(row.legacy_client_id));
    if (!clientUuid) {
      console.warn(
        `Skip ${label} ${row.entity_id}: client ${row.legacy_client_id} not in modules DB`
      );
      skippedNoClient++;
      continue;
    }

    await modulesPool.query(
      `INSERT INTO forex_fees (
         client_id, legacy_entity_id, side, date, amount, remark, created_at
       ) VALUES ($1::uuid, $2, $3::forex_side_enum, $4, $5, $6, $7)
       ON CONFLICT (legacy_entity_id) DO UPDATE SET
         client_id = EXCLUDED.client_id,
         side = EXCLUDED.side,
         date = EXCLUDED.date,
         amount = EXCLUDED.amount,
         remark = EXCLUDED.remark,
         created_at = EXCLUDED.created_at`,
      [
        clientUuid,
        row.entity_id,
        row.side,
        row.date ?? null,
        row.amount,
        row.remark ?? null,
        row.created_at ?? new Date(),
      ]
    );
    upserted++;
  }

  return {
    label,
    sourceTotal,
    linked: rows.length,
    upserted,
    skippedNoClient,
    orphans,
  };
}

async function migrateIelts(
  clientMap: Map<number, string>
): Promise<MigrationStats> {
  const label = "ielts";
  const entityType = "ielts_id";
  const sourceTotal = await countSourceRows(label);
  const orphans = await countOrphans(label, entityType);
  const rows = await fetchLinkedRows(
    label,
    entityType,
    `e.enrolled_status, e.amount, e.date, e.remarks, e.created_at`
  );

  let upserted = 0;
  let skippedNoClient = 0;

  for (const row of rows) {
    const clientUuid = clientMap.get(Number(row.legacy_client_id));
    if (!clientUuid) {
      console.warn(
        `Skip ${label} ${row.entity_id}: client ${row.legacy_client_id} not in modules DB`
      );
      skippedNoClient++;
      continue;
    }

    await modulesPool.query(
      `INSERT INTO ielts (
         client_id, legacy_entity_id, enrolled_status, amount, date, remarks, created_at
       ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (legacy_entity_id) DO UPDATE SET
         client_id = EXCLUDED.client_id,
         enrolled_status = EXCLUDED.enrolled_status,
         amount = EXCLUDED.amount,
         date = EXCLUDED.date,
         remarks = EXCLUDED.remarks,
         created_at = EXCLUDED.created_at`,
      [
        clientUuid,
        row.entity_id,
        row.enrolled_status ?? false,
        row.amount,
        row.date ?? null,
        row.remarks ?? null,
        row.created_at ?? new Date(),
      ]
    );
    upserted++;
  }

  return {
    label,
    sourceTotal,
    linked: rows.length,
    upserted,
    skippedNoClient,
    orphans,
  };
}

async function migrateInsurance(
  clientMap: Map<number, string>
): Promise<MigrationStats> {
  const label = "insurance";
  const entityType = "insurance_id";
  const sourceTotal = await countSourceRows(label);
  const orphans = await countOrphans(label, entityType);
  const rows = await fetchLinkedRows(
    label,
    entityType,
    `e.amount, e.policy_number, e.date, e.remark, e.created_at`
  );

  let upserted = 0;
  let skippedNoClient = 0;

  for (const row of rows) {
    const clientUuid = clientMap.get(Number(row.legacy_client_id));
    if (!clientUuid) {
      console.warn(
        `Skip ${label} ${row.entity_id}: client ${row.legacy_client_id} not in modules DB`
      );
      skippedNoClient++;
      continue;
    }

    await modulesPool.query(
      `INSERT INTO insurance (
         client_id, legacy_entity_id, amount, policy_number, date, remark, created_at
       ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (legacy_entity_id) DO UPDATE SET
         client_id = EXCLUDED.client_id,
         amount = EXCLUDED.amount,
         policy_number = EXCLUDED.policy_number,
         date = EXCLUDED.date,
         remark = EXCLUDED.remark,
         created_at = EXCLUDED.created_at`,
      [
        clientUuid,
        row.entity_id,
        row.amount,
        row.policy_number ?? null,
        row.date,
        row.remark ?? null,
        row.created_at ?? new Date(),
      ]
    );
    upserted++;
  }

  return {
    label,
    sourceTotal,
    linked: rows.length,
    upserted,
    skippedNoClient,
    orphans,
  };
}

async function migrateLoan(
  clientMap: Map<number, string>
): Promise<MigrationStats> {
  const label = "loan";
  const entityType = "loan_id";
  const sourceTotal = await countSourceRows(label);
  const orphans = await countOrphans(label, entityType);
  const rows = await fetchLinkedRows(
    label,
    entityType,
    `e.amount, e.disbursment_date, e.remarks, e.created_at`
  );

  let upserted = 0;
  let skippedNoClient = 0;

  for (const row of rows) {
    const clientUuid = clientMap.get(Number(row.legacy_client_id));
    if (!clientUuid) {
      console.warn(
        `Skip ${label} ${row.entity_id}: client ${row.legacy_client_id} not in modules DB`
      );
      skippedNoClient++;
      continue;
    }

    await modulesPool.query(
      `INSERT INTO loan (
         client_id, legacy_entity_id, amount, disbursment_date, remarks, created_at
       ) VALUES ($1::uuid, $2, $3, $4, $5, $6)
       ON CONFLICT (legacy_entity_id) DO UPDATE SET
         client_id = EXCLUDED.client_id,
         amount = EXCLUDED.amount,
         disbursment_date = EXCLUDED.disbursment_date,
         remarks = EXCLUDED.remarks,
         created_at = EXCLUDED.created_at`,
      [
        clientUuid,
        row.entity_id,
        row.amount,
        row.disbursment_date,
        row.remarks ?? null,
        row.created_at ?? new Date(),
      ]
    );
    upserted++;
  }

  return {
    label,
    sourceTotal,
    linked: rows.length,
    upserted,
    skippedNoClient,
    orphans,
  };
}

async function migrateSimCard(
  clientMap: Map<number, string>
): Promise<MigrationStats> {
  const label = "sim_card";
  const entityType = "simCard_id";
  const sourceTotal = await countSourceRows(label);
  const orphans = await countOrphans(label, entityType);
  const rows = await fetchLinkedRows(
    label,
    entityType,
    `e.activated_status, e.simcard_plan, e.sim_card_giving_date,
     e.sim_activation_date, e.remarks, e.created_at`
  );

  let upserted = 0;
  let skippedNoClient = 0;

  for (const row of rows) {
    const clientUuid = clientMap.get(Number(row.legacy_client_id));
    if (!clientUuid) {
      console.warn(
        `Skip ${label} ${row.entity_id}: client ${row.legacy_client_id} not in modules DB`
      );
      skippedNoClient++;
      continue;
    }

    await modulesPool.query(
      `INSERT INTO sim_card (
         client_id, legacy_entity_id, activated_status, simcard_plan,
         sim_card_giving_date, sim_activation_date, remarks, created_at
       ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (legacy_entity_id) DO UPDATE SET
         client_id = EXCLUDED.client_id,
         activated_status = EXCLUDED.activated_status,
         simcard_plan = EXCLUDED.simcard_plan,
         sim_card_giving_date = EXCLUDED.sim_card_giving_date,
         sim_activation_date = EXCLUDED.sim_activation_date,
         remarks = EXCLUDED.remarks,
         created_at = EXCLUDED.created_at`,
      [
        clientUuid,
        row.entity_id,
        row.activated_status ?? false,
        row.simcard_plan ?? null,
        row.sim_card_giving_date ?? null,
        row.sim_activation_date ?? null,
        row.remarks ?? null,
        row.created_at ?? new Date(),
      ]
    );
    upserted++;
  }

  return {
    label,
    sourceTotal,
    linked: rows.length,
    upserted,
    skippedNoClient,
    orphans,
  };
}

async function migrateTutionFees(
  clientMap: Map<number, string>
): Promise<MigrationStats> {
  const label = "tution_fees";
  const entityType = "tutionFees_id";
  const sourceTotal = await countSourceRows(label);
  const orphans = await countOrphans(label, entityType);
  const rows = await fetchLinkedRows(
    label,
    entityType,
    `e.tution_fees_status, e.date, e.remark, e.created_at`
  );

  let upserted = 0;
  let skippedNoClient = 0;

  for (const row of rows) {
    const clientUuid = clientMap.get(Number(row.legacy_client_id));
    if (!clientUuid) {
      console.warn(
        `Skip ${label} ${row.entity_id}: client ${row.legacy_client_id} not in modules DB`
      );
      skippedNoClient++;
      continue;
    }

    await modulesPool.query(
      `INSERT INTO tution_fees (
         client_id, legacy_entity_id, tution_fees_status, date, remark, created_at
       ) VALUES ($1::uuid, $2, $3::tution_fees_status_enum, $4, $5, $6)
       ON CONFLICT (legacy_entity_id) DO UPDATE SET
         client_id = EXCLUDED.client_id,
         tution_fees_status = EXCLUDED.tution_fees_status,
         date = EXCLUDED.date,
         remark = EXCLUDED.remark,
         created_at = EXCLUDED.created_at`,
      [
        clientUuid,
        row.entity_id,
        row.tution_fees_status,
        row.date ?? null,
        row.remark ?? null,
        row.created_at ?? new Date(),
      ]
    );
    upserted++;
  }

  return {
    label,
    sourceTotal,
    linked: rows.length,
    upserted,
    skippedNoClient,
    orphans,
  };
}

async function migrateNewSell(
  clientMap: Map<number, string>
): Promise<MigrationStats> {
  const label = "new_sell";
  const entityType = "newSell_id";
  const sourceTotal = await countSourceRows(label);
  const orphans = await countOrphans(label, entityType);
  const rows = await fetchLinkedRows(
    label,
    entityType,
    `e.service_name, e.service_information, e.amount, e.date, e.invoice_no, e.remark, e.created_at`
  );

  let upserted = 0;
  let skippedNoClient = 0;

  for (const row of rows) {
    const clientUuid = clientMap.get(Number(row.legacy_client_id));
    if (!clientUuid) {
      console.warn(
        `Skip ${label} ${row.entity_id}: client ${row.legacy_client_id} not in modules DB`
      );
      skippedNoClient++;
      continue;
    }

    await modulesPool.query(
      `INSERT INTO new_sell (
         client_id, legacy_entity_id, service_name, service_information,
         amount, date, invoice_no, remark, created_at
       ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (legacy_entity_id) DO UPDATE SET
         client_id = EXCLUDED.client_id,
         service_name = EXCLUDED.service_name,
         service_information = EXCLUDED.service_information,
         amount = EXCLUDED.amount,
         date = EXCLUDED.date,
         invoice_no = EXCLUDED.invoice_no,
         remark = EXCLUDED.remark,
         created_at = EXCLUDED.created_at`,
      [
        clientUuid,
        row.entity_id,
        row.service_name,
        row.service_information ?? null,
        row.amount,
        row.date,
        row.invoice_no ?? null,
        row.remark ?? null,
        row.created_at ?? new Date(),
      ]
    );
    upserted++;
  }

  return {
    label,
    sourceTotal,
    linked: rows.length,
    upserted,
    skippedNoClient,
    orphans,
  };
}

function printStats(stats: MigrationStats): void {
  console.log(
    `${stats.label}: source=${stats.sourceTotal} linked=${stats.linked} upserted=${stats.upserted} skipped_client=${stats.skippedNoClient} orphans_no_cpp=${stats.orphans}`
  );
}

async function main() {
  const clientMap = await loadClientUuidMap();
  if (!clientMap.size) {
    throw new Error(
      "No migrated clients. Run: npm run migrate:module-clients"
    );
  }

  console.log(`Loaded ${clientMap.size} client UUID mappings.`);

  const migrators = [
    migrateAirTicket,
    migrateCreditCard,
    migrateForexCard,
    migrateForexFees,
    migrateIelts,
    migrateInsurance,
    migrateLoan,
    migrateSimCard,
    migrateTutionFees,
    migrateNewSell,
  ];

  const results: MigrationStats[] = [];
  for (const migrate of migrators) {
    try {
      const stats = await migrate(clientMap);
      results.push(stats);
      printStats(stats);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Migration failed: ${message}`);
      throw err;
    }
  }

  const totals = results.reduce(
    (acc, s) => ({
      sourceTotal: acc.sourceTotal + s.sourceTotal,
      linked: acc.linked + s.linked,
      upserted: acc.upserted + s.upserted,
      skippedNoClient: acc.skippedNoClient + s.skippedNoClient,
      orphans: acc.orphans + s.orphans,
    }),
    {
      sourceTotal: 0,
      linked: 0,
      upserted: 0,
      skippedNoClient: 0,
      orphans: 0,
    }
  );

  console.log("\nDone.");
  console.log(
    `Totals: source=${totals.sourceTotal} linked=${totals.linked} upserted=${totals.upserted} skipped_client=${totals.skippedNoClient} orphans_no_cpp=${totals.orphans}`
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
