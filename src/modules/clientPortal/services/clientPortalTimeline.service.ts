import { eq } from "drizzle-orm";
import { db } from "../../../config/databaseConnection";
import {
  getPoolSecond,
  isModulesDbConfigured,
} from "../../../config/databaseConnectionSecond";
import { clientInformation } from "../../../schemas/clientInformation.schema";
import { listChecklistAssignmentsForClient } from "../../clientDocuments/services/clientDocumentChecklist.service";
import { getClientPortalProfile } from "./clientPortalAuth.service";

export type ClientTimelineStepStatus = "completed" | "in_progress" | "pending";

export interface ClientPortalTimelineStep {
  code: string;
  title: string;
  description: string;
  status: ClientTimelineStepStatus;
  occurredAt: string | null;
  helpText: string | null;
  sortOrder: number;
}

export interface ClientPortalTimeline {
  progressPercent: number;
  completedSteps: number;
  totalSteps: number;
  currentPhaseLabel: string;
  currentStepCode: string;
  steps: ClientPortalTimelineStep[];
  journeyStage: string | null;
  visaResult: string | null;
  enrollmentDate: string | null;
  note: string;
}

type JourneyContext = {
  clientUuid: string | null;
  currentStage: string | null;
  visaResult: string | null;
  stageUpdatedAt: string | null;
  completedAt: string | null;
  createdAt: string | null;
  stageDates: Map<string, string>;
};

const TIMELINE_STEPS = [
  {
    code: "APPLICATION_STARTED",
    title: "Application Started",
    description:
      "Your application has been created and registered in our system.",
    helpText: null,
  },
  {
    code: "DOCUMENTS_SUBMITTED",
    title: "Documents Submitted",
    description:
      "All required documents have been uploaded and submitted for review.",
    helpText: null,
  },
  {
    code: "UNDER_REVIEW",
    title: "Under Review",
    description: "Our team is reviewing your application and documents.",
    helpText:
      "Your application is currently under review. This process typically takes 5–10 business days. You will be notified once the review is complete.",
  },
  {
    code: "APPLICATION_EVALUATION",
    title: "Application Evaluation",
    description:
      "Your application will be evaluated by the admissions or visa processing team.",
    helpText: null,
  },
  {
    code: "DECISION",
    title: "Decision",
    description: "The final decision will be communicated to you.",
    helpText: null,
  },
] as const;

const JOURNEY_STAGE_ORDER: Record<string, number> = {
  ENROLLED: 10,
  INITIAL_PAYMENT_PENDING: 20,
  INITIAL_PAYMENT_DONE: 30,
  DOCUMENTS_IN_PROGRESS: 40,
  DOCUMENTS_SUBMITTED: 50,
  BEFORE_VISA_PAYMENT_PENDING: 55,
  BEFORE_VISA_PAYMENT_DONE: 60,
  VISA_FILED: 70,
  VISA_RESULT_PENDING: 80,
  AFTER_VISA_PAYMENT_PENDING: 85,
  AFTER_VISA_PAYMENT_DONE: 90,
  VISA_APPROVED: 100,
  VISA_REJECTED: 100,
  COMPLETED: 110,
  ON_HOLD: 45,
};

function stageRank(stage: string | null | undefined): number {
  if (!stage) return 0;
  return JOURNEY_STAGE_ORDER[stage] ?? 0;
}

async function loadJourneyContext(clientId: number): Promise<JourneyContext> {
  const empty: JourneyContext = {
    clientUuid: null,
    currentStage: null,
    visaResult: null,
    stageUpdatedAt: null,
    completedAt: null,
    createdAt: null,
    stageDates: new Map(),
  };

  if (!isModulesDbConfigured()) return empty;

  try {
    const pool = getPoolSecond();
    const clientRes = await pool.query<{ id: string; created_at: Date | null }>(
      `SELECT id, created_at FROM clients WHERE legacy_client_id = $1 LIMIT 1`,
      [clientId]
    );
    const clientUuid = clientRes.rows[0]?.id ?? null;
    if (!clientUuid) return empty;

    const journeyRes = await pool.query<{
      current_stage: string;
      visa_result: string | null;
      stage_updated_at: Date;
      completed_at: Date | null;
      created_at: Date;
    }>(
      `SELECT current_stage, visa_result, stage_updated_at, completed_at, created_at
         FROM client_journey
        WHERE client_id = $1::uuid
        LIMIT 1`,
      [clientUuid]
    );

    const journey = journeyRes.rows[0];
    const eventsRes = await pool.query<{ to_stage: string; changed_at: Date }>(
      `SELECT to_stage, changed_at
         FROM client_journey_events
        WHERE client_id = $1::uuid
        ORDER BY changed_at ASC`,
      [clientUuid]
    );

    const stageDates = new Map<string, string>();
    for (const row of eventsRes.rows) {
      if (!stageDates.has(row.to_stage)) {
        stageDates.set(row.to_stage, new Date(row.changed_at).toISOString());
      }
    }

    return {
      clientUuid,
      currentStage: journey?.current_stage ?? null,
      visaResult: journey?.visa_result ?? null,
      stageUpdatedAt: journey?.stage_updated_at
        ? new Date(journey.stage_updated_at).toISOString()
        : null,
      completedAt: journey?.completed_at
        ? new Date(journey.completed_at).toISOString()
        : null,
      createdAt: journey?.created_at
        ? new Date(journey.created_at).toISOString()
        : clientRes.rows[0]?.created_at
          ? new Date(clientRes.rows[0].created_at).toISOString()
          : null,
      stageDates,
    };
  } catch {
    return empty;
  }
}

