import {
  pgTable,
  bigserial,
  bigint,
  varchar,
  timestamp,
  text,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "../../schemas/users.schema";

export const notifications = pgTable(
  "notifications",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: bigint("user_id", { mode: "number" })
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    type: varchar("type", { length: 64 }).notNull(),
    category: varchar("category", { length: 32 }).notNull().default("system"),
    priority: varchar("priority", { length: 16 }).notNull().default("normal"),
    title: varchar("title", { length: 255 }).notNull(),
    body: text("body").notNull(),
    entityType: varchar("entity_type", { length: 64 }),
    entityId: bigint("entity_id", { mode: "number" }),
    actionUrl: varchar("action_url", { length: 512 }),
    actorUserId: bigint("actor_user_id", { mode: "number" }).references(() => users.id),
    scheduledAt: timestamp("scheduled_at"),
    deliverAt: timestamp("deliver_at").notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at"),
    readAt: timestamp("read_at"),
    dismissedAt: timestamp("dismissed_at"),
    dedupeKey: varchar("dedupe_key", { length: 128 }),
    meta: jsonb("meta").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userReadIdx: index("idx_notifications_user_read_created").on(
      table.userId,
      table.readAt,
      table.createdAt
    ),
    deliverPendingIdx: index("idx_notifications_deliver_pending").on(
      table.deliverAt,
      table.deliveredAt
    ),
    userDedupeIdx: uniqueIndex("idx_notifications_user_dedupe").on(
      table.userId,
      table.dedupeKey
    ),
    typeIdx: index("idx_notifications_type").on(table.type),
  })
);
