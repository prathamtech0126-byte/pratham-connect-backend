import type { Role } from "../../../types/role";

export type VisaProcessingStage =
  | "DOCUMENTATION"
  | "FINANCIAL_ASSESSMENT"
  | "CASE_PREPARATION"
  | "FILING_PREPARATION"
  | "SUBMISSION"
  | "DECISION"
  | "REFILING"
  | "ON_HOLD"
  | "CLIENT_DROP";

export type VisaAssignedTeam = "none" | "cx" | "binding" | "application";

export const VISA_CASE_VIEW_ALL_ROLES = [
  "admin",
  "superadmin",
  "manager",
  "developer",
  "branchmanager",
] as const satisfies readonly Role[];

export const VISA_CASE_LIST_ROLES = [
  ...VISA_CASE_VIEW_ALL_ROLES,
  "counsellor",
  "cx",
  "binding",
  "application",
] as const satisfies readonly Role[];

export const VISA_CASE_TRAVEL_UPDATE_ROLES = [
  "counsellor",
  "cx",
  "admin",
  "manager",
  "developer",
  "binding",
  "application",
] as const satisfies readonly Role[];

export const VISA_CASE_DECISION_ROLES = [
  "application",
  "binding",
  "admin",
  "developer",
] as const satisfies readonly Role[];

/** Binding and Application operate as one post-CX ops team. */
export const VISA_CASE_BINDING_APPLICATION_ROLES = [
  "binding",
  "application",
] as const satisfies readonly Role[];

export const isBindingApplicationRole = (
  role: string
): role is (typeof VISA_CASE_BINDING_APPLICATION_ROLES)[number] =>
  (VISA_CASE_BINDING_APPLICATION_ROLES as readonly string[]).includes(role);

/** Stages owned by the combined binding + application team. */
export const BINDING_APPLICATION_PROCESSING_STAGES = [
  "FINANCIAL_ASSESSMENT",
  "CASE_PREPARATION",
  "FILING_PREPARATION",
  "SUBMISSION",
  "DECISION",
  "REFILING",
] as const satisfies readonly VisaProcessingStage[];

/** CX / Binding / Application — strict assignee visibility on list/detail. */
export const VISA_CASE_OPS_ROLES = [
  "cx",
  "binding",
  "application",
] as const satisfies readonly Role[];

/** Only these roles may receive visa case assignments. */
export const VISA_CASE_ASSIGNABLE_ROLES = VISA_CASE_OPS_ROLES;

export const isVisaCaseAssignableRole = (
  role: string
): role is (typeof VISA_CASE_ASSIGNABLE_ROLES)[number] =>
  (VISA_CASE_ASSIGNABLE_ROLES as readonly string[]).includes(role);

/** Roles that may assign visa cases to any ops team member. */
export const VISA_CASE_ASSIGN_ADMIN_ROLES = [
  "admin",
  "superadmin",
  "manager",
  "branchmanager",
] as const satisfies readonly Role[];

export const STAGE_ORDER: VisaProcessingStage[] = [
  "DOCUMENTATION",
  "FINANCIAL_ASSESSMENT",
  "CASE_PREPARATION",
  "FILING_PREPARATION",
  "SUBMISSION",
  "DECISION",
  "REFILING",
  "ON_HOLD",
  "CLIENT_DROP",
];

export const STAGE_TO_TEAM: Record<VisaProcessingStage, VisaAssignedTeam> = {
  DOCUMENTATION: "cx",
  FINANCIAL_ASSESSMENT: "binding",
  CASE_PREPARATION: "binding",
  FILING_PREPARATION: "binding",
  SUBMISSION: "binding",
  DECISION: "binding",
  REFILING: "binding",
  ON_HOLD: "none",
  CLIENT_DROP: "none",
};

/** API-facing ops teams — binding and application are shown as one team. */
export type DisplayAssignedTeam = "cx" | "binding";

export const DISPLAY_OPS_TEAMS: readonly DisplayAssignedTeam[] = [
  "cx",
  "binding",
] as const;

/** Map stored team (cx | binding | application) → display team (cx | binding). */
export const toDisplayAssignedTeam = (
  team: VisaAssignedTeam | string | null | undefined
): DisplayAssignedTeam | null => {
  if (team === "cx") return "cx";
  if (team === "binding" || team === "application") return "binding";
  return null;
};

/** Normalize team before persisting — application is stored as binding. */
export const normalizeAssignedTeamForStorage = (
  team: VisaAssignedTeam | string | null | undefined
): VisaAssignedTeam => {
  if (team === "application") return "binding";
  if (team === "cx" || team === "binding" || team === "none") return team;
  return "none";
};

/** DB filter teams for a display/query team (binding includes legacy application rows). */
export const assignedTeamsForFilter = (
  team: string | null | undefined
): VisaAssignedTeam[] | null => {
  if (!team) return null;
  if (team === "binding" || team === "application") {
    return ["binding", "application"];
  }
  if (team === "cx") return ["cx"];
  return null;
};

/** Ops team → macro stages shown together in filters / status pickers. */
export const TEAM_PROCESSING_STAGES: Record<
  Exclude<VisaAssignedTeam, "none">,
  readonly VisaProcessingStage[]
> = {
  cx: ["DOCUMENTATION"],
  binding: BINDING_APPLICATION_PROCESSING_STAGES,
  application: BINDING_APPLICATION_PROCESSING_STAGES,
};

export const formatProcessingLabel = (
  stage: VisaProcessingStage | string,
  subStatus: string
): string => {
  const stageLabel =
    STAGE_LABELS[stage as VisaProcessingStage] ?? String(stage);
  const subLabel = SUB_STATUS_LABELS[subStatus] ?? subStatus;
  return `${stageLabel}: ${subLabel}`;
};

