import {
  getMonthRevenuePayments,
  type RevenuePaymentRow,
} from "../models/revenue.model";

type RevenuePaymentLine = {
  amountId: string;
  amount: string;
  date: string;
  type: RevenuePaymentRow["paymentType"];
  consultancyStage: string | null;
  productName: string | null;
};

type ClientRevenueGroup = {
  client: {
    id: string;
    clientCode: string;
    legacyClientId: number | null;
    fullName: string;
  };
  count: number;
  totalAmount: string;
  payments: RevenuePaymentLine[];
};

type CounsellorRevenueGroup = {
  counsellor: {
    legacyUserId: number;
    fullName: string | null;
    empId: string | null;
  };
  count: number;
  totalAmount: string;
  clients: ClientRevenueGroup[];
};

export type MonthRevenueReport = {
  period: {
    month: number;
    year: number;
  };
  totalCount: number;
  totalAmount: string;
  counsellors: CounsellorRevenueGroup[];
};

/** @deprecated use MonthRevenueReport */
export type CurrentMonthRevenueReport = MonthRevenueReport;

const parseMoney = (value: string | null | undefined): number => {
  const amount = parseFloat(value ?? "0");
  return Number.isFinite(amount) ? amount : 0;
};

const formatMoney = (value: number): string => value.toFixed(2);

export const getCalendarMonthPeriod = (offsetMonths = 0) => {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1);

  return {
    month: target.getMonth() + 1,
    year: target.getFullYear(),
  };
};

const toPaymentLine = (row: RevenuePaymentRow): RevenuePaymentLine => ({
  amountId: row.amountId,
  amount: row.amount,
  date: row.paymentDate,
  type: row.paymentType,
  consultancyStage: row.consultancyStage,
  productName: row.productName,
});

const buildCounsellorClientGroups = (
  rows: RevenuePaymentRow[]
): CounsellorRevenueGroup[] => {
  const counsellorMap = new Map<number, CounsellorRevenueGroup>();

  for (const row of rows) {
    const counsellorId = row.counsellorLegacyUserId;

    let counsellorGroup = counsellorMap.get(counsellorId);
    if (!counsellorGroup) {
      counsellorGroup = {
        counsellor: {
          legacyUserId: counsellorId,
          fullName: row.counsellorFullName,
          empId: row.counsellorEmpId,
        },
        count: 0,
        totalAmount: "0.00",
        clients: [],
      };
      counsellorMap.set(counsellorId, counsellorGroup);
    }

    let clientGroup = counsellorGroup.clients.find(
      (entry) => entry.client.id === row.clientId
    );

    if (!clientGroup) {
      clientGroup = {
        client: {
          id: row.clientId,
          clientCode: row.clientCode,
          legacyClientId: row.legacyClientId,
          fullName: row.clientFullName,
        },
        count: 0,
        totalAmount: "0.00",
        payments: [],
      };
      counsellorGroup.clients.push(clientGroup);
    }

    const line = toPaymentLine(row);
    const lineAmount = parseMoney(line.amount);

    clientGroup.payments.push(line);
    clientGroup.count += 1;
    clientGroup.totalAmount = formatMoney(
      parseMoney(clientGroup.totalAmount) + lineAmount
    );

    counsellorGroup.count += 1;
    counsellorGroup.totalAmount = formatMoney(
      parseMoney(counsellorGroup.totalAmount) + lineAmount
    );
  }

  return [...counsellorMap.values()].sort(
    (a, b) => parseMoney(b.totalAmount) - parseMoney(a.totalAmount)
  );
};

const buildMonthRevenueReport = async (
  year: number,
  month: number,
  counsellorLegacyUserId?: number
): Promise<MonthRevenueReport> => {
  const rows = await getMonthRevenuePayments(
    year,
    month,
    counsellorLegacyUserId
  );

  const totalAmount = rows.reduce(
    (sum, row) => sum + parseMoney(row.amount),
    0
  );

  return {
    period: { month, year },
    totalCount: rows.length,
    totalAmount: formatMoney(totalAmount),
    counsellors: buildCounsellorClientGroups(rows),
  };
};

export const getMonthRevenueReport = async (
  year: number,
  month: number,
  options?: { counsellorLegacyUserId?: number }
): Promise<MonthRevenueReport> => {
  return buildMonthRevenueReport(
    year,
    month,
    options?.counsellorLegacyUserId
  );
};

export const getCurrentMonthRevenueReport = async (options?: {
  counsellorLegacyUserId?: number;
}): Promise<MonthRevenueReport> => {
  const period = getCalendarMonthPeriod(0);
  return buildMonthRevenueReport(
    period.year,
    period.month,
    options?.counsellorLegacyUserId
  );
};

export const getLastMonthRevenueReport = async (options?: {
  counsellorLegacyUserId?: number;
}): Promise<MonthRevenueReport> => {
  const period = getCalendarMonthPeriod(-1);
  return buildMonthRevenueReport(
    period.year,
    period.month,
    options?.counsellorLegacyUserId
  );
};
