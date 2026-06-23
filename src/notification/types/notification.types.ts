export type NotificationCategory =
  | "leads"
  | "payments"
  | "clients"
  | "operations"
  | "system"
  | "alerts";

export type NotificationPriority = "low" | "normal" | "high" | "urgent";

export type NotificationType =
  | "lead_assignment_batch"
  | "lead_assigned_telecaller"
  | "lead_assigned_counsellor"
  | "lead_transferred_to_counsellor"
  | "lead_reassigned"
  | "lead_followup_reminder"
  | "lead_followup_overdue"
  | "lead_converted"
  | "lead_dropped"
  | "lead_junked"
  | "payment_pending_approval"
  | "payment_approved"
  | "payment_rejected"
  | "payment_partial"
  | "client_assigned"
  | "client_transfer"
  | "tech_support_ticket"
  | "tech_support_request"
  | "deadline_missed"
  | "visa_case_document_request"
  | "system";

export interface NotifyInput {
  type: NotificationType;
  userIds: number[];
  title: string;
  body: string;
  category?: NotificationCategory;
  priority?: NotificationPriority;
  entityType?: string;
  entityId?: number;
  actionUrl?: string;
  actorUserId?: number | null;
  scheduledAt?: Date | null;
  deliverAt?: Date;
  dedupeKey?: string | null;
  meta?: Record<string, unknown>;
  /** If false, only persist when deliverAt <= now */
  deliverImmediately?: boolean;
}

export interface NotificationRow {
  id: number;
  userId: number;
  type: string;
  category: string;
  priority: string;
  title: string;
  body: string;
  entityType: string | null;
  entityId: number | null;
  actionUrl: string | null;
  actorUserId: number | null;
  scheduledAt: Date | null;
  deliverAt: Date;
  deliveredAt: Date | null;
  readAt: Date | null;
  dismissedAt: Date | null;
  dedupeKey: string | null;
  meta: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface NotificationPayload {
  id: number;
  type: string;
  category: string;
  priority: string;
  title: string;
  body: string;
  entityType: string | null;
  entityId: number | null;
  actionUrl: string | null;
  meta: Record<string, unknown>;
  deliverAt: string;
  createdAt: string;
  readAt: string | null;
}
