import { TAG_NAMES } from "../../tags/tags";
import { buildPaths, param } from "../../utils/routeBuilder";

const backendDashboardRoles = [
  "admin",
  "superadmin",
  "manager",
  "branchmanager",
  "developer",
];

export const moduleReportsPaths = buildPaths([
  {
    method: "get",
    path: "/api/modules/reports/backend-report",
    tag: TAG_NAMES.MODULE_REPORTS,
    summary: "Backend analytics report",
    description:
      "Full backend analytics report for admin, manager, and branch manager: KPI cards, financial summary, categorical breakdowns, decision by destination, accompanying members, and processing times. Scoped by enrollment date. Use GET /enrollment-trend for the enrollment chart. Data from modules DB.",
    roles: backendDashboardRoles,
    parameters: [
      param.query(
        "filter",
        "today | weekly | monthly | custom (default: monthly)"
      ),
      param.query("fromDate", "Start date for custom filter (YYYY-MM-DD)"),
      param.query("toDate", "End date for custom filter (YYYY-MM-DD)"),
      param.query("branchCode", "Filter by branch code, e.g. VAD"),
    ],
    responseExample: {
      success: true,
      data: {
        meta: {
          title: "Backend Report",
          availableFilters: ["today", "weekly", "monthly", "custom"],
          period: {
            filter: "monthly",
            fromDate: "2026-06-01",
            toDate: "2026-06-30",
          },
        },
        kpiCards: {
          totalCases: { value: 41, subtitle: "Enrolled visa cases" },
          approvalRate: {
            value: "72.5%",
            subtitle: "29 of 40 decided",
          },
          totalCharges: {
            value: "1250000.00",
            currency: "INR",
            subtitle: "Billed across cases",
          },
          outstanding: {
            value: "125000.00",
            currency: "INR",
            subtitle: "8 clients with balance",
          },
          collectionRate: { value: "90.0%", subtitle: "Of total charges" },
          avgDecisionDays: { value: "45", subtitle: "Enrollment → decision" },
        },
        financialSummary: {
          currency: "INR",
          totalCharges: "1250000.00",
          initialChargesReceived: "1125000.00",
          financeCharges: "50000.00",
          totalBalanceDue: "125000.00",
          collectionPercent: "90.0%",
          avgChargePerClient: "30487.80",
          clientsFullyPaid: 33,
          clientsWithBalanceDue: 8,
        },
        quickHighlights: {
          topDestination: "Canada",
          topTravelReason: "Tourism",
          topSponsorType: "Self-Sponsored",
        },
        byDestinationCountry: [
          { label: "Canada", count: 12 },
          { label: "UK", count: 8 },
        ],
        byReasonOfTravel: [{ label: "Tourism", count: 15 }],
        bySponsorRelationship: [{ label: "Self-Sponsored", count: 10 }],
        decisionByDestination: {
          rows: [
            {
              destination: "Canada",
              approved: 8,
              refused: 2,
              withdrawn: 1,
              pending: 1,
              total: 12,
            },
          ],
          totals: {
            destination: "Total",
            approved: 8,
            refused: 2,
            withdrawn: 1,
            pending: 1,
            total: 12,
          },
        },
        accompanyingMembers: {
          totalAccompanyingMembers: 5,
          avgMembersPerCase: "1.2",
          casesWithAccompanying: 4,
        },
        processingTimes: {
          enrollmentToSubmissionDays: "21",
          submissionToDecisionDays: "30",
          enrollmentToDecisionDays: "45",
        },
      },
    },
  },
  {
    method: "get",
    path: "/api/modules/reports/enrollment-trend",
    tag: TAG_NAMES.MODULE_REPORTS,
    summary: "Enrollment trend chart",
    description:
      "Monthly enrollment trend for backend report chart. Independent of backend-report period filters. " +
      "range=6_month | 12_month (default) | maximum (all time). Optional branchCode filter.",
    roles: backendDashboardRoles,
    parameters: [
      param.query("range", "6_month | 12_month | maximum (default: 12_month)"),
      param.query("branchCode", "Filter by branch code, e.g. VAD"),
    ],
    responseExample: {
      success: true,
      data: {
        meta: {
          title: "Enrollment Trend",
          range: "12_month",
          rangeLabel: "Last 12 months",
          granularity: "month",
          bucketCount: 12,
          totalEnrollments: 847,
          availableRanges: ["6_month", "12_month", "maximum"],
        },
        enrollmentTrend: [
          { month: "Jul 2025", enrollments: 4 },
          { month: "Aug 2025", enrollments: 7 },
          { month: "Jun 2026", enrollments: 67 },
        ],
      },
    },
  },
  {
    method: "get",
    path: "/api/modules/reports/backend-dashboard",
    tag: TAG_NAMES.MODULE_REPORTS,
    summary: "Backend ops dashboard",
    description:
      "Aggregated backend team dashboard: summary metrics, case outcomes, pipeline stages, and team leaderboard. Scoped by enrollment date. Data from modules DB.",
    roles: backendDashboardRoles,
    parameters: [
      param.query(
        "filter",
        "today | weekly | monthly | custom (default: monthly)"
      ),
      param.query("fromDate", "Start date for custom filter (YYYY-MM-DD)"),
      param.query("toDate", "End date for custom filter (YYYY-MM-DD)"),
      param.query("branchCode", "Filter by branch code, e.g. VAD"),
    ],
    responseExample: {
      success: true,
      data: {
        meta: {
          title: "Backend Dashboard",
          period: {
            filter: "monthly",
            fromDate: "2026-06-01",
            toDate: "2026-06-30",
          },
        },
        summary: {
          totalClients: 41,
          clientsByCategory: [
            { category: "visitor", label: "Visitor", count: 18 },
            { category: "spouse", label: "Spouse", count: 4 },
            { category: "student", label: "Student", count: 21 },
          ],
          approvalRate: null,
          outstandingBalance: "125000.00",
          currency: "INR",
        },
        caseOutcomes: {
          approved: 0,
          refused: 0,
          withdrawn: 0,
          pending: 41,
          filesSubmitted: 0,
          approvalRate: null,
          refusalRate: null,
        },
        casesByStage: [
          { stage: "DOCUMENTATION", label: "Documentation", count: 38 },
          { stage: "CASE_PREPARATION", label: "Case Preparation", count: 2 },
        ],
        teamLeaderboard: [],
      },
    },
  },
  {
    method: "get",
    path: "/api/modules/reports/ops-dashboard",
    tag: TAG_NAMES.MODULE_REPORTS,
    summary: "Personal ops team dashboard",
    description:
      "Role-scoped personal dashboard. CX has a separate view. Binding and application roles share one combined Binding & Application dashboard for a single assignee.",
    roles: ["cx", "binding", "application", "developer"],
    parameters: [
      param.query(
        "filter",
        "workload | today | weekly | monthly | custom (default: workload)"
      ),
      param.query("fromDate", "Start date for custom filter (YYYY-MM-DD)"),
      param.query("toDate", "End date for custom filter (YYYY-MM-DD)"),
    ],
    responseExample: {
      success: true,
      data: {
        meta: {
          title: "CX Dashboard",
          team: "cx",
          scope: "assigned_to_me",
          period: {
            filter: "workload",
            mode: "workload",
            description: "All active cases assigned to you (excludes withdrawn)",
          },
          stuckCaseThresholdDays: 7,
        },
        summary: {
          activeCases: 7,
          clientsByCategory: [
            { category: "visitor", label: "Visitor", count: 3 },
            { category: "spouse", label: "Spouse", count: 1 },
            { category: "student", label: "Student", count: 3 },
          ],
          readyForHandoff: 2,
          handoffsCompleted: 1,
          stuckCases: 1,
          clientsOnHold: 0,
          clientWithdrawals: 1,
        },
        bySubStatus: [
          {
            subStatus: "CHECKLIST_SHARED",
            label: "Checklist Shared",
            stage: "DOCUMENTATION",
            count: 3,
          },
        ],
        casesByStage: [
          { stage: "DOCUMENTATION", label: "Documentation", count: 7 },
        ],
      },
    },
  },
  {
    method: "get",
    path: "/api/modules/reports/cx-report",
    tag: TAG_NAMES.MODULE_REPORTS,
    summary: "CX team personal performance report",
    description:
      "Personal CX performance report: summary KPIs with period-over-period trends, daily task completion chart, TAT health, client stage progress, and document processing stats. Scoped to cases assigned to the viewer. Data from modules DB.",
    roles: ["cx", "developer"],
    parameters: [
      param.query(
        "filter",
        "today | weekly | monthly | custom (default: weekly)"
      ),
      param.query("fromDate", "Start date for custom filter (YYYY-MM-DD)"),
      param.query("toDate", "End date for custom filter (YYYY-MM-DD)"),
    ],
    responseExample: {
      success: true,
      data: {
        meta: {
          title: "My Report",
          team: "cx",
          teamLabel: "CX Team",
          scope: "assigned_to_me",
          period: {
            filter: "weekly",
            fromDate: "2026-06-09",
            toDate: "2026-06-15",
          },
        },
        performanceSummary: {
          tasksCompleted: {
            value: 52,
            trend: { direction: "up", delta: 8, label: "+8 vs last period" },
          },
          docsReviewed: {
            value: 34,
            pending: 6,
            subtitle: "6 pending",
          },
          tatWarnings: {
            value: 3,
            breaches: 1,
            subtitle: "1 breach",
            alert: true,
          },
          completionRate: {
            value: 87,
            display: "87%",
            trend: {
              direction: "up",
              delta: 3,
              label: "+3% vs last period",
            },
          },
        },
        completionTrend: [
          { date: "2026-06-09", dayLabel: "Mon", completed: 8, overdue: 1 },
          { date: "2026-06-10", dayLabel: "Tue", completed: 10, overdue: 2 },
        ],
        tatHealth: {
          totalClients: 20,
          byRiskLevel: [
            { level: "safe", label: "Safe", count: 14, color: "green" },
            { level: "warning", label: "Warning", count: 4, color: "orange" },
            { level: "breach", label: "Breach", count: 2, color: "red" },
          ],
          summary: { escalated: 2, onTrack: 14 },
        },
        stageProgress: [
          { key: "documentation", label: "Documentation", count: 6 },
          { key: "backend_ops", label: "Backend Ops", count: 4 },
        ],
        documentStats: {
          outcomeBreakdown: [
            { key: "approved", label: "Approved", count: 28, color: "green" },
            { key: "rejected", label: "Rejected", count: 6, color: "red" },
          ],
          reviewRate: {
            approvalRate: 82.4,
            approvalRateDisplay: "82%",
            subtitle: "Approval rate this period",
            avgTurnaround: "2.4 hrs",
          },
          rejectionReasons: [
            { key: "blurry_scan", label: "Blurry scan", count: 4 },
          ],
        },
      },
    },
  },
  {
    method: "get",
    path: "/api/modules/reports/binding-report",
    tag: TAG_NAMES.MODULE_REPORTS,
    summary: "Binding team personal performance report",
    description:
      "Personal Binding team performance report: files bound KPI with period-over-period trend, average days in binding, doc completeness at CX handoff, TAT breach rate, daily bound vs blocked chart, visa application status breakdown, and TAT health trend. Scoped to cases assigned to or handed off by the viewer. Data from modules DB.",
    roles: ["binding", "developer"],
    parameters: [
      param.query(
        "filter",
        "today | weekly | monthly | custom (default: weekly)"
      ),
      param.query("fromDate", "Start date for custom filter (YYYY-MM-DD)"),
      param.query("toDate", "End date for custom filter (YYYY-MM-DD)"),
    ],
    responseExample: {
      success: true,
      data: {
        meta: {
          title: "My Report",
          team: "binding",
          teamLabel: "Binding Team",
          scope: "assigned_to_me",
          period: {
            filter: "weekly",
            fromDate: "2026-06-09",
            toDate: "2026-06-15",
          },
          tatThresholds: { safeDays: 3, warningDays: 5, breachDays: 7 },
        },
        performanceSummary: {
          filesBound: {
            value: 14,
            trend: {
              direction: "up",
              deltaPercent: 17,
              label: "+17% vs prev",
            },
          },
          avgDaysInBinding: { value: 6.2, subtitle: "days per file" },
          docCompletenessAtHandoff: { value: 88, display: "88%" },
          tatBreachRate: {
            value: 14,
            display: "14%",
            subtitle: "of assigned clients",
          },
        },
        filesBoundVsBlocked: [
          { date: "2026-06-09", dayLabel: "Mon", bound: 3, blocked: 1 },
          { date: "2026-06-10", dayLabel: "Tue", bound: 2, blocked: 2 },
        ],
        visaApplicationStatus: [
          { key: "pending", label: "Pending", count: 4, color: "grey" },
          { key: "submitted", label: "Submitted", count: 6, color: "blue" },
          { key: "approved", label: "Approved", count: 8, color: "green" },
        ],
        tatHealthTrend: [
          {
            date: "2026-06-09",
            dayLabel: "Mon",
            onTrack: 12,
            warning: 4,
            breach: 2,
          },
        ],
      },
    },
  },
]);
