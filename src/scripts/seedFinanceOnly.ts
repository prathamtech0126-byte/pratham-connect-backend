/**
 * seedFinanceOnly.ts
 */

import "dotenv/config";
import { db } from "../config/databaseConnection";

import { clientInformation } from "../schemas/clientInformation.schema";
import { clientPayments } from "../schemas/clientPayment.schema";
import { clientProductPayments } from "../schemas/clientProductPayments.schema";
import { allFinance } from "../schemas/allFinance.schema";
import { tutionFees } from "../schemas/tutionFees.schema";
import { visaExtension } from "../schemas/visaExtension.schema";

// ─────────────────────────────────────────
// TYPES (MATCH YOUR DB ENUMS)
// ─────────────────────────────────────────

type TuitionStatus = "paid" | "pending";

type PaymentStage =
  | "INITIAL"
  | "BEFORE_VISA"
  | "AFTER_VISA"
  | "SUBMITTED_VISA";

type ProductName =
  | "TUTION_FEES"
  | "VISA_EXTENSION"
  | "ALL_FINANCE_EMPLOYEMENT"; // ✅ IMPORTANT

type EntityType =
  | "tutionFees_id"
  | "visaextension_id"
  | "allFinance_id";

type ApprovalStatus = "pending" | "approved" | "rejected";

// ─────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────

const RUN_ID = Date.now().toString(36).toUpperCase();

const uid = (prefix: string, i: number) =>
  `${prefix}-${RUN_ID}-${String(i).padStart(3, "0")}`;

const rand = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const randDec = (min: number, max: number) =>
  (Math.random() * (max - min) + min).toFixed(2);

const dateStr = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

// ─────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────

const N = 25;
const COUNSELLORS = [4, 5, 6];
const SALE_TYPES = [1, 2, 3];
const HANDLER_ID = 4;

// ─────────────────────────────────────────
// SEED MONTH
// ─────────────────────────────────────────

async function seedMonth(year: number, month: number) {
  console.log(`📅 Seeding ${year}-${month}`);

  await db.transaction(async (tx) => {
    // ── Clients ──
    const clients = await tx
      .insert(clientInformation)
      .values(
        Array.from({ length: N }, (_, i) => ({
          counsellorId: COUNSELLORS[i % COUNSELLORS.length],
          fullName: `Client ${i + 1}`,
          enrollmentDate: dateStr(year, month, rand(1, 28)),
          passportDetails: uid("PP", i),
          leadTypeId: 1,
          archived: false,
        }))
      )
      .returning({ id: clientInformation.clientId });

    const clientIds = clients.map((c) => c.id);

    // ── Tuition Fees ──
    const tf = await tx
      .insert(tutionFees)
      .values(
        Array.from({ length: 10 }, (_, i) => {
          const status: TuitionStatus =
            i % 2 === 0 ? "paid" : "pending";

          return {
            tutionFeesStatus: status,
            feeDate: dateStr(year, month, rand(1, 28)),
            remarks: "seed",
          };
        })
      )
      .returning({ id: tutionFees.id });

    // ── Visa Extension ──
    const ve = await tx
      .insert(visaExtension)
      .values(
        Array.from({ length: 10 }, (_, i) => ({
          type: "TRV Extension",
          amount: randDec(20000, 80000),
          extensionDate: dateStr(year, month, rand(1, 28)),
          invoiceNo: uid("VE", i),
          remarks: "seed",
        }))
      )
      .returning({ id: visaExtension.id });

    // ── All Finance ──
    const af = await tx
      .insert(allFinance)
      .values(
        Array.from({ length: 10 }, (_, i) => {
          const approval: ApprovalStatus = "approved";

          return {
            totalAmount: randDec(100000, 500000),
            amount: randDec(50000, 200000),
            paymentDate: dateStr(year, month, rand(1, 28)),
            invoiceNo: uid("AF", i),
            partialPayment: i % 2 === 0,
            approvalStatus: approval,
            approvedBy: 1,
            approvedAt: new Date(),
            remarks: "seed",
          };
        })
      )
      .returning({ id: allFinance.financeId });

    // ── Client Payments ──
    await tx.insert(clientPayments).values(
      clientIds.map((cid, i) => {
        const stage: PaymentStage = "INITIAL";

        return {
          clientId: cid,
          saleTypeId: SALE_TYPES[i % SALE_TYPES.length],
          totalPayment: randDec(50000, 200000),
          stage,
          amount: randDec(20000, 100000),
          paymentDate: dateStr(year, month, rand(1, 28)),
          invoiceNo: uid("CP", i),
          handledBy: HANDLER_ID,
          remarks: "seed",
        };
      })
    );

    // ── Client Product Payments ──
    const entries = [
  ...tf.map((t) => ({
    entityId: t.id,
    entityType: "tutionFees_id" as const,
    productName: "TUTION_FEES" as const,
    amount: randDec(50000, 200000),
  })),
  ...ve.map((v) => ({
    entityId: v.id,
    entityType: "visaextension_id" as const,
    productName: "VISA_EXTENSION" as const,
    amount: randDec(20000, 80000),
  })),
  ...af.map((a) => ({
    entityId: a.id,
    entityType: "allFinance_id" as const,
    productName: "ALL_FINANCE_EMPLOYEMENT" as const,
    amount: randDec(50000, 200000),
  })),
];

    await tx.insert(clientProductPayments).values(
      entries.map((e, i) => ({
        clientId: clientIds[i % clientIds.length],
        productName: e.productName,
        amount: e.amount,
        paymentDate: dateStr(year, month, rand(1, 28)),
        invoiceNo: uid("PP", i),
        entityId: e.entityId,
        entityType: e.entityType,
        handledBy: HANDLER_ID,
        remarks: "seed",
      }))
    );
  });

  console.log("✓ Month done");
}

// ─────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────

async function main() {
  for (const m of [1, 2, 3, 4]) {
    await seedMonth(2026, m);
  }

  console.log("\n✅ Finance seed completed");
}

main();