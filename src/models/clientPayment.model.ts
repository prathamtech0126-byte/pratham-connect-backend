import { db } from "../config/databaseConnection";
import pool from "../config/databaseConnection";
import { clientPayments } from "../schemas/clientPayment.schema";
import { saleTypes } from "../schemas/saleType.schema";
import { eq, and, ne, desc } from "drizzle-orm";
import { parseFrontendDate } from "../utils/date";
import { activityActionEnum } from "../schemas/activityLog.schema";

export type PaymentStage =
  | "INITIAL"
  | "BEFORE_VISA"
  | "AFTER_VISA"
  | "SUBMITTED_VISA";

interface SaveClientPaymentInput {
  paymentId?: number; // 👈 optional
  clientId: number;
  saleTypeId: number;
  totalPayment: string;
  stage: PaymentStage;
  amount: string;
  paymentDate?: string;
  invoiceNo?: string;
  remarks?: string;
}

export const saveClientPayment = async (
  data: SaveClientPaymentInput
) => {
  // Normalize IDs - convert strings to numbers if needed
  const paymentId = data.paymentId ? Number(data.paymentId) : undefined;
  const clientId = Number(data.clientId);
  const saleTypeId = Number(data.saleTypeId);
  const {
    totalPayment,
    stage,
    amount,
    paymentDate,
    invoiceNo,
    remarks,
  } = data;

  if (!clientId || !Number.isFinite(clientId) || clientId <= 0) {
    throw new Error("Valid clientId is required");
  }

  if (!saleTypeId || !Number.isFinite(saleTypeId) || saleTypeId <= 0) {
    throw new Error("Valid saleTypeId is required");
  }

  if (!stage || !amount || !totalPayment) {
    throw new Error("Required payment fields missing: stage, amount, totalPayment");
  }

  // Validate sale type exists
  const saleType = await db
    .select({ id: saleTypes.saleTypeId })
    .from(saleTypes)
    .where(eq(saleTypes.saleTypeId, saleTypeId))
    .limit(1);

  if (!saleType.length) {
    throw new Error("Invalid sale type");
  }

  // Frontend sends DD-MM-YYYY; normalize to YYYY-MM-DD for DB. Default to today if missing.
  const finalPaymentDate = parseFrontendDate(paymentDate) || new Date().toISOString().split("T")[0];

  // Normalize invoiceNo: convert empty string to null (invoiceNo can be NULL)
  // User can provide a unique invoice number, or leave it NULL
  let normalizedInvoiceNo: string | null = null;
  if (invoiceNo !== undefined && invoiceNo !== null) {
    const trimmed = String(invoiceNo).trim();
    normalizedInvoiceNo = trimmed.length > 0 ? trimmed : null;
  }

  /* =========================
     UPSERT PAYMENT (with IS DISTINCT FROM check)
  ========================= */
  const normalizedRemarks = remarks ? String(remarks).trim() : null;
  const normalizedTotalPayment = String(totalPayment);
  const normalizedAmount = String(amount);

  // If paymentId is provided, validate it exists first
  if (paymentId && Number.isFinite(paymentId) && paymentId > 0) {
    const existingPayment = await db
      .select({ id: clientPayments.paymentId, invoiceNo: clientPayments.invoiceNo })
      .from(clientPayments)
      .where(eq(clientPayments.paymentId, paymentId));

    if (!existingPayment.length) {
      throw new Error("Payment not found");
    }

    // Check if invoiceNo is being changed and if the new invoiceNo already exists (excluding current payment)
    // Only check for duplicates if a new invoiceNo is provided (not NULL)
    if (normalizedInvoiceNo !== null && normalizedInvoiceNo !== existingPayment[0].invoiceNo) {
      const duplicateCheck = await db
        .select({ id: clientPayments.paymentId })
        .from(clientPayments)
        .where(and(
          eq(clientPayments.invoiceNo, normalizedInvoiceNo),
          ne(clientPayments.paymentId, paymentId)
        ))
        .limit(1);

      if (duplicateCheck.length > 0) {
        throw new Error(`Invoice number "${normalizedInvoiceNo}" already exists. Please use a different invoice number.`);
      }
    }
  } else {
    // For new records, check if invoiceNo already exists (only if invoiceNo is provided)
    if (normalizedInvoiceNo !== null) {
      const duplicateCheck = await db
        .select({ id: clientPayments.paymentId })
        .from(clientPayments)
        .where(eq(clientPayments.invoiceNo, normalizedInvoiceNo))
        .limit(1);

      if (duplicateCheck.length > 0) {
        throw new Error(`Invoice number "${normalizedInvoiceNo}" already exists. Please use a different invoice number.`);
      }
    }
  }

  // Use UPSERT with IS DISTINCT FROM to only update when data actually changes
  // Note: When WHERE clause is false, PostgreSQL still returns the existing row but rowCount = 0
  const upsertQuery = paymentId && Number.isFinite(paymentId) && paymentId > 0
    ? `
      WITH updated AS (
        INSERT INTO client_payment (
          id, client_id, sale_type_id, total_payment, stage, amount, payment_date, invoice_no, remarks
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO UPDATE SET
          client_id = EXCLUDED.client_id,
          sale_type_id = EXCLUDED.sale_type_id,
          total_payment = EXCLUDED.total_payment,
          stage = EXCLUDED.stage,
          amount = EXCLUDED.amount,
          payment_date = EXCLUDED.payment_date,
          invoice_no = EXCLUDED.invoice_no,
          remarks = EXCLUDED.remarks
        WHERE (
          client_payment.client_id IS DISTINCT FROM EXCLUDED.client_id
          OR client_payment.sale_type_id IS DISTINCT FROM EXCLUDED.sale_type_id
          OR client_payment.total_payment IS DISTINCT FROM EXCLUDED.total_payment
          OR client_payment.stage IS DISTINCT FROM EXCLUDED.stage
          OR client_payment.amount IS DISTINCT FROM EXCLUDED.amount
          OR client_payment.payment_date IS DISTINCT FROM EXCLUDED.payment_date
          OR client_payment.invoice_no IS DISTINCT FROM EXCLUDED.invoice_no
          OR client_payment.remarks IS DISTINCT FROM EXCLUDED.remarks
        )
        RETURNING id, client_id, sale_type_id, total_payment, stage, amount, payment_date, invoice_no, remarks, created_at
      )
      SELECT * FROM updated
      UNION ALL
      SELECT id, client_id, sale_type_id, total_payment, stage, amount, payment_date, invoice_no, remarks, created_at
      FROM client_payment
      WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM updated)
      LIMIT 1;
    `
    : `
      INSERT INTO client_payment (
        client_id, sale_type_id, total_payment, stage, amount, payment_date, invoice_no, remarks
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, client_id, sale_type_id, total_payment, stage, amount, payment_date, invoice_no, remarks, created_at;
    `;

  const values = paymentId && Number.isFinite(paymentId) && paymentId > 0
    ? [paymentId, clientId, saleTypeId, normalizedTotalPayment, stage, normalizedAmount, finalPaymentDate, normalizedInvoiceNo, normalizedRemarks]
    : [clientId, saleTypeId, normalizedTotalPayment, stage, normalizedAmount, finalPaymentDate, normalizedInvoiceNo, normalizedRemarks];

  try {
    const result = await pool.query(upsertQuery, values);
    const rowCount = result.rowCount || 0;
    const row = result.rows[0];

    if (!row) {
      // Log the query and values for debugging
      console.error("UPSERT query returned no rows:", {
        paymentId,
        query: upsertQuery.substring(0, 200),
        values: values.map((v, i) => ({ param: i + 1, value: v, type: typeof v })),
      });
      throw new Error("Failed to save payment: Query returned no rows");
    }

    // Determine action based on rowCount and whether it's a new record
    const isNewRecord = !paymentId || !Number.isFinite(paymentId) || paymentId <= 0;
    const action = isNewRecord ? "CREATED" : (rowCount > 0 ? "UPDATED" : "NO_CHANGE");

    return {
      action,
      payment: {
        paymentId: row.id,
        clientId: row.client_id,
        saleTypeId: row.sale_type_id,
        totalPayment: row.total_payment,
        stage: row.stage,
        amount: row.amount,
        paymentDate: row.payment_date,
        invoiceNo: row.invoice_no,
        remarks: row.remarks,
        createdAt: row.created_at,
      },
      rowCount, // Include rowCount so controller can check if real change occurred
    };
  } catch (error: any) {
    // Log the actual database error
    console.error("Database error in saveClientPayment:", {
      error: error.message,
      code: error.code,
      detail: error.detail,
      constraint: error.constraint,
      paymentId,
      clientId,
      invoiceNo: normalizedInvoiceNo,
    });
    throw error;
  }
};

