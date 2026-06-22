import { bigint, bigserial, date, decimal, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { allFinance, financeApprovalStatusEnum } from "../../schemas/allFinance.schema";
import { users } from "../../schemas/users.schema";

export const financePayments = pgTable(
    "finance_payments",
    {
      paymentId: bigserial("id", { mode: "number" }).primaryKey(),
  
      financeId: bigint("finance_id", { mode: "number" })
        .references(() => allFinance.financeId, {
          onDelete: "cascade",
        })
        .notNull(),
  
      amount: decimal("amount", {
        precision: 12,
        scale: 2,
      }).notNull(),
  
      paymentDate: date("payment_date"),
  
      paidBy: bigint("paid_by", {
        mode: "number",
      }).references(() => users.id),
  
      approvalStatus: financeApprovalStatusEnum(
        "approval_status"
      ).default("pending"),
  
      approvedBy: bigint("approved_by", {
        mode: "number",
      }).references(() => users.id),
  
      approvedAt: timestamp("approved_at"),
  
      remarks: text("remarks"),
  
      createdAt: timestamp("created_at").defaultNow(),
    }
  );

