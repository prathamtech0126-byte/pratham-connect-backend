// activityLog.schema.ts
import {
  pgTable,
  bigserial,
  bigint,
  varchar,
  timestamp,
  jsonb,
  index,
  text,
  pgEnum,
} from "drizzle-orm/pg-core";
import { users } from "./users.schema";
import { clientInformation } from "./clientInformation.schema";

// Action type enum for consistency
export const activityActionEnum = pgEnum("activity_action_enum", [
  "CREATE",
  "UPDATE",
  "DELETE",
  "STATUS_CHANGE",
  "PAYMENT_ADDED",
  "PAYMENT_UPDATED",
  "PAYMENT_DELETED",
  "PRODUCT_ADDED",
  "PRODUCT_UPDATED",
  "PRODUCT_DELETED",
  "ARCHIVE",
  "UNARCHIVE",
  "LOGIN",
  "LOGOUT",
]);

export const activityLog = pgTable(
  "activity_log",
  {
    logId: bigserial("id", { mode: "number" }).primaryKey(),

    // Entity tracking (what was changed)
    entityType: varchar("entity_type", { length: 50 }).notNull(),
    // e.g. 'client', 'client_payment', 'product_payment', 'beaconAccount', 'simCard', etc.

    entityId: bigint("entity_id", { mode: "number" }), // Made nullable for bulk/system operations
    // ID from respective table (nullable for bulk/system operations)

    // Client reference (for filtering by client)
    clientId: bigint("client_id", { mode: "number" })
      .references(() => clientInformation.clientId), // Links to client_information.id
    // Links to client_information.id (nullable for non-client activities)

    // Action performed
    action: activityActionEnum("action").notNull(), // Use enum for consistency
    // CREATE | UPDATE | DELETE | STATUS_CHANGE | PAYMENT_ADDED | etc.

    // Change tracking
    oldValue: jsonb("old_value"), // Previous state
    newValue: jsonb("new_value"), // New state

    // Human-readable description
    description: text("description"), // e.g. "Client payment of $500 added", "Client status changed to Active"
    // Human-readable description of the action

    // Metadata for flexible additional data
    metadata: jsonb("metadata"), // For any additional context: { ip: "...", device: "...", etc. }
    // For any additional context: { ip: "...", device: "...", etc. }

    // Who performed the action
    performedBy: bigint("performed_by", { mode: "number" })
      .references(() => users.id)
      .notNull(), // Made required - always track who did it

    // Request context (optional)
    ipAddress: varchar("ip_address", { length: 45 }),
    userAgent: varchar("user_agent", { length: 500 }), // Increased length for longer user agents

    // Timestamp
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    // Composite index for entity lookups
    entityIdx: index("idx_activity_entity").on(
      table.entityType,
      table.entityId
    ),

    // Client index (for filtering by client)
    clientIdx: index("idx_activity_client").on(table.clientId),

    // Action index
    actionIdx: index("idx_activity_action").on(table.action),

    // User index
    userIdx: index("idx_activity_user").on(table.performedBy),

    // Time-based queries
    createdAtIdx: index("idx_activity_created_at").on(table.createdAt),

    // Composite: client + action (common query pattern)
    clientActionIdx: index("idx_activity_client_action").on(
      table.clientId,
      table.action
    ),
  })
);
