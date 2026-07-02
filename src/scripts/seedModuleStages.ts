import "dotenv/config";
import { getPoolSecond } from "../config/databaseConnectionSecond";
import {
  CLIENT_JOURNEY_STAGE_SEED,
  PAYMENT_STAGE_SEED,
  STAGE_PIPELINE_CODES,
  STAGE_PIPELINE_LABELS,
  VISA_CASE_MACRO_STAGE_SEED,
  VISA_CASE_SUB_STATUS_SEED,
} from "../modules/stages/constants/stage.constants";

type PipelineRow = { id: string; code: string };
type StageRow = { id: string; code: string };

async function seed() {
  const pool = getPoolSecond();

  console.log("Seeding module stage pipelines and definitions...");

  for (const code of STAGE_PIPELINE_CODES) {
    await pool.query(
      `
      INSERT INTO stage_pipelines (code, name, description, is_active)
      VALUES ($1, $2, $3, true)
      ON CONFLICT (code) DO UPDATE
      SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        updated_at = now()
      `,
      [
        code,
        STAGE_PIPELINE_LABELS[code],
        `Default ${STAGE_PIPELINE_LABELS[code]} pipeline`,
      ]
    );
  }

  const { rows: pipelines } = await pool.query<PipelineRow>(
    `SELECT id, code FROM stage_pipelines WHERE code = ANY($1::text[])`,
    [STAGE_PIPELINE_CODES]
  );

  const pipelineByCode = new Map(pipelines.map((row) => [row.code, row.id]));

  const upsertStage = async (input: {
    pipelineCode: string;
    parentId?: string | null;
    code: string;
    label: string;
    description?: string | null;
    kind?: string;
    team?: string | null;
    sortOrder?: number;
    metadata?: Record<string, unknown>;
    isSystem?: boolean;
  }) => {
    const pipelineId = pipelineByCode.get(input.pipelineCode);
    if (!pipelineId) {
      throw new Error(`Pipeline not found: ${input.pipelineCode}`);
    }

    await pool.query(
      `
      INSERT INTO stage_definitions (
        pipeline_id, parent_id, code, label, description, kind, team,
        sort_order, metadata, is_system, is_active
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9::jsonb, $10, true
      )
      ON CONFLICT (pipeline_id, code) DO UPDATE
      SET
        label = EXCLUDED.label,
        description = EXCLUDED.description,
        kind = EXCLUDED.kind,
        team = EXCLUDED.team,
        sort_order = EXCLUDED.sort_order,
        metadata = EXCLUDED.metadata,
        is_system = EXCLUDED.is_system,
        updated_at = now()
      `,
      [
        pipelineId,
        input.parentId ?? null,
        input.code,
        input.label,
        input.description ?? null,
        input.kind ?? (input.parentId ? "sub_status" : "macro"),
        input.team ?? null,
        input.sortOrder ?? 0,
        JSON.stringify(input.metadata ?? {}),
        input.isSystem ?? false,
      ]
    );
  };

  for (const stage of CLIENT_JOURNEY_STAGE_SEED) {
    await upsertStage({
      pipelineCode: "CLIENT_JOURNEY",
      code: stage.code,
      label: stage.label,
      sortOrder: stage.sortOrder,
      isSystem: stage.isSystem,
      kind: "macro",
    });
  }

  for (const stage of PAYMENT_STAGE_SEED) {
    await upsertStage({
      pipelineCode: "PAYMENT",
      code: stage.code,
      label: stage.label,
      sortOrder: stage.sortOrder,
      isSystem: stage.isSystem,
      kind: "macro",
    });
  }

  for (const stage of VISA_CASE_MACRO_STAGE_SEED) {
    await upsertStage({
      pipelineCode: "VISA_CASE_PROCESSING",
      code: stage.code,
      label: stage.label,
      sortOrder: stage.sortOrder,
      kind: stage.kind,
      team: stage.team,
      metadata: stage.metadata,
      isSystem: stage.isSystem,
    });
  }

  const { rows: macroStages } = await pool.query<StageRow>(
    `
    SELECT sd.id, sd.code
    FROM stage_definitions sd
    INNER JOIN stage_pipelines sp ON sp.id = sd.pipeline_id
    WHERE sp.code = 'VISA_CASE_PROCESSING'
      AND sd.kind = 'macro'
    `
  );

  const macroIdByCode = new Map(macroStages.map((row) => [row.code, row.id]));

  for (const subStatus of VISA_CASE_SUB_STATUS_SEED) {
    const parentId = macroIdByCode.get(subStatus.parentCode);
    if (!parentId) {
      throw new Error(`Missing macro stage for sub-status parent: ${subStatus.parentCode}`);
    }

    await upsertStage({
      pipelineCode: "VISA_CASE_PROCESSING",
      parentId,
      code: subStatus.code,
      label: subStatus.label,
      sortOrder: subStatus.sortOrder,
      kind: subStatus.kind,
      metadata: subStatus.metadata,
      isSystem: subStatus.isSystem,
    });
  }

  const { rows: counts } = await pool.query<{ pipeline_code: string; count: string }>(
    `
    SELECT sp.code AS pipeline_code, COUNT(sd.id)::text AS count
    FROM stage_pipelines sp
    LEFT JOIN stage_definitions sd ON sd.pipeline_id = sp.id
    GROUP BY sp.code
    ORDER BY sp.code
    `
  );

  console.log("✓ Stage seed complete:");
  for (const row of counts) {
    console.log(`   - ${row.pipeline_code}: ${row.count} stages`);
  }

  await pool.end();
  process.exit(0);
}

seed().catch((err) => {
  console.error("stage seed failed:", err);
  process.exit(1);
});
