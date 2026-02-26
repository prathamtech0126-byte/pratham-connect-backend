import { db } from "../config/databaseConnection";
import {
  clientProductPayments,
  productTypeEnum,
  entityTypeEnum,
} from "../schemas/clientProductPayments.schema";
import { clientInformation } from "../schemas/clientInformation.schema";
import { simCard } from "../schemas/simCard.schema";
import { airTicket } from "../schemas/airTicket.schema";
import { ielts } from "../schemas/ielts.schema";
import { loan } from "../schemas/loan.schema";
import { forexCard } from "../schemas/forexCard.schema";
import { forexFees } from "../schemas/forexFees.schema";
import { tutionFees } from "../schemas/tutionFees.schema";
import { insurance } from "../schemas/insurance.schema";
import { beaconAccount } from "../schemas/beaconAccount.schema";
import { creditCard } from "../schemas/creditCard.schema";
import { newSell } from "../schemas/newSell.schema";
import { visaExtension } from "../schemas/visaExtension.schema";
import { allFinance } from "../schemas/allFinance.schema";
import { users } from "../schemas/users.schema";
import { eq, inArray, and, ne, sql, desc } from "drizzle-orm";
import { parseFrontendDate } from "../utils/date";

// Helper function to safely fetch entities with error handling
const fetchEntities = async <T extends { id: number } | { financeId: number }>(
  table: any,
  ids: number[],
  entityType: string
): Promise<Map<number, T>> => {
  if (!ids || ids.length === 0) {
    return new Map();
  }

  try {
    // For allFinance, use financeId field; for others, use id
    const idField = entityType === "allFinance_id" ? table.financeId : table.id;

    const records = await db
      .select()
      .from(table)
      .where(
        ids.length === 1
          ? eq(idField, ids[0])
          : inArray(idField, ids)
      );

    const map = new Map(records.map((r: any) => {
      // Handle both id and financeId field names
      const key = Number(r.financeId ?? r.id);
      return [key, r];
    }));

    return map;
  } catch (error) {
    if (entityType === "newSell_id" || entityType === "allFinance_id") {
      console.error(`[DEBUG] fetchEntities error for ${entityType}:`, error);
    }
    return new Map();
  }
};

// Product type enum values
export type ProductType =
  | "ALL_FINANCE_EMPLOYEMENT"
  | "INDIAN_SIDE_EMPLOYEMENT"
  | "NOC_LEVEL_JOB_ARRANGEMENT"
  | "LAWYER_REFUSAL_CHARGE"
  | "ONSHORE_PART_TIME_EMPLOYEMENT"
  | "TRV_WORK_PERMIT_EXT_STUDY_PERMIT_EXTENSION"
  | "MARRIAGE_PHOTO_FOR_COURT_MARRIAGE"
  | "MARRIAGE_PHOTO_CERTIFICATE"
  | "RECENTE_MARRIAGE_RELATIONSHIP_AFFIDAVIT"
  | "JUDICAL_REVIEW_CHARGE"
  | "SIM_CARD_ACTIVATION"
  | "INSURANCE"
  | "BEACON_ACCOUNT"
  | "AIR_TICKET"
  | "OTHER_NEW_SELL"
  | "SPONSOR_CHARGES"
  | "FINANCE_EMPLOYEMENT"
  | "IELTS_ENROLLMENT"
  | "LOAN_DETAILS"
  | "FOREX_CARD"
  | "FOREX_FEES"
  | "TUTION_FEES"
  | "CREDIT_CARD"
  | "VISA_EXTENSION"
  | "REFUSAL_CHARGES"
  | "KIDS_STUDY_PERMIT"
  | "CANADA_FUND"
  | "EMPLOYMENT_VERIFICATION_CHARGES"
  | "ADDITIONAL_AMOUNT_STATEMENT_CHARGES";

// Entity type enum values
export type EntityType =
  | "visaextension_id"
  | "simCard_id"
  | "airTicket_id"
  | "newSell_id"
  | "ielts_id"
  | "loan_id"
  | "forexCard_id"
  | "forexFees_id"
  | "tutionFees_id"
  | "insurance_id"
  | "beaconAccount_id"
  | "creditCard_id"
  | "allFinance_id"
  | "master_only";

// Map product name to entity type
const productToEntityTypeMap: Record<ProductType, EntityType> = {
  SIM_CARD_ACTIVATION: "simCard_id",
  AIR_TICKET: "airTicket_id",
  IELTS_ENROLLMENT: "ielts_id",
  LOAN_DETAILS: "loan_id",
  FOREX_CARD: "forexCard_id",
  FOREX_FEES: "forexFees_id",
  TUTION_FEES: "tutionFees_id",
  INSURANCE: "insurance_id",
  BEACON_ACCOUNT: "beaconAccount_id",
  CREDIT_CARD: "creditCard_id",
  OTHER_NEW_SELL: "newSell_id",
  VISA_EXTENSION: "visaextension_id",
  // ✅ ALL FINANCE - uses its own table
  ALL_FINANCE_EMPLOYEMENT: "allFinance_id",
  // Products without specific tables use newSell
  // ✅ MASTER-ONLY PRODUCTS
  INDIAN_SIDE_EMPLOYEMENT: "master_only",
  NOC_LEVEL_JOB_ARRANGEMENT: "master_only",
  LAWYER_REFUSAL_CHARGE: "master_only",
  ONSHORE_PART_TIME_EMPLOYEMENT: "master_only",
  TRV_WORK_PERMIT_EXT_STUDY_PERMIT_EXTENSION: "visaextension_id",
  MARRIAGE_PHOTO_FOR_COURT_MARRIAGE: "master_only",
  MARRIAGE_PHOTO_CERTIFICATE: "master_only",
  RECENTE_MARRIAGE_RELATIONSHIP_AFFIDAVIT: "master_only",
  JUDICAL_REVIEW_CHARGE: "master_only",
  SPONSOR_CHARGES: "master_only",
  FINANCE_EMPLOYEMENT: "master_only",
  REFUSAL_CHARGES: "master_only",
  KIDS_STUDY_PERMIT: "master_only",
  CANADA_FUND: "master_only",
  EMPLOYMENT_VERIFICATION_CHARGES: "master_only",
  ADDITIONAL_AMOUNT_STATEMENT_CHARGES: "master_only",
};

// Map entity type to table for validation
const entityTypeToTable: Record<EntityType, any> = {
  simCard_id: simCard,
  airTicket_id: airTicket,
  ielts_id: ielts,
  loan_id: loan,
  forexCard_id: forexCard,
  forexFees_id: forexFees,
  tutionFees_id: tutionFees,
  insurance_id: insurance,
  beaconAccount_id: beaconAccount,
  creditCard_id: creditCard,
  allFinance_id: allFinance,
  newSell_id: newSell,
  visaextension_id: visaExtension,
  master_only: null,
};

