/**
 * Hard-delete test clients and ALL their related data from both databases.
 *
 * Usage:
 *   npx ts-node -e "require('dotenv/config')" src/scripts/deleteTestClients.ts <clientId1> [clientId2] ...
 *
 * Example:
 *   npx ts-node --require dotenv/config src/scripts/deleteTestClients.ts 42 43 44
 *
 * What gets deleted (main CRM DB):
 *   - Entity rows (visa_extension, all_finance, air_ticket, new_sell, ielts, loan,
 *     forex_card, forex_fees, tution_fees, insurance, sim_card, credit_card, beacon_account)
 *     collected via client_product_payment.entity_id before the FK cascade removes them
 *   - client_product_payment  (cascades from client_information)
 *   - client_payment          (cascades from client_information)
 *   - student_application     (cascades from client_information)
 *   - incentive_record_breakdowns  (cascades from incentive_records)
 *   - incentive_audit_logs        (cascades from incentive_records)
 *   - incentive_records
 *   - activity_log
 *   - client_information      (triggers all the cascades above)
 *
 * What gets deleted (modules DB, if DATABASE_URL_SECOND is configured):
 *   - visa_case_assignments, visa_case_status_events, visa_case_document_requests
 *   - visa_cases
 *   - journey_timeline_events, client_journey_events, client_journey
 *   - sale_items, sales
 *   - product_transactions, amounts, payment_balances, invoices,
 *     installment_plans, remarks, currency_rates, dates
 *   - client_transfer_modules, client_sale_modules, client_family_members_modules
 *   - client_core_modules
 *   - clients
 *   - persons
 */

import "dotenv/config";
import { Pool } from "pg";

const mainPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
});

const modulesPool = process.env.DATABASE_URL_SECOND
  ? new Pool({
      connectionString: process.env.DATABASE_URL_SECOND,
      ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
    })
  : null;

