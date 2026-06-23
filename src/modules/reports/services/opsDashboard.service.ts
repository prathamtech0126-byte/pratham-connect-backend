import type { Role } from "../../../types/role";
import {
  OPS_PROFILE_LABELS,
  OPS_ROLE_TO_PROFILE,
  OPS_STUCK_CASE_DAYS,
  dashboardStagesForProfile,
  type OpsDashboardFilter,
} from "../constants/opsDashboard.constants";
import {
  STAGE_LABELS,
  SUB_STATUS_LABELS,
  VISA_CATEGORY_LABELS,
  type VisaProcessingStage,
} from "../../visaCase/constants/visaCase.constants";
import { SUB_STATUS_BY_STAGE } from "../../visaCase/services/visaCaseStateMachine";
import { fetchOpsDashboardAggregates } from "../models/opsDashboard.model";
import {
  resolveHandoffPeriod,
  resolveOpsDashboardScope,
} from "../utils/opsDashboardScope";

type ViewerContext = {
  userId: number;
  role: Role;
};

export type OpsDashboardInput = {
  filter: OpsDashboardFilter;
  fromDate?: string;
  toDate?: string;
};

type OpsTeamRole = keyof typeof OPS_ROLE_TO_PROFILE;

const parseCount = (value: string | undefined): number =>
  Number.parseInt(value ?? "0", 10) || 0;

const formatRate = (numerator: number, denominator: number): string | null => {
  if (denominator <= 0) return null;
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
};

const decidedCount = (approved: number, refused: number): number =>
  approved + refused;

const VISA_CATEGORY_SLUGS = ["visitor", "spouse", "student"] as const;

const assertOpsRole = (role: Role): OpsTeamRole => {
  if (!(role in OPS_ROLE_TO_PROFILE)) {
    throw new Error(
      "Forbidden: ops dashboard is only for cx, binding, and application roles"
    );
  }
  return role as OpsTeamRole;
};

const buildClientsByCategory = (
  rows: Array<{ category: string; count: string }>
): Array<{ category: string; label: string; count: number }> => {
  const countByCategory = new Map(
    rows.map((row) => [row.category, parseCount(row.count)])
  );

  return VISA_CATEGORY_SLUGS.map((category) => ({
    category,
    label: VISA_CATEGORY_LABELS[category] ?? category,
    count: countByCategory.get(category) ?? 0,
  }));
};

const buildBySubStatus = (
  teamStages: readonly VisaProcessingStage[],
  rows: Array<{ sub_status: string; count: string }>
): Array<{
  subStatus: string;
  label: string;
  stage: VisaProcessingStage;
  stageLabel: string;
  count: number;
}> => {
  const countBySubStatus = new Map(
    rows.map((row) => [row.sub_status, parseCount(row.count)])
  );

  return teamStages.flatMap((stage) =>
    SUB_STATUS_BY_STAGE[stage].map((subStatus) => ({
      subStatus,
      label: SUB_STATUS_LABELS[subStatus] ?? subStatus,
      stage,
      stageLabel: STAGE_LABELS[stage],
      count: countBySubStatus.get(subStatus) ?? 0,
    }))
  );
};

const buildCasesByStage = (
  teamStages: readonly VisaProcessingStage[],
  rows: Array<{ stage: string; count: string }>
): Array<{ stage: VisaProcessingStage; label: string; count: number }> => {
  const countByStage = new Map(
    rows.map((row) => [row.stage, parseCount(row.count)])
  );

  return teamStages.map((stage) => ({
    stage,
    label: STAGE_LABELS[stage],
    count: countByStage.get(stage) ?? 0,
  }));
};

export const getOpsDashboard = async (
  viewer: ViewerContext,
  input: OpsDashboardInput
) => {
  const opsRole = assertOpsRole(viewer.role);
  const profile = OPS_ROLE_TO_PROFILE[opsRole];
  const teamStages = dashboardStagesForProfile(profile);
  const scope = resolveOpsDashboardScope(
    input.filter,
    input.fromDate,
    input.toDate
  );
  const handoffPeriod = resolveHandoffPeriod(scope);

  const raw = await fetchOpsDashboardAggregates({
    assignedUserId: viewer.userId,
    profile,
    teamStages,
    scope,
    handoffPeriod,
  });

  const activeCases = parseCount(raw.totals?.active_cases);
  const approved = parseCount(raw.totals?.approved);
  const refused = parseCount(raw.totals?.refused);
  const withdrawn = parseCount(raw.totals?.withdrawn);
  const pending = parseCount(raw.totals?.pending);
  const filesSubmitted = parseCount(raw.totals?.files_submitted);
  const readyForHandoff = parseCount(raw.totals?.ready_for_handoff);
  const stuckCases = parseCount(raw.totals?.stuck_cases);
  const clientsOnHold = parseCount(raw.totals?.clients_on_hold);
  const clientWithdrawals = parseCount(raw.totals?.client_withdrawals);
  const handoffsCompleted = parseCount(raw.handoffsCompleted);
  const receivedFromCx = parseCount(raw.receivedFromCx);
  const decided = decidedCount(approved, refused);

  const clientsByCategory = buildClientsByCategory(raw.byCategory);
  const bySubStatus = buildBySubStatus(teamStages, raw.bySubStatus);
  const casesByStage = buildCasesByStage(teamStages, raw.byStage);

  const periodMeta =
    scope.mode === "workload"
      ? {
          filter: input.filter,
          mode: "workload" as const,
          description: "All active cases assigned to you (excludes withdrawn)",
        }
      : {
          filter: input.filter,
          mode: "period" as const,
          fromDate: scope.period.fromDate,
          toDate: scope.period.toDate,
          description:
            "Cases enrolled in the selected period and assigned to you",
        };

  const profileLabel = OPS_PROFILE_LABELS[profile];

  const attentionMetrics = {
    stuckCases,
    clientsOnHold,
    clientWithdrawals,
  };

  const summary =
    profile === "cx"
      ? {
          activeCases,
          clientsByCategory,
          readyForHandoff,
          handoffsCompleted,
          ...attentionMetrics,
        }
      : {
          activeCases,
          clientsByCategory,
          readyForApplicationWork: readyForHandoff,
          receivedFromCx,
          ...attentionMetrics,
        };

  const baseResponse = {
    meta: {
      title: `${profileLabel} Dashboard`,
      viewerRole: viewer.role,
      profile,
      profileLabel,
      scope: "assigned_to_me" as const,
      generatedAt: new Date().toISOString(),
      period: periodMeta,
      handoffPeriod,
      stuckCaseThresholdDays: OPS_STUCK_CASE_DAYS,
    },
    summary,
    bySubStatus,
    casesByStage,
  };

  if (profile === "cx") {
    return baseResponse;
  }

  return {
    ...baseResponse,
    caseOutcomes: {
      approved,
      refused,
      withdrawn,
      pending,
      filesSubmitted,
      approvalRate: formatRate(approved, decided),
      refusalRate: formatRate(refused, decided),
    },
  };
};