/** Return type for activity log: amount, remarks, paymentDate, invoiceNo (and allFinance anotherPayment*) from entity tables */
export interface EntityDisplayData {
  amount?: string | null;
  remarks?: string | null;
  paymentDate?: string | Date | null;
  invoiceNo?: string | null;
  anotherPaymentAmount?: string | null;
  anotherPaymentDate?: string | Date | null;
}

/**
 * Fetch amount, remarks, paymentDate, invoiceNo from entity table for activity log.
 * Use when client_product_payment has null for these (entity-based products store data in entity table).
 */
export const getEntityDisplayDataForActivityLog = async (
  entityType: EntityType,
  entityId: number | null
): Promise<EntityDisplayData> => {
  if (!entityId || entityType === "master_only") return {};

  const table = entityTypeToTable[entityType];
  if (!table) return {};

  try {
    const idField = entityType === "allFinance_id" ? table.financeId : table.id;
    const [row] = await db.select().from(table).where(eq(idField, entityId)).limit(1);
    if (!row) return {};

    const out: EntityDisplayData = {};
    if ("amount" in row && row.amount != null) out.amount = String(row.amount);
    if ("remarks" in row && row.remarks != null) out.remarks = String(row.remarks);
    if ("remark" in row && row.remark != null) out.remarks = String(row.remark);
    if ("paymentDate" in row && row.paymentDate != null) out.paymentDate = row.paymentDate;
    if ("payment_date" in row && (row as any).payment_date != null)
      out.paymentDate = (row as any).payment_date;
    if ("invoiceNo" in row && row.invoiceNo != null) out.invoiceNo = String(row.invoiceNo);
    if ("invoice_no" in row && (row as any).invoice_no != null)
      out.invoiceNo = String((row as any).invoice_no);
    if ("anotherPaymentAmount" in row && (row as any).anotherPaymentAmount != null)
      out.anotherPaymentAmount = String((row as any).anotherPaymentAmount);
    if ("anotherPaymentDate" in row && (row as any).anotherPaymentDate != null)
      out.anotherPaymentDate = (row as any).anotherPaymentDate;
    // Entities like beacon_account use fundingDate/openingDate instead of paymentDate
    if (out.paymentDate == null) {
      const fundingDate = (row as any).fundingDate ?? (row as any).funding_date;
      const openingDate = (row as any).openingDate ?? (row as any).opening_date;
      if (fundingDate != null) out.paymentDate = fundingDate;
      else if (openingDate != null) out.paymentDate = openingDate;
    }
    return out;
  } catch {
    return {};
  }
};

// Entity data interfaces
interface SimCardData {
  activatedStatus?: boolean;
  simcardPlan?: string;
  simCardGivingDate?: string;
  simActivationDate?: string;
  remarks?: string;
}

interface AirTicketData {
  isTicketBooked?: boolean;
  amount?: number | string;
  airTicketNumber?: string;
  ticketDate?: string;
  remarks?: string;
}

interface IeltsData {
  enrolledStatus?: boolean;
  amount: number | string;
  enrollmentDate?: string;
  remarks?: string;
}

interface LoanData {
  amount: number | string;
  disbursmentDate?: string;
  remarks?: string;
}

interface ForexCardData {
  forexCardStatus?: string;
  cardDate?: string;
  remarks?: string;
}

interface ForexFeesData {
  side: "PI" | "TP";
  amount: number | string;
  feeDate?: string;
  remarks?: string;
}

interface TutionFeesData {
  tutionFeesStatus: "paid" | "pending";
  feeDate?: string;
  remarks?: string;
}

interface InsuranceData {
  amount: number | string;
  policyNumber?: string;
  insuranceDate?: string;
  remarks?: string;
}

interface BeaconAccountData {
  amount?: number | string;
  fundingAmount?: number | string; // Frontend sends this field
  accountDate?: string;
  fundingDate?: string; // Frontend sends this field
  openingDate?: string; // Frontend sends this field
  remarks?: string;
}

interface CreditCardData {
  activatedStatus?: boolean;
  cardPlan?: string;
  cardGivingDate?: string;
  cardActivationDate?: string;
  cardDate?: string;
  remarks?: string;
}

interface AllFinanceData {
  amount: number | string;
  paymentDate?: string;
  invoiceNo?: string;
  partialPayment?: boolean;
  approvalStatus?: "pending" | "approved" | "rejected";
  approvedBy?: number;
  remarks?: string;
  anotherPaymentAmount?: number | string;
  anotherPaymentDate?: string;
}

interface VisaExtensionData {
  type: string;
  amount: number | string;
  extensionDate?: string;
  invoiceNo?: string;
  remarks?: string;
}

interface NewSellData {
  serviceName: string;
  serviceInformation?: string;
  amount: number | string;
  sellDate?: string;
  invoiceNo?: string;
  remarks?: string;
}

interface SaveClientProductPaymentInput {
  productPaymentId?: number;
  clientId: number;
  productName: ProductType;
  invoiceNo?: string;
  amount: number | string;
  paymentDate?: string;
  remarks?: string;
  entityId?: number;
  // Entity data based on product type
  entityData?:
    | SimCardData
    | AirTicketData
    | IeltsData
    | LoanData
    | ForexCardData
    | ForexFeesData
    | TutionFeesData
    | InsuranceData
    | BeaconAccountData
    | CreditCardData
    | AllFinanceData
    | VisaExtensionData
    | NewSellData;
}

