/**
 * Seed a full client journey demo: lead conversion → enrollment → visa case
 * → CX → Binding → Application, with timeline events for Swagger testing.
 *
 * Prerequisite: modules DB configured (DATABASE_URL_SECOND), npm run db:push:modules
 *
 * Usage: npm run seed:journey-demo
 */
import "dotenv/config";
import bcrypt from "bcrypt";
import { pool } from "../config/databaseConnection";
import {
  getPoolSecond,
  isModulesDbConfigured,
} from "../config/databaseConnectionSecond";
import { saveClient } from "../models/client.model";
import {
  emitLeadConvertedEvent,
} from "../modules/journey/services/journeyEvent.service";
import {
  getClientJourneySummary,
  getClientJourneyTimeline,
} from "../modules/journey/services/journeyTimeline.service";
import { assignVisaCase } from "../modules/visaCase/services/visaCaseAssignment.service";
import { getVisaCaseBySaleId } from "../modules/visaCase/models/visaCase.model";
import { updateVisaCaseStatus } from "../modules/visaCase/services/visaCase.service";
import {
  ensureSaleAndVisaCase,
  syncClientFromMain,
} from "../modules/sync/modulesSync.service";
import type { Role } from "../types/role";

const RUN_TAG = Date.now().toString(36).toUpperCase();
const DEMO_OPS_PASSWORD = "JourneyDemo1!";

type OpsUser = { id: number; fullName: string; role: Role };
type OpsTeamRole = "cx" | "binding" | "application";

async function findUserByRole(role: Role): Promise<OpsUser> {
  const { rows } = await pool.query<{ id: number; full_name: string; role: string }>(
    `SELECT id, full_name, role
       FROM users
      WHERE role = $1 AND status = true
      ORDER BY id
      LIMIT 1`,
    [role]
  );
  const row = rows[0];
  if (!row) {
    throw new Error(`No active user with role "${role}" found in main CRM`);
  }
  return {
    id: Number(row.id),
    fullName: row.full_name,
    role: row.role as Role,
  };
}

async function findOrEnsureOpsUser(role: OpsTeamRole): Promise<OpsUser> {
  try {
    return await findUserByRole(role);
  } catch {
    const passwordHash = await bcrypt.hash(DEMO_OPS_PASSWORD, 10);
    const email = `journey-demo-${role}-${RUN_TAG.toLowerCase()}@pratham.local`;
    const fullName = `Journey Demo ${role.toUpperCase()} ${RUN_TAG}`;

    const { rows } = await pool.query<{
      id: number;
      full_name: string;
      role: string;
    }>(
      `INSERT INTO users (full_name, email, password_hash, role, status)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id, full_name, role`,
      [fullName, email, passwordHash, role]
    );
    const row = rows[0];
    if (!row) {
      throw new Error(`Failed to create demo user for role "${role}"`);
    }
    console.log(`   ✓ created demo ${role} user: ${fullName} (#${row.id})`);
    return {
      id: Number(row.id),
      fullName: row.full_name,
      role: row.role as Role,
    };
  }
}

async function findStudentSaleTypeId(): Promise<number> {
  const { rows } = await getPoolSecond().query<{ legacy_sale_type_id: number }>(
    `SELECT st.legacy_sale_type_id
       FROM sale_type st
       JOIN visa_categories vc ON vc.id = st.visa_category_id
      WHERE vc.slug = 'student'
        AND st.legacy_sale_type_id IS NOT NULL
      ORDER BY st.legacy_sale_type_id
      LIMIT 1`
  );
  const id = rows[0]?.legacy_sale_type_id;
  if (!id) {
    throw new Error(
      "No student sale type in modules DB. Run: npm run migrate:module-sale-types"
    );
  }
  return Number(id);
}

async function findLeadTypeId(): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `SELECT id FROM lead_type ORDER BY id LIMIT 1`
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("No lead types in main CRM");
  return Number(id);
}

