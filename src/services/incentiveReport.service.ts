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

export async function getIncentiveReport(
  params: ReportParams
): Promise<ReportResponse> {
  const { page, pageSize, startDate, endDate } = params;
  const offset = (page - 1) * pageSize;

  // Run rules fetch + counsellor stats + spouse count + total count in parallel.
  const [rules, counsellorStats, spouseCount, totalRecords] = await Promise.all([
    getRules(),
    getCounsellorStats(startDate, endDate),
    getCompanyWideSpouseCount(startDate, endDate),
    getTotalClientCount(startDate, endDate),
  ]);

  // Fetch paginated client rows, then batch-fetch their payment stages.
  const clients = await getPaginatedClients(startDate, endDate, pageSize, offset);
  const clientIds = clients.map((c) => c.clientId);
  const paymentStages = await getClientPaymentStages(clientIds);

  const data: ReportItem[] = clients.map((client) => {
    const stat = counsellorStats.get(client.counsellorId) ?? emptyStat(client.counsellorId);
    const receivedAmount = computeReceivedAmount(paymentStages.get(client.clientId));

    const financeBonus = getFinanceBonus(stat.allFinanceCount, rules.allFinanceRules);

    let incentiveAmount = financeBonus;
    if (client.saleType === "Spouse") {
      incentiveAmount += getSpouseIncentive(spouseCount, rules.coreSpouseRules);
    } else if (client.saleType === "Visitor") {
      incentiveAmount += getVisitorIncentive(
        stat.totalReceivedAmount,
        rules.coreVisitorRules
      );
    } else if (client.saleType === "Student") {
      incentiveAmount +=
        getStudentIncentive(stat.studentCount, rules.studentRules) +
        getCanadaStudentBonus(stat.canadaStudentCount, rules.canadaStudentRules);
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
