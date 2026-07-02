type LeadTransferSnapshot = {
  assignmentStatus?: string | null;
  progressStatus?: string | null;
  currentCounsellorId?: number | null;
  isJunk?: boolean | null;
};

function isConvertedOrTerminal(lead: LeadTransferSnapshot): boolean {
  return (
    lead.assignmentStatus === "converted" ||
    lead.progressStatus === "converted" ||
    lead.assignmentStatus === "dropped" ||
    lead.progressStatus === "junk" ||
    lead.isJunk === true
  );
}

/** Manager may reassign only transferred leads currently assigned to them. */
export function canManagerReassignTransferredLead(
  lead: LeadTransferSnapshot,
  managerUserId: number
): boolean {
  if (isConvertedOrTerminal(lead)) return false;
  if (lead.assignmentStatus !== "transferred") return false;
  const ownerId = Number(lead.currentCounsellorId);
  return Number.isFinite(ownerId) && ownerId > 0 && ownerId === Number(managerUserId);
}

export function isLeadTransferBlockedForUser(
  lead: LeadTransferSnapshot,
  role?: string | null,
  userId?: number | null
): boolean {
  if (isConvertedOrTerminal(lead)) return true;

  if (lead.assignmentStatus === "transferred") {
    if (role === "manager" && userId != null) {
      return !canManagerReassignTransferredLead(lead, Number(userId));
    }
    return true;
  }

  return false;
}
