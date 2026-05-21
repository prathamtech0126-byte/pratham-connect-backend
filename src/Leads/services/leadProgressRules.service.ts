type LeadProgressSnapshot = {
  progressStatus?: string | null;
  eligibilityStatus?: string | null;
  leadQuality?: string | null;
};

/**
 * Auto-advance not_contacted → contacted only when:
 * - eligibility is newly set/changed (any value), or
 * - lead quality is newly set to "bad".
 * excellent / good / average never trigger contacted.
 */
export function applyAutoContactedProgressIfNeeded(
  patch: Record<string, unknown>,
  previous: LeadProgressSnapshot
): void {
  const touchesEligibility = Object.prototype.hasOwnProperty.call(patch, "eligibilityStatus");
  const touchesQuality = Object.prototype.hasOwnProperty.call(patch, "leadQuality");

  // Eligibility/quality updates: server owns progress — ignore client-sent progressStatus.
  if (touchesEligibility || touchesQuality) {
    delete patch.progressStatus;
  } else if (Object.prototype.hasOwnProperty.call(patch, "progressStatus")) {
    return;
  }

  if (previous.progressStatus !== "not_contacted") return;

  const eligibilityChanged =
    touchesEligibility &&
    patch.eligibilityStatus != null &&
    patch.eligibilityStatus !== previous.eligibilityStatus;

  const qualitySetToBad =
    touchesQuality &&
    patch.leadQuality === "bad" &&
    previous.leadQuality !== "bad";

  if (eligibilityChanged || qualitySetToBad) {
    patch.progressStatus = "contacted";
  }
}
