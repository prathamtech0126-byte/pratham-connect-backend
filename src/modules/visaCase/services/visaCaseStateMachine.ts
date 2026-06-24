import type { Role } from "../../../types/role";
import {
  STAGE_ORDER,
  STAGE_TO_TEAM,
  VISA_CASE_BINDING_APPLICATION_ROLES,
  type VisaProcessingStage,
} from "../constants/visaCase.constants";

export type VisaProcessingSubStatus =
  | "CHECKLIST_SHARED"
  | "PARTIALLY_RECEIVED"
  | "FULLY_RECEIVED"
  | "ADDITIONAL_DOCUMENTS_REQUESTED"
  | "REVIEW_PENDING"
  | "UNDER_REVIEW"
  | "FINANCIAL_APPROVED"
  | "DOCUMENTS_PENDING"
  | "PROFILE_ASSESSMENT_COMPLETED"
  | "SOP_COVER_LETTER_UNDER_PREPARATION"
  | "SOP_COVER_LETTER_REVIEW"
  | "SOP_APPROVED_BY_CLIENT"
  | "APPLICATION_FORM_FILLING"
  | "APPLICATION_REVIEW_PENDING"
  | "READY_TO_FILE"
  | "FILE_SUBMITTED"
  | "DECISION_PENDING"
  | "DECISION_APPROVED"
  | "DECISION_REFUSED"
  | "DECISION_WITHDRAWN"
  | "REFUSAL_ANALYSIS"
  | "REVISED_SOP_LOE_PREPARATION"
  | "READY_TO_REFILE"
  | "REFILED"
  | "AWAITING_DOCUMENTS"
  | "AWAITING_FUNDS"
  | "CLIENT_REQUESTED_PAUSE"
  | "VOLUNTARY_WITHDRAWAL"
  | "REFUND_PROCESSED"
  | "LOST_CONTACT";

export const SUB_STATUS_BY_STAGE: Record<
  VisaProcessingStage,
  VisaProcessingSubStatus[]
> = {
  DOCUMENTATION: [
    "CHECKLIST_SHARED",
    "PARTIALLY_RECEIVED",
    "FULLY_RECEIVED",
    "ADDITIONAL_DOCUMENTS_REQUESTED",
  ],
  FINANCIAL_ASSESSMENT: [
    "REVIEW_PENDING",
    "UNDER_REVIEW",
    "FINANCIAL_APPROVED",
    "DOCUMENTS_PENDING",
  ],
  CASE_PREPARATION: [
    "PROFILE_ASSESSMENT_COMPLETED",
    "SOP_COVER_LETTER_UNDER_PREPARATION",
    "SOP_COVER_LETTER_REVIEW",
    "SOP_APPROVED_BY_CLIENT",
  ],
  FILING_PREPARATION: [
    "APPLICATION_FORM_FILLING",
    "APPLICATION_REVIEW_PENDING",
    "READY_TO_FILE",
  ],
  SUBMISSION: ["FILE_SUBMITTED"],
  DECISION: [
    "DECISION_PENDING",
    "DECISION_APPROVED",
    "DECISION_REFUSED",
    "DECISION_WITHDRAWN",
  ],
  REFILING: [
    "REFUSAL_ANALYSIS",
    "REVISED_SOP_LOE_PREPARATION",
    "READY_TO_REFILE",
    "REFILED",
  ],
  ON_HOLD: [
    "AWAITING_DOCUMENTS",
    "AWAITING_FUNDS",
    "CLIENT_REQUESTED_PAUSE",
  ],
  CLIENT_DROP: [
    "VOLUNTARY_WITHDRAWAL",
    "REFUND_PROCESSED",
    "LOST_CONTACT",
  ],
};

/** Stages that may be entered from any prior stage (pause / drop). */
const FLEX_ENTRY_STAGES: VisaProcessingStage[] = ["ON_HOLD", "CLIENT_DROP"];

export const SUB_STATUS_TO_STAGE = Object.entries(SUB_STATUS_BY_STAGE).reduce(
  (acc, [stage, subs]) => {
    for (const sub of subs) {
      acc[sub as VisaProcessingSubStatus] = stage as VisaProcessingStage;
    }
    return acc;
  },
  {} as Record<VisaProcessingSubStatus, VisaProcessingStage>
);

const ADMIN_STAGE_ROLES: Role[] = [
  "admin",
  "manager",
  "developer",
  "superadmin",
];

const BINDING_APPLICATION_STAGE_ROLES: Role[] = [
  ...VISA_CASE_BINDING_APPLICATION_ROLES,
  ...ADMIN_STAGE_ROLES,
];

