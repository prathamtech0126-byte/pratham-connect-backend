// // clientPayments.schema.ts
// import {
//   pgTable,
//   decimal,
//   varchar,
//   date,
//   text,
//   timestamp,
//   bigserial,
//   bigint,
//   pgEnum
// } from "drizzle-orm/pg-core";
// import { clientInformation } from "./clientInformation.schema";


// export const stageEnum = pgEnum("stage_enum", [
//   "INITIAL",
//   "BEFORE_VISA",
//   "AFTER_VISA",
//   "SUBMITTED_VISA",
// ]);

// export const clientPayments = pgTable("client_payment", {
//   // paymentId: serial("id").primaryKey(),
//   paymentId: bigserial("id", { mode: "number" }).primaryKey(),

//   // clientId: integer("client_id")
//   //   .references(() => clientInformation.clientId, { onDelete: "cascade" })
//   //   .notNull(),

//     clientId: bigint("client_id", { mode: "number" })
//     .references(() => clientInformation.clientId, { onDelete: "cascade" })
//     .notNull(),

//   totalPayment: decimal("total_payment", { precision: 12, scale: 2 }).notNull(),

//   // stage: varchar("stage", { length: 20 })
//   //   .$type<"INITIAL" | "BEFORE_VISA" | "AFTER_VISA" | "SUBMITTED_VISA">()
//   //   .notNull(),

//   stage: stageEnum("stage").notNull(),

//   amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),

//   paymentDate: date("payment_date"),
//   invoiceNo: varchar("invoice_no", { length: 50 }),
//   remarks: text("remarks"),

//   createdAt: timestamp("created_at").defaultNow(),
// });
import {
  pgTable,
  decimal,
  varchar,
  date,
  text,
  timestamp,
  bigserial,
  bigint,
  serial,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { clientInformation } from "./clientInformation.schema";
import { saleTypes } from "./saleType.schema";

export const stageEnum = pgEnum("stage_enum", [
  "INITIAL",
  "BEFORE_VISA",
  "AFTER_VISA",
  "SUBMITTED_VISA",
]);

export const clientPayments = pgTable(
  "client_payment",
  {
    paymentId: bigserial("id", { mode: "number" }).primaryKey(),

    clientId: bigint("client_id", { mode: "number" })
      .references(() => clientInformation.clientId, { onDelete: "cascade" })
      .notNull(),

    saleTypeId: serial("sale_type_id")
      .references(() => saleTypes.saleTypeId)
      .notNull(),

    totalPayment: decimal("total_payment", {
      precision: 12,
      scale: 2,
    }).notNull(),

    stage: stageEnum("stage").notNull(),

    amount: decimal("amount", { precision: 12, scale: 2 }),

    paymentDate: date("payment_date").notNull(),

    invoiceNo: varchar("invoice_no", { length: 50 }).unique(),

    remarks: text("remarks"),

    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    clientIdx: index("idx_payment_client").on(table.clientId),

    saleTypeIdx: index("idx_payment_sale_type").on(table.saleTypeId),

    stageIdx: index("idx_payment_stage").on(table.stage),

    paymentDateIdx: index("idx_payment_date").on(table.paymentDate),

    createdAtIdx: index("idx_payment_created_at").on(table.createdAt),

    clientPaymentDateIdx: index("idx_payment_client_date").on(
      table.clientId,
      table.paymentDate
    ),
    clientStageIdx: index("idx_payment_client_stage").on(
      table.clientId,
      table.stage
    ),
    stagePaymentDateIdx: index("idx_payment_stage_date").on(
      table.stage,
      table.paymentDate
    ),
  })
);
