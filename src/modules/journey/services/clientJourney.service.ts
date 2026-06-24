import {
  getPoolSecond,
  isModulesDbConfigured,
} from "../../../config/databaseConnectionSecond";
import { invalidateModulesCachesOnWrite } from "../../cache/invalidate";
import type { VisaProcessingStage } from "../../visaCase/constants/visaCase.constants";
import type { VisaProcessingSubStatus } from "../../visaCase/services/visaCaseStateMachine";

type JourneyStage =
  | "ENROLLED"
  | "INITIAL_PAYMENT_PENDING"
  | "INITIAL_PAYMENT_DONE"
  | "DOCUMENTS_IN_PROGRESS"
  | "DOCUMENTS_SUBMITTED"
  | "BEFORE_VISA_PAYMENT_PENDING"
  | "BEFORE_VISA_PAYMENT_DONE"
  | "VISA_FILED"
  | "VISA_RESULT_PENDING"
  | "AFTER_VISA_PAYMENT_PENDING"
  | "AFTER_VISA_PAYMENT_DONE"
  | "VISA_APPROVED"
  | "VISA_REJECTED"
  | "COMPLETED"
  | "ON_HOLD";

const log = (label: string, error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`[clientJourney] ${label}:`, msg);
};

const PAYMENT_STAGE_TO_JOURNEY: Record<string, JourneyStage> = {
  INITIAL: "INITIAL_PAYMENT_DONE",
  BEFORE_VISA: "BEFORE_VISA_PAYMENT_DONE",
  AFTER_VISA: "AFTER_VISA_PAYMENT_DONE",
};

/** Macro journey stage while ops processing is active. */
const PROCESSING_MACRO_STAGE: JourneyStage = "DOCUMENTS_IN_PROGRESS";

async function resolveClientId(legacyClientId: number): Promise<string | null> {
  const { rows } = await getPoolSecond().query<{ id: string }>(
    `SELECT id FROM clients WHERE legacy_client_id = $1 LIMIT 1`,
    [legacyClientId]
  );
  return rows[0]?.id ?? null;
}

function macroStageForProcessingSubStatus(
  subStatus: VisaProcessingSubStatus
): JourneyStage {
  if (subStatus === "FILE_SUBMITTED") return "VISA_FILED";
  return PROCESSING_MACRO_STAGE;
}

/**
 * Creates the client_journey summary row and initial ENROLLED event.
 * Idempotent — safe on every client sync (new or existing modules client).
 */
export async function ensureClientJourneyOnEnrollment(input: {
  clientId: string;
  stageUpdatedBy: number;
}): Promise<void> {
  if (!isModulesDbConfigured()) return;

  try {
    await getPoolSecond().query(
      `INSERT INTO client_journey (client_id, current_stage, stage_updated_by)
       VALUES ($1::uuid, 'ENROLLED'::journey_stage_enum, $2)
       ON CONFLICT (client_id) DO NOTHING`,
      [input.clientId, input.stageUpdatedBy]
    );

    const enrolledEvent = await getPoolSecond().query(
      `SELECT 1 FROM client_journey_events
       WHERE client_id = $1::uuid
         AND to_stage = 'ENROLLED'::journey_stage_enum
       LIMIT 1`,
      [input.clientId]
    );

    if (!enrolledEvent.rows[0]) {
      await getPoolSecond().query(
        `INSERT INTO client_journey_events (client_id, from_stage, to_stage, changed_by)
         VALUES ($1::uuid, NULL, 'ENROLLED'::journey_stage_enum, $2)`,
        [input.clientId, input.stageUpdatedBy]
      );
    }

    await invalidateModulesCachesOnWrite({ clientId: input.clientId });
  } catch (error) {
    log("ensureClientJourneyOnEnrollment", error);
  }
}

/**
 * Updates client_journey.current_stage and appends an immutable client_journey_events row.
 */