export const STAGE_LABELS: Record<VisaProcessingStage, string> = {
  DOCUMENTATION: "Documentation",
  FINANCIAL_ASSESSMENT: "Financial Assessment",
  CASE_PREPARATION: "Case Preparation",
  FILING_PREPARATION: "Filing Preparation",
  SUBMISSION: "Submission",
  DECISION: "Decision",
  REFILING: "Refiling",
  ON_HOLD: "On Hold",
  CLIENT_DROP: "Client Drop",
};

export const SUB_STATUS_LABELS: Record<string, string> = {
  CHECKLIST_SHARED: "Checklist Shared",
  PARTIALLY_RECEIVED: "Partially Received",
  FULLY_RECEIVED: "Fully Received",
  ADDITIONAL_DOCUMENTS_REQUESTED: "Additional Documents Requested",
  REVIEW_PENDING: "Review Pending",
  UNDER_REVIEW: "Under Review",
  FINANCIAL_APPROVED: "Approved",
  DOCUMENTS_PENDING: "Documents Pending",
  PROFILE_ASSESSMENT_COMPLETED: "Profile Assessment Completed",
  SOP_COVER_LETTER_UNDER_PREPARATION: "SOP / Cover Letter Under Preparation",
  SOP_COVER_LETTER_REVIEW: "SOP / Cover Letter Review",
  SOP_APPROVED_BY_CLIENT: "SOP Approved by Client",
  APPLICATION_FORM_FILLING: "Application Form Filling",
  APPLICATION_REVIEW_PENDING: "Application Review Pending",
  READY_TO_FILE: "Ready to File",
  FILE_SUBMITTED: "File Submitted",
  DECISION_PENDING: "Pending",
  DECISION_APPROVED: "Approved",
  DECISION_REFUSED: "Refused",
  DECISION_WITHDRAWN: "Withdrawn",
  REFUSAL_ANALYSIS: "Refusal Analysis",
  REVISED_SOP_LOE_PREPARATION: "Revised SOP / LOE Preparation",
  READY_TO_REFILE: "Ready to Refile",
  REFILED: "Refiled",
  AWAITING_DOCUMENTS: "Awaiting Documents",
  AWAITING_FUNDS: "Awaiting Funds",
  CLIENT_REQUESTED_PAUSE: "Client Requested Pause",
  VOLUNTARY_WITHDRAWAL: "Voluntary Withdrawal",
  REFUND_PROCESSED: "Refund Processed",
  LOST_CONTACT: "Lost Contact",
};

/** All processing sub-status enum values (for API docs / filters). */
export const ALL_PROCESSING_SUB_STATUS_VALUES = Object.keys(
  SUB_STATUS_LABELS
) as (keyof typeof SUB_STATUS_LABELS)[];

/** Decision sub-status / outcome aliases → visa_cases.decision column. */
export const DECISION_SUB_STATUS_TO_OUTCOME = {
  DECISION_PENDING: "PENDING",
  DECISION_APPROVED: "APPROVED",
  DECISION_REFUSED: "REFUSED",
  DECISION_WITHDRAWN: "WITHDRAWN",
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REFUSED: "REFUSED",
  WITHDRAWN: "WITHDRAWN",
} as const satisfies Record<
  string,
  "PENDING" | "APPROVED" | "REFUSED" | "WITHDRAWN"
>;

export const isDecisionOutcomeFilter = (
  value: string
): value is keyof typeof DECISION_SUB_STATUS_TO_OUTCOME =>
  value in DECISION_SUB_STATUS_TO_OUTCOME;

const SUB_STATUS_LABEL_TO_ENUM = Object.fromEntries(
  Object.entries(SUB_STATUS_LABELS).map(([enumValue, label]) => [label, enumValue])
) as Record<string, keyof typeof SUB_STATUS_LABELS>;

/** Accept enum keys, display labels, or "Stage: Sub-status" display labels for list filters. */
export const resolveProcessingSubStatusFilter = (
  value: string
): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (isDecisionOutcomeFilter(trimmed)) return trimmed;
  if (trimmed in SUB_STATUS_LABELS) return trimmed;

  const byLabel = SUB_STATUS_LABEL_TO_ENUM[trimmed];
  if (byLabel) return byLabel;

  const colonIdx = trimmed.lastIndexOf(": ");
  if (colonIdx >= 0) {
    const subLabel = trimmed.slice(colonIdx + 2).trim();
    const fromDisplay = SUB_STATUS_LABEL_TO_ENUM[subLabel];
    if (fromDisplay) return fromDisplay;
  }

  return null;
};

export const REASON_OF_TRAVEL_LABELS: Record<string, string> = {
  TOURISM: "Tourism",
  FAMILY_VISIT: "Family Visit",
  BUSINESS_VISIT: "Business Visit",
  CONVOCATION: "Convocation",
  WEDDING: "Wedding",
  MEDICAL: "Medical",
  OTHER: "Other",
};

export const SPONSOR_RELATIONSHIP_LABELS: Record<string, string> = {
  SON: "Son",
  DAUGHTER: "Daughter",
  BROTHER: "Brother",
  SISTER: "Sister",
  FRIEND: "Friend",
  SELF_SPONSORED: "Self-Sponsored",
};

export const DECISION_LABELS: Record<string, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REFUSED: "Refused",
  WITHDRAWN: "Withdrawn",
};

export const STUDENT_APPLICATION_STATUS_LABELS: Record<string, string> = {
  app_submitted: "Application Submitted",
  offer_received: "Offer Received",
  cas_received: "CAS Received",
  visa_submitted: "Visa Submitted",
  process_completed: "Process Completed",
};

export const VISA_CATEGORY_LABELS: Record<string, string> = {
  visitor: "Visitor",
  spouse: "Spouse",
  student: "Student",
};
