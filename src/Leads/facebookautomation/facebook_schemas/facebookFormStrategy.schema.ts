import {
  bigint,
  bigserial,
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "../../../schemas/users.schema";

export const facebookFormStrategy = pgTable("facebook_form_strategy", {
  id: bigserial("id", { mode: "number" }).primaryKey(),

  formId: varchar("form_id", { length: 100 }).notNull().unique(),
  formName: text("form_name"),
  pageId: varchar("page_id", { length: 100 }),
  pageName: text("page_name"),
  isMasterManaged: boolean("is_master_managed").default(false).notNull(),
  /** Sale type (lead type) for imported leads — required when activating or distributing. */
  leadTypeId: bigint("lead_type_id", { mode: "number" }),
  /** Groups forms under one master distribution (typically the sale type id as string). */
  masterDistributionGroup: varchar("master_distribution_group", { length: 100 }),

  strategy: varchar("strategy", { length: 50 }),

  assignedTelecallers: jsonb("assigned_telecallers")
    .$type<number[]>()
    .default([])
    .notNull(),

  assignedCounsellors: jsonb("assigned_counsellors")
    .$type<number[]>()
    .default([])
    .notNull(),

  priorityWeights: jsonb("priority_weights")
    .$type<Record<string, number>>()
    .default({})
    .notNull(),

  isActive: boolean("is_active").default(false).notNull(),
  isArchived: boolean("is_archived").default(false).notNull(),

  roundRobinIndex: integer("round_robin_index").default(0).notNull(),
  lastLeadCreatedTime: timestamp("last_lead_created_time"),

  createdBy: bigint("created_by", { mode: "number" }).references(() => users.id),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
