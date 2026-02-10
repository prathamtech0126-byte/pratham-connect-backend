// message.schema.ts
import {
  pgTable,
  bigserial,
  bigint,
  varchar,
  timestamp,
  boolean,
  integer,
  text,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users.schema";

// Message type enum
export const messageTypeEnum = pgEnum("message_type_enum", [
  "broadcast",
  "individual",
]);

// Message priority enum
export const messagePriorityEnum = pgEnum("message_priority_enum", [
  "low",
  "normal",
  "high",
  "urgent",
]);

// Acknowledgment method enum
export const acknowledgmentMethodEnum = pgEnum("acknowledgment_method_enum", [
  "button",
  "timer",
  "auto",
]);

// Messages table
export const messages = pgTable(
  "messages",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    message: text("message").notNull(),

    title: varchar("title", { length: 255 }),

    senderId: bigint("sender_id", { mode: "number" })
      .references(() => users.id)
      .notNull(),

    messageType: messageTypeEnum("message_type").notNull().default("broadcast"),

    // For broadcast messages: array of roles ['manager', 'counsellor']
    targetRoles: text("target_roles").array().notNull().default([]),

    // For individual messages: array of user IDs [5, 10, 15]
    targetUserIds: integer("target_user_ids").array().notNull().default([]),

    priority: messagePriorityEnum("priority").notNull().default("normal"),

    isActive: boolean("is_active").notNull().default(true),

    createdAt: timestamp("created_at").defaultNow().notNull(),

    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    senderIdx: index("idx_messages_sender").on(table.senderId),
    typeIdx: index("idx_messages_type").on(table.messageType),
    activeIdx: index("idx_messages_active").on(table.isActive, table.createdAt),
    typeActiveIdx: index("idx_messages_type_active").on(
      table.messageType,
      table.isActive
    ),
  })
);

// Message acknowledgments table
export const messageAcknowledgments = pgTable(
  "message_acknowledgments",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    messageId: bigint("message_id", { mode: "number" })
      .references(() => messages.id, { onDelete: "cascade" })
      .notNull(),

    userId: bigint("user_id", { mode: "number" })
      .references(() => users.id)
      .notNull(),

    acknowledgedAt: timestamp("acknowledged_at").defaultNow().notNull(),

    acknowledgmentMethod: acknowledgmentMethodEnum("acknowledgment_method")
      .notNull()
      .default("button"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    messageUserIdx: index("idx_ack_message_user").on(
      table.messageId,
      table.userId
    ),
    userIdx: index("idx_ack_user").on(table.userId),
    messageIdx: index("idx_ack_message").on(table.messageId),
    // Unique constraint: one acknowledgment per user per message
    uniqueMessageUser: index("idx_ack_unique_message_user").on(
      table.messageId,
      table.userId
    ),
  })
);
