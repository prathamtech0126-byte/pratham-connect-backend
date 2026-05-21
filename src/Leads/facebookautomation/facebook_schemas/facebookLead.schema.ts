import {
  AnyPgColumn,
  bigserial,
  bigint,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { leads } from "../../schemas/leads.schema";

/** Facebook/Instagram-specific lead metadata (1:1 with leads for Meta sources). */
export const facebookLead = pgTable(
  "facebook_lead",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    leadId: bigint("lead_id", { mode: "number" })
      .notNull()
      .references((): AnyPgColumn => leads.id, { onDelete: "cascade" }),

    campaignId: varchar("campaign_id", { length: 100 }),
    campaignName: text("campaign_name"),
    adsetId: varchar("adset_id", { length: 100 }),
    adsetName: text("adset_name"),
    adId: varchar("ad_id", { length: 100 }),
    adName: text("ad_name"),
    formId: varchar("form_id", { length: 100 }),
    formName: text("form_name"),

    facebookCreatedAt: timestamp("facebook_created_at"),

    customAnswers: jsonb("custom_answers")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    leadIdUnique: uniqueIndex("idx_facebook_lead_lead_id").on(table.leadId),
    formIdIdx: index("idx_facebook_lead_form_id").on(table.formId),
    facebookCreatedAtIdx: index("idx_facebook_lead_facebook_created_at").on(
      table.facebookCreatedAt
    ),
    customAnswersGinIdx: index("idx_facebook_lead_custom_answers_gin").using(
      "gin",
      table.customAnswers
    ),
  })
);
