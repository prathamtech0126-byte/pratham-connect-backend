import {
  pgTable,
  timestamp,
  bigserial,
  bigint,
  integer,
  decimal,
  date,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users.schema";

export const targetTypeEnum = ["Core Sale", "Core Product", "Other Product", "Revenue"] as const;
export type TargetType = (typeof targetTypeEnum)[number];

export const managerTargets = pgTable(
  "manager_targets",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    // Single manager: set; multiple managers: null (use manager_ids only).
    manager_id: bigint("manager_id", { mode: "number" })
      .references(() => users.id),

    // When multiple managers share one target: list of manager user IDs. Single manager = [manager_id].
    manager_ids: integer("manager_ids").array().notNull().default([]),

    // Every target is a date range (e.g. 2025-01-15 to 2025-02-20; or full month, quarter, year)
    start_date: date("start_date").notNull(),
    end_date: date("end_date").notNull(),

    // Core sale targets
    core_sale_target_clients: bigint("core_sale_target_clients", { mode: "number" })
      .notNull()
      .default(0),
    core_sale_target_revenue: decimal("core_sale_target_revenue", {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default("0"),

    // Core product targets
    core_product_target_clients: bigint("core_product_target_clients", {
      mode: "number",
    })
      .notNull()
      .default(0),
    core_product_target_revenue: decimal("core_product_target_revenue", {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default("0"),

    // Other product targets
    other_product_target_clients: bigint("other_product_target_clients", {
      mode: "number",
    })
      .notNull()
      .default(0),
    other_product_target_revenue: decimal("other_product_target_revenue", {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default("0"),

    // Overall target (e.g. company-wide or combined target for the period)
    overall: decimal("overall", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),

  },
  (table) => ({
    managerDateRangeIdx: index("idx_manager_targets_manager_dates").on(
      table.manager_id,
      table.start_date,
      table.end_date
    ),
    managerIdx: index("idx_manager_targets_manager").on(table.manager_id),
  })
);
