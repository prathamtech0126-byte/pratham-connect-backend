import {
  pgEnum,
  pgTable,
  bigserial,
  bigint,
  varchar,
  timestamp,
  index,
  boolean,
} from "drizzle-orm/pg-core";
import { users } from "./users.schema";

export const deviceInventoryTypeEnum = pgEnum("device_inventory_device_type_enum", [
  "laptop",
  "mobile",
  "desktop",
  "display",
  "mouse",
  "keyboard",
  "network-wifi",
  "printer",
  "scanner",
  "monitor",
  "webcam",
  "headset",
  "other",
]);

export const deviceInventory = pgTable(
  "device_inventory",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    deviceType: deviceInventoryTypeEnum("device_type").notNull(),
    deviceName: varchar("device_name", { length: 180 }),
    prathamProductCode: varchar("pratham_product_code", { length: 120 }),
    product: varchar("product", { length: 180 }),
    accessories: varchar("accessories", { length: 300 }),
    hardwareDetail: varchar("hardware_detail", { length: 300 }),
    serialNumber: varchar("serial_number", { length: 120 }),
    vendorName: varchar("vendor_name", { length: 160 }),
    invoice: varchar("invoice", { length: 120 }),
    invoiceDate: varchar("invoice_date", { length: 40 }),
    price: varchar("price", { length: 60 }),
    productNumber: varchar("product_number", { length: 120 }),
    companyType: varchar("company_type", { length: 120 }),

    currentUserId: bigint("current_user_id", { mode: "number" }).references(() => users.id),
    pastUser1Id: bigint("past_user_1_id", { mode: "number" }).references(() => users.id),
    pastUser2Id: bigint("past_user_2_id", { mode: "number" }).references(() => users.id),
    pastUser3Id: bigint("past_user_3_id", { mode: "number" }).references(() => users.id),
    pastUser4Id: bigint("past_user_4_id", { mode: "number" }).references(() => users.id),
    onRepair: boolean("on_repair").default(false).notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    deviceTypeIdx: index("idx_device_inventory_device_type").on(table.deviceType),
    currentUserIdx: index("idx_device_inventory_current_user").on(table.currentUserId),
    updatedAtIdx: index("idx_device_inventory_updated_at").on(table.updatedAt),
  })
);

export const deviceInventoryAssignments = pgTable(
  "device_inventory_assignments",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    deviceId: bigint("device_id", { mode: "number" })
      .references(() => deviceInventory.id, { onDelete: "cascade" })
      .notNull(),
    userId: bigint("user_id", { mode: "number" })
      .references(() => users.id)
      .notNull(),
    assignedByUserId: bigint("assigned_by_user_id", { mode: "number" }).references(() => users.id),
    assignmentAccessories: varchar("assignment_accessories", { length: 300 }),

    assignedAt: timestamp("assigned_at").defaultNow().notNull(),
    unassignedAt: timestamp("unassigned_at"),

    isActive: boolean("is_active").default(true).notNull(),
  },
  (table) => ({
    deviceActiveIdx: index("idx_device_inventory_assignments_device_active").on(
      table.deviceId,
      table.isActive
    ),
    userActiveIdx: index("idx_device_inventory_assignments_user_active").on(table.userId, table.isActive),
  })
);

