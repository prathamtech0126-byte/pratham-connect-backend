import "dotenv/config";
import { eq, and, sql } from "drizzle-orm";
import { db } from "../config/databaseConnection";
import { allFinance } from "../schemas/allFinance.schema";
import { financePayments } from "../schemas/finance_payments.schema";
import { clientProductPayments } from "../schemas/clientProductPayments.schema";
import { clientInformation } from "../schemas/clientInformation.schema";

async function migrateFinancePayments() {
  console.log("Migration Started...");

  try {
    const allFinances = await db.select().from(allFinance);
    console.log(`Found ${allFinances.length} finance records`);

    for (const finance of allFinances) {
      console.log(`Processing Finance ID: ${finance.financeId}`);

      const [relatedProductPayment] = await db
        .select({
          paidBy: sql<number | null>`COALESCE(${clientProductPayments.handledBy}, ${clientInformation.counsellorId})`,
        })
        .from(clientProductPayments)
        .leftJoin(
          clientInformation,
          eq(clientProductPayments.clientId, clientInformation.clientId)
        )
        .where(
          and(
            eq(clientProductPayments.entityType, "allFinance_id"),
            eq(clientProductPayments.entityId, finance.financeId)
          )
        )
        .limit(1);

      const paidBy = relatedProductPayment?.paidBy ?? null;
      const paymentsToInsert: (typeof financePayments.$inferInsert)[] = [];

      // PAYMENT 1
      if (finance.amount) {
        paymentsToInsert.push({
          financeId: finance.financeId,
          amount: finance.amount,
          paymentDate: finance.paymentDate,
          paidBy,
          approvalStatus: finance.approvalStatus,
          approvedBy: finance.approvedBy,
          approvedAt: finance.approvedAt,
          remarks: finance.remarks,
        });
      }

      // PAYMENT 2
      if (finance.anotherPaymentAmount) {
        paymentsToInsert.push({
          financeId: finance.financeId,
          amount: finance.anotherPaymentAmount,
          paymentDate: finance.anotherPaymentDate,
          paidBy,
          approvalStatus: "approved",
        });
      }

      // PAYMENT 3
      if (finance.anotherPaymentAmount2) {
        paymentsToInsert.push({
          financeId: finance.financeId,
          amount: finance.anotherPaymentAmount2,
          paymentDate: finance.anotherPaymentDate2,
          paidBy,
          approvalStatus: "approved",
        });
      }

      // PAYMENT 4
      if (finance.anotherPaymentAmount3) {
        paymentsToInsert.push({
          financeId: finance.financeId,
          amount: finance.anotherPaymentAmount3,
          paymentDate: finance.anotherPaymentDate3,
          paidBy,
          approvalStatus: "approved",
        });
      }

      if (paymentsToInsert.length > 0) {
        await db.insert(financePayments).values(paymentsToInsert);

        console.log(
          `Inserted ${paymentsToInsert.length} payments for Finance ID ${finance.financeId}`
        );
      }
    }

    console.log("Migration Completed Successfully");
  } catch (error) {
    console.error("Migration Failed");
    console.error(error);
  } finally {
    process.exit(0);
  }
}

migrateFinancePayments();