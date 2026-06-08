import {
  pgTable,
  varchar,
  text,
  timestamp,
  bigserial,
  bigint,
  index,
  pgEnum,
  date,
} from "drizzle-orm/pg-core";
import { clientInformation } from "./clientInformation.schema";
import { saleTypes } from "./saleType.schema";
import { users } from "./users.schema";

export const studentApplicationStatusEnum = pgEnum("student_application_status", [
  "app_submitted",
  "offer_received",
  "cas_received",
  "visa_submitted",
  "process_completed",
]);

export const studentApplications = pgTable(
  "student_application",
  {
    applicationId: bigserial("id", { mode: "number" }).primaryKey(),

    clientId: bigint("client_id", { mode: "number" })
      .references(() => clientInformation.clientId, { onDelete: "cascade" })
      .notNull(),

    saleTypeId: bigint("sale_type_id", { mode: "number" })
      .references(() => saleTypes.saleTypeId, { onDelete: "restrict" })
      .notNull(),

    counsellorId: bigint("counsellor_id", { mode: "number" })
      .references(() => users.id, { onDelete: "restrict" })
      .notNull(),

    universityName: varchar("university_name", { length: 255 }).notNull(),
    courseName: varchar("course_name", { length: 500 }),
    country: varchar("country", { length: 100 }),

    status: studentApplicationStatusEnum("status").notNull().default("app_submitted"),

    applicationDate: date("application_date"),
    note: text("note"),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => ({
    clientIdx: index("idx_student_application_client").on(table.clientId),
    counsellorIdx: index("idx_student_application_counsellor").on(table.counsellorId),
    statusIdx: index("idx_student_application_status").on(table.status),
    saleTypeIdx: index("idx_student_application_sale_type").on(table.saleTypeId),
    clientCreatedIdx: index("idx_student_application_client_created").on(
      table.clientId,
      table.createdAt,
    ),
  }),
);
