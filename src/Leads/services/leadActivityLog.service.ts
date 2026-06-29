import { Request } from "express";
import { logActivity } from "../../services/activityLog.service";

type LeadSnapshot = {
  id: number;
  fullName: string;
  phone: string;
  assignmentStatus?: string | null;
  progressStatus?: string | null;
  eligibilityStatus?: string | null;
  leadQuality?: string | null;
  currentTelecallerId?: number | null;
  currentCounsellorId?: number | null;
  assignedBy?: number | null;
};

const leadSnapshot = (lead: LeadSnapshot) => ({
  id: lead.id,
  fullName: lead.fullName,
  phone: lead.phone,
  assignmentStatus: lead.assignmentStatus ?? null,
  progressStatus: lead.progressStatus ?? null,
  eligibilityStatus: lead.eligibilityStatus ?? null,
  leadQuality: lead.leadQuality ?? null,
  currentTelecallerId: lead.currentTelecallerId ?? null,
  currentCounsellorId: lead.currentCounsellorId ?? null,
  assignedBy: lead.assignedBy ?? null,
});

const formatLabel = (value: string | null | undefined) =>
  value ? value.replace(/_/g, " ") : "Not set";

export const isLeadTransferBlocked = (lead: {
  assignmentStatus?: string | null;
  progressStatus?: string | null;
}) =>
  lead.assignmentStatus === "transferred" ||
  lead.assignmentStatus === "converted" ||
  lead.progressStatus === "converted";

export const logLeadCreated = async (
  req: Request,
  lead: LeadSnapshot,
  performedBy: number
) => {
  await logActivity(req, {
    entityType: "lead",
    entityId: lead.id,
    action: "CREATE",
    newValue: leadSnapshot(lead),
    description: `Lead created: ${lead.fullName}`,
    metadata: { leadName: lead.fullName, phone: lead.phone },
    performedBy,
  });
};

export const logLeadAssignment = async (
  req: Request,
  input: {
    lead: LeadSnapshot;
    previous: LeadSnapshot;
    performedBy: number;
    telecallerId?: number | null;
    counsellorId?: number | null;
    telecallerName?: string | null;
    counsellorName?: string | null;
  }
) => {
  const { lead, previous, performedBy, telecallerId, counsellorId, telecallerName, counsellorName } =
    input;

  const transferredToCounsellor = counsellorId != null;
  const description = transferredToCounsellor
    ? `Lead transferred to counsellor: ${counsellorName ?? counsellorId}`
    : `Lead assigned to telecaller: ${telecallerName ?? telecallerId}`;

  await logActivity(req, {
    entityType: "lead",
    entityId: lead.id,
    action: "STATUS_CHANGE",
    oldValue: leadSnapshot(previous),
    newValue: leadSnapshot(lead),
    description,
    metadata: {
      leadName: lead.fullName,
      telecallerId: telecallerId ?? null,
      counsellorId: counsellorId ?? null,
      telecallerName: telecallerName ?? null,
      counsellorName: counsellorName ?? null,
      assignmentStatus: lead.assignmentStatus ?? null,
    },
    performedBy,
  });
};

export type BulkAssigneeSummary = {
  userId: number;
  userName: string;
  role: "telecaller" | "counsellor";
  count: number;
};

const formatBulkAssigneePhrase = (summaries: BulkAssigneeSummary[]) => {
  if (summaries.length === 1) {
    const s = summaries[0];
    const roleLabel = s.role === "counsellor" ? "counsellor" : "telecaller";
    return `${roleLabel} ${s.userName}`;
  }
  return summaries.map((s) => `${s.userName} (${s.count})`).join(", ");
};

/** One global activity log entry for bulk assign / distribute / junk restore flows. */
export const logBulkLeadAssignment = async (
  req: Request,
  input: {
    performedBy: number;
    leadCount: number;
    summaries: BulkAssigneeSummary[];
    action: "assigned" | "distributed" | "restored_and_assigned" | "restored_and_distributed";
    strategy?: string | null;
  }
) => {
  const { performedBy, leadCount, summaries, action, strategy } = input;
  if (leadCount <= 0 || summaries.length === 0) return;

  const leadWord = leadCount === 1 ? "lead" : "leads";
  const assigneePhrase = formatBulkAssigneePhrase(summaries);
  const strategyNote = strategy ? ` via ${strategy.replace(/_/g, " ")}` : "";

  let description: string;
  switch (action) {
    case "assigned":
      description = `Assigned ${leadCount} ${leadWord} to ${assigneePhrase}`;
      break;
    case "distributed":
      description =
        summaries.length === 1
          ? `Distributed ${leadCount} ${leadWord} to ${assigneePhrase}${strategyNote}`
          : `Distributed ${leadCount} ${leadWord}${strategyNote}: ${assigneePhrase}`;
      break;
    case "restored_and_assigned":
      description = `Restored and assigned ${leadCount} ${leadWord} to ${assigneePhrase}`;
      break;
    case "restored_and_distributed":
      description =
        summaries.length === 1
          ? `Restored and assigned ${leadCount} ${leadWord} to ${assigneePhrase}`
          : `Restored and distributed ${leadCount} ${leadWord}: ${assigneePhrase}`;
      break;
  }

  await logActivity(req, {
    entityType: "lead",
    entityId: null,
    action: "STATUS_CHANGE",
    description,
    metadata: {
      bulk: true,
      leadCount,
      summaries,
      strategy: strategy ?? null,
      bulkAction: action,
    },
    performedBy,
  });
};

