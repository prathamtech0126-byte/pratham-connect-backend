import type { Role } from "../../../types/role";
import type { VisaProcessingStage } from "../../visaCase/constants/visaCase.constants";

/** Roles allowed to view the Binding team personal performance report. */
export const BINDING_REPORT_ROLES = [
  "binding",
  "developer",
] as const satisfies readonly Role[];

export type BindingReportFilter = "today" | "weekly" | "monthly" | "custom";

export const BINDING_REPORT_FILTERS: readonly BindingReportFilter[] = [
  "today",
  "weekly",
  "monthly",
  "custom",
];

export const BINDING_FINANCIAL_STAGE =
  "FINANCIAL_ASSESSMENT" as const satisfies VisaProcessingStage;

export const CX_TO_BINDING_ASSIGNMENT_TYPE = "cx_to_binding";
export const BINDING_TO_APPLICATION_ASSIGNMENT_TYPE = "binding_to_application";

/** CX documentation complete at handoff. */
export const BINDING_HANDOFF_DOC_COMPLETE_SUB_STATUS = "FULLY_RECEIVED";

/** Sub-statuses that count as blocked during binding work. */
export const BINDING_BLOCKED_SUB_STATUSES = [
  "DOCUMENTS_PENDING",
] as const;

export const BINDING_BLOCKED_ON_HOLD_SUB_STATUSES = [
  "AWAITING_DOCUMENTS",
  "AWAITING_FUNDS",
] as const;

/** Days in binding before TAT risk tiers apply (from cx_to_binding receipt). */
export const BINDING_TAT_SAFE_DAYS = 3;
export const BINDING_TAT_WARNING_DAYS = 5;
export const BINDING_TAT_BREACH_DAYS = 7;

export type BindingVisaApplicationStatusKey =
  | "pending"
  | "submitted"
  | "biometrics"
  | "interview"
  | "approved"
  | "rejected";

export type BindingVisaApplicationStatusBucket = {
  key: BindingVisaApplicationStatusKey;
  label: string;
  color: string;
};

/**
 * Visa pipeline buckets for the donut chart.
 * Biometrics / Interview reserved for future sub-statuses (return 0 until then).
 */
export const BINDING_VISA_APPLICATION_STATUS_BUCKETS: readonly BindingVisaApplicationStatusBucket[] =
  [
    { key: "pending", label: "Pending", color: "grey" },
    { key: "submitted", label: "Submitted", color: "blue" },
    { key: "biometrics", label: "Biometrics", color: "yellow" },
    { key: "interview", label: "Interview", color: "purple" },
    { key: "approved", label: "Approved", color: "green" },
    { key: "rejected", label: "Rejected", color: "red" },
  ];

/**
 * Maps current case stage / sub-status into simplified visa application buckets.
 */
export const BINDING_VISA_APPLICATION_STATUS_SQL = `
  CASE
    WHEN vc.decision = 'APPROVED' OR vc.current_sub_status = 'DECISION_APPROVED' THEN 'approved'
    WHEN vc.decision = 'REFUSED' OR vc.current_sub_status = 'DECISION_REFUSED' THEN 'rejected'
    WHEN vc.current_sub_status = 'FILE_SUBMITTED' OR vc.current_stage = 'SUBMISSION' THEN 'submitted'
    WHEN vc.current_stage IN ('CASE_PREPARATION', 'FILING_PREPARATION') THEN 'pending'
    WHEN vc.current_stage = '${BINDING_FINANCIAL_STAGE}' THEN 'pending'
    WHEN vc.current_stage = 'DECISION' AND vc.decision = 'PENDING' THEN 'pending'
    WHEN vc.current_stage = 'REFILING' THEN 'pending'
    ELSE 'pending'
  END
`;
