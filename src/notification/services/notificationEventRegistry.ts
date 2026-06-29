import type {
  NotificationCategory,
  NotificationPriority,
  NotificationType,
} from "../types/notification.types";

export type RegistryEntry = {
  category: NotificationCategory;
  defaultPriority: NotificationPriority;
};

export const NOTIFICATION_EVENT_REGISTRY: Record<NotificationType, RegistryEntry> = {
  lead_assignment_batch: { category: "leads", defaultPriority: "normal" },
  lead_assigned_telecaller: { category: "leads", defaultPriority: "normal" },
  lead_assigned_counsellor: { category: "leads", defaultPriority: "normal" },
  lead_transferred_to_counsellor: { category: "leads", defaultPriority: "high" },
  lead_reassigned: { category: "leads", defaultPriority: "high" },
  lead_followup_reminder: { category: "leads", defaultPriority: "normal" },
  lead_followup_overdue: { category: "alerts", defaultPriority: "high" },
  lead_converted: { category: "leads", defaultPriority: "normal" },
  lead_dropped: { category: "leads", defaultPriority: "low" },
  lead_junked: { category: "leads", defaultPriority: "low" },
  payment_pending_approval: { category: "payments", defaultPriority: "high" },
  payment_approved: { category: "payments", defaultPriority: "normal" },
  payment_rejected: { category: "payments", defaultPriority: "high" },
  payment_partial: { category: "payments", defaultPriority: "high" },
  client_assigned: { category: "clients", defaultPriority: "normal" },
  client_transfer: { category: "clients", defaultPriority: "normal" },
  tech_support_ticket: { category: "operations", defaultPriority: "normal" },
  tech_support_request: { category: "operations", defaultPriority: "normal" },
  deadline_missed: { category: "system", defaultPriority: "high" },
  visa_case_document_request: { category: "operations", defaultPriority: "high" },
  lead_inbound_registered: { category: "leads", defaultPriority: "normal" },
  lead_client_self_edited: { category: "leads", defaultPriority: "normal" },
  lead_frontdesk_verified: { category: "leads", defaultPriority: "normal" },
  lead_frontdesk_assigned: { category: "leads", defaultPriority: "normal" },
  lead_frontdesk_updated: { category: "leads", defaultPriority: "low" },
  system: { category: "system", defaultPriority: "normal" },
};

export function getRegistryEntry(type: NotificationType): RegistryEntry {
  return NOTIFICATION_EVENT_REGISTRY[type] ?? NOTIFICATION_EVENT_REGISTRY.system;
}
