import type { Role } from "../../../types/role";
import type { VisaProcessingStage } from "../../visaCase/constants/visaCase.constants";

/** Roles allowed to view the CX personal performance report. */
export const CX_REPORT_ROLES = ["cx", "developer"] as const satisfies readonly Role[];

export type CxReportFilter = "today" | "weekly" | "monthly" | "custom";

export const CX_REPORT_FILTERS: readonly CxReportFilter[] = [
  "today",
  "weekly",
  "monthly",
  "custom",
];

/** Days without case movement before TAT risk tiers apply. */
export const CX_TAT_SAFE_DAYS = 5;
export const CX_TAT_WARNING_DAYS = 7;
export const CX_TAT_BREACH_DAYS = 10;

/** Open document requests older than this count as overdue tasks. */
export const CX_DOC_REQUEST_SLA_DAYS = 2;

/**
 * CX sub-status transitions that count as a completed documentation task.
 */
export const CX_TASK_COMPLETION_SUB_STATUSES = [
  "CHECKLIST_SHARED",
  "PARTIALLY_RECEIVED",
  "FULLY_RECEIVED",
  "ADDITIONAL_DOCUMENTS_REQUESTED",
] as const;

export type CxReportLifecycleKey =
  | "documentation"
  | "backend_ops"
  | "binding"
  | "application"
  | "visa_filing"
  | "visa_result"
  | "post_visa";

export type CxReportLifecycleStage = {
  key: CxReportLifecycleKey;
  label: string;
};

/**
 * Simplified client lifecycle buckets shown on the CX report.
 * Maps visa processing stages (and decision) into UI-friendly groups.
 */
export const CX_REPORT_LIFECYCLE_STAGES: readonly CxReportLifecycleStage[] = [
  { key: "documentation", label: "Documentation" },
  { key: "backend_ops", label: "Backend Ops" },
  { key: "binding", label: "Binding" },
  { key: "application", label: "Application" },
  { key: "visa_filing", label: "Visa Filing" },
  { key: "visa_result", label: "Visa Result" },
  { key: "post_visa", label: "Post Visa" },
];

export const CX_LIFECYCLE_STAGE_SQL = `
  CASE
    WHEN vc.current_stage = 'DOCUMENTATION' THEN 'documentation'
    WHEN vc.current_stage = 'FINANCIAL_ASSESSMENT' THEN 'backend_ops'
    WHEN vc.current_stage = 'CASE_PREPARATION' THEN 'binding'
    WHEN vc.current_stage = 'FILING_PREPARATION' THEN 'application'
    WHEN vc.current_stage = 'SUBMISSION' THEN 'visa_filing'
    WHEN vc.current_stage = 'DECISION' AND vc.decision = 'PENDING' THEN 'visa_result'
    WHEN vc.current_stage = 'DECISION' AND vc.decision <> 'PENDING' THEN 'post_visa'
    ELSE 'documentation'
  END
`;

export const CX_DOC_REJECTION_REASONS = [
  { key: "blurry_scan", label: "Blurry scan", pattern: "blur" },
  { key: "expired_document", label: "Expired document", pattern: "expir" },
  { key: "wrong_format", label: "Wrong format", pattern: "format" },
  { key: "missing_page", label: "Missing page", pattern: "missing" },
] as const;

export const DOCUMENTATION_STAGE = "DOCUMENTATION" as const satisfies VisaProcessingStage;
