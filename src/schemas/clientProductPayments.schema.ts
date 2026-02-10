import {
  pgTable,
  decimal,
  date,
  text,
  bigint,
  timestamp,
  bigserial,
  pgEnum,
  index,
  varchar,
} from "drizzle-orm/pg-core";
import { clientInformation } from "./clientInformation.schema";

// Product type enum - all available products
export const productTypeEnum = pgEnum("product_type_enum", [
  // SPOUSE products
  "ALL_FINANCE_EMPLOYEMENT",
  "INDIAN_SIDE_EMPLOYEMENT",
  "NOC_LEVEL_JOB_ARRANGEMENT",
  "LAWYER_REFUSAL_CHARGE",
  "ONSHORE_PART_TIME_EMPLOYEMENT",
  "TRV_WORK_PERMIT_EXT_STUDY_PERMIT_EXTENSION",
  "MARRIAGE_PHOTO_FOR_COURT_MARRIAGE",
  "MARRIAGE_PHOTO_CERTIFICATE",
  "RECENTE_MARRIAGE_RELATIONSHIP_AFFIDAVIT",
  "JUDICAL_REVIEW_CHARGE",
  "SIM_CARD_ACTIVATION",
  "INSURANCE",
  "BEACON_ACCOUNT",
  "AIR_TICKET",
  "OTHER_NEW_SELL",
  // VISITOR products
  "SPONSOR_CHARGES",
  // STUDENT products
  "FINANCE_EMPLOYEMENT",
  "IELTS_ENROLLMENT",
  "LOAN_DETAILS",
  "FOREX_CARD",
  "FOREX_FEES",
  "TUTION_FEES",
  "CREDIT_CARD",
  // Common products
  "VISA_EXTENSION",
  // Additional master-only products
  "REFUSAL_CHARGES",
  "KIDS_STUDY_PERMIT",
  "CANADA_FUND",
  "EMPLOYMENT_VERIFICATION_CHARGES",
  "ADDITIONAL_AMOUNT_STATEMENT_CHARGES",
]);

// Entity type enum - maps to database tables
export const entityTypeEnum = pgEnum("entity_type_enum", [
  "visaextension_id",
  "simCard_id",
  "airTicket_id",
  "newSell_id",
  "ielts_id",
  "loan_id",
  "forexCard_id",
  "forexFees_id",
  "tutionFees_id",
  "insurance_id",
  "beaconAccount_id",
  "creditCard_id",
  "allFinance_id",
  "master_only"
]);

export const clientProductPayments = pgTable(
  "client_product_payment",
  {
    productPaymentId: bigserial("id", { mode: "number" }).primaryKey(),

    clientId: bigint("client_id", { mode: "number" })
      .references(() => clientInformation.clientId, { onDelete: "cascade" })
      .notNull(),

    productName: productTypeEnum("product_name").notNull(),

    amount: decimal("amount", { precision: 12, scale: 2 }),

    paymentDate: date("date"),

    invoiceNo: varchar("invoice_no", { length: 50 }).unique(),

    entityId: bigint("entity_id", { mode: "number" }),

    entityType: entityTypeEnum("entity_type").notNull(),

    remarks: text("remark"),

    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    clientIdx: index("idx_product_payment_client").on(table.clientId),

    productNameIdx: index("idx_product_payment_product_name").on(
      table.productName
    ),

    paymentDateIdx: index("idx_product_payment_date").on(table.paymentDate),

    entityIdx: index("idx_product_payment_entity").on(
      table.entityType,
      table.entityId
    ),

    createdAtIdx: index("idx_product_payment_created_at").on(table.createdAt),

    clientProductIdx: index("idx_product_payment_client_product").on(
      table.clientId,
      table.productName
    ),

    clientCreatedIdx: index("idx_product_payment_client_created").on(
      table.clientId,
      table.createdAt
    ),
  })
);
