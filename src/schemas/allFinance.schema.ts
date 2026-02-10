import {
  pgTable,
  decimal,
  varchar,
  date,
  text,
  timestamp,
  bigserial,
  bigint,
  index,
  boolean,
  pgEnum,
} from "drizzle-orm/pg-core";
import { users } from "./users.schema";

// Approval status enum
export const financeApprovalStatusEnum = pgEnum("finance_approval_status_enum", [
  "pending",
  "approved",
  "rejected",
]);

export const allFinance = pgTable(
  "all_finance",
  {
    financeId: bigserial("id", { mode: "number" }).primaryKey(),

    // Common fields
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),

    paymentDate: date("payment_date"),

    invoiceNo: varchar("invoice_no", { length: 50 }).unique(),

    partialPayment: boolean("partial_payment").default(false),

    // Approval status: pending, approved, rejected
    approvalStatus: financeApprovalStatusEnum("approval_status").default("pending"),

    // Approved by user manager who approved the payment (nullable for pending requests)
    approvedBy: bigint("approved_by", { mode: "number" })
      .references(() => users.id),

    // Remarks for the payment
    remarks: text("remarks"),

    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    paymentDateIdx: index("idx_finance_payment_date").on(table.paymentDate),
    approvalStatusIdx: index("idx_finance_approval_status").on(table.approvalStatus),
    createdAtIdx: index("idx_finance_created_at").on(table.createdAt),
  })
);
