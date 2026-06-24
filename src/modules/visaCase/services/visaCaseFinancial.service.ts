import { eq, inArray } from "drizzle-orm";
import { pool } from "../../../config/databaseConnection";
import { getDbSecond } from "../../../config/databaseConnectionSecond";
import { clients } from "../../clients/schemas/client_convert.schema";
import { paymentBalances } from "../../payments/schemas/paymentBalance.schema";
import { amounts } from "../../payments/schemas/amount.schema";
import { products } from "../../products/schemas/product.schema";

export type VisaCaseFinancialSummary = {
  totalCharges: string;
  initialCharges: string;
  beforeVisaCharges: string;
  financeCharges: string;
  balanceDue: string;
};

export type VisaCaseFinancialLookup = {
  clientId: string;
  legacyClientId?: number | null;
  legacySaleTypeId?: number | null;
};

export type DashboardFinancialAggregate = {
  totalCharges: string;
  initialCharges: string;
  beforeVisaCharges: string;
  financeCharges: string;
  balanceDue: string;
  clientsFullyPaid: number;
  clientsWithBalance: number;
};

const emptyDashboardFinancialAggregate = (): DashboardFinancialAggregate => ({
  totalCharges: "0.00",
  initialCharges: "0.00",
  beforeVisaCharges: "0.00",
  financeCharges: "0.00",
  balanceDue: "0.00",
  clientsFullyPaid: 0,
  clientsWithBalance: 0,
});

const formatMoney = (value: number): string =>
  Number.isFinite(value) ? value.toFixed(2) : "0.00";

const parseMoney = (value: string | null | undefined): number => {
  const amount = parseFloat(value ?? "0");
  return Number.isFinite(amount) ? amount : 0;
};

const buildLegacyKey = (legacyClientId: number, legacySaleTypeId: number): string =>
  `${legacyClientId}:${legacySaleTypeId}`;

const isFinanceProduct = (productCode: string | null | undefined): boolean => {
  const code = (productCode ?? "").toUpperCase();
  return (
    code.includes("LOAN") ||
    code.includes("FINANCE") ||
    code === "ALL_FINANCE" ||
    code === "LOAN_DETAILS"
  );
};

type ClientPaymentAggregateRow = {
  client_id: number;
  sale_type_id: number;
  total_payment: string;
  paid_amount: string;
  initial_amount: string;
  before_visa_amount: string;
};

const mapClientPaymentAggregate = (
  row: ClientPaymentAggregateRow
): Pick<VisaCaseFinancialSummary, "totalCharges" | "initialCharges" | "beforeVisaCharges" | "balanceDue"> => {
  const totalCharges = parseMoney(row.total_payment);
  const paidAmount = parseMoney(row.paid_amount);

  return {
    totalCharges: formatMoney(totalCharges),
    initialCharges: formatMoney(parseMoney(row.initial_amount)),
    beforeVisaCharges: formatMoney(parseMoney(row.before_visa_amount)),
    balanceDue: formatMoney(Math.max(totalCharges - paidAmount, 0)),
  };
};

/** Core sale financials from main CRM client_payment (per client + sale type). */
export const getFinancialSummariesFromClientPayment = async (
  pairs: Array<{ legacyClientId: number; legacySaleTypeId: number }>
): Promise<Map<string, Pick<VisaCaseFinancialSummary, "totalCharges" | "initialCharges" | "beforeVisaCharges" | "balanceDue">>> => {
  const uniquePairs = [
    ...new Map(
      pairs.map((pair) => [
        buildLegacyKey(pair.legacyClientId, pair.legacySaleTypeId),
        pair,
      ])
    ).values(),
  ];

  if (uniquePairs.length === 0) {
    return new Map();
  }

  const clientIds = uniquePairs.map((pair) => pair.legacyClientId);
  const saleTypeIds = uniquePairs.map((pair) => pair.legacySaleTypeId);

  const { rows } = await pool.query<ClientPaymentAggregateRow>(
    `
    SELECT
      cp.client_id,
      cp.sale_type_id,
      COALESCE(MAX(cp.total_payment::numeric), 0)::text AS total_payment,
      COALESCE(SUM(cp.amount::numeric) FILTER (
        WHERE cp.stage IN ('INITIAL', 'BEFORE_VISA', 'AFTER_VISA')
      ), 0)::text AS paid_amount,
      COALESCE(SUM(cp.amount::numeric) FILTER (
        WHERE cp.stage = 'INITIAL'
      ), 0)::text AS initial_amount,
      COALESCE(SUM(cp.amount::numeric) FILTER (
        WHERE cp.stage = 'BEFORE_VISA'
      ), 0)::text AS before_visa_amount
    FROM client_payment cp
    INNER JOIN unnest($1::bigint[], $2::int[]) AS t(client_id, sale_type_id)
      ON cp.client_id = t.client_id AND cp.sale_type_id = t.sale_type_id
    GROUP BY cp.client_id, cp.sale_type_id
    `,
    [clientIds, saleTypeIds]
  );

  const result = new Map<
    string,
    Pick<VisaCaseFinancialSummary, "totalCharges" | "initialCharges" | "beforeVisaCharges" | "balanceDue">
  >();

  for (const row of rows) {
    result.set(
      buildLegacyKey(row.client_id, row.sale_type_id),
      mapClientPaymentAggregate(row)
    );
  }

  return result;
};

