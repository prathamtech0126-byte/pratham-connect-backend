import type { Role } from "../../../types/role";
import {
  REASON_OF_TRAVEL_LABELS,
  SPONSOR_RELATIONSHIP_LABELS,
} from "../../visaCase/constants/visaCase.constants";
import { fetchDashboardAggregates, fetchScopedVisaCaseFinancialLookups, type DashboardDateFilter } from "../../visaCase/models/visaCaseDashboard.model";
import { aggregateDashboardFinancials } from "../../visaCase/services/visaCaseFinancial.service";
import {
  BACKEND_REPORT_DESTINATION_ALIASES,
  BACKEND_REPORT_DESTINATIONS,
  BACKEND_REPORT_FILTERS,
  BACKEND_REPORT_SPONSOR_TYPES,
  BACKEND_REPORT_TRAVEL_REASONS,
  type BackendReportFilter,
} from "../constants/backendReport.constants";
import {
  resolveReportDateRange,
  type ReportDateRange,
} from "../utils/reportDateRange";

type ViewerContext = {
  userId: number;
  role: Role;
};

export type BackendReportInput = {
  filter: BackendReportFilter;
  fromDate?: string;
  toDate?: string;
  branchCode?: string;
};

const parseCount = (value: string | undefined): number =>
  Number.parseInt(value ?? "0", 10) || 0;

const parseMoney = (value: string | undefined): string => {
  const num = Number.parseFloat(value ?? "0");
  return Number.isFinite(num) ? num.toFixed(2) : "0.00";
};

const formatRate = (numerator: number, denominator: number): string | null => {
  if (denominator <= 0) return null;
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
};