export async function transitionClientJourneyStage(input: {
  clientId: string;
  toStage: JourneyStage;
  changedBy: number;
  notes?: string | null;
  visaCaseId?: string | null;
  processingStage?: VisaProcessingStage | null;
  processingSubStatus?: VisaProcessingSubStatus | null;
  fromProcessingStage?: VisaProcessingStage | null;
  fromProcessingSubStatus?: VisaProcessingSubStatus | null;
}): Promise<boolean> {
  if (!isModulesDbConfigured()) return false;

  try {
    await ensureClientJourneyOnEnrollment({
      clientId: input.clientId,
      stageUpdatedBy: input.changedBy,
    });

    const current = await getPoolSecond().query<{
      current_stage: JourneyStage;
      current_processing_stage: VisaProcessingStage | null;
      current_processing_sub_status: VisaProcessingSubStatus | null;
    }>(
      `SELECT current_stage, current_processing_stage, current_processing_sub_status
         FROM client_journey
        WHERE client_id = $1::uuid
        LIMIT 1`,
      [input.clientId]
    );
    const row = current.rows[0];
    const fromStage = row?.current_stage ?? null;
    const fromProcessingStage =
      input.fromProcessingStage ?? row?.current_processing_stage ?? null;
    const fromProcessingSubStatus =
      input.fromProcessingSubStatus ?? row?.current_processing_sub_status ?? null;

    const macroChanged = fromStage !== input.toStage;
    const processingChanged =
      input.processingStage != null &&
      (fromProcessingStage !== input.processingStage ||
        fromProcessingSubStatus !== input.processingSubStatus);

    if (!macroChanged && !processingChanged) return false;

    await getPoolSecond().query(
      `UPDATE client_journey SET
         current_stage = $2::journey_stage_enum,
         stage_updated_by = $3,
         stage_updated_at = NOW(),
         updated_at = NOW(),
         notes = COALESCE($4, notes),
         current_processing_stage = COALESCE($5::visa_processing_stage_enum, current_processing_stage),
         current_processing_sub_status = COALESCE($6::visa_processing_sub_status_enum, current_processing_sub_status)
       WHERE client_id = $1::uuid`,
      [
        input.clientId,
        input.toStage,
        input.changedBy,
        input.notes ?? null,
        input.processingStage ?? null,
        input.processingSubStatus ?? null,
      ]
    );

    await getPoolSecond().query(
      `INSERT INTO client_journey_events (
         client_id, visa_case_id,
         from_stage, to_stage,
         from_processing_stage, to_processing_stage,
         from_processing_sub_status, to_processing_sub_status,
         changed_by, notes
       ) VALUES (
         $1::uuid, $2::uuid,
         $3::journey_stage_enum, $4::journey_stage_enum,
         $5::visa_processing_stage_enum, $6::visa_processing_stage_enum,
         $7::visa_processing_sub_status_enum, $8::visa_processing_sub_status_enum,
         $9, $10
       )`,
      [
        input.clientId,
        input.visaCaseId ?? null,
        fromStage,
        input.toStage,
        fromProcessingStage,
        input.processingStage ?? null,
        fromProcessingSubStatus,
        input.processingSubStatus ?? null,
        input.changedBy,
        input.notes ?? null,
      ]
    );

    await invalidateModulesCachesOnWrite({ clientId: input.clientId });
    return true;
  } catch (error) {
    log("transitionClientJourneyStage", error);
    return false;
  }
}

/** Map main-CRM payment stage → client journey stage after payment is recorded. */
export async function syncClientJourneyOnPayment(input: {
  legacyClientId: number;
  paymentStage: string;
  changedBy: number;
}): Promise<void> {
  if (!isModulesDbConfigured()) return;

  const toStage = PAYMENT_STAGE_TO_JOURNEY[input.paymentStage];
  if (!toStage) return;

  try {
    const clientId = await resolveClientId(input.legacyClientId);
    if (!clientId) return;

    await transitionClientJourneyStage({
      clientId,
      toStage,
      changedBy: input.changedBy,
    });
  } catch (error) {
    log("syncClientJourneyOnPayment", error);
  }
}

