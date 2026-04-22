import { getRules } from "../models/incentiveRules.model";
import {
  getCounsellorStats,
  getCompanyWideSpouseCount,
  getPaginatedClients,
  getTotalClientCount,
  getClientPaymentStages,
  type CounsellorStat,
  type PaymentStage,
} from "../models/incentiveReport.model";
import {
  getSpouseIncentive,
  getVisitorIncentive,
  getStudentIncentive,
  getCanadaStudentBonus,
  getFinanceBonus,
} from "../utils/incentiveCalculator";
import { redisGetJson, redisSetJson } from "../config/redis";
import type { IncentiveRulesPayload } from "../models/incentiveRules.model";

export interface ReportParams {
  page: number;
  pageSize: number;
  startDate: string;
  endDate: string;
}

export interface ReportItem {
  clientId: number;
  clientName: string;
  counsellor: string;
  enrollmentDate: string;
  saleType: "Spouse" | "Visitor" | "Student";
  eligibility: "Eligible" | "Not Eligible";
  receivedAmount: number;
  incentiveAmount: number;
  status: "Pending";
}

export interface ReportResponse {
  data: ReportItem[];
  pagination: {
    page: number;
    pageSize: number;
    totalRecords: number;
    totalPages: number;
  };
}

// Mirror of the receivedAmount rule in getCounsellorStats CTE (client_received).
// If the rule changes, update both.
function computeReceivedAmount(stage: PaymentStage | undefined): number {
  if (!stage) return 0;
  if (stage.hasBeforeVisa) return stage.beforeVisaAmount;
  if (!stage.hasBeforeVisa && !stage.hasInitial) return stage.afterVisaAmount;
  return 0;
}

function emptyStat(counsellorId: number): CounsellorStat {
  return {
    counsellorId,
    totalReceivedAmount: 0,
    studentCount: 0,
    canadaStudentCount: 0,
    allFinanceCount: 0,
  };
}

async function getCachedRules(): Promise<IncentiveRulesPayload> {
  const cached = await redisGetJson<IncentiveRulesPayload>("incentive-rules:all");
  if (cached) return cached;
  const fresh = await getRules();
  await redisSetJson("incentive-rules:all", fresh, 600);
  return fresh;
}

export async function getIncentiveReport(
  params: ReportParams
): Promise<ReportResponse> {
  const { page, pageSize, startDate, endDate } = params;
  const offset = (page - 1) * pageSize;

  // Run rules fetch + counsellor stats + spouse count + total count in parallel.
  const [rules, counsellorStats, spouseCount, totalRecords] = await Promise.all([
    getCachedRules(),
    getCounsellorStats(startDate, endDate),
    getCompanyWideSpouseCount(startDate, endDate),
    getTotalClientCount(startDate, endDate),
  ]);

  // Fetch paginated client rows, then batch-fetch their payment stages.
  const clients = await getPaginatedClients(startDate, endDate, pageSize, offset);
  const clientIds = clients.map((c) => c.clientId);
  const paymentStages = await getClientPaymentStages(clientIds);

  const data: ReportItem[] = clients.map((client) => {
    const stat = counsellorStats.get(client.counsellorId);
    if (!stat) {
      console.warn(
        `[incentiveReport] counsellor ${client.counsellorId} missing from stats map for client ${client.clientId}`
      );
    }
    const resolvedStat = stat ?? emptyStat(client.counsellorId);
    const receivedAmount = computeReceivedAmount(paymentStages.get(client.clientId));

    const financeBonus = getFinanceBonus(resolvedStat.allFinanceCount, rules.allFinanceRules);

    let incentiveAmount = financeBonus;
    if (client.saleType === "Spouse") {
      incentiveAmount += getSpouseIncentive(spouseCount, rules.coreSpouseRules);
    } else if (client.saleType === "Visitor") {
      incentiveAmount += getVisitorIncentive(
        resolvedStat.totalReceivedAmount,
        rules.coreVisitorRules
      );
    } else if (client.saleType === "Student") {
      incentiveAmount +=
        getStudentIncentive(resolvedStat.studentCount, rules.studentRules) +
        getCanadaStudentBonus(resolvedStat.canadaStudentCount, rules.canadaStudentRules);
    }

    return {
      clientId:       client.clientId,
      clientName:     client.clientName,
      counsellor:     client.counsellor,
      enrollmentDate: client.enrollmentDate,
      saleType:       client.saleType as "Spouse" | "Visitor" | "Student",
      eligibility:    incentiveAmount > 0 ? "Eligible" : "Not Eligible",
      receivedAmount,
      incentiveAmount,
      status:         "Pending",
    };
  });

  return {
    data,
    pagination: {
      page,
      pageSize,
      totalRecords,
      totalPages: Math.ceil(totalRecords / pageSize),
    },
  };
}
