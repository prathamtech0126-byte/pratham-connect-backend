import type { Role } from "../../../types/role";
import {
  DECISION_LABELS,
  REASON_OF_TRAVEL_LABELS,
  SPONSOR_RELATIONSHIP_LABELS,
  STAGE_LABELS,
  VISA_CASE_VIEW_ALL_ROLES,
} from "../constants/visaCase.constants";
import {
  fetchDashboardAggregates,
  fetchScopedVisaCaseFinancialLookups,
  type DashboardDateFilter,
} from "../models/visaCaseDashboard.model";
import { aggregateDashboardFinancials } from "./visaCaseFinancial.service";

type ViewerContext = {
  userId: number;
  role: Role;
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

const topByCount = (
  rows: Array<{ count: string; [key: string]: string }>,
  key: string
): string | null => {
  if (!rows.length) return null;
  const sorted = [...rows]
    .filter((row) => row[key] !== "Unknown")
    .sort((a, b) => parseCount(b.count) - parseCount(a.count));
  const top = sorted[0];
  if (!top || parseCount(top.count) === 0) return null;
  return top[key] ?? null;
};

export const getVisaCaseDashboard = async (
  viewer: ViewerContext,
  filters: DashboardDateFilter
) => {
  const scopedFilters: DashboardDateFilter = { ...filters };

  if (
    !(VISA_CASE_VIEW_ALL_ROLES as readonly string[]).includes(viewer.role) &&
    viewer.role === "counsellor"
  ) {
    scopedFilters.userId = viewer.userId;
  }

  const [raw, financialLookups] = await Promise.all([
    fetchDashboardAggregates(scopedFilters),
    fetchScopedVisaCaseFinancialLookups(scopedFilters),
  ]);
  const financial = await aggregateDashboardFinancials(financialLookups);

  const totalClients = parseCount(raw.totals?.total_clients);
  const approved = parseCount(raw.totals?.approved);
  const refused = parseCount(raw.totals?.refused);
  const withdrawn = parseCount(raw.totals?.withdrawn);
  const pending = parseCount(raw.totals?.pending);
  const filesSubmitted = parseCount(raw.totals?.files_submitted);

  const totalCharges = financial.totalCharges;
  const initialCharges = financial.initialCharges;
  const balanceDue = financial.balanceDue;
  const collectionPct = formatRate(
    Number.parseFloat(initialCharges),
    Number.parseFloat(totalCharges)
  );

  const topDestination = topByCount(raw.byDestination, "country_name");
  const topTravelReasonRaw = topByCount(raw.byTravelReason, "reason");
  const topSponsorRaw = topByCount(raw.bySponsor, "sponsor");

  return {
    meta: {
      title: "Pratham International – Visa Case Dashboard",
      generatedAt: new Date().toISOString(),
      filters: scopedFilters,
    },
    summary: {
      totalClients,
      approvalRate: formatRate(approved, approved + refused),
      outstandingBalance: balanceDue,
    },
    caseOutcomes: {
      totalEnrolledClients: totalClients,
      approved,
      refused,
      withdrawn,
      pendingDecision: pending,
      filesSubmitted,
      approvalRate: formatRate(approved, approved + refused),
      refusalRate: formatRate(refused, approved + refused),
    },
    byDestinationCountry: raw.byDestination.map((row) => ({
      country: row.country_name,
      count: parseCount(row.count),
    })),
    bySponsorRelationship: raw.bySponsor.map((row) => ({
      sponsor:
        SPONSOR_RELATIONSHIP_LABELS[row.sponsor] ??
        row.sponsor.replace(/_/g, " "),
      count: parseCount(row.count),
    })),
    byReasonOfTravel: raw.byTravelReason.map((row) => ({
      reason:
        REASON_OF_TRAVEL_LABELS[row.reason] ??
        row.reason.replace(/_/g, " "),
      count: parseCount(row.count),
    })),
    casesByStage: raw.byStage.map((row) => ({
      stage: STAGE_LABELS[row.stage as keyof typeof STAGE_LABELS] ?? row.stage,
      count: parseCount(row.count),
    })),
    financialSummary: {
      currency: "INR",
      totalCharges,
      initialChargesReceived: initialCharges,
      financeCharges: financial.financeCharges,
      totalBalanceDue: balanceDue,
      collectionPercent: collectionPct,
      avgChargePerClient:
        totalClients > 0
          ? (Number.parseFloat(totalCharges) / totalClients).toFixed(2)
          : null,
      clientsFullyPaid: financial.clientsFullyPaid,
      clientsWithBalanceDue: financial.clientsWithBalance,
    },
    accompanyingMembers: {
      total: parseCount(raw.accompanying?.total_accompanying),
      avgPerCase: raw.accompanying?.avg_members
        ? Number.parseFloat(raw.accompanying.avg_members).toFixed(1)
        : null,
      casesWithAccompanying: parseCount(raw.accompanying?.cases_with_accompanying),
    },
    processingTimes: {
      enrollmentToSubmissionDays: raw.processingTimes?.avg_enrollment_to_submission,
      submissionToDecisionDays: raw.processingTimes?.avg_submission_to_decision,
      enrollmentToDecisionDays: raw.processingTimes?.avg_enrollment_to_decision,
    },
    decisionByDestination: raw.decisionByDestination.map((row) => ({
      destination: row.country_name,
      approved: parseCount(row.approved),
      refused: parseCount(row.refused),
      withdrawn: parseCount(row.withdrawn),
      pending: parseCount(row.pending),
      total: parseCount(row.total),
    })),
    enrollmentTrend: raw.enrollmentTrend.map((row) => ({
      month: row.month_label,
      enrollments: parseCount(row.enrollments),
    })),
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
    rawDecisions: raw.byDecision.map((row) => ({
      decision: DECISION_LABELS[row.decision] ?? row.decision,
      count: parseCount(row.count),
    })),
  };
};