const getFinanceChargesForClient = async (clientId: string): Promise<number> => {
  const charges = await getFinanceChargesForClientsBulk([clientId]);
  return charges.get(clientId) ?? 0;
};

const getFinanceChargesForClientsBulk = async (
  clientIds: string[]
): Promise<Map<string, number>> => {
  const uniqueIds = [...new Set(clientIds)];
  if (uniqueIds.length === 0) return new Map();

  const balanceRows = await getDbSecond()
    .select({
      clientId: paymentBalances.clientId,
      scope: paymentBalances.scope,
      totalAmount: paymentBalances.totalAmount,
      productCode: products.productName,
    })
    .from(paymentBalances)
    .leftJoin(products, eq(paymentBalances.productId, products.id))
    .where(inArray(paymentBalances.clientId, uniqueIds));

  const totals = new Map<string, number>();
  for (const row of balanceRows) {
    if (row.scope === "PRODUCT" && isFinanceProduct(row.productCode)) {
      const current = totals.get(row.clientId) ?? 0;
      totals.set(row.clientId, current + parseMoney(row.totalAmount));
    }
  }

  return totals;
};

const getModulesFinancialFallback = async (
  clientId: string
): Promise<Pick<VisaCaseFinancialSummary, "totalCharges" | "initialCharges" | "beforeVisaCharges" | "balanceDue">> => {
  const fallbackMap = await getModulesFinancialFallbackBulk([clientId]);
  return (
    fallbackMap.get(clientId) ?? {
      totalCharges: "0.00",
      initialCharges: "0.00",
      beforeVisaCharges: "0.00",
      balanceDue: "0.00",
    }
  );
};

const getModulesFinancialFallbackBulk = async (
  clientIds: string[]
): Promise<
  Map<string, Pick<VisaCaseFinancialSummary, "totalCharges" | "initialCharges" | "beforeVisaCharges" | "balanceDue">>
> => {
  const uniqueIds = [...new Set(clientIds)];
  if (uniqueIds.length === 0) return new Map();

  const [clientRows, balanceRows, amountRows] = await Promise.all([
    getDbSecond()
      .select({
        id: clients.id,
        totalAmount: clients.totalAmount,
        pendingAmount: clients.pendingAmount,
      })
      .from(clients)
      .where(inArray(clients.id, uniqueIds)),
    getDbSecond()
      .select({
        clientId: paymentBalances.clientId,
        totalAmount: paymentBalances.totalAmount,
      })
      .from(paymentBalances)
      .where(inArray(paymentBalances.clientId, uniqueIds)),
    getDbSecond()
      .select({
        clientId: amounts.clientId,
        amount: amounts.amount,
        consultancyStage: amounts.consultancyStage,
      })
      .from(amounts)
      .where(inArray(amounts.clientId, uniqueIds)),
  ]);

  const clientById = new Map(clientRows.map((row) => [row.id, row]));

  const computedTotalByClient = new Map<string, number>();
  for (const row of balanceRows) {
    const current = computedTotalByClient.get(row.clientId) ?? 0;
    computedTotalByClient.set(
      row.clientId,
      current + parseMoney(row.totalAmount)
    );
  }

  const initialTotalByClient = new Map<string, number>();
  const beforeVisaTotalByClient = new Map<string, number>();
  for (const row of amountRows) {
    if (row.consultancyStage === "INITIAL") {
      const current = initialTotalByClient.get(row.clientId) ?? 0;
      initialTotalByClient.set(row.clientId, current + parseMoney(row.amount));
    } else if (row.consultancyStage === "BEFORE_VISA") {
      const current = beforeVisaTotalByClient.get(row.clientId) ?? 0;
      beforeVisaTotalByClient.set(row.clientId, current + parseMoney(row.amount));
    }
  }

  const result = new Map<
    string,
    Pick<VisaCaseFinancialSummary, "totalCharges" | "initialCharges" | "beforeVisaCharges" | "balanceDue">
  >();

  for (const clientId of uniqueIds) {
    const client = clientById.get(clientId);
    const totalCharges = client
      ? parseMoney(client.totalAmount)
      : (computedTotalByClient.get(clientId) ?? 0);
    const balanceDue = client ? parseMoney(client.pendingAmount) : 0;

    result.set(clientId, {
      totalCharges: formatMoney(totalCharges),
      initialCharges: formatMoney(initialTotalByClient.get(clientId) ?? 0),
      beforeVisaCharges: formatMoney(beforeVisaTotalByClient.get(clientId) ?? 0),
      balanceDue: formatMoney(balanceDue),
    });
  }

  return result;
};

