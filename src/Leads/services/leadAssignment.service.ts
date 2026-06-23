type LeadAssignSnapshot = {
  currentTelecallerId?: number | null;
  assignmentStatus?: string | null;
  progressStatus?: string | null;
  eligibilityStatus?: string | null;
  leadQuality?: string | null;
};

/** Admin assigns straight to counsellor (no telecaller handoff). */
export function isDirectCounsellorAssignment(lead: LeadAssignSnapshot): boolean {
  const hasTelecaller = lead.currentTelecallerId != null;
  const status = lead.assignmentStatus ?? "not_assigned";
  return !hasTelecaller || status === "assigned" || status === "not_assigned";
}

/**
 * Assign/reassign to counsellor. Does not advance progress to contacted —
 * contacted is applied only when eligibility + quality are set (leadProgressRules).
 */
export function buildCounsellorAssignPatch(
  currentLead: LeadAssignSnapshot,
  counsellorId: number,
  assignedBy: number,
  options: { isAdminLike?: boolean } = {}
): Record<string, unknown> {
  const existingTelecallerId = currentLead.currentTelecallerId ?? null;
  const patch: Record<string, unknown> = {
    currentCounsellorId: counsellorId,
    assignedBy,
  };

  if (existingTelecallerId != null) {
    patch.currentTelecallerId = existingTelecallerId;
  }

  const directAssign = options.isAdminLike && isDirectCounsellorAssignment(currentLead);

  if (directAssign) {
    patch.assignmentStatus = "assigned";
  } else {
    patch.assignmentStatus = "transferred";
    if (!currentLead.eligibilityStatus) {
      patch.eligibilityStatus = "eligible";
    }
  }

  return patch;
}