/** Advance journey when a visa case exists for the client. */
export async function syncClientJourneyOnVisaCaseCreated(input: {
  clientId: string;
  visaCaseId: string;
  changedBy: number;
  processingStage?: VisaProcessingStage;
  processingSubStatus?: VisaProcessingSubStatus;
}): Promise<void> {
  if (!isModulesDbConfigured()) return;

  const processingStage = input.processingStage ?? "DOCUMENTATION";
  const processingSubStatus = input.processingSubStatus ?? "CHECKLIST_SHARED";

  try {
    await ensureClientJourneyOnEnrollment({
      clientId: input.clientId,
      stageUpdatedBy: input.changedBy,
    });

    const current = await getPoolSecond().query<{ current_stage: JourneyStage }>(
      `SELECT current_stage FROM client_journey WHERE client_id = $1::uuid LIMIT 1`,
      [input.clientId]
    );
    const stage = current.rows[0]?.current_stage;

    const advanceFrom: JourneyStage[] = [
      "ENROLLED",
      "INITIAL_PAYMENT_PENDING",
      "INITIAL_PAYMENT_DONE",
    ];

    const toMacroStage = advanceFrom.includes(stage ?? "ENROLLED")
      ? PROCESSING_MACRO_STAGE
      : (stage ?? PROCESSING_MACRO_STAGE);

    await transitionClientJourneyStage({
      clientId: input.clientId,
      visaCaseId: input.visaCaseId,
      toStage: toMacroStage,
      changedBy: input.changedBy,
      notes: "Visa case created",
      processingStage,
      processingSubStatus,
    });
  } catch (error) {
    log("syncClientJourneyOnVisaCaseCreated", error);
  }
}

/** Keep client_journey in sync when ops updates visa case processing status. */
export async function syncClientJourneyOnProcessingStatusChange(input: {
  clientId: string;
  visaCaseId: string;
  fromStage: VisaProcessingStage | null;
  toStage: VisaProcessingStage;
  fromSubStatus: VisaProcessingSubStatus | null;
  toSubStatus: VisaProcessingSubStatus;
  changedBy: number;
  notes?: string | null;
}): Promise<void> {
  if (!isModulesDbConfigured()) return;

  try {
    await ensureClientJourneyOnEnrollment({
      clientId: input.clientId,
      stageUpdatedBy: input.changedBy,
    });

    const current = await getPoolSecond().query<{ current_stage: JourneyStage }>(
      `SELECT current_stage FROM client_journey WHERE client_id = $1::uuid LIMIT 1`,
      [input.clientId]
    );
    const currentMacro = current.rows[0]?.current_stage ?? "ENROLLED";
    const targetMacro = macroStageForProcessingSubStatus(input.toSubStatus);

    const toMacroStage =
      currentMacro === "ENROLLED" ||
      currentMacro === "INITIAL_PAYMENT_PENDING" ||
      currentMacro === "INITIAL_PAYMENT_DONE"
        ? PROCESSING_MACRO_STAGE
        : targetMacro === "VISA_FILED" ||
            currentMacro === PROCESSING_MACRO_STAGE ||
            currentMacro === "DOCUMENTS_SUBMITTED"
          ? targetMacro
          : currentMacro;

    await transitionClientJourneyStage({
      clientId: input.clientId,
      visaCaseId: input.visaCaseId,
      toStage: toMacroStage,
      changedBy: input.changedBy,
      notes: input.notes ?? null,
      fromProcessingStage: input.fromStage,
      fromProcessingSubStatus: input.fromSubStatus,
      processingStage: input.toStage,
      processingSubStatus: input.toSubStatus,
    });
  } catch (error) {
    log("syncClientJourneyOnProcessingStatusChange", error);
  }
}
