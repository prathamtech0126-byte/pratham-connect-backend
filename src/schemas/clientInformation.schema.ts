// clientInformation.schema.ts
// import {
//   pgTable,
//   serial,
//   varchar,
//   date,
//   timestamp,
//   bigserial,
//   bigint,
// } from "drizzle-orm/pg-core";
// import { users } from "./users.schema";
// import { saleTypes } from "./saleType.schema";

// export const clientInformation = pgTable("client_information", {
//   clientId: bigserial("id",{ mode: "number" }).primaryKey(),
//   counsellorId: bigint("counsellor_id", { mode: "number" })
//     .references(() => users.id)
//     .notNull(),
//   fullName: varchar("fullname", { length: 150 }).notNull(),
//   enrollmentDate: date("date").notNull(),
//   saleTypeId: serial("sale_type_id")
//     .references(() => saleTypes.saleTypeId)
//     .notNull(),
//   createdAt: timestamp("created_at").defaultNow(),
// });
import {
  pgTable,
  varchar,
  date,
  timestamp,
  bigserial,
  bigint,
  serial,
  index,
  boolean,
} from "drizzle-orm/pg-core";
import { users } from "./users.schema";
import { leadTypes } from "./leadType.schema";

export const clientInformation = pgTable(
  "client_information",
  {
    clientId: bigserial("id", { mode: "number" }).primaryKey(),

    counsellorId: bigint("counsellor_id", { mode: "number" })
      .references(() => users.id)
      .notNull(),

    fullName: varchar("fullname", { length: 150 }).notNull(),

    enrollmentDate: date("date").notNull(),

    passportDetails: varchar("passport_details", { length: 100 }).notNull().unique(),

    leadTypeId: serial("lead_type_id")
      .references(() => leadTypes.id)
      .notNull(),

    archived: boolean("archived").default(false),

    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    counsellorIdx: index("idx_client_counsellor").on(table.counsellorId),

    leadTypeIdx: index("idx_client_lead_type").on(table.leadTypeId),

    passportDetailsIdx: index("idx_client_passport_details").on(table.passportDetails),

    enrollmentDateIdx: index("idx_client_enrollment_date").on(
      table.enrollmentDate
    ),

    createdAtIdx: index("idx_client_created_at").on(table.createdAt),

    counsellorCreatedIdx: index("idx_client_counsellor_created").on(
      table.counsellorId,
      table.createdAt
    ),
  })
);