// Helper function to create entity record
const createEntityRecord = async (
  entityType: EntityType,
  entityData: any,
  productAmount: number | string = 0,
  remarks?: string
): Promise<number> => {
  const amountValue =
    typeof productAmount === "string"
      ? parseFloat(productAmount)
      : productAmount;

  switch (entityType) {
    case "simCard_id": {
      const data = entityData as SimCardData;
      const [record] = await db
        .insert(simCard)
        .values({
          activatedStatus: data.activatedStatus ?? false,
          simcardPlan: data.simcardPlan ?? null,
          simCardGivingDate: parseFrontendDate(data.simCardGivingDate) ?? null,
          simActivationDate: parseFrontendDate(data.simActivationDate) ?? null,
          remarks: data.remarks ?? null,
        })
        .returning();
      return record.id;
    }

    case "airTicket_id": {
      const data = entityData as AirTicketData;

      // Provide default for NOT NULL field if not provided
      const finalAirTicketNumber = data.airTicketNumber || `TKT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const finalTicketDate = parseFrontendDate(data.ticketDate) || new Date().toISOString().split("T")[0];

      // Check if airTicketNumber already exists before creating
      const duplicateCheck = await db
        .select({ id: airTicket.id })
        .from(airTicket)
        .where(eq(airTicket.airTicketNumber, finalAirTicketNumber))
        .limit(1);

      if (duplicateCheck.length > 0) {
        throw new Error(`Air ticket number "${finalAirTicketNumber}" already exists. Please use a different ticket number.`);
      }

      const [record] = await db
        .insert(airTicket)
        .values({
          isTicketBooked: data.isTicketBooked ?? false,
          amount: data.amount ? data.amount.toString() : amountValue.toString(),
          airTicketNumber: finalAirTicketNumber,
          ticketDate: finalTicketDate,
          remarks: data.remarks ?? null,
        })
        .returning();
      return record.id;
    }

    case "ielts_id": {
      const data = entityData as IeltsData;
      const [record] = await db
        .insert(ielts)
        .values({
          enrolledStatus: data.enrolledStatus ?? false,
          amount: data.amount.toString(),
          enrollmentDate: parseFrontendDate(data.enrollmentDate) ?? null,
          remarks: data.remarks ?? null,
        })
        .returning();
      return record.id;
    }

    case "loan_id": {
      const data = entityData as LoanData;
      // Provide default for NOT NULL field if not provided
      const finalDisbursmentDate = parseFrontendDate(data.disbursmentDate) || new Date().toISOString().split("T")[0];
      const [record] = await db
        .insert(loan)
        .values({
          amount: data.amount.toString(),
          disbursmentDate: finalDisbursmentDate,
          remarks: data.remarks ?? null,
        })
        .returning();
      return record.id;
    }

    case "forexCard_id": {
      const data = entityData as ForexCardData;
      const [record] = await db
        .insert(forexCard)
        .values({
          forexCardStatus: data.forexCardStatus ?? null,
          cardDate: parseFrontendDate(data.cardDate) ?? null,
          remarks: data.remarks ?? null,
        })
        .returning();
      return record.id;
    }

    case "forexFees_id": {
      const data = entityData as ForexFeesData;
      if (!data.side || !["PI", "TP"].includes(data.side)) {
        throw new Error("side is required and must be 'PI' or 'TP'");
      }
      const [record] = await db
        .insert(forexFees)
        .values({
          side: data.side as any,
          amount: data.amount.toString(),
          feeDate: parseFrontendDate(data.feeDate) ?? null,
          remarks: data.remarks ?? null,
        })
        .returning();
      return record.id;
    }

    case "tutionFees_id": {
      const data = entityData as TutionFeesData;
      if (
        !data.tutionFeesStatus ||
        !["paid", "pending"].includes(data.tutionFeesStatus)
      ) {
        throw new Error(
          "tutionFeesStatus is required and must be 'paid' or 'pending'"
        );
      }
      const [record] = await db
        .insert(tutionFees)
        .values({
          tutionFeesStatus: data.tutionFeesStatus as any,
          feeDate: parseFrontendDate(data.feeDate) ?? null,
          remarks: data.remarks ?? null,
        })
        .returning();
      return record.id;
    }

    case "insurance_id": {
      const data = entityData as InsuranceData;
      // Provide default for NOT NULL field if not provided
      const finalInsuranceDate = parseFrontendDate(data.insuranceDate) || new Date().toISOString().split("T")[0];
      const [record] = await db
        .insert(insurance)
        .values({
          amount: data.amount.toString(),
          policyNumber: data.policyNumber ?? null,
          insuranceDate: finalInsuranceDate,
          remarks: data.remarks ?? null,
        })
        .returning();
      return record.id;
    }

    case "beaconAccount_id": {
      const data = entityData as BeaconAccountData;
      // Use amount if provided, otherwise fallback to fundingAmount
      const amountValue = data.amount ?? data.fundingAmount;
      if (amountValue === undefined || amountValue === null) {
        throw new Error("amount or fundingAmount is required for beacon account");
      }
      // Use accountDate if provided, otherwise fallback to fundingDate or openingDate (frontend: DD-MM-YYYY)
      const [record] = await db
        .insert(beaconAccount)
        .values({
          amount: amountValue.toString(),
          openingDate: parseFrontendDate(data.openingDate) ?? null,
          fundingDate: parseFrontendDate(data.fundingDate) ?? null,
          remarks: data.remarks ?? null,
        })
        .returning();
      return record.id;
    }

    case "creditCard_id": {
      const data = entityData as CreditCardData;
      const [record] = await db
        .insert(creditCard)
        .values({
          activatedStatus: data.activatedStatus ?? false,
          cardPlan: data.cardPlan ?? null,
          cardGivingDate: parseFrontendDate(data.cardGivingDate) ?? null,
          cardActivationDate: parseFrontendDate(data.cardActivationDate) ?? null,
          cardDate: parseFrontendDate(data.cardDate) ?? null,
          remarks: data.remarks ?? null,
        })
        .returning();
      return record.id;
    }

    case "allFinance_id": {
      const data = entityData as AllFinanceData;
      const amountValue = typeof data.amount === "string" ? parseFloat(data.amount) : data.amount;

      if (!amountValue || !isFinite(amountValue) || amountValue <= 0) {
        throw new Error("Valid amount is required for all finance");
      }

      const paymentDateParsed = parseFrontendDate(data.paymentDate);
      if (!paymentDateParsed) {
        throw new Error("paymentDate is required for all finance");
      }

      // Determine approval status based on partialPayment
      // If partialPayment is true, status is "pending" (needs manager approval)
      // If partialPayment is false, status is "approved" (auto-approved)
      const approvalStatus = data.partialPayment === true ? "pending" : (data.approvalStatus || "approved");

      // Check for duplicate invoiceNo if provided
      if (data.invoiceNo) {
        const [duplicateCheck] = await db
          .select({ financeId: allFinance.financeId })
          .from(allFinance)
          .where(eq(allFinance.invoiceNo, data.invoiceNo))
          .limit(1);

        if (duplicateCheck) {
          throw new Error(`Invoice number "${data.invoiceNo}" already exists. Please use a different invoice number.`);
        }
      }

      const anotherAmount =
        data.anotherPaymentAmount !== undefined && data.anotherPaymentAmount !== null && data.anotherPaymentAmount !== ""
          ? (typeof data.anotherPaymentAmount === "string" ? parseFloat(data.anotherPaymentAmount) : data.anotherPaymentAmount)
          : null;
      const anotherDate = data.anotherPaymentDate ? parseFrontendDate(data.anotherPaymentDate) ?? null : null;

      const [record] = await db
        .insert(allFinance)
        .values({
          amount: amountValue.toString(),
          paymentDate: paymentDateParsed,
          invoiceNo: data.invoiceNo && data.invoiceNo.trim() !== "" ? data.invoiceNo.trim() : null,
          partialPayment: data.partialPayment ?? false,
          approvalStatus: approvalStatus as "pending" | "approved" | "rejected",
          approvedBy: data.approvedBy && approvalStatus === "approved" ? data.approvedBy : null,
          remarks: data.remarks && data.remarks.trim() !== "" ? data.remarks.trim() : null,
          anotherPaymentAmount: anotherAmount != null && isFinite(anotherAmount) ? anotherAmount.toString() : null,
          anotherPaymentDate: anotherDate,
        })
        .returning();
      return record.financeId;
    }

    case "visaextension_id": {
      const data = entityData as VisaExtensionData;
      if (!data.type) {
        throw new Error("type is required for visa extension");
      }
      // Provide default for NOT NULL field if not provided (frontend: DD-MM-YYYY)
      const finalExtensionDate = parseFrontendDate(data.extensionDate) || new Date().toISOString().split("T")[0];

      // Normalize invoiceNo and remarks - convert empty strings to null
      const normalizedInvoiceNo = data.invoiceNo && data.invoiceNo.trim() !== "" ? data.invoiceNo.trim() : null;
      const normalizedRemarks = data.remarks && data.remarks.trim() !== "" ? data.remarks.trim() : null;

      // Check for duplicate invoice_no before insert (unique constraint on visa_extension)
      if (normalizedInvoiceNo) {
        const [duplicate] = await db
          .select({ id: visaExtension.id })
          .from(visaExtension)
          .where(eq(visaExtension.invoiceNo, normalizedInvoiceNo))
          .limit(1);
        if (duplicate) {
          throw new Error(
            `Invoice number "${normalizedInvoiceNo}" already exists in visa extension. Please use a different invoice number.`
          );
        }
      }

      const [record] = await db
        .insert(visaExtension)
        .values({
          type: data.type,
          amount: data.amount.toString(),
          extensionDate: finalExtensionDate,
          invoiceNo: normalizedInvoiceNo,
          remarks: normalizedRemarks,
        })
        .returning();
      return record.id;
    }

    case "newSell_id": {
      const data = entityData as NewSellData;
      if (!data.serviceName) {
        throw new Error("serviceName is required for new sell");
      }
      // Provide default for NOT NULL field if not provided
      const finalSellDate = parseFrontendDate(data.sellDate) || new Date().toISOString().split("T")[0];
      const [record] = await db
        .insert(newSell)
        .values({
          serviceName: data.serviceName,
          serviceInformation: data.serviceInformation ?? null,
          amount: data.amount.toString(),
          sellDate: finalSellDate,
          invoiceNo: data.invoiceNo ?? null,
          remarks: data.remarks ?? null,
        })
        .returning();
      return record.id;
    }

    default:
      throw new Error(`Unsupported entity type: ${entityType}`);
  }
};


export const saveClientProductPayment = async (
  data: SaveClientProductPaymentInput
) => {
  // Normalize IDs - convert strings to numbers if needed
  const productPaymentId = data.productPaymentId ? Number(data.productPaymentId) : undefined;
  const clientId = Number(data.clientId);
  const {
    productName,
    amount,
    paymentDate,
    remarks,
    invoiceNo,
    entityData,
  } = data;

  if (!clientId || !Number.isFinite(clientId) || clientId <= 0) {
    throw new Error("Valid clientId is required");
  }

  if (!productName) {
    throw new Error("productName is required");
  }

  const entityType = productToEntityTypeMap[productName];
  if (!entityType) throw new Error("Invalid productName");

  // ---------------------------
  // AMOUNT VALIDATION (STRICT)
  // ---------------------------
  let amountValue: number | null = null;

  // For master_only products, amount is stored in client_product_payment table
  // For allFinance_id, amount is stored in all_finance table (handled in entityData)
  if (entityType === "master_only") {
    if (amount === undefined || amount === null) {
      throw new Error("amount is required for master_only products");
    }

    amountValue = typeof amount === "string" ? parseFloat(amount) : amount;

    if (!isFinite(amountValue) || amountValue <= 0) {
      throw new Error("Invalid amount");
    }
  }

  // ---------------------------
  // UPDATE
  // ---------------------------
  if (productPaymentId && Number.isFinite(productPaymentId) && productPaymentId > 0) {
    const [existing] = await db
      .select()
      .from(clientProductPayments)
      .where(eq(clientProductPayments.productPaymentId, productPaymentId));

    if (!existing) {
      throw new Error("Product payment record not found");
    }

    // update entity table only if exists
    if (entityData && entityType !== "master_only") {
      const table = entityTypeToTable[entityType];

      // Filter out non-entity fields (id, productPaymentId, productName, etc.)
      // Note: paymentDate is kept because for allFinance_id it is the entity's own payment date
      const {
        id,
        productPaymentId,
        productName,
        clientId,
        entityId,
        entityType: _entityType,
        ...cleanEntityData
      } = entityData as any;

      // Check for duplicate airTicketNumber if updating air ticket
      if (entityType === "airTicket_id" && cleanEntityData.airTicketNumber) {
        // Get current air ticket record
        const [currentAirTicket] = await db
          .select({ id: airTicket.id, airTicketNumber: airTicket.airTicketNumber })
          .from(airTicket)
          .where(eq(airTicket.id, existing.entityId!))
          .limit(1);

        if (currentAirTicket && cleanEntityData.airTicketNumber !== currentAirTicket.airTicketNumber) {
          // Check if new airTicketNumber already exists (excluding current record)
          const duplicateCheck = await db
            .select({ id: airTicket.id })
            .from(airTicket)
            .where(and(
              eq(airTicket.airTicketNumber, cleanEntityData.airTicketNumber),
              ne(airTicket.id, existing.entityId!)
            ))
            .limit(1);

          if (duplicateCheck.length > 0) {
            throw new Error(`Air ticket number "${cleanEntityData.airTicketNumber}" already exists. Please use a different ticket number.`);
          }
        }
      }

      // Transform data for all finance updates
      if (entityType === "allFinance_id") {
        const data = cleanEntityData as AllFinanceData;

        // If entityId doesn't exist, create a new all finance record
        if (!existing.entityId) {
          if (!data.amount) {
            throw new Error("amount is required for all finance");
          }

          const amountValue = typeof data.amount === "string" ? parseFloat(data.amount) : data.amount;
          if (!isFinite(amountValue) || amountValue <= 0) {
            throw new Error("Invalid amount for all finance");
          }

          const approvalStatus = data.partialPayment === true ? "pending" : (data.approvalStatus || "approved");

          // Check for duplicate invoiceNo if provided
          if (data.invoiceNo) {
            const [duplicateCheck] = await db
              .select({ financeId: allFinance.financeId })
              .from(allFinance)
              .where(eq(allFinance.invoiceNo, data.invoiceNo))
              .limit(1);

            if (duplicateCheck) {
              throw new Error(`Invoice number "${data.invoiceNo}" already exists. Please use a different invoice number.`);
            }
          }

          const newPaymentDateParsed = parseFrontendDate(data.paymentDate);
          if (!newPaymentDateParsed) {
            throw new Error("paymentDate is required for all finance");
          }
          const anotherAmount =
            data.anotherPaymentAmount !== undefined && data.anotherPaymentAmount !== null && data.anotherPaymentAmount !== ""
              ? (typeof data.anotherPaymentAmount === "string" ? parseFloat(data.anotherPaymentAmount) : data.anotherPaymentAmount)
              : null;
          const anotherDate = data.anotherPaymentDate ? parseFrontendDate(data.anotherPaymentDate) ?? null : null;

          const [newAllFinance] = await db
            .insert(allFinance)
            .values({
              amount: amountValue.toString(),
              paymentDate: newPaymentDateParsed,
              invoiceNo: data.invoiceNo && data.invoiceNo.trim() !== "" ? data.invoiceNo.trim() : null,
              partialPayment: data.partialPayment ?? false,
              approvalStatus: approvalStatus as "pending" | "approved" | "rejected",
              approvedBy: data.approvedBy && approvalStatus === "approved" ? data.approvedBy : null,
              remarks: data.remarks && data.remarks.trim() !== "" ? data.remarks.trim() : null,
              anotherPaymentAmount: anotherAmount != null && isFinite(anotherAmount) ? anotherAmount.toString() : null,
              anotherPaymentDate: anotherDate,
            })
            .returning();

          await db
            .update(clientProductPayments)
            .set({
              entityId: newAllFinance.financeId,
              entityType: "allFinance_id" as any
            })
            .where(eq(clientProductPayments.productPaymentId, productPaymentId));

          existing.entityId = newAllFinance.financeId;
          existing.entityType = "allFinance_id";
        } else {
          // Update existing all finance record
          const [existingAllFinance] = await db
            .select()
            .from(allFinance)
            .where(eq(allFinance.financeId, existing.entityId))
            .limit(1);

          if (!existingAllFinance) {
            throw new Error("All finance record not found");
          }

          // Prepare update data
          const updateData: any = {};

          // Only allow status changes through approval endpoint, not through regular update
          // Regular updates can only change other fields, not approval status
          if (data.amount !== undefined) {
            const amountValue = typeof data.amount === "string" ? parseFloat(data.amount) : data.amount;
            if (!isFinite(amountValue) || amountValue <= 0) {
              throw new Error("Invalid amount for all finance");
            }
            updateData.amount = amountValue.toString();
          }

          if (data.paymentDate !== undefined) {
            const parsed = parseFrontendDate(data.paymentDate);
            if (parsed) updateData.paymentDate = parsed;
          }

          if (data.invoiceNo !== undefined) {
            const normalizedInvoiceNo = data.invoiceNo && data.invoiceNo.trim() !== "" ? data.invoiceNo.trim() : null;

            // Check for duplicate invoiceNo if changing
            if (normalizedInvoiceNo && normalizedInvoiceNo !== existingAllFinance.invoiceNo) {
              const [duplicateCheck] = await db
                .select({ financeId: allFinance.financeId })
                .from(allFinance)
                .where(eq(allFinance.invoiceNo, normalizedInvoiceNo))
                .limit(1);

              if (duplicateCheck) {
                throw new Error(`Invoice number "${normalizedInvoiceNo}" already exists. Please use a different invoice number.`);
              }
            }
            updateData.invoiceNo = normalizedInvoiceNo;
          }

          if (data.partialPayment !== undefined) {
            updateData.partialPayment = data.partialPayment;
          }

          if (data.remarks !== undefined) {
            updateData.remarks = data.remarks && data.remarks.trim() !== "" ? data.remarks.trim() : null;
          }

          if (data.anotherPaymentAmount !== undefined) {
            const anotherAmount =
              data.anotherPaymentAmount !== null && data.anotherPaymentAmount !== ""
                ? (typeof data.anotherPaymentAmount === "string" ? parseFloat(data.anotherPaymentAmount) : data.anotherPaymentAmount)
                : null;
            updateData.anotherPaymentAmount = anotherAmount != null && isFinite(anotherAmount) ? anotherAmount.toString() : null;
          }
          if (data.anotherPaymentDate !== undefined) {
            updateData.anotherPaymentDate = data.anotherPaymentDate ? parseFrontendDate(data.anotherPaymentDate) ?? null : null;
          }

          // If the payment was previously rejected, editing it resubmits it for approval (reset to pending)
          if (existingAllFinance.approvalStatus === "rejected") {
            updateData.approvalStatus = "pending";
            updateData.approvedBy = null;
          }

          await db
            .update(allFinance)
            .set(updateData)
            .where(eq(allFinance.financeId, existing.entityId));
        }
        // Skip to end - allFinance is fully handled above
      } else if (entityType === "visaextension_id") {
        const data = cleanEntityData as VisaExtensionData;

        // If entityId doesn't exist, create a new visa extension record
        if (!existing.entityId) {
          // Create new visa extension record
          if (!data.type) {
            throw new Error("type is required for visa extension");
          }
          const finalExtensionDate = parseFrontendDate(data.extensionDate) || new Date().toISOString().split("T")[0];
          if (!data.amount) {
            throw new Error("amount is required for visa extension");
          }

          // Normalize invoiceNo - convert empty string to null
          const normalizedInvoiceNo = data.invoiceNo && data.invoiceNo.trim() !== ""
            ? data.invoiceNo.trim()
            : null;

          // Check for duplicate invoiceNo if provided
          if (normalizedInvoiceNo) {
            const [duplicateCheck] = await db
              .select({ id: visaExtension.id })
              .from(visaExtension)
              .where(eq(visaExtension.invoiceNo, normalizedInvoiceNo))
              .limit(1);

            if (duplicateCheck) {
              throw new Error(`Invoice number "${normalizedInvoiceNo}" already exists in visa extension. Please use a different invoice number.`);
            }
          }

          const [newVisaExtension] = await db
            .insert(visaExtension)
            .values({
              type: data.type,
              amount: data.amount.toString(),
              extensionDate: finalExtensionDate,
              invoiceNo: normalizedInvoiceNo,
              remarks: data.remarks && data.remarks.trim() !== "" ? data.remarks.trim() : null,
            })
            .returning();

          // Update the client_product_payment record with the new entityId and entityType
          await db
            .update(clientProductPayments)
            .set({
              entityId: newVisaExtension.id,
              entityType: "visaextension_id" as any
            })
            .where(eq(clientProductPayments.productPaymentId, productPaymentId));

          // Update the existing object so entityId and entityType are available for later use
          existing.entityId = newVisaExtension.id;
          existing.entityType = "visaextension_id";
        } else {
          // Update existing visa extension record
          const [existingVisaExtension] = await db
            .select()
            .from(visaExtension)
            .where(eq(visaExtension.id, existing.entityId))
            .limit(1);

          if (!existingVisaExtension) {
            throw new Error("Visa extension record not found");
          }

          // Prepare transformed data
          const transformedData: any = {};

          // Type is required - use provided or existing
          if (data.type !== undefined) {
            transformedData.type = data.type;
          } else if (existingVisaExtension.type) {
            transformedData.type = existingVisaExtension.type;
          } else {
            throw new Error("type is required for visa extension");
          }

          // Convert amount to string if provided
          if (data.amount !== undefined) {
            transformedData.amount = data.amount.toString();
          } else if (existingVisaExtension.amount) {
            transformedData.amount = existingVisaExtension.amount.toString();
          }

          // Handle extensionDate - use provided (DD-MM-YYYY), existing, or default
          if (data.extensionDate !== undefined) {
            transformedData.extensionDate = parseFrontendDate(data.extensionDate) ?? existingVisaExtension.extensionDate ?? new Date().toISOString().split("T")[0];
          } else if (existingVisaExtension.extensionDate) {
            transformedData.extensionDate = existingVisaExtension.extensionDate;
          } else {
            transformedData.extensionDate = new Date().toISOString().split("T")[0];
          }

          // Handle optional fields - normalize empty strings to null
          if (data.invoiceNo !== undefined) {
            transformedData.invoiceNo = data.invoiceNo && data.invoiceNo.trim() !== "" ? data.invoiceNo.trim() : null;
          }
          if (data.remarks !== undefined) {
            transformedData.remarks = data.remarks && data.remarks.trim() !== "" ? data.remarks.trim() : null;
          }

          await db
            .update(visaExtension)
            .set(transformedData)
            .where(eq(visaExtension.id, existing.entityId));
        }
        // Skip to end - visaExtension is fully handled above
      } else {
        // For other entity types, handle update or create
        if (!existing.entityId) {
          // Entity doesn't exist, create a new one
          const newEntityId = await createEntityRecord(entityType, cleanEntityData);

          // Update the client_product_payment record with the new entityId and entityType
          await db
            .update(clientProductPayments)
            .set({
              entityId: newEntityId,
              entityType: entityType as any
            })
            .where(eq(clientProductPayments.productPaymentId, productPaymentId));

          // Update the existing object so entityId and entityType are available for later use
          existing.entityId = newEntityId;
          existing.entityType = entityType;
        } else {
          // Entity exists, update it
          await db
            .update(table)
            .set(cleanEntityData)
            .where(eq(table.id, existing.entityId));
        }
      }
    }

    // Normalize invoiceNo for master_only products (convert empty string to null)
    let normalizedInvoiceNo: string | null = null;
    if (entityType === "master_only") {
      if (invoiceNo !== undefined && invoiceNo !== null) {
        const trimmed = String(invoiceNo).trim();
        normalizedInvoiceNo = trimmed.length > 0 ? trimmed : null;
      } else {
        normalizedInvoiceNo = existing.invoiceNo;
      }
    }

    // Check for duplicate invoiceNo if changing (for master_only products)
    if (entityType === "master_only" && normalizedInvoiceNo !== null && normalizedInvoiceNo !== existing.invoiceNo) {
      const duplicateCheck = await db
        .select({ productPaymentId: clientProductPayments.productPaymentId })
        .from(clientProductPayments)
        .where(eq(clientProductPayments.invoiceNo, normalizedInvoiceNo))
        .limit(1);

      if (duplicateCheck.length > 0) {
        throw new Error(`Invoice number "${normalizedInvoiceNo}" already exists in product payments. Please use a different invoice number.`);
      }
    }

    const [updated] = await db
      .update(clientProductPayments)
      .set({
        // For entity-based products: data is stored in entity table, so set to NULL here
        // For master_only products: data is stored in this table
        amount:
          entityType === "master_only"
            ? amountValue!.toString()
            : null,
        paymentDate:
          entityType === "master_only"
            ? parseFrontendDate(paymentDate) ?? existing.paymentDate
            : null,
        invoiceNo:
          entityType === "master_only"
            ? normalizedInvoiceNo
            : null,
        remarks:
          entityType === "master_only"
            ? (remarks !== undefined
                ? (remarks !== null && String(remarks).trim() !== "" ? String(remarks).trim() : null)
                : existing.remarks)
            : null,
      })
      .where(eq(clientProductPayments.productPaymentId, productPaymentId))
      .returning();

    return { action: "UPDATED", record: updated };
  }

  // ---------------------------
  // CREATE
  // ---------------------------
  let entityId: number | null = null;

  if (entityType !== "master_only") {
    if (!entityData) {
      throw new Error("entityData required");
    }

    entityId = await createEntityRecord(entityType, entityData);
  }

  // Normalize invoiceNo for master_only products
  let normalizedInvoiceNo: string | null = null;
  if (entityType === "master_only" && invoiceNo !== undefined && invoiceNo !== null) {
    const trimmed = String(invoiceNo).trim();
    normalizedInvoiceNo = trimmed.length > 0 ? trimmed : null;
  }

  // Check for duplicate invoiceNo if provided (for master_only products)
  if (entityType === "master_only" && normalizedInvoiceNo !== null) {
    const duplicateCheck = await db
      .select({ productPaymentId: clientProductPayments.productPaymentId })
      .from(clientProductPayments)
      .where(eq(clientProductPayments.invoiceNo, normalizedInvoiceNo))
      .limit(1);

    if (duplicateCheck.length > 0) {
      throw new Error(`Invoice number "${normalizedInvoiceNo}" already exists in product payments. Please use a different invoice number.`);
    }
  }

  const [record] = await db
    .insert(clientProductPayments)
    .values({
      clientId,
      productName: productName as any,
      entityType: entityType as any,
      entityId,
      // For entity-based products: data is stored in entity table, so set to NULL here
      // For master_only products: data is stored in this table
      amount:
        entityType === "master_only"
          ? amountValue!.toString()
          : null,
      paymentDate:
        entityType === "master_only"
          ? parseFrontendDate(paymentDate) ?? null
          : null,
      invoiceNo:
        entityType === "master_only"
          ? normalizedInvoiceNo
          : null,
      remarks:
        entityType === "master_only"
          ? (remarks !== undefined && remarks !== null && String(remarks).trim() !== "" ? String(remarks).trim() : null)
          : null,
    })
    .returning();

  return { action: "CREATED", record };
};


export const getProductPaymentsByClientId = async (clientId: number) => {

  // Order by payment date first (so "today" filter shows by date), then createdAt for null dates
  const payments = await db
    .select()
    .from(clientProductPayments)
    .where(eq(clientProductPayments.clientId, clientId))
    .orderBy(desc(clientProductPayments.paymentDate), desc(clientProductPayments.createdAt));

  if (payments.length === 0) return [];

  // Group payments by entity type to fetch data efficiently
  const entityGroups = payments.reduce((groups, payment) => {
    if (payment.entityId && payment.entityType !== "master_only") {
      if (!groups[payment.entityType]) {
        groups[payment.entityType] = [];
      }
      groups[payment.entityType].push(payment.entityId);
    }
    return groups;
  }, {} as Record<string, number[]>);

  // Fetch entity data for each type
  const entityMaps: Record<string, Map<number, any>> = {};

  // ---- SIM CARD ----
  if (entityGroups.simCard_id) {
    entityMaps.simCard_id = await fetchEntities(simCard, entityGroups.simCard_id, "simCard_id");
  }

  // ---- AIR TICKET ----
  if (entityGroups.airTicket_id) {
    entityMaps.airTicket_id = await fetchEntities(airTicket, entityGroups.airTicket_id, "airTicket_id");
  }

  // ---- IELTS ----
  if (entityGroups.ielts_id) {
    entityMaps.ielts_id = await fetchEntities(ielts, entityGroups.ielts_id, "ielts_id");
  }

  // ---- LOAN ----
  if (entityGroups.loan_id) {
    entityMaps.loan_id = await fetchEntities(loan, entityGroups.loan_id, "loan_id");
  }

  // ---- FOREX CARD ----
  if (entityGroups.forexCard_id) {
    entityMaps.forexCard_id = await fetchEntities(forexCard, entityGroups.forexCard_id, "forexCard_id");
  }

  // ---- FOREX FEES ----
  if (entityGroups.forexFees_id) {
    entityMaps.forexFees_id = await fetchEntities(forexFees, entityGroups.forexFees_id, "forexFees_id");
  }

  // ---- TUITION FEES ----
  if (entityGroups.tutionFees_id) {
    entityMaps.tutionFees_id = await fetchEntities(tutionFees, entityGroups.tutionFees_id, "tutionFees_id");
  }

  // ---- INSURANCE ----
  if (entityGroups.insurance_id) {
    entityMaps.insurance_id = await fetchEntities(insurance, entityGroups.insurance_id, "insurance_id");
  }

  // ---- BEACON ACCOUNT ----
  if (entityGroups.beaconAccount_id) {
    entityMaps.beaconAccount_id = await fetchEntities(beaconAccount, entityGroups.beaconAccount_id, "beaconAccount_id");
  }

  // ---- CREDIT CARD ----
  if (entityGroups.creditCard_id) {
    entityMaps.creditCard_id = await fetchEntities(creditCard, entityGroups.creditCard_id, "creditCard_id");
  }

  // ---- ALL FINANCE ----
  if (entityGroups.allFinance_id) {
    entityMaps.allFinance_id = await fetchEntities(allFinance, entityGroups.allFinance_id, "allFinance_id");
  }

  // ---- NEW SELL ----
  if (entityGroups.newSell_id) {
    entityMaps.newSell_id = await fetchEntities(newSell, entityGroups.newSell_id, "newSell_id");
  }

  // ---- VISA EXTENSION ----
  if (entityGroups.visaextension_id) {
    entityMaps.visaextension_id = await fetchEntities(visaExtension, entityGroups.visaextension_id, "visaextension_id");
  }

  // ---- FETCH APPROVER DATA FOR ALL FINANCE ----
  // Get approver user data for allFinance entities that have approvedBy
  const approverMap = new Map<number, any>();
  if (entityMaps.allFinance_id && entityMaps.allFinance_id.size > 0) {
    const allFinanceEntities = Array.from(entityMaps.allFinance_id.values());
    const approverIds: number[] = allFinanceEntities
      .map((f: any) => f.approvedBy)
      .filter((id): id is number => typeof id === "number" && !isNaN(id));
    const uniqueApproverIds = [...new Set(approverIds)];

    if (uniqueApproverIds.length > 0) {
      const approvers = await db
        .select({
          id: users.id,
          fullName: users.fullName,
          designation: users.designation,
          role: users.role,
        })
        .from(users)
        .where(inArray(users.id, uniqueApproverIds));

      approvers.forEach(approver => {
        approverMap.set(approver.id, {
          id: approver.id,
          name: approver.fullName,
          designation: approver.designation,
          role: approver.role,
        });
      });
    }
  }

  // ---- MERGE ----
  return payments.map(p => {
    if (p.entityType === "master_only") {
      return {
        ...p,
        entity: null, // master_only products don't have entity data
      };
    }

    if (p.entityId) {
      // Ensure entity map exists (initialize if missing)
      if (!entityMaps[p.entityType]) {
        entityMaps[p.entityType] = new Map();
      }

      // Ensure both key and lookup use Number for type consistency
      const entityIdNum = Number(p.entityId);
      const entityIdStr = String(p.entityId);

      // Try both number and string lookups
      let entity = entityMaps[p.entityType].get(entityIdNum);
      if (!entity && entityMaps[p.entityType].has(Number(entityIdStr))) {
        entity = entityMaps[p.entityType].get(Number(entityIdStr));
      }

      // For allFinance entities, add approver data if approvedBy exists
      if (p.entityType === "allFinance_id" && entity && entity.approvedBy) {
        const approver = approverMap.get(entity.approvedBy);
        entity = {
          ...entity,
          approver: approver || null,
        };
      }

      const result = {
        ...p,
        entity: entity || null,
      };

      return result;
    }

    return {
      ...p,
      entity: null,
    };
  });
};

/* ================================
   GET PENDING ALL FINANCE APPROVALS
================================ */

export const getPendingAllFinanceApprovals = async () => {
  // Get all pending finance payments
  const pendingFinance = await db
    .select({
      financeId: allFinance.financeId,
      amount: allFinance.amount,
      paymentDate: allFinance.paymentDate,
      invoiceNo: allFinance.invoiceNo,
      partialPayment: allFinance.partialPayment,
      approvalStatus: allFinance.approvalStatus,
      approvedBy: allFinance.approvedBy,
      remarks: allFinance.remarks,
      anotherPaymentAmount: allFinance.anotherPaymentAmount,
      anotherPaymentDate: allFinance.anotherPaymentDate,
      createdAt: allFinance.createdAt,
    })
    .from(allFinance)
    .where(eq(allFinance.approvalStatus, "pending"))
    .orderBy(allFinance.createdAt);

  if (pendingFinance.length === 0) {
    return [];
  }

  const financeIds = pendingFinance.map(f => f.financeId);

  // Get product payments for these finance records
  const productPayments = await db
    .select({
      productPaymentId: clientProductPayments.productPaymentId,
      clientId: clientProductPayments.clientId,
      entityId: clientProductPayments.entityId,
    })
    .from(clientProductPayments)
    .where(
      and(
        eq(clientProductPayments.productName, "ALL_FINANCE_EMPLOYEMENT"),
        inArray(clientProductPayments.entityId, financeIds)
      )
    );

  const financeToPaymentMap = new Map(
    productPayments.map(p => [p.entityId, p])
  );

  // Get client info
  const clientIds = [...new Set(productPayments.map(p => p.clientId))];
  const clients = clientIds.length > 0
    ? await db
        .select({
          clientId: clientInformation.clientId,
          fullName: clientInformation.fullName,
          counsellorId: clientInformation.counsellorId,
        })
        .from(clientInformation)
        .where(inArray(clientInformation.clientId, clientIds))
    : [];

  const clientMap = new Map(clients.map(c => [c.clientId, c]));

  // Get counsellor info
  const counsellorIds = [...new Set(clients.map(c => c.counsellorId).filter(Boolean))];
  const counsellors = counsellorIds.length > 0
    ? await db
        .select({
          id: users.id,
          fullName: users.fullName,
          managerId: users.managerId,
        })
        .from(users)
        .where(inArray(users.id, counsellorIds))
    : [];

  const counsellorMap = new Map(counsellors.map(c => [c.id, c]));

  // Get approver info (for non-pending records, though this function only returns pending)
  // This is for future use if we want to show all records
  // Filter out null/undefined values and ensure we have valid numbers
  const approverIds: number[] = pendingFinance
    .map(f => f.approvedBy)
    .filter((id): id is number => typeof id === "number" && !isNaN(id));
  const uniqueApproverIds = [...new Set(approverIds)];

  const approvers = uniqueApproverIds.length > 0
    ? await db
        .select({
          id: users.id,
          fullName: users.fullName,
          designation: users.designation,
          role: users.role,
        })
        .from(users)
        .where(inArray(users.id, uniqueApproverIds))
    : [];

  const approverMap = new Map(approvers.map(a => [a.id, a]));

  // Combine data
  return pendingFinance.map(finance => {
    const productPayment = financeToPaymentMap.get(finance.financeId);
    const clientId = productPayment?.clientId;
    const client = clientId ? clientMap.get(clientId) : null;
    const counsellor = client?.counsellorId ? counsellorMap.get(client.counsellorId) : null;
    const approver = finance.approvedBy ? approverMap.get(finance.approvedBy) : null;

    return {
      ...finance,
      productPaymentId: productPayment?.productPaymentId,
      client: client ? {
        clientId: client.clientId,
        fullName: client.fullName,
      } : null,
      counsellor: counsellor ? {
        id: counsellor.id,
        fullName: counsellor.fullName,
        managerId: counsellor.managerId,
      } : null,
      approver: approver ? {
        id: approver.id,
        name: approver.fullName,
        designation: approver.designation,
        role: approver.role,
      } : null,
    };
  });
};

/* ================================
   APPROVE ALL FINANCE PAYMENT
================================ */

export const approveAllFinancePayment = async (
  financeId: number,
  approvedBy: number
) => {
  // Check if finance record exists and is pending
  const [finance] = await db
    .select()
    .from(allFinance)
    .where(eq(allFinance.financeId, financeId))
    .limit(1);

  if (!finance) {
    throw new Error(`Finance payment not found with financeId: ${financeId}`);
  }

  if (finance.approvalStatus !== "pending") {
    throw new Error(`Payment is already ${finance.approvalStatus}`);
  }

  // Update approval status
  // Note: allFinance.financeId maps to database column "id"
  const [updated] = await db
    .update(allFinance)
    .set({
      approvalStatus: "approved",
      approvedBy: approvedBy,
    })
    .where(eq(allFinance.financeId, financeId))
    .returning();

  if (!updated) {
    throw new Error(`Failed to update finance payment with financeId: ${financeId}. Update returned no rows.`);
  }

  // Get approver user data
  const [approver] = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      designation: users.designation,
      role: users.role,
    })
    .from(users)
    .where(eq(users.id, approvedBy))
    .limit(1);

  console.log(`✅ Approved all finance payment ${financeId} by user ${approvedBy}`);

  return {
    ...updated,
    approver: approver ? {
      id: approver.id,
      name: approver.fullName,
      designation: approver.designation,
      role: approver.role,
    } : null,
  };
};

/* ================================
   REJECT ALL FINANCE PAYMENT
================================ */

export const rejectAllFinancePayment = async (
  financeId: number,
  approvedBy: number
) => {
  // Check if finance record exists and is pending
  const [finance] = await db
    .select()
    .from(allFinance)
    .where(eq(allFinance.financeId, financeId))
    .limit(1);

  if (!finance) {
    throw new Error(`Finance payment not found with financeId: ${financeId}`);
  }

  if (finance.approvalStatus !== "pending") {
    throw new Error(`Payment is already ${finance.approvalStatus}`);
  }

  // Update approval status
  // Note: allFinance.financeId maps to database column "id"
  const [updated] = await db
    .update(allFinance)
    .set({
      approvalStatus: "rejected",
      approvedBy: approvedBy,
    })
    .where(eq(allFinance.financeId, financeId))
    .returning();

  if (!updated) {
    throw new Error(`Failed to update finance payment with financeId: ${financeId}. Update returned no rows.`);
  }

  // Get approver user data
  const [approver] = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      designation: users.designation,
      role: users.role,
    })
    .from(users)
    .where(eq(users.id, approvedBy))
    .limit(1);

  console.log(`✅ Rejected all finance payment ${financeId} by user ${approvedBy}`);

  return {
    ...updated,
    approver: approver ? {
      id: approver.id,
      name: approver.fullName,
      designation: approver.designation,
      role: approver.role,
    } : null,
  };
};


/**
 * Delete a client product payment by id. Also deletes the linked entity row
 * (e.g. ielts, visaExtension, allFinance) when entityId is present.
 */
export const deleteClientProductPayment = async (
  productPaymentId: number
): Promise<typeof clientProductPayments.$inferSelect | null> => {
  return await db.transaction(async (tx) => {
    // 1. Get record first (need entityType + entityId to delete entity row)
    const [payment] = await tx
      .select({
        productPaymentId: clientProductPayments.productPaymentId,
        entityType: clientProductPayments.entityType,
        entityId: clientProductPayments.entityId,
      })
      .from(clientProductPayments)
      .where(eq(clientProductPayments.productPaymentId, productPaymentId))
      .limit(1);

    if (!payment) {
      return null;
    }

    const { entityType, entityId } = payment;

    // 2. Delete main record
    const deleted = await tx
      .delete(clientProductPayments)
      .where(eq(clientProductPayments.productPaymentId, productPaymentId))
      .returning();

    if (!deleted.length) {
      return null;
    }

    // 3. Delete referenced entity row if present (ielts, visaExtension, allFinance, etc.)
    if (
      entityId != null &&
      entityType &&
      entityType !== "master_only"
    ) {
      const table = entityTypeToTable[entityType as EntityType];
      if (table) {
        const idField = entityType === "allFinance_id" ? table.financeId : table.id;
        await tx.delete(table).where(eq(idField, entityId));
      }
    }

    return deleted[0];
  });
};