/** Sum per-case financials (client_payment lifetime balance) for dashboard/report scopes. */
export const aggregateDashboardFinancials = async (
  lookups: VisaCaseFinancialLookup[]
): Promise<DashboardFinancialAggregate> => {
  if (lookups.length === 0) {
    return emptyDashboardFinancialAggregate();
  }

  const summaries = await getFinancialSummariesForVisaCases(lookups);

  let totalCharges = 0;
  let initialCharges = 0;
  let beforeVisaCharges = 0;
  let financeCharges = 0;
  let balanceDue = 0;
  let clientsFullyPaid = 0;
  let clientsWithBalance = 0;

  for (const lookup of lookups) {
    const key = buildVisaCaseFinancialKey(
      lookup.clientId,
      lookup.legacyClientId,
      lookup.legacySaleTypeId
    );
    const summary = summaries.get(key) ?? {
      totalCharges: "0.00",
      initialCharges: "0.00",
      beforeVisaCharges: "0.00",
      financeCharges: "0.00",
      balanceDue: "0.00",
    };

    totalCharges += parseMoney(summary.totalCharges);
    initialCharges += parseMoney(summary.initialCharges);
    beforeVisaCharges += parseMoney(summary.beforeVisaCharges);
    financeCharges += parseMoney(summary.financeCharges);

    const due = parseMoney(summary.balanceDue);
    balanceDue += due;
    if (due > 0) {
      clientsWithBalance += 1;
    } else {
      clientsFullyPaid += 1;
    }
  }

  return {
    totalCharges: formatMoney(totalCharges),
    initialCharges: formatMoney(initialCharges),
    beforeVisaCharges: formatMoney(beforeVisaCharges),
    financeCharges: formatMoney(financeCharges),
    balanceDue: formatMoney(balanceDue),
    clientsFullyPaid,
    clientsWithBalance,
  };
};

export const getFinancialSummaryForClient = async (
  input: VisaCaseFinancialLookup
): Promise<VisaCaseFinancialSummary> => {
  const financeCharges = await getFinanceChargesForClient(input.clientId);

  if (input.legacyClientId != null && input.legacySaleTypeId != null) {
    const clientPaymentMap = await getFinancialSummariesFromClientPayment([
      {
        legacyClientId: input.legacyClientId,
        legacySaleTypeId: input.legacySaleTypeId,
      },
    ]);

    const fromClientPayment = clientPaymentMap.get(
      buildLegacyKey(input.legacyClientId, input.legacySaleTypeId)
    );

    if (fromClientPayment) {
      return {
        ...fromClientPayment,
        financeCharges: formatMoney(financeCharges),
      };
    }
  }

  const fallback = await getModulesFinancialFallback(input.clientId);

  return {
    ...fallback,
    financeCharges: formatMoney(financeCharges),
  };
};

export const buildVisaCaseFinancialKey = (
  clientId: string,
  legacyClientId?: number | null,
  legacySaleTypeId?: number | null
): string =>
  legacyClientId != null && legacySaleTypeId != null
    ? buildLegacyKey(legacyClientId, legacySaleTypeId)
    : clientId;

export const getFinancialSummariesForVisaCases = async (
  lookups: VisaCaseFinancialLookup[]
): Promise<Map<string, VisaCaseFinancialSummary>> => {
  if (lookups.length === 0) {
    return new Map();
  }

  const legacyPairs = lookups
    .filter(
      (lookup) =>
        lookup.legacyClientId != null && lookup.legacySaleTypeId != null
    )
    .map((lookup) => ({
      legacyClientId: lookup.legacyClientId as number,
      legacySaleTypeId: lookup.legacySaleTypeId as number,
    }));

  const uniqueClientIds = [...new Set(lookups.map((lookup) => lookup.clientId))];

  const [clientPaymentMap, financeChargesMap, modulesFallbackMap] =
    await Promise.all([
      getFinancialSummariesFromClientPayment(legacyPairs),
      getFinanceChargesForClientsBulk(uniqueClientIds),
      getModulesFinancialFallbackBulk(uniqueClientIds),
    ]);

  const result = new Map<string, VisaCaseFinancialSummary>();

  for (const lookup of lookups) {
    const key = buildVisaCaseFinancialKey(
      lookup.clientId,
      lookup.legacyClientId,
      lookup.legacySaleTypeId
    );

    const fromClientPayment =
      lookup.legacyClientId != null && lookup.legacySaleTypeId != null
        ? clientPaymentMap.get(
            buildLegacyKey(lookup.legacyClientId, lookup.legacySaleTypeId)
          )
        : undefined;

    const coreSummary =
      fromClientPayment ??
      modulesFallbackMap.get(lookup.clientId) ?? {
        totalCharges: "0.00",
        initialCharges: "0.00",
        beforeVisaCharges: "0.00",
        balanceDue: "0.00",
      };

    result.set(key, {
      ...coreSummary,
      financeCharges: formatMoney(
        financeChargesMap.get(lookup.clientId) ?? 0
      ),
    });
  }

  return result;
};