export const logLeadUpdate = async (
  req: Request,
  input: {
    previous: LeadSnapshot;
    updated: LeadSnapshot;
    performedBy: number;
    patch: Record<string, unknown>;
  }
) => {
  const { previous, updated, performedBy, patch } = input;
  const entries: Array<{
    action: "UPDATE" | "STATUS_CHANGE";
    description: string;
    metadata?: Record<string, unknown>;
  }> = [];

  if (Object.prototype.hasOwnProperty.call(patch, "leadQuality")) {
    entries.push({
      action: "UPDATE",
      description: `Lead quality updated: ${formatLabel(previous.leadQuality)} → ${formatLabel(updated.leadQuality)}`,
      metadata: { leadName: updated.fullName, field: "leadQuality" },
    });
  }

  if (Object.prototype.hasOwnProperty.call(patch, "eligibilityStatus")) {
    entries.push({
      action: "UPDATE",
      description: `Lead eligibility updated: ${formatLabel(previous.eligibilityStatus)} → ${formatLabel(updated.eligibilityStatus)}`,
      metadata: { leadName: updated.fullName, field: "eligibilityStatus" },
    });
  }

  if (Object.prototype.hasOwnProperty.call(patch, "progressStatus")) {
    entries.push({
      action: "STATUS_CHANGE",
      description: `Lead progress updated: ${formatLabel(previous.progressStatus)} → ${formatLabel(updated.progressStatus)}`,
      metadata: { leadName: updated.fullName, field: "progressStatus" },
    });
  }

  const assignmentKeys = ["currentTelecallerId", "currentCounsellorId", "assignedBy", "assignmentStatus"];
  if (assignmentKeys.some((key) => Object.prototype.hasOwnProperty.call(patch, key))) {
    entries.push({
      action: "STATUS_CHANGE",
      description: `Lead assignment updated for ${updated.fullName}`,
      metadata: { leadName: updated.fullName, field: "assignment" },
    });
  }

  const infoKeys = [
    "fullName",
    "phone",
    "whatsapp",
    "email",
    "city",
    "leadType",
    "leadSource",
    "latestNote",
    "customAnswers",
  ];
  if (infoKeys.some((key) => Object.prototype.hasOwnProperty.call(patch, key))) {
    entries.push({
      action: "UPDATE",
      description: `Lead information updated: ${updated.fullName}`,
      metadata: { leadName: updated.fullName, field: "info" },
    });
  }

  if (!entries.length) {
    entries.push({
      action: "UPDATE",
      description: `Lead updated: ${updated.fullName}`,
      metadata: { leadName: updated.fullName },
    });
  }

  for (const entry of entries) {
    await logActivity(req, {
      entityType: "lead",
      entityId: updated.id,
      action: entry.action,
      oldValue: leadSnapshot(previous),
      newValue: leadSnapshot(updated),
      description: entry.description,
      metadata: entry.metadata,
      performedBy,
    });
  }
};

export const logLeadJunk = async (
  req: Request,
  lead: LeadSnapshot,
  previous: LeadSnapshot,
  performedBy: number,
  reason?: string
) => {
  await logActivity(req, {
    entityType: "lead",
    entityId: lead.id,
    action: "STATUS_CHANGE",
    oldValue: leadSnapshot(previous),
    newValue: leadSnapshot(lead),
    description: `Lead marked as junk: ${lead.fullName}`,
    metadata: { leadName: lead.fullName, reason: reason ?? null },
    performedBy,
  });
};

export const logLeadConverted = async (
  req: Request,
  lead: LeadSnapshot,
  previous: LeadSnapshot,
  performedBy: number,
  clientId: number
) => {
  await logActivity(req, {
    entityType: "lead",
    entityId: lead.id,
    action: "STATUS_CHANGE",
    oldValue: leadSnapshot(previous),
    newValue: leadSnapshot(lead),
    description: `Lead converted to client: ${lead.fullName}`,
    metadata: { leadName: lead.fullName, clientId },
    performedBy,
  });
};

export const logLeadDropped = async (
  req: Request,
  lead: LeadSnapshot,
  previous: LeadSnapshot,
  performedBy: number,
  reason: string
) => {
  await logActivity(req, {
    entityType: "lead",
    entityId: lead.id,
    action: "STATUS_CHANGE",
    oldValue: leadSnapshot(previous),
    newValue: leadSnapshot(lead),
    description: `Lead dropped by counsellor: ${lead.fullName}`,
    metadata: { leadName: lead.fullName, reason },
    performedBy,
  });
};

export const logLeadFollowup = async (
  req: Request,
  lead: LeadSnapshot,
  previous: LeadSnapshot,
  performedBy: number,
  followupAt: Date,
  message?: string | null
) => {
  await logActivity(req, {
    entityType: "lead",
    entityId: lead.id,
    action: "STATUS_CHANGE",
    oldValue: leadSnapshot(previous),
    newValue: leadSnapshot(lead),
    description: `Follow-up scheduled for ${lead.fullName}`,
    metadata: {
      leadName: lead.fullName,
      followupAt: followupAt.toISOString(),
      message: message ?? null,
    },
    performedBy,
  });
};
