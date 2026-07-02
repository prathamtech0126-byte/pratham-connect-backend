import type { Role } from "../../../types/role";
import {
  STAGE_LABELS,
  STAGE_ORDER,
  STAGE_TO_TEAM,
  SUB_STATUS_LABELS,
  type VisaProcessingStage,
} from "../../visaCase/constants/visaCase.constants";
import { SUB_STATUS_BY_STAGE } from "../../visaCase/services/visaCaseStateMachine";

/** Top-level stage domains — each pipeline is managed independently. */
export const STAGE_PIPELINE_CODES = [
  "CLIENT_JOURNEY",
  "VISA_CASE_PROCESSING",
  "PAYMENT",
] as const;

export type StagePipelineCode = (typeof STAGE_PIPELINE_CODES)[number];

export const STAGE_PIPELINE_LABELS: Record<StagePipelineCode, string> = {
  CLIENT_JOURNEY: "Client Journey",
  VISA_CASE_PROCESSING: "Visa Case Processing",
  PAYMENT: "Payment",
};

export const STAGE_KINDS = ["macro", "sub_status"] as const;
export type StageKind = (typeof STAGE_KINDS)[number];

export const STAGE_ADMIN_ROLES = [
  "admin",
  "superadmin",
  "manager",
  "developer",
] as const satisfies readonly Role[];

export const STAGE_READ_ROLES = [
  "counsellor",
  "cx",
  "binding",
  "application",
  ...STAGE_ADMIN_ROLES,
] as const satisfies readonly Role[];

/** Client journey stages (from journey_stage_enum). */
export const CLIENT_JOURNEY_STAGE_SEED: Array<{
  code: string;
  label: string;
  sortOrder: number;
  isSystem: boolean;
}> = [
  { code: "ENROLLED", label: "Enrolled", sortOrder: 10, isSystem: true },
  {
    code: "INITIAL_PAYMENT_PENDING",
    label: "Initial Payment Pending",
    sortOrder: 20,
    isSystem: true,
  },
  {
    code: "INITIAL_PAYMENT_DONE",
    label: "Initial Payment Done",
    sortOrder: 30,
    isSystem: true,
  },
  {
    code: "DOCUMENTS_IN_PROGRESS",
    label: "Documents In Progress",
    sortOrder: 40,
    isSystem: true,
  },
  {
    code: "DOCUMENTS_SUBMITTED",
    label: "Documents Submitted",
    sortOrder: 50,
    isSystem: true,
  },
  {
    code: "BEFORE_VISA_PAYMENT_PENDING",
    label: "Before Visa Payment Pending",
    sortOrder: 60,
    isSystem: true,
  },
  {
    code: "BEFORE_VISA_PAYMENT_DONE",
    label: "Before Visa Payment Done",
    sortOrder: 70,
    isSystem: true,
  },
  { code: "VISA_FILED", label: "Visa Filed", sortOrder: 80, isSystem: true },
  {
    code: "VISA_RESULT_PENDING",
    label: "Visa Result Pending",
    sortOrder: 90,
    isSystem: true,
  },
  {
    code: "AFTER_VISA_PAYMENT_PENDING",
    label: "After Visa Payment Pending",
    sortOrder: 100,
    isSystem: true,
  },
  {
    code: "AFTER_VISA_PAYMENT_DONE",
    label: "After Visa Payment Done",
    sortOrder: 110,
    isSystem: true,
  },
  {
    code: "VISA_APPROVED",
    label: "Visa Approved",
    sortOrder: 120,
    isSystem: true,
  },
  {
    code: "VISA_REJECTED",
    label: "Visa Rejected",
    sortOrder: 130,
    isSystem: true,
  },
  { code: "COMPLETED", label: "Completed", sortOrder: 140, isSystem: true },
  { code: "ON_HOLD", label: "On Hold", sortOrder: 150, isSystem: true },
];

/** Payment stages (from stage_enum). */
export const PAYMENT_STAGE_SEED: Array<{
  code: string;
  label: string;
  sortOrder: number;
  isSystem: boolean;
}> = [
  { code: "INITIAL", label: "Initial", sortOrder: 10, isSystem: true },
  { code: "BEFORE_VISA", label: "Before Visa", sortOrder: 20, isSystem: true },
  { code: "AFTER_VISA", label: "After Visa", sortOrder: 30, isSystem: true },
  {
    code: "SUBMITTED_VISA",
    label: "Submitted Visa",
    sortOrder: 40,
    isSystem: true,
  },
];

const VISA_ADMIN_ROLES: Role[] = [
  "admin",
  "manager",
  "developer",
  "superadmin",
];

const VISA_BINDING_ROLES: Role[] = [
  "binding",
  "application",
  ...VISA_ADMIN_ROLES,
];

const VISA_STAGE_ROLE_MAP: Record<VisaProcessingStage, Role[]> = {
  DOCUMENTATION: ["cx", "counsellor", ...VISA_ADMIN_ROLES],
  FINANCIAL_ASSESSMENT: VISA_BINDING_ROLES,
  CASE_PREPARATION: VISA_BINDING_ROLES,
  FILING_PREPARATION: VISA_BINDING_ROLES,
  SUBMISSION: VISA_BINDING_ROLES,
  DECISION: VISA_BINDING_ROLES,
  REFILING: VISA_BINDING_ROLES,
  ON_HOLD: ["cx", "counsellor", "binding", "application", ...VISA_ADMIN_ROLES],
  CLIENT_DROP: [
    "cx",
    "counsellor",
    "binding",
    "application",
    ...VISA_ADMIN_ROLES,
  ],
};

const FLEX_ENTRY_STAGES = new Set<VisaProcessingStage>(["ON_HOLD", "CLIENT_DROP"]);

export const VISA_CASE_MACRO_STAGE_SEED = STAGE_ORDER.map((code, index) => ({
  code,
  label: STAGE_LABELS[code],
  sortOrder: (index + 1) * 10,
  kind: "macro" as const,
  team: STAGE_TO_TEAM[code],
  isSystem: true,
  metadata: {
    allowedRoles: VISA_STAGE_ROLE_MAP[code],
    flexEntry: FLEX_ENTRY_STAGES.has(code),
  },
}));

export const VISA_CASE_SUB_STATUS_SEED = STAGE_ORDER.flatMap((parentCode) =>
  SUB_STATUS_BY_STAGE[parentCode].map((code, index) => ({
    code,
    parentCode,
    label: SUB_STATUS_LABELS[code] ?? code,
    sortOrder: (index + 1) * 10,
    kind: "sub_status" as const,
    isSystem: true,
    metadata: {},
  }))
);

export const normalizeStageCode = (value: string): string =>
  value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
