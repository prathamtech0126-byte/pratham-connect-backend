import {
  bigint,
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * All notification types the system can generate.
 * Add new types here as features expand.
 */
export const notificationTypeEnum = pgEnum("notification_type_enum", [
  // Installment plan lifecycle
  "INSTALLMENT_PLAN_CREATED",      // → manager / TL / admin: plan awaiting approval
  "INSTALLMENT_PLAN_APPROVED",     // → counsellor: plan was approved
  "INSTALLMENT_PLAN_REJECTED",     // → counsellor: plan was rejected (reason attached)

  // Installment collection
  "INSTALLMENT_DUE_REMINDER",      // → counsellor: installment due soon
  "INSTALLMENT_OVERDUE",           // → counsellor + manager: installment is overdue
  "INSTALLMENT_PAID",              // → manager: installment collected

  // Payment completion
  "PAYMENT_COMPLETED",             // → manager: all installments paid; final invoice issued

  // Client journey
  "CLIENT_JOURNEY_STAGE_UPDATED",  // → counsellor: client stage changed
  "CLIENT_TRANSFERRED",            // → new counsellor: client transferred to them

  // Front desk / lead registration
  "LEAD_INBOUND_REGISTERED",       // → front_desk: new website registration
  "LEAD_CLIENT_SELF_EDITED",       // → front_desk: client updated via edit link
  "LEAD_FRONTDESK_VERIFIED",       // → front_desk: lead verified
  "LEAD_FRONTDESK_ASSIGNED",       // → front_desk: lead assigned to counsellor
  "LEAD_FRONTDESK_UPDATED",        // → front_desk: lead details updated by staff
]);

/**
 * referenceType values — tells the consumer which table referenceId points to.
 */
export const notificationReferenceTypeEnum = pgEnum(
  "notification_reference_type_enum",
  [
    "installment_plan",
    "installment",
    "client",
    "client_journey",
    "lead",
  ]
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /**
     * Main CRM users.id of the person who should see this notification.
     * Cross-DB reference — no FK.
     */
    recipientUserId: bigint("recipient_user_id", { mode: "number" }).notNull(),

    type: notificationTypeEnum("type").notNull(),

    /** Short heading shown in the notification bell / list */
    title: varchar("title", { length: 255 }).notNull(),

    /** Full message body */
    message: text("message").notNull(),

    /**
     * UUID of the entity this notification is about.
     * Use referenceType to know which table to query.
     */
    referenceId: uuid("reference_id"),

    referenceType: notificationReferenceTypeEnum("reference_type"),

    isRead: boolean("is_read").notNull().default(false),

    /** Timestamp the recipient opened / acknowledged this notification */
    readAt: timestamp("read_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    recipientUserIdIdx: index("idx_notifications_recipient_user_id").on(
      table.recipientUserId
    ),
    typeIdx:            index("idx_notifications_type").on(table.type),
    isReadIdx:          index("idx_notifications_is_read").on(table.isRead),
    referenceIdx:       index("idx_notifications_reference").on(
      table.referenceType,
      table.referenceId
    ),
    createdAtIdx:       index("idx_notifications_created_at").on(table.createdAt),

    /** Fast query: unread notifications per user (most common access pattern) */
    recipientUnreadIdx: index("idx_notifications_recipient_unread").on(
      table.recipientUserId,
      table.isRead,
      table.createdAt
    ),
  })
);