function computeDocumentStats(
  assignments: Awaited<ReturnType<typeof listChecklistAssignmentsForClient>>
) {
  let required = 0;
  let uploaded = 0;

  for (const assignment of assignments) {
    for (const section of assignment.sections) {
      for (const item of section.items) {
        if (!item.isMandatory) continue;
        required += 1;
        const status =
          item.reviewStatus ?? (item.uploads.length > 0 ? "under_review" : "not_uploaded");
        if (status !== "not_uploaded") uploaded += 1;
      }
    }
  }

  return { required, uploaded };
}

function resolveActiveStepIndex(
  journey: JourneyContext,
  docStats: ReturnType<typeof computeDocumentStats>
): number {
  const rank = stageRank(journey.currentStage);

  if (
    journey.visaResult === "APPROVED" ||
    journey.visaResult === "REJECTED" ||
    journey.currentStage === "VISA_APPROVED" ||
    journey.currentStage === "VISA_REJECTED" ||
    journey.currentStage === "COMPLETED"
  ) {
    return 4;
  }

  if (rank >= stageRank("VISA_FILED")) {
    return 3;
  }

  if (
    rank >= stageRank("DOCUMENTS_SUBMITTED") ||
    (docStats.required > 0 && docStats.uploaded >= docStats.required)
  ) {
    return 2;
  }

  if (rank >= stageRank("DOCUMENTS_IN_PROGRESS") || docStats.uploaded > 0) {
    return 1;
  }

  return 0;
}

function isDecisionComplete(journey: JourneyContext): boolean {
  return (
    journey.visaResult === "APPROVED" ||
    journey.visaResult === "REJECTED" ||
    journey.currentStage === "VISA_APPROVED" ||
    journey.currentStage === "VISA_REJECTED" ||
    journey.currentStage === "COMPLETED"
  );
}

function resolveStepOccurredAt(
  stepCode: string,
  journey: JourneyContext,
  enrollmentDate: string | null
): string | null {
  switch (stepCode) {
    case "APPLICATION_STARTED":
      return enrollmentDate || journey.stageDates.get("ENROLLED") || journey.createdAt;
    case "DOCUMENTS_SUBMITTED":
      return journey.stageDates.get("DOCUMENTS_SUBMITTED") ?? null;
    case "UNDER_REVIEW":
      return journey.stageDates.get("DOCUMENTS_SUBMITTED") || journey.stageUpdatedAt;
    case "APPLICATION_EVALUATION":
      return journey.stageDates.get("VISA_FILED") ?? null;
    case "DECISION":
      return (
        journey.completedAt ||
        journey.stageDates.get("VISA_APPROVED") ||
        journey.stageDates.get("VISA_REJECTED") ||
        journey.stageDates.get("COMPLETED") ||
        null
      );
    default:
      return null;
  }
}

function buildSteps(
  activeIndex: number,
  journey: JourneyContext,
  enrollmentDate: string | null
): ClientPortalTimelineStep[] {
  return TIMELINE_STEPS.map((step, index) => {
    let status: ClientTimelineStepStatus = "pending";
    if (index < activeIndex) status = "completed";
    else if (index === activeIndex) status = "in_progress";

    if (step.code === "DECISION" && isDecisionComplete(journey)) {
      status = "completed";
    }

    return {
      code: step.code,
      title: step.title,
      description: step.description,
      status,
      occurredAt:
        status === "pending"
          ? null
          : resolveStepOccurredAt(step.code, journey, enrollmentDate),
      helpText: status === "in_progress" ? step.helpText : null,
      sortOrder: index + 1,
    };
  });
}

export async function getClientPortalTimeline(
  accountId: number
): Promise<ClientPortalTimeline> {
  const profile = await getClientPortalProfile(accountId);
  const clientId = profile.clientId;

  const [clientRow, assignments, journey] = await Promise.all([
    db
      .select({
        enrollmentDate: clientInformation.enrollmentDate,
        createdAt: clientInformation.createdAt,
      })
      .from(clientInformation)
      .where(eq(clientInformation.clientId, clientId))
      .limit(1)
      .then((rows) => rows[0]),
    listChecklistAssignmentsForClient(clientId),
    loadJourneyContext(clientId),
  ]);

  const enrollmentDate =
    clientRow?.enrollmentDate?.toString() ?? clientRow?.createdAt?.toISOString() ?? null;

  const docStats = computeDocumentStats(assignments);
  const activeIndex = resolveActiveStepIndex(journey, docStats);
  const steps = buildSteps(activeIndex, journey, enrollmentDate);

  const completedSteps = steps.filter((s) => s.status === "completed").length;
  const totalSteps = steps.length;
  const progressPercent = Math.round((completedSteps / totalSteps) * 100);
  const currentStep = steps.find((s) => s.status === "in_progress") ?? steps[activeIndex];

  return {
    progressPercent,
    completedSteps,
    totalSteps,
    currentPhaseLabel: currentStep?.title ?? "In Progress",
    currentStepCode: currentStep?.code ?? "APPLICATION_STARTED",
    steps,
    journeyStage: journey.currentStage,
    visaResult: journey.visaResult,
    enrollmentDate,
    note: "Timeline dates are estimates. Updates are reflected within 1–2 business days.",
  };
}