async function upsertClientJourney(
  clientId: string,
  stageUpdatedBy: number
): Promise<void> {
  await getPoolSecond().query(
    `INSERT INTO client_journey (client_id, current_stage, stage_updated_by, notes)
     VALUES ($1::uuid, 'DOCUMENTS_IN_PROGRESS'::journey_stage_enum, $2, $3)
     ON CONFLICT (client_id) DO UPDATE SET
       current_stage = EXCLUDED.current_stage,
       stage_updated_by = EXCLUDED.stage_updated_by,
       notes = EXCLUDED.notes,
       stage_updated_at = NOW(),
       updated_at = NOW()`,
    [clientId, stageUpdatedBy, `Journey demo seed ${RUN_TAG}`]
  );
}

async function main(): Promise<void> {
  if (!isModulesDbConfigured()) {
    throw new Error("DATABASE_URL_SECOND is not configured");
  }

  console.log("═".repeat(60));
  console.log("  Journey demo seed — lead → application");
  console.log("═".repeat(60));

  const counsellor = await findUserByRole("counsellor");
  const admin = await findUserByRole("admin");
  const cx = await findOrEnsureOpsUser("cx");
  const binding = await findOrEnsureOpsUser("binding");
  const application = await findOrEnsureOpsUser("application");
  const legacySaleTypeId = await findStudentSaleTypeId();
  const leadTypeId = await findLeadTypeId();

  console.log("\nUsing users:");
  console.log(`  counsellor : ${counsellor.fullName} (#${counsellor.id})`);
  console.log(`  admin      : ${admin.fullName} (#${admin.id})`);
  console.log(`  cx         : ${cx.fullName} (#${cx.id})`);
  console.log(`  binding    : ${binding.fullName} (#${binding.id})`);
  console.log(`  application: ${application.fullName} (#${application.id})`);
  console.log(`  sale type  : legacy #${legacySaleTypeId}`);

  const today = new Date().toISOString().slice(0, 10);
  const passport = `JOURNEY-DEMO-${RUN_TAG}`;
  const clientName = `Journey Demo ${RUN_TAG}`;

  console.log("\n1. Create client in main CRM…");
  const saved = await saveClient(
    {
      fullName: clientName,
      enrollmentDate: today,
      passportDetails: passport,
      leadTypeId,
    },
    counsellor.id
  );
  const legacyClientId = saved.client.clientId;
  console.log(`   ✓ legacy client id: ${legacyClientId}`);

  console.log("\n2. Sync to modules DB + emit journey events…");
  const syncResult = await syncClientFromMain(legacyClientId);
  const moduleClientId = syncResult?.clientUuid;
  if (!moduleClientId) {
    throw new Error("syncClientFromMain failed — check modules DB tables");
  }
  console.log(`   ✓ modules client id: ${moduleClientId}`);

  await emitLeadConvertedEvent({
    legacyClientId,
    leadId: null,
    actorId: counsellor.id,
    actorName: counsellor.fullName,
  });
  console.log("   ✓ LEAD_CONVERTED event");

  console.log("\n3. Create sale + visa case…");
  await ensureSaleAndVisaCase({
    legacyClientId,
    legacySaleTypeId,
    counsellorId: counsellor.id,
  });

  const saleRow = await getPoolSecond().query<{ id: string; sale_id: string }>(
    `SELECT s.id, s.sale_id
       FROM sales s
       JOIN clients c ON c.id = s.client_id
      WHERE c.legacy_client_id = $1
      ORDER BY s.created_at DESC
      LIMIT 1`,
    [legacyClientId]
  );
  const saleUuid = saleRow.rows[0]?.id;
  if (!saleUuid) throw new Error("Sale not created in modules DB");

  const visaCaseRow = await getVisaCaseBySaleId(saleUuid);
  if (!visaCaseRow) throw new Error("Visa case not created");
  const visaCaseId = visaCaseRow.id;
  console.log(`   ✓ visa case id: ${visaCaseId}`);

  console.log("\n4. Assign visa case: admin → CX…");
  await assignVisaCase(
    { userId: admin.id, role: admin.role },
    visaCaseId,
    { assignedUserId: cx.id, notes: "Demo: initial CX assignment" }
  );
  console.log(`   ✓ assigned to ${cx.fullName}`);

  console.log("\n5. CX documentation progress…");
  await updateVisaCaseStatus(visaCaseId, { userId: cx.id, role: "cx" }, {
    subStatus: "PARTIALLY_RECEIVED",
    notes: "Demo: documents partially received",
  });
  await updateVisaCaseStatus(visaCaseId, { userId: cx.id, role: "cx" }, {
    subStatus: "FULLY_RECEIVED",
    notes: "Demo: all documents received",
  });
  console.log("   ✓ DOCUMENTATION → FULLY_RECEIVED");

  console.log("\n6. Hand off: CX → Binding…");
  await assignVisaCase(
    { userId: cx.id, role: "cx" },
    visaCaseId,
    { assignedUserId: binding.id, notes: "Demo: CX to binding handoff" }
  );
  console.log(`   ✓ assigned to ${binding.fullName}`);

  console.log("\n7. Binding financial assessment…");
  await updateVisaCaseStatus(visaCaseId, { userId: binding.id, role: "binding" }, {
    subStatus: "REVIEW_PENDING",
    notes: "Demo: financial review pending",
  });
  await updateVisaCaseStatus(visaCaseId, { userId: binding.id, role: "binding" }, {
    subStatus: "UNDER_REVIEW",
    notes: "Demo: financial under review",
  });
  await updateVisaCaseStatus(visaCaseId, { userId: binding.id, role: "binding" }, {
    subStatus: "FINANCIAL_APPROVED",
    notes: "Demo: financial approved",
  });
  console.log("   ✓ FINANCIAL_ASSESSMENT → FINANCIAL_APPROVED");

  console.log("\n8. Hand off: Binding → Application…");
  await assignVisaCase(
    { userId: binding.id, role: "binding" },
    visaCaseId,
    { assignedUserId: application.id, notes: "Demo: binding to application handoff" }
  );
  console.log(`   ✓ assigned to ${application.fullName}`);

  console.log("\n9. Application case preparation…");
  await updateVisaCaseStatus(
    visaCaseId,
    { userId: application.id, role: "application" },
    {
      subStatus: "PROFILE_ASSESSMENT_COMPLETED",
      notes: "Demo: profile assessment completed",
    }
  );
  console.log("   ✓ CASE_PREPARATION → PROFILE_ASSESSMENT_COMPLETED");

  console.log("\n10. Upsert client_journey summary row…");
  await upsertClientJourney(moduleClientId, counsellor.id);
  console.log("   ✓ current stage: DOCUMENTS_IN_PROGRESS");

  console.log("\n11. Verify journey APIs…");
  const timeline = await getClientJourneyTimeline(moduleClientId);
  const summary = await getClientJourneySummary(moduleClientId);

  const phases = [...new Set(timeline.events.map((e) => e.phase))];
  const sources = [...new Set(timeline.events.map((e) => e.source))];

  console.log(`   ✓ timeline events: ${timeline.events.length}`);
  console.log(`   ✓ phases: ${phases.join(" → ")}`);
  console.log(`   ✓ sources: ${sources.join(", ")}`);
  console.log(`   ✓ summary stage: ${summary.currentJourneyStage}`);
  console.log(`   ✓ active visa cases: ${summary.activeVisaCases.length}`);

  const port = process.env.PORT ?? "5006";
  const base = `http://localhost:${port}`;

  console.log("\n" + "═".repeat(60));
  console.log("  Done — test in Swagger or curl:");
  console.log("═".repeat(60));
  console.log(`\n  Client name     : ${clientName}`);
  console.log(`  Legacy client id: ${legacyClientId}`);
  console.log(`  Modules client  : ${moduleClientId}`);
  console.log(`  Visa case       : ${visaCaseId}`);
  console.log(`\n  GET ${base}/api/modules/clients/${moduleClientId}/journey-timeline`);
  console.log(`  GET ${base}/api/modules/clients/${moduleClientId}/journey-summary`);
  console.log(`\n  Swagger: ${base}/api-docs → Module Client Journey`);
  console.log("");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌ seed:journey-demo failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
    if (isModulesDbConfigured()) {
      await getPoolSecond().end().catch(() => undefined);
    }
  });