const STAGE_ROLE_MAP: Record<VisaProcessingStage, Role[]> = {
  DOCUMENTATION: ["cx", "counsellor", ...ADMIN_STAGE_ROLES],
  FINANCIAL_ASSESSMENT: BINDING_APPLICATION_STAGE_ROLES,
  CASE_PREPARATION: BINDING_APPLICATION_STAGE_ROLES,
  FILING_PREPARATION: BINDING_APPLICATION_STAGE_ROLES,
  SUBMISSION: BINDING_APPLICATION_STAGE_ROLES,
  DECISION: BINDING_APPLICATION_STAGE_ROLES,
  REFILING: BINDING_APPLICATION_STAGE_ROLES,
  ON_HOLD: [
    "cx",
    "counsellor",
    ...VISA_CASE_BINDING_APPLICATION_ROLES,
    ...ADMIN_STAGE_ROLES,
  ],
  CLIENT_DROP: [
    "cx",
    "counsellor",
    ...VISA_CASE_BINDING_APPLICATION_ROLES,
    ...ADMIN_STAGE_ROLES,
  ],
};

export const stageForSubStatus = (
  subStatus: VisaProcessingSubStatus
): VisaProcessingStage => SUB_STATUS_TO_STAGE[subStatus];

export const isSubStatusValidForStage = (
  stage: VisaProcessingStage,
  subStatus: VisaProcessingSubStatus
): boolean => SUB_STATUS_BY_STAGE[stage].includes(subStatus);

export const canRoleUpdateStage = (
  role: Role,
  stage: VisaProcessingStage
): boolean => {
  if (role === "developer") return true;
  return STAGE_ROLE_MAP[stage].includes(role);
};

export const teamForStage = (stage: VisaProcessingStage) =>
  STAGE_TO_TEAM[stage];

const stageIndex = (stage: VisaProcessingStage): number =>
  STAGE_ORDER.indexOf(stage);

export type StatusTransitionInput = {
  currentStage: VisaProcessingStage;
  currentSubStatus: VisaProcessingSubStatus;
  nextSubStatus: VisaProcessingSubStatus;
  role: Role;
  adminOverride?: boolean;
};

export type StatusTransitionResult =
  | {
      ok: true;
      nextStage: VisaProcessingStage;
      nextSubStatus: VisaProcessingSubStatus;
      assignedTeam: (typeof STAGE_TO_TEAM)[VisaProcessingStage];
    }
  | { ok: false; message: string };

export const validateStatusTransition = (
  input: StatusTransitionInput
): StatusTransitionResult => {
  const nextStage = stageForSubStatus(input.nextSubStatus);
  if (!nextStage) {
    return { ok: false, message: "Invalid processing sub-status" };
  }

  if (!isSubStatusValidForStage(nextStage, input.nextSubStatus)) {
    return { ok: false, message: "Sub-status does not match stage" };
  }

  if (!input.adminOverride && !canRoleUpdateStage(input.role, nextStage)) {
    return {
      ok: false,
      message: "Forbidden: your role cannot update this processing stage",
    };
  }

  const currentIdx = stageIndex(input.currentStage);
  const nextIdx = stageIndex(nextStage);
  const isFlexEntry = FLEX_ENTRY_STAGES.includes(nextStage);
  const isResumingFromFlex = FLEX_ENTRY_STAGES.includes(input.currentStage);

  if (
    !input.adminOverride &&
    nextStage === "REFILING" &&
    input.currentStage !== "DECISION"
  ) {
    return {
      ok: false,
      message: "Refiling is only allowed after the decision stage",
    };
  }

  if (!input.adminOverride && !isFlexEntry) {
    if (nextIdx > currentIdx + 1) {
      return { ok: false, message: "Cannot skip processing stages" };
    }

    if (nextIdx < currentIdx && !isResumingFromFlex) {
      return {
        ok: false,
        message: "Cannot move backwards without admin override",
      };
    }
  }

  if (
    !input.adminOverride &&
    nextIdx === currentIdx &&
    input.currentSubStatus === input.nextSubStatus
  ) {
    return { ok: false, message: "Processing status is already set to this value" };
  }

  return {
    ok: true,
    nextStage,
    nextSubStatus: input.nextSubStatus,
    assignedTeam: teamForStage(nextStage),
  };
};

/** Set status directly — validates subStatus only, no stage-order or role checks. */
export const resolveDirectStatusChange = (
  subStatus: VisaProcessingSubStatus
): StatusTransitionResult => {
  const nextStage = stageForSubStatus(subStatus);
  if (!nextStage) {
    return { ok: false, message: "Invalid processing sub-status" };
  }

  if (!isSubStatusValidForStage(nextStage, subStatus)) {
    return { ok: false, message: "Sub-status does not match stage" };
  }

  return {
    ok: true,
    nextStage,
    nextSubStatus: subStatus,
    assignedTeam: teamForStage(nextStage),
  };
};
