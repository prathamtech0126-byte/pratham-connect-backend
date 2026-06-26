import type { Request } from "express";
import { logActivity } from "../../../services/activityLog.service";
import { getVisaCaseById } from "../models/visaCase.model";
import {
  DECISION_LABELS,
  formatProcessingLabel,
  REASON_OF_TRAVEL_LABELS,
  SPONSOR_RELATIONSHIP_LABELS,
} from "../constants/visaCase.constants";

type ActivityAction = "UPDATE" | "STATUS_CHANGE" | "CREATE";

const parseLegacyClientId = (value: unknown): number | null => {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export const logVisaCaseActivity = async (
  req: Request,
  input: {
    visaCaseId: string;
    legacyClientId?: number | null;
    action: ActivityAction;
    description: string;
    oldValue?: unknown;
    newValue?: unknown;
    metadata?: Record<string, unknown>;
    performedBy: number;
    performerRole?: string;
  }
): Promise<void> => {
  const clientId = parseLegacyClientId(input.legacyClientId);
  try {
    await logActivity(req, {
      entityType: "visa_case",
      entityId: clientId,
      clientId,
      action: input.action,
      oldValue: input.oldValue ?? null,
      newValue: input.newValue ?? null,
      description: input.description,
      metadata: {
        visaCaseId: input.visaCaseId,
        ...(input.performerRole ? { performerRole: input.performerRole } : {}),
        ...input.metadata,
      },
      performedBy: input.performedBy,
    });
  } catch {
    // activity log must not fail the main operation
  }
};

export const getVisaCaseLegacyClientId = async (
  visaCaseId: string
): Promise<number | null> => {
  const row = await getVisaCaseById(visaCaseId);
  return parseLegacyClientId(row?.client.legacyClientId);
};

export const logVisaCaseTravelUpdate = async (
  req: Request,
  visaCaseId: string,
  performedBy: number,
  performerRole: string,
  before: NonNullable<Awaited<ReturnType<typeof getVisaCaseById>>>,
  after: NonNullable<Awaited<ReturnType<typeof getVisaCaseById>>>
) => {
  await logVisaCaseActivity(req, {
    visaCaseId,
    legacyClientId: before.client.legacyClientId,
    action: "UPDATE",
    description: `Visa case travel details updated for ${before.person.fullName}`,
    oldValue: {
      reasonOfTravel: before.visaCase.reasonOfTravel,
      reasonLabel: before.visaCase.reasonOfTravel
        ? REASON_OF_TRAVEL_LABELS[before.visaCase.reasonOfTravel]
        : null,
      destinationCountryId: before.visaCase.destinationCountryId,
    },
    newValue: {
      reasonOfTravel: after.visaCase.reasonOfTravel,
      reasonLabel: after.visaCase.reasonOfTravel
        ? REASON_OF_TRAVEL_LABELS[after.visaCase.reasonOfTravel]
        : null,
      destinationCountryId: after.visaCase.destinationCountryId,
    },
    performedBy,
    performerRole,
  });
};

export const logVisaCaseSponsorshipUpdate = async (
  req: Request,
  visaCaseId: string,
  performedBy: number,
  performerRole: string,
  before: NonNullable<Awaited<ReturnType<typeof getVisaCaseById>>>,
  after: NonNullable<Awaited<ReturnType<typeof getVisaCaseById>>>
) => {
  await logVisaCaseActivity(req, {
    visaCaseId,
    legacyClientId: before.client.legacyClientId,
    action: "UPDATE",
    description: `Visa case sponsorship updated for ${before.person.fullName}`,
    oldValue: {
      sponsorRelationship: before.visaCase.sponsorRelationship,
      relationshipLabel: before.visaCase.sponsorRelationship
        ? SPONSOR_RELATIONSHIP_LABELS[before.visaCase.sponsorRelationship]
        : null,
      accompanyingMembersCount: before.visaCase.accompanyingMembersCount,
    },
    newValue: {
      sponsorRelationship: after.visaCase.sponsorRelationship,
      relationshipLabel: after.visaCase.sponsorRelationship
        ? SPONSOR_RELATIONSHIP_LABELS[after.visaCase.sponsorRelationship]
        : null,
      accompanyingMembersCount: after.visaCase.accompanyingMembersCount,
    },
    performedBy,
    performerRole,
  });
};

export const logVisaCaseStatusUpdate = async (
  req: Request,
  visaCaseId: string,
  performedBy: number,
  performerRole: string,
  before: NonNullable<Awaited<ReturnType<typeof getVisaCaseById>>>,
  after: NonNullable<Awaited<ReturnType<typeof getVisaCaseById>>>,
  notes?: string | null
) => {
  await logVisaCaseActivity(req, {
    visaCaseId,
    legacyClientId: before.client.legacyClientId,
    action: "STATUS_CHANGE",
    description: `Visa case status updated for ${before.person.fullName}: ${formatProcessingLabel(before.visaCase.currentStage, before.visaCase.currentSubStatus)} → ${formatProcessingLabel(after.visaCase.currentStage, after.visaCase.currentSubStatus)}`,
    oldValue: {
      stage: before.visaCase.currentStage,
      subStatus: before.visaCase.currentSubStatus,
      assignedTeam: before.visaCase.assignedTeam,
      submissionDate: before.visaCase.submissionDate,
      decisionDate: before.visaCase.decisionDate,
    },
    newValue: {
      stage: after.visaCase.currentStage,
      subStatus: after.visaCase.currentSubStatus,
      assignedTeam: after.visaCase.assignedTeam,
      submissionDate: after.visaCase.submissionDate,
      decisionDate: after.visaCase.decisionDate,
    },
    metadata: notes ? { notes } : undefined,
    performedBy,
    performerRole,
  });
};

export const logVisaCaseDecisionUpdate = async (
  req: Request,
  visaCaseId: string,
  performedBy: number,
  performerRole: string,
  before: NonNullable<Awaited<ReturnType<typeof getVisaCaseById>>>,
  after: NonNullable<Awaited<ReturnType<typeof getVisaCaseById>>>
) => {
  await logVisaCaseActivity(req, {
    visaCaseId,
    legacyClientId: before.client.legacyClientId,
    action: "STATUS_CHANGE",
    description: `Visa case decision updated for ${before.person.fullName}: ${DECISION_LABELS[before.visaCase.decision] ?? before.visaCase.decision} → ${DECISION_LABELS[after.visaCase.decision] ?? after.visaCase.decision}`,
    oldValue: {
      decision: before.visaCase.decision,
      decisionDate: before.visaCase.decisionDate,
      remarks: before.visaCase.remarks,
      stage: before.visaCase.currentStage,
      subStatus: before.visaCase.currentSubStatus,
    },
    newValue: {
      decision: after.visaCase.decision,
      decisionDate: after.visaCase.decisionDate,
      remarks: after.visaCase.remarks,
      stage: after.visaCase.currentStage,
      subStatus: after.visaCase.currentSubStatus,
    },
    performedBy,
    performerRole,
  });
};

export const logVisaCaseDocumentRequest = async (
  req: Request,
  visaCaseId: string,
  performedBy: number,
  performerRole: string,
  input: {
    legacyClientId: number | null;
    clientName: string;
    documentType: string;
    notes?: string | null;
  }
) => {
  await logVisaCaseActivity(req, {
    visaCaseId,
    legacyClientId: input.legacyClientId,
    action: "CREATE",
    description: `Document requested for ${input.clientName}: ${input.documentType}`,
    newValue: {
      documentType: input.documentType,
      notes: input.notes ?? null,
    },
    performedBy,
    performerRole,
  });
};

export const logVisaCaseDocumentFulfilled = async (
  req: Request,
  visaCaseId: string,
  performedBy: number,
  performerRole: string,
  input: {
    legacyClientId: number | null;
    clientName: string;
    documentType: string;
    notes?: string | null;
  }
) => {
  await logVisaCaseActivity(req, {
    visaCaseId,
    legacyClientId: input.legacyClientId,
    action: "UPDATE",
    description: `Document fulfilled for ${input.clientName}: ${input.documentType}`,
    newValue: {
      documentType: input.documentType,
      notes: input.notes ?? null,
      status: "FULFILLED",
    },
    performedBy,
    performerRole,
  });
};

export const logVisaCaseAssignment = async (
  req: Request,
  input: {
    visaCaseId: string;
    legacyClientId: number | null;
    performedBy: number;
    performerRole: string;
    assigneeName: string;
    assignedTeam: string;
    assignmentType: string;
    assignedUserId: number;
  }
) => {
  await logVisaCaseActivity(req, {
    visaCaseId: input.visaCaseId,
    legacyClientId: input.legacyClientId,
    action: "STATUS_CHANGE",
    description: `Visa case assigned to ${input.assigneeName} (${input.assignedTeam})`,
    metadata: {
      assignmentType: input.assignmentType,
      assignedUserId: input.assignedUserId,
      assignedTeam: input.assignedTeam,
    },
    performedBy: input.performedBy,
    performerRole: input.performerRole,
  });
};
