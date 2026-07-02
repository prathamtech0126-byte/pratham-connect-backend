import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { stagePipelines } from "./stagePipeline.schema";

export type StageDefinitionMetadata = {
  allowedRoles?: string[];
  flexEntry?: boolean;
  isTerminal?: boolean;
  [key: string]: unknown;
};

/**
 * Admin-managed stage rows within a pipeline.
 * Macro stages have parentId = null; visa sub-statuses reference their macro stage.
 */
export const stageDefinitions = pgTable(
  "stage_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pipelineId: uuid("pipeline_id")
      .references(() => stagePipelines.id, { onDelete: "cascade" })
      .notNull(),
    parentId: uuid("parent_id"),
    code: varchar("code", { length: 128 }).notNull(),
    label: varchar("label", { length: 255 }).notNull(),
    description: text("description"),
    kind: varchar("kind", { length: 32 }).notNull().default("macro"),
    team: varchar("team", { length: 32 }),
    sortOrder: integer("sort_order").default(0).notNull(),
    metadata: jsonb("metadata")
      .$type<StageDefinitionMetadata>()
      .default({})
      .notNull(),
    isSystem: boolean("is_system").default(false).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    pipelineCodeUniq: uniqueIndex("uniq_stage_definitions_pipeline_code").on(
      table.pipelineId,
      table.code
    ),
    pipelineIdx: index("idx_stage_definitions_pipeline_id").on(table.pipelineId),
    parentIdx: index("idx_stage_definitions_parent_id").on(table.parentId),
    activeIdx: index("idx_stage_definitions_is_active").on(table.isActive),
    sortIdx: index("idx_stage_definitions_sort_order").on(table.sortOrder),
  })
);