export const getPaymentsByClientId = async (clientId: number) => {
  const payments = await db
    .select({
      paymentId: clientPayments.paymentId,
      clientId: clientPayments.clientId,
      saleTypeId: clientPayments.saleTypeId,
      totalPayment: clientPayments.totalPayment,
      stage: clientPayments.stage,
      amount: clientPayments.amount,
      paymentDate: clientPayments.paymentDate,
      invoiceNo: clientPayments.invoiceNo,
      remarks: clientPayments.remarks,
      createdAt: clientPayments.createdAt,
      // Sale type information
      saleType: saleTypes.saleType,
    })
    .from(clientPayments)
    .leftJoin(saleTypes, eq(clientPayments.saleTypeId, saleTypes.saleTypeId))
    .where(eq(clientPayments.clientId, clientId))
    .orderBy(desc(clientPayments.paymentDate));

  // Transform to include saleType object instead of saleTypeId
  return payments.map((payment) => ({
    paymentId: payment.paymentId,
    clientId: payment.clientId,
    saleType: payment.saleTypeId
      ? {
          id: payment.saleTypeId,
          saleType: payment.saleType || null,
        }
      : null,
    totalPayment: payment.totalPayment,
    stage: payment.stage,
    amount: payment.amount,
    paymentDate: payment.paymentDate,
    invoiceNo: payment.invoiceNo,
    remarks: payment.remarks,
    createdAt: payment.createdAt,
  }));
};


export const deleteClientPayment = async (paymentId: number) => {
  try {
    const deleted = await db
      .delete(clientPayments)
      .where(eq(clientPayments.paymentId, paymentId))
      .returning({
        paymentId: clientPayments.paymentId,
        clientId: clientPayments.clientId,
        saleTypeId: clientPayments.saleTypeId,
        totalPayment: clientPayments.totalPayment,
        stage: clientPayments.stage,
        amount: clientPayments.amount,
      });

    if (!deleted || deleted.length === 0) {
      return null;
    }

    return deleted[0];
  } catch (error: any) {
    console.error("DB delete error:", error);
    throw new Error("DATABASE_DELETE_FAILED");
  }
};
