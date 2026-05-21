import "dotenv/config";
import { sql } from "drizzle-orm";
import { db, pool } from "../config/databaseConnection";
import { getRules } from "../models/incentiveRules.model";
import {
  getCounsellorStats,
  getCompanyWideSpouseCount,
  getClientPaymentStages,
  getClientAllFinanceAmounts,
  getClientOtherProductPayments,
  getProductDisplayNameMap,
  getPaginatedClients,
} from "../models/incentiveReport.model";
import {
  getSpouseIncentive,
  getVisitorIncentive,
  getStudentIncentive,
  getCanadaStudentBonus,
  getFinanceBonus,
} from "../utils/incentiveCalculator";

function findMatchedRangeSlab(
  count: number,
  rules: Array<{ minCount: number; maxCount: number; incentiveAmount: number }>
) {
  for (const rule of rules) {
    const max = rule.maxCount === -1 ? Infinity : rule.maxCount;
    if (count >= rule.minCount && count <= max) return rule;
  }
  return null;
}

function findMatchedVisitorTier(
  totalAmount: number,
  rules: Array<{ label: string; incentiveAmount: number }>
) {
  let matched: { label: string; incentiveAmount: number; threshold: number } | null = null;
  for (const rule of rules) {
    const threshold = parseFloat(rule.label.replace(/[^0-9.]/g, ""));
    if (!Number.isNaN(threshold) && totalAmount >= threshold) {
      matched = { label: rule.label, incentiveAmount: rule.incentiveAmount, threshold };
    }
  }
  return matched;
}

async function findClient(targetName: string, startDate: string, endDate: string) {
  const rows = await db.execute<{
    client_id: string;
    client_name: string;
    enrollment_date: string;
    counsellor_id: string;
    counsellor: string;
    sale_type: string;
    sale_type_id: string;
  }>(sql`
    SELECT DISTINCT ON (ci.id)
      ci.id::text AS client_id,
      ci.fullname AS client_name,
      ci.date::text AS enrollment_date,
      ci.counsellor_id::text AS counsellor_id,
      u.full_name AS counsellor,
      stc.name AS sale_type,
      st.id::text AS sale_type_id
    FROM client_information ci
    INNER JOIN users u ON u.id = ci.counsellor_id
    INNER JOIN client_payment cp ON cp.client_id = ci.id
    INNER JOIN sale_type st ON st.id = cp.sale_type_id
    INNER JOIN sale_type_category stc ON stc.id = st.category_id
    WHERE ci.date BETWEEN ${startDate}::date AND ${endDate}::date
      AND ci.archived = false
      AND LOWER(ci.fullname) LIKE LOWER(${`%${targetName}%`})
    ORDER BY ci.id,
      CASE LOWER(stc.name)
        WHEN 'student' THEN 1
        WHEN 'spouse' THEN 2
        WHEN 'visitor' THEN 3
        ELSE 4
      END
    LIMIT 5
  `);
  return rows.rows;
}