const formatAvgDays = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const num = Number.parseFloat(value);
  if (Number.isFinite(num)) {
    return Number.isInteger(num) ? String(num) : num.toFixed(1);
  }
  const match = value.match(/(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const days = Number.parseFloat(match[1]);
  return Number.isFinite(days)
    ? Number.isInteger(days)
      ? String(days)
      : days.toFixed(1)
    : null;
};

const topByCount = <T extends { count: string }>(
  rows: T[],
  pick: (row: T) => string,
  exclude: readonly string[] = ["Unknown"]
): string | null => {
  if (!rows.length) return null;
  const excluded = new Set(exclude);
  const sorted = [...rows]
    .filter((row) => !excluded.has(pick(row)))
    .sort((a, b) => parseCount(b.count) - parseCount(a.count));
  const top = sorted[0];
  if (!top || parseCount(top.count) === 0) return null;
  return pick(top);
};

const normalizeDestinationLabel = (
  countryName: string
): (typeof BACKEND_REPORT_DESTINATIONS)[number] | null => {
  if (
    (BACKEND_REPORT_DESTINATIONS as readonly string[]).includes(countryName)
  ) {
    return countryName as (typeof BACKEND_REPORT_DESTINATIONS)[number];
  }
  return BACKEND_REPORT_DESTINATION_ALIASES[countryName] ?? null;
};

const buildDestinationCountryRows = (
  rows: Array<{ country_name: string; count: string }>
): Array<{ label: string; count: number }> => {
  const countByLabel = new Map<string, number>();

  for (const row of rows) {
    const label = normalizeDestinationLabel(row.country_name) ?? row.country_name;
    if (label === "Unknown") continue;
    if (!label) continue;
    countByLabel.set(label, (countByLabel.get(label) ?? 0) + parseCount(row.count));
  }

  return [...countByLabel.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
};

const buildTravelReasonRows = (
  rows: Array<{ reason: string; count: string }>
): Array<{ label: string; count: number }> => {
  const countByKey = new Map(
    rows.map((row) => [row.reason, parseCount(row.count)])
  );

  return BACKEND_REPORT_TRAVEL_REASONS.map(({ key, label }) => ({
    label,
    count: countByKey.get(key) ?? 0,
  }));
};

const buildSponsorRows = (
  rows: Array<{ sponsor: string; count: string }>
): Array<{ label: string; count: number }> => {
  const countByKey = new Map(
    rows.map((row) => [row.sponsor, parseCount(row.count)])
  );

  return BACKEND_REPORT_SPONSOR_TYPES.map(({ key, label }) => ({
    label,
    count: countByKey.get(key) ?? 0,
  }));
};

const buildDecisionByDestination = (
  rows: Array<{
    country_name: string;
    approved: string;
    refused: string;
    withdrawn: string;
    pending: string;
    total: string;
  }>
) => {
  const aggregated = new Map<
    string,
    {
      destination: string;
      approved: number;
      refused: number;
      withdrawn: number;
      pending: number;
      total: number;
    }
  >();

  for (const row of rows) {
    const destination =
      normalizeDestinationLabel(row.country_name) ?? row.country_name;
    if (destination === "Unknown") continue;

    const existing = aggregated.get(destination) ?? {
      destination,
      approved: 0,
      refused: 0,
      withdrawn: 0,
      pending: 0,
      total: 0,
    };

    existing.approved += parseCount(row.approved);
    existing.refused += parseCount(row.refused);
    existing.withdrawn += parseCount(row.withdrawn);
    existing.pending += parseCount(row.pending);
    existing.total += parseCount(row.total);
    aggregated.set(destination, existing);
  }

  const destinations = [...aggregated.values()].sort(
    (a, b) => b.total - a.total || a.destination.localeCompare(b.destination)
  );

  const totals = destinations.reduce(
    (acc, row) => ({
      approved: acc.approved + row.approved,
      refused: acc.refused + row.refused,
      withdrawn: acc.withdrawn + row.withdrawn,
      pending: acc.pending + row.pending,
      total: acc.total + row.total,
    }),
    { approved: 0, refused: 0, withdrawn: 0, pending: 0, total: 0 }
  );

  return {
    rows: destinations,
    totals: {
      destination: "Total",
      ...totals,
    },
  };
};

export const getBackendReport = async (
  viewer: ViewerContext,
  input: BackendReportInput
) => {
  const period: ReportDateRange = resolveReportDateRange(
    input.filter,
    input.fromDate,
    input.toDate
  );

  const dashboardFilters: DashboardDateFilter = {
    fromDate: period.fromDate,
    toDate: period.toDate,
    branchCode: input.branchCode,
    includeEnrollmentTrend: false,
  };

  const [raw, financialLookups] = await Promise.all([
    fetchDashboardAggregates(dashboardFilters),
    fetchScopedVisaCaseFinancialLookups(dashboardFilters),
  ]);
  const financial = await aggregateDashboardFinancials(financialLookups);

  const totalCases = parseCount(raw.totals?.total_clients);
  const approved = parseCount(raw.totals?.approved);
  const refused = parseCount(raw.totals?.refused);
  const withdrawn = parseCount(raw.totals?.withdrawn);
  const pending = parseCount(raw.totals?.pending);
  const decided = approved + refused;

  const totalCharges = financial.totalCharges;
  const initialCharges = financial.initialCharges;
  const balanceDue = financial.balanceDue;
  const clientsWithBalance = financial.clientsWithBalance;
  const totalChargesNum = Number.parseFloat(totalCharges) || 0;
  const balanceDueNum = Number.parseFloat(balanceDue) || 0;
  const collectedCharges = Math.max(totalChargesNum - balanceDueNum, 0);
  const collectionRate = formatRate(collectedCharges, totalChargesNum);
  const approvalRate = formatRate(approved, decided);
  const finalizedCases = approved + refused + withdrawn;
  const avgDecisionDays =
    finalizedCases > 0
      ? formatAvgDays(raw.processingTimes?.avg_assignment_to_decision)
      : null;

  const topDestinationRaw = topByCount(raw.byDestination, (row) => row.country_name);
  const topDestination = topDestinationRaw
    ? normalizeDestinationLabel(topDestinationRaw) ?? topDestinationRaw
    : null;
  const topTravelReasonRaw = topByCount(raw.byTravelReason, (row) => row.reason);
  const topSponsorRaw = topByCount(raw.bySponsor, (row) => row.sponsor);

  const byDestinationCountry = buildDestinationCountryRows(raw.byDestination);

  const decisionByDestination = buildDecisionByDestination(
    raw.decisionByDestination
  );

  return {
    meta: {
      title: "Backend Report",
      viewerRole: viewer.role,
      generatedAt: new Date().toISOString(),
      period: {
        filter: input.filter,
        fromDate: period.fromDate,
        toDate: period.toDate,
      },
      branchCode: input.branchCode ?? null,
      availableFilters: [...BACKEND_REPORT_FILTERS],
    },
    kpiCards: {
      totalCases: {
        value: totalCases,
        subtitle: "Enrolled visa cases",
      },
      approvalRate: {
        value: approvalRate,
        subtitle: `${approved} of ${decided} decided`,
        decided,
        approved,
      },
      totalCharges: {
        value: totalCharges,
        currency: "INR",
        subtitle: "Billed across cases",
      },
      outstanding: {
        value: balanceDue,
        currency: "INR",
        subtitle: `${clientsWithBalance} client${clientsWithBalance === 1 ? "" : "s"} with balance`,
        clientsWithBalance,
      },
      collectionRate: {
        value: collectionRate,
        subtitle: "Of total charges",
      },
      avgDecisionDays: {
        value: avgDecisionDays,
        subtitle: "Assigned → decision",
      },
    },
    financialSummary: {
      currency: "INR",
      totalCharges,
      initialChargesReceived: initialCharges,
      financeCharges: financial.financeCharges,
      totalBalanceDue: balanceDue,
      collectionPercent: collectionRate,
      avgChargePerClient:
        totalCases > 0
          ? (Number.parseFloat(totalCharges) / totalCases).toFixed(2)
          : null,
      clientsFullyPaid: financial.clientsFullyPaid,
      clientsWithBalanceDue: clientsWithBalance,
    },
    quickHighlights: {
      topDestination,
      topTravelReason: topTravelReasonRaw
        ? REASON_OF_TRAVEL_LABELS[topTravelReasonRaw] ??
          topTravelReasonRaw.replace(/_/g, " ")
        : null,
      topSponsorType: topSponsorRaw
        ? SPONSOR_RELATIONSHIP_LABELS[topSponsorRaw] ??
          topSponsorRaw.replace(/_/g, " ")
        : null,
    },
    byDestinationCountry,
    byReasonOfTravel: buildTravelReasonRows(raw.byTravelReason),
    bySponsorRelationship: buildSponsorRows(raw.bySponsor),
    decisionByDestination,
    accompanyingMembers: {
      totalAccompanyingMembers: parseCount(
        raw.accompanying?.total_accompanying
      ),
      avgMembersPerCase: raw.accompanying?.avg_members
        ? formatAvgDays(raw.accompanying.avg_members)
        : null,
      casesWithAccompanying: parseCount(
        raw.accompanying?.cases_with_accompanying
      ),
    },
    processingTimes: {
      enrollmentToSubmissionDays: formatAvgDays(
        raw.processingTimes?.avg_enrollment_to_submission
      ),
      submissionToDecisionDays: formatAvgDays(
        raw.processingTimes?.avg_submission_to_decision
      ),
      enrollmentToDecisionDays: avgDecisionDays,
    },
    caseOutcomes: {
      approved,
      refused,
      withdrawn,
      pending,
      filesSubmitted: parseCount(raw.totals?.files_submitted),
      approvalRate,
      refusalRate: formatRate(refused, decided),
    },
  };
};
