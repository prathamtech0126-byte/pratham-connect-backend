import { getApproverUserIds } from "../models/notification.model";
import { notifyUsers } from "../services/notification.service";

export async function notifyPaymentPendingApproval(params: {
  financeId: number;
  clientId?: number;
  clientName?: string;
  amount?: string | number;
  counsellorName?: string;
  actorUserId?: number;
}): Promise<void> {
  const approverIds = await getApproverUserIds();
  if (approverIds.length === 0) return;

  const amountLabel =
    params.amount != null ? `$${params.amount}` : "payment";

  await notifyUsers({
    type: "payment_pending_approval",
    userIds: approverIds,
    title: "Payment approval required",
    body: `${params.counsellorName ?? "A counsellor"} submitted ${amountLabel} for ${params.clientName ?? "a client"} — approval needed.`,
    priority: "high",
    entityType: "client",
    entityId: params.clientId,
    actionUrl: params.clientId ? `/clients/${params.clientId}` : "/messages",
    actorUserId: params.actorUserId,
    dedupeKey: `payment_pending:${params.financeId}`,
    meta: {
      financeId: params.financeId,
      clientId: params.clientId,
      clientName: params.clientName,
      amount: params.amount,
    },
  });
}

export async function notifyPaymentApproved(params: {
  counsellorId: number;
  financeId: number;
  clientId?: number;
  clientName?: string;
  amount?: string | number;
}): Promise<void> {
  await notifyUsers({
    type: "payment_approved",
    userIds: [params.counsellorId],
    title: "Payment approved",
    body: `All Finance payment for ${params.clientName ?? "client"} (${params.amount != null ? `$${params.amount}` : "amount"}) was approved.`,
    entityType: "client",
    entityId: params.clientId,
    actionUrl: params.clientId ? `/clients/${params.clientId}` : undefined,
    dedupeKey: `payment_approved:${params.financeId}:${params.counsellorId}`,
    meta: params,
  });
}

export async function notifyPaymentRejected(params: {
  counsellorId: number;
  financeId: number;
  clientId?: number;
  clientName?: string;
  amount?: string | number;
}): Promise<void> {
  await notifyUsers({
    type: "payment_rejected",
    userIds: [params.counsellorId],
    title: "Payment rejected",
    body: `All Finance payment for ${params.clientName ?? "client"} was rejected. Please review.`,
    priority: "high",
    entityType: "client",
    entityId: params.clientId,
    actionUrl: params.clientId ? `/clients/${params.clientId}` : undefined,
    dedupeKey: `payment_rejected:${params.financeId}:${params.counsellorId}`,
    meta: params,
  });
}

export async function notifyPartialPaymentApproval(params: {
  financeId: number;
  clientId: number;
  clientName: string;
  counsellorName: string;
  amount: string | number;
  actorUserId?: number;
  /** Counsellor's manager (included in addition to all approver roles). */
  managerId?: number | null;
}): Promise<void> {
  const approverIds = await getApproverUserIds();
  const userIds = [
    ...new Set([
      ...approverIds,
      ...(params.managerId != null && params.managerId > 0 ? [params.managerId] : []),
    ]),
  ];
  if (userIds.length === 0) return;

  await notifyUsers({
    type: "payment_partial",
    userIds,
    title: "Partial payment approval required",
    body: `${params.counsellorName} submitted a partial payment of $${params.amount} for ${params.clientName}.`,
    priority: "high",
    entityType: "client",
    entityId: params.clientId,
    actionUrl: `/clients/${params.clientId}`,
    actorUserId: params.actorUserId,
    dedupeKey: `payment_partial:${params.financeId}`,
    meta: params,
  });
}
