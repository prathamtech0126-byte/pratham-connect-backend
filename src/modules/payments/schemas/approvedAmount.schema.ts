import {
  bigint,
  date,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { amounts } from "./amount.schema";

/**
 * PENDING_APPROVAL — counsellor has submitted the amount for review.
 * APPROVED         — manager / team lead / admin has approved.
 * REJECTED         — reviewer declined; rejectionReason is set.
 */
export const approvalStatusEnum = pgEnum("approval_status_enum", [
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
]);

export const amountApproved = pgTable(
  "amount_approved",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    amountId: uuid("amount_id")
      .references(() => amounts.id)
      .notNull(),

    /** Amount the counsellor is requesting approval for */
    requestedAmount: numeric("requested_amount", {
      precision: 12,
      scale: 2,
    }).notNull(),

    /** Actual amount approved (may differ from requested on partial approval) */
    approvedAmount: numeric("approved_amount", {
      precision: 12,
      scale: 2,
    }),

    status: approvalStatusEnum("status").notNull().default("PENDING_APPROVAL"),

    /** Main CRM users.id — counsellor who raised the request (cross-DB, no FK) */
    requestedBy: bigint("requested_by", { mode: "number" }).notNull(),

    /** Manager / team lead / admin who approved (cross-DB, no FK) */
    approvedBy: bigint("approved_by", { mode: "number" }),

    approvedDate: date("approved_date"),

    /** Manager / team lead / admin who rejected (cross-DB, no FK) */
    rejectedBy: bigint("rejected_by", { mode: "number" }),

    rejectedDate: date("rejected_date"),

    rejectionReason: text("rejection_reason"),

    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    amountIdIdx:      index("idx_amount_approved_amount_id").on(table.amountId),
    statusIdx:        index("idx_amount_approved_status").on(table.status),
    requestedByIdx:   index("idx_amount_approved_requested_by").on(table.requestedBy),
    approvedByIdx:    index("idx_amount_approved_approved_by").on(table.approvedBy),
    rejectedByIdx:    index("idx_amount_approved_rejected_by").on(table.rejectedBy),
    createdAtIdx:     index("idx_amount_approved_created_at").on(table.createdAt),
  })
);
