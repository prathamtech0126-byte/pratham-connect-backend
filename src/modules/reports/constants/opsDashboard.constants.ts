import type { Role } from "../../../types/role";
import type { VisaProcessingStage } from "../../visaCase/constants/visaCase.constants";
import {
  STAGE_ORDER,
  TEAM_PROCESSING_STAGES,
} from "../../visaCase/constants/visaCase.constants";

/** Roles allowed to view the personal ops dashboard. */
export const OPS_DASHBOARD_ROLES = [
  "cx",
  "binding",
  "application",
] as const satisfies readonly Role[];

export type OpsDashboardFilter =
  | "workload"
  | "today"
  | "weekly"
  | "monthly"
  | "custom";

export const OPS_DASHBOARD_FILTERS: readonly OpsDashboardFilter[] = [
  "workload",
  "today",
  "weekly",
  "monthly",
  "custom",
];

/** Cases with no status movement longer than this are flagged as stuck. */
export const OPS_STUCK_CASE_DAYS = 7;

/**
 * Dashboard profiles — binding + application share one combined view
 * for a single assignee (financial assessment through submission).
 */
export type OpsDashboardProfile = "cx" | "binding_application";

export const OPS_ROLE_TO_PROFILE: Record<
  (typeof OPS_DASHBOARD_ROLES)[number],
  OpsDashboardProfile
> = {
  cx: "cx",
  binding: "binding_application",
  application: "binding_application",
};

export const OPS_PROFILE_LABELS: Record<OpsDashboardProfile, string> = {
  cx: "CX",
  binding_application: "Binding & Application",
};

/** CX owns documentation only. */
export const CX_DASHBOARD_STAGES = TEAM_PROCESSING_STAGES.cx;

/**
 * Binding + Application combined — one person handles financial assessment
 * through submission on their assigned cases.
 */
export const BINDING_APPLICATION_DASHBOARD_STAGES: readonly VisaProcessingStage[] =
  STAGE_ORDER.filter(
    (stage) =>
      (TEAM_PROCESSING_STAGES.binding as readonly string[]).includes(stage) ||
      (TEAM_PROCESSING_STAGES.application as readonly string[]).includes(stage)
  );

export const dashboardStagesForProfile = (
  profile: OpsDashboardProfile
): readonly VisaProcessingStage[] =>
  profile === "cx" ? CX_DASHBOARD_STAGES : BINDING_APPLICATION_DASHBOARD_STAGES;

/** Cases at financial approved — ready to move into application work. */
export const BINDING_APPLICATION_READY_FOR_HANDOFF = {
  stage: "FINANCIAL_ASSESSMENT" as const,
  subStatus: "FINANCIAL_APPROVED",
};

export const CX_READY_FOR_HANDOFF = {
  stage: "DOCUMENTATION" as const,
  subStatus: "FULLY_RECEIVED",
};

/** Cases received from CX onto this assignee in the handoff window. */
export const RECEIVED_FROM_CX_ASSIGNMENT_TYPE = "cx_to_binding";