async function deleteFromMainDb(clientId: number): Promise<void> {
  const client = await mainPool.connect();
  try {
    await client.query("BEGIN");

    // --- Verify client exists ---
    const { rows: ciRows } = await client.query(
      `SELECT id, fullname, archived FROM client_information WHERE id = $1`,
      [clientId]
    );
    if (ciRows.length === 0) {
      console.log(`  ⚠️  Client ${clientId} not found in main CRM DB — skipping.`);
      await client.query("ROLLBACK");
      return;
    }
    const ci = ciRows[0] as { id: number; fullname: string; archived: boolean };
    console.log(`  Client found: "${ci.fullname}" (archived: ${ci.archived})`);

    // --- Collect entity IDs before cascade deletes them ---
    const { rows: productPayments } = await client.query<{
      entity_type: string;
      entity_id: string;
    }>(
      `SELECT entity_type, entity_id
         FROM client_product_payment
        WHERE client_id = $1
          AND entity_type <> 'master_only'
          AND entity_id IS NOT NULL`,
      [clientId]
    );

    // Group entity IDs by table name
    const entityMap: Record<string, number[]> = {};
    const entityTableMap: Record<string, string> = {
      visaextension_id: "visa_extension",
      simCard_id: "sim_card",
      airTicket_id: "air_ticket",
      newSell_id: "new_sell",
      ielts_id: "ielts",
      loan_id: "loan",
      forexCard_id: "forex_card",
      forexFees_id: "forex_fees",
      tutionFees_id: "tution_fees",
      insurance_id: "insurance",
      beaconAccount_id: "beacon_account",
      creditCard_id: "credit_card",
      allFinance_id: "all_finance",
    };
    for (const pp of productPayments) {
      const table = entityTableMap[pp.entity_type];
      if (!table) continue;
      if (!entityMap[table]) entityMap[table] = [];
      entityMap[table].push(Number(pp.entity_id));
    }

    // --- Delete incentive records (breakdowns + audit logs cascade from them) ---
    const { rowCount: irCount } = await client.query(
      `DELETE FROM incentive_records WHERE client_id = $1`,
      [clientId]
    );
    if ((irCount ?? 0) > 0) console.log(`    Deleted ${irCount} incentive_records row(s)`);

    // --- Delete activity_log ---
    const { rowCount: alCount } = await client.query(
      `DELETE FROM activity_log WHERE client_id = $1`,
      [clientId]
    );
    if ((alCount ?? 0) > 0) console.log(`    Deleted ${alCount} activity_log row(s)`);

    // --- Delete client_information (cascades: client_payment, client_product_payment, student_application) ---
    await client.query(`DELETE FROM client_information WHERE id = $1`, [clientId]);
    console.log(`    Deleted client_information + cascades (client_payment, client_product_payment, student_application)`);

    // --- Delete orphaned entity rows (no FK back, collected above) ---
    for (const [table, ids] of Object.entries(entityMap)) {
      if (ids.length === 0) continue;
      const { rowCount } = await client.query(
        `DELETE FROM ${table} WHERE id = ANY($1::bigint[])`,
        [ids]
      );
      console.log(`    Deleted ${rowCount} ${table} entity row(s)`);
    }

    await client.query("COMMIT");
    console.log(`  ✅ Main CRM DB: client ${clientId} fully deleted.`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function deleteFromModulesDb(legacyClientId: number): Promise<void> {
  if (!modulesPool) {
    console.log(`  ℹ️  DATABASE_URL_SECOND not set — skipping modules DB.`);
    return;
  }

  const client = await modulesPool.connect();
  try {
    await client.query("BEGIN");

    // Find the UUID clientId in modules DB via legacy_client_id
    const { rows: clientRows } = await client.query<{ id: string; client_code: string }>(
      `SELECT c.id, c.client_code
         FROM clients c
        WHERE c.legacy_client_id = $1
        LIMIT 1`,
      [legacyClientId]
    );

    if (clientRows.length === 0) {
      console.log(`  ℹ️  Client ${legacyClientId} not found in modules DB — skipping.`);
      await client.query("ROLLBACK");
      return;
    }

    const { id: clientUuid, client_code } = clientRows[0];
    console.log(`  Modules DB client: ${client_code} (${clientUuid})`);

    // Visa cases: delete child rows first, then visa_cases
    const { rows: visaCaseRows } = await client.query<{ id: string }>(
      `SELECT id FROM visa_cases WHERE client_id = $1`,
      [clientUuid]
    );
    const visaCaseIds = visaCaseRows.map((r) => r.id);

    if (visaCaseIds.length > 0) {
      await client.query(`DELETE FROM visa_case_assignments WHERE visa_case_id = ANY($1::uuid[])`, [visaCaseIds]);
      await client.query(`DELETE FROM visa_case_status_events WHERE visa_case_id = ANY($1::uuid[])`, [visaCaseIds]);
      await client.query(`DELETE FROM visa_case_document_requests WHERE client_id = $1`, [clientUuid]);
      await client.query(`DELETE FROM visa_cases WHERE client_id = $1`, [clientUuid]);
      console.log(`    Deleted ${visaCaseIds.length} visa_case(s) + assignments/events/doc requests`);
    }

    // Journey
    await client.query(`DELETE FROM journey_timeline_events WHERE client_id = $1`, [clientUuid]);
    await client.query(`DELETE FROM client_journey_events WHERE client_id = $1`, [clientUuid]);
    await client.query(`DELETE FROM client_journey WHERE client_id = $1`, [clientUuid]);
    console.log(`    Deleted journey rows`);

    // Sales + sale items
    const { rows: saleRows } = await client.query<{ id: string }>(
      `SELECT id FROM sales WHERE client_id = $1`,
      [clientUuid]
    );
    if (saleRows.length > 0) {
      const saleIds = saleRows.map((r) => r.id);
      await client.query(`DELETE FROM sale_items WHERE sale_id = ANY($1::uuid[])`, [saleIds]);
      await client.query(`DELETE FROM sales WHERE client_id = $1`, [clientUuid]);
      console.log(`    Deleted ${saleRows.length} sale(s) + sale_items`);
    }

    // Payments (no cascade on client_id)
    await client.query(`DELETE FROM product_transactions WHERE client_id = $1`, [clientUuid]);
    await client.query(`DELETE FROM amounts WHERE client_id = $1`, [clientUuid]);
    await client.query(`DELETE FROM payment_balances WHERE client_id = $1`, [clientUuid]);
    await client.query(`DELETE FROM invoices WHERE client_id = $1`, [clientUuid]);
    await client.query(`DELETE FROM installment_plans WHERE client_id = $1`, [clientUuid]);
    await client.query(`DELETE FROM remarks WHERE client_id = $1`, [clientUuid]);
    await client.query(`DELETE FROM currency_rates WHERE client_id = $1`, [clientUuid]);
    await client.query(`DELETE FROM dates WHERE client_id = $1`, [clientUuid]);
    console.log(`    Deleted payment tables`);

    // Client relation tables
    await client.query(`DELETE FROM client_transfer_modules WHERE client_id = $1`, [clientUuid]);
    await client.query(`DELETE FROM client_sale_modules WHERE client_id = $1`, [clientUuid]);
    await client.query(`DELETE FROM client_family_members_modules WHERE client_id = $1`, [clientUuid]);
    await client.query(`DELETE FROM client_core_modules WHERE client_id = $1`, [clientUuid]);
    console.log(`    Deleted client_*_modules rows`);

    // Get person_id before deleting client
    const { rows: personRows } = await client.query<{ person_id: string }>(
      `SELECT person_id FROM clients WHERE id = $1`,
      [clientUuid]
    );
    const personId = personRows[0]?.person_id;

    // Delete client row
    await client.query(`DELETE FROM clients WHERE id = $1`, [clientUuid]);
    console.log(`    Deleted clients row`);

    // Delete person (only if no other clients reference this person)
    if (personId) {
      const { rows: otherClients } = await client.query(
        `SELECT 1 FROM clients WHERE person_id = $1 LIMIT 1`,
        [personId]
      );
      if (otherClients.length === 0) {
        await client.query(`DELETE FROM persons WHERE id = $1`, [personId]);
        console.log(`    Deleted persons row`);
      } else {
        console.log(`    Person ${personId} still referenced by other clients — not deleted.`);
      }
    }

    await client.query("COMMIT");
    console.log(`  ✅ Modules DB: client ${legacyClientId} fully deleted.`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: npx ts-node --require dotenv/config src/scripts/deleteTestClients.ts <clientId1> [clientId2] ...");
    process.exit(1);
  }

  const clientIds = args.map((a) => {
    const n = parseInt(a, 10);
    if (isNaN(n) || n <= 0) {
      console.error(`Invalid clientId: ${a}`);
      process.exit(1);
    }
    return n;
  });

  console.log(`\n🗑️  Hard-deleting ${clientIds.length} client(s): [${clientIds.join(", ")}]\n`);
  console.log("⚠️  This is IRREVERSIBLE. You have 5 seconds to cancel (Ctrl+C)...\n");
  await new Promise((r) => setTimeout(r, 5000));

  for (const clientId of clientIds) {
    console.log(`\n── Client ${clientId} ──`);
    try {
      await deleteFromMainDb(clientId);
      await deleteFromModulesDb(clientId);
    } catch (err: any) {
      console.error(`  ❌ Error deleting client ${clientId}:`, err.message);
      process.exit(1);
    }
  }

  console.log("\n✅ All done. Remember to clear Redis cache:\n   npm run cache:clear\n");
  await mainPool.end();
  if (modulesPool) await modulesPool.end();
}

main();
