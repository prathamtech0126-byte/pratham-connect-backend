import { inArray } from "drizzle-orm";
import { db } from "../../../config/databaseConnection";
import { users } from "../../../schemas/users.schema";
import type { Role } from "../../../types/role";
import {
  STAGE_LABELS,
  STAGE_ORDER,
  VISA_CATEGORY_LABELS,
  type VisaProcessingStage,
} from "../../visaCase/constants/visaCase.constants";
import {
  BACKEND_TEAM_LABELS,
  type BackendDashboardFilter,
} from "../constants/backendDashboard.constants";
import {
  fetchBackendDashboardAggregates,
  type BackendDashboardQuery,
} from "../models/backendDashboard.model";
import {
  resolveReportDateRange,
  type ReportDateRange,
} from "../utils/reportDateRange";
import { fetchScopedVisaCaseFinancialLookups } from "../../visaCase/models/visaCaseDashboard.model";
import { aggregateDashboardFinancials } from "../../visaCase/services/visaCaseFinancial.service";

type ViewerContext = {
  userId: number;
  role: Role;
};

export type BackendDashboardInput = {
  filter: BackendDashboardFilter;
  fromDate?: string;
  toDate?: string;
  branchCode?: string;
  category?: "visitor" | "spouse" | "student";
};

const parseCount = (value: string | undefined): number =>
  Number.parseInt(value ?? "0", 10) || 0;

const formatRate = (numerator: number, denominator: number): string | null => {
  if (denominator <= 0) return null;
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
};

const decidedCount = (approved: number, refused: number): number =>
  approved + refused;

const VISA_CATEGORY_SLUGS = ["visitor", "spouse", "student"] as const;

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

const buildCasesByStage = (
  rows: Array<{ stage: string; count: string }>
): Array<{ stage: VisaProcessingStage; label: string; count: number }> => {
  const countByStage = new Map(
    rows.map((row) => [row.stage, parseCount(row.count)])
  );

  return STAGE_ORDER.map((stage) => ({
    stage,
    label: STAGE_LABELS[stage],
    count: countByStage.get(stage) ?? 0,
  }));
};

const loadLeaderboardUsers = async (userIds: number[]) => {
  if (!userIds.length) return new Map<number, { fullName: string; role: string; empId: string | null }>();

  const rows = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      role: users.role,
      empId: users.emp_id,
    })
    .from(users)
    .where(inArray(users.id, userIds));

  return new Map(
    rows.map((row) => [
      row.id,
      {
        fullName: row.fullName,
        role: row.role,
        empId: row.empId ?? null,
      },
    ])
  );
};

export const getBackendDashboard = async (
  viewer: ViewerContext,
  input: BackendDashboardInput
) => {
  const period: ReportDateRange = resolveReportDateRange(
    input.filter,
    input.fromDate,
    input.toDate
  );

  const query: BackendDashboardQuery = {
    ...period,
    branchCode: input.branchCode,
    category: input.category,
  };

  const [raw, financialLookups] = await Promise.all([
    fetchBackendDashboardAggregates(query),
    fetchScopedVisaCaseFinancialLookups({
      fromDate: period.fromDate,
      toDate: period.toDate,
      branchCode: input.branchCode,
      category: input.category,
    }),
  ]);
  const financial = await aggregateDashboardFinancials(financialLookups);

  const totalClients = parseCount(raw.totals?.total_clients);
  const clientsByCategory = buildClientsByCategory(raw.byCategory);
  const approved = parseCount(raw.totals?.approved);
  const refused = parseCount(raw.totals?.refused);
  const withdrawn = parseCount(raw.totals?.withdrawn);
  const pending = parseCount(raw.totals?.pending);
  const filesSubmitted = parseCount(raw.totals?.files_submitted);
  const decided = decidedCount(approved, refused);
  const outstandingBalance = financial.balanceDue;

  const leaderboardUserIds = raw.teamLeaderboard
    .map((row) => Number.parseInt(row.assigned_user_id, 10))
    .filter((id) => Number.isFinite(id));

  const userById = await loadLeaderboardUsers(leaderboardUserIds);

  const teamLeaderboard = raw.teamLeaderboard.map((row) => {
    const userId = Number.parseInt(row.assigned_user_id, 10);
    const user = userById.get(userId);
    const team = row.assigned_team as keyof typeof BACKEND_TEAM_LABELS;
    const memberApproved = parseCount(row.approved);
    const memberRefused = parseCount(row.refused);
    const memberDecided = decidedCount(memberApproved, memberRefused);

    return {
      userId,
      fullName: user?.fullName ?? `User #${userId}`,
      empId: user?.empId ?? null,
      role: user?.role ?? null,
      team,
      teamLabel: BACKEND_TEAM_LABELS[team] ?? row.assigned_team,
      activeCases: parseCount(row.active_cases),
      approved: memberApproved,
      refused: memberRefused,
      withdrawn: parseCount(row.withdrawn),
      pending: parseCount(row.pending),
      filesSubmitted: parseCount(row.files_submitted),
      approvalRate: formatRate(memberApproved, memberDecided),
    };
  });

  return {
    meta: {
      title: "Backend Dashboard",
      viewerRole: viewer.role,
      generatedAt: new Date().toISOString(),
      period: {
        filter: input.filter,
        fromDate: period.fromDate,
        toDate: period.toDate,
      },
      branchCode: input.branchCode ?? null,
    },
    summary: {
      totalClients,
      clientsByCategory,
      approvalRate: formatRate(approved, decided),
      outstandingBalance,
      currency: "INR",
    },
    caseOutcomes: {
      approved,
      refused,
      withdrawn,
      pending,
      filesSubmitted,
      approvalRate: formatRate(approved, decided),
      refusalRate: formatRate(refused, decided),
    },
    casesByStage: buildCasesByStage(raw.byStage),
    teamLeaderboard,
  };
};