async function main() {
  const startDate = process.argv[2] ?? "2026-01-01";
  const endDate = process.argv[3] ?? "2026-04-30";
  const targetName = process.argv[4] ?? "KIRTAN KIRITBHAI BRAHMBHATT";

  const candidates = await findClient(targetName, startDate, endDate);
  if (candidates.length === 0) {
    console.log(`No client found for "${targetName}" in range ${startDate} to ${endDate}.`);
    return;
  }

  const client = candidates[0];
  const clientId = Number(client.client_id);
  const counsellorId = Number(client.counsellor_id);

  const [rules, counsellorStats, spouseCount, paymentStages, allFinanceAmounts, otherProductPayments, productNames] =
    await Promise.all([
      getRules(startDate, endDate),
      getCounsellorStats(startDate, endDate),
      getCompanyWideSpouseCount(startDate, endDate),
      getClientPaymentStages([clientId]),
      getClientAllFinanceAmounts([clientId]),
      getClientOtherProductPayments([clientId]),
      getProductDisplayNameMap(),
    ]);

  const stat = counsellorStats.get(counsellorId) ?? {
    counsellorId,
    totalReceivedAmount: 0,
    studentCount: 0,
    canadaStudentCount: 0,
    allFinanceCount: 0,
  };

  const saleTypeLower = String(client.sale_type).toLowerCase();
  const spouseRule = findMatchedRangeSlab(spouseCount, rules.coreSpouseRules);
  const visitorTier = findMatchedVisitorTier(stat.totalReceivedAmount, rules.coreVisitorRules);
  const studentRule = findMatchedRangeSlab(stat.studentCount, rules.studentRules);
  const canadaRule = findMatchedRangeSlab(stat.canadaStudentCount, rules.canadaStudentRules);
  const financeRule = findMatchedRangeSlab(stat.allFinanceCount, rules.allFinanceRules);

  let coreSaleIncentive = 0;
  if (saleTypeLower === "spouse") {
    coreSaleIncentive = getSpouseIncentive(spouseCount, rules.coreSpouseRules);
  } else if (saleTypeLower === "visitor") {
    coreSaleIncentive = getVisitorIncentive(stat.totalReceivedAmount, rules.coreVisitorRules);
  } else if (saleTypeLower === "student") {
    coreSaleIncentive =
      getStudentIncentive(stat.studentCount, rules.studentRules) +
      getCanadaStudentBonus(stat.canadaStudentCount, rules.canadaStudentRules);
  }

  const financeBonus = getFinanceBonus(stat.allFinanceCount, rules.allFinanceRules);
  const clientProducts = otherProductPayments.get(clientId) ?? [];
  const otherProductMatched = clientProducts.map((p) => {
    const displayName = productNames.get(p.productName) ?? p.productName.replace(/_/g, " ");
    const matchedRule = rules.visitorProductRules.find(
      (r) => r.label.toLowerCase() === displayName.toLowerCase()
    );
    return {
      productName: p.productName,
      displayName,
      amount: p.amount,
      matchedRuleLabel: matchedRule?.label ?? null,
      incentive: matchedRule?.incentiveAmount ?? 0,
    };
  });
  const otherProductsIncentive = otherProductMatched.reduce((sum, p) => sum + p.incentive, 0);
  const total = coreSaleIncentive + financeBonus + otherProductsIncentive;

  const pageSize = 100;
  const page = 5;
  const offset = (page - 1) * pageSize;
  const pageRows = await getPaginatedClients(startDate, endDate, pageSize, offset);
  const foundOnRequestedPage = pageRows.some((r) => r.clientId === clientId);

  const paymentStage = paymentStages.get(clientId);
  const receivedAmount =
    (paymentStage?.initialAmount ?? 0) +
    (paymentStage?.beforeVisaAmount ?? 0) +
    (paymentStage?.afterVisaAmount ?? 0);

  const audit = {
    input: { startDate, endDate, requestedPage: page, pageSize, targetName },
    client: {
      clientId,
      clientName: client.client_name,
      counsellorId,
      counsellor: client.counsellor,
      saleType: client.sale_type,
      enrollmentDate: client.enrollment_date,
      presentInRequestedPage5: foundOnRequestedPage,
    },
    valuesUsedByCalculation: {
      companyWideSpouseCount: spouseCount,
      counsellorVisitorTotalReceivedAmount: stat.totalReceivedAmount,
      counsellorStudentCount: stat.studentCount,
      counsellorCanadaStudentCount: stat.canadaStudentCount,
      counsellorAllFinanceCount: stat.allFinanceCount,
      clientCoreReceivedAmountCards: receivedAmount,
      clientAllFinanceAmountCards: allFinanceAmounts.get(clientId) ?? 0,
    },
    matchedRules: {
      spouseRule,
      visitorTier,
      studentRule,
      canadaRule,
      financeRule,
      otherProductMatched,
    },
    resultAsPerApiLogic: {
      coreSaleIncentive,
      financeBonus,
      otherProductsIncentive,
      totalIncentive: total,
      eligible: total > 0,
      eligibilityReason:
        total > 0
          ? "Eligible because at least one rule bucket produced incentive."
          : "Not eligible because no visitor/spouse/student slab and no finance/other-product bonus matched.",
    },
  };

  console.log(JSON.stringify(audit, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });

