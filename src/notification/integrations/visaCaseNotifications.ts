import {
  getUserById,
} from "../../modules/visaCase/services/visaCaseAssignment.service";

type NotifyUsersInput = {
  type: string;
  userIds: number[];
  title: string;
  body: string;
  priority?: string;
  entityType?: string;
  entityId?: number;
  actionUrl?: string;
  actorUserId?: number;
  dedupeKey?: string;
  meta?: Record<string, unknown>;
};

async function notifyUsers(input: NotifyUsersInput): Promise<void> {
  try {
    // @ts-expect-error notification stack may be absent in partial deployments
    const mod = await import("../services/notification.service");
    await mod.notifyUsers(input);
  } catch {
    // Notification stack is optional (e.g. seed scripts, partial deployments).
  }
}

const TEAM_LABELS: Record<string, string> = {
  cx: "CX",
  binding: "Binding",
  application: "Application",
};

const resolveCxDocumentRequestNotifyUserIds = async (input: {
  cxHandlerUserId: number;
  excludeUserId?: number;
}): Promise<number[]> => {
  if (input.cxHandlerUserId <= 0) return [];

  if (
    input.excludeUserId != null &&
    input.excludeUserId > 0 &&
    input.excludeUserId === input.cxHandlerUserId
  ) {
    return [];
  }

  return [input.cxHandlerUserId];
};

export async function notifyVisaCaseDocumentRequested(params: {
  requestId: string;
  visaCaseId: string;
  cxHandlerUserId: number;
  legacyClientId?: number | null;
  clientName?: string | null;
  clientCode?: string | null;
  personLabel: string;
  documentType: string;
  sourceTeam: string;
  actorUserId: number;
  actorRole: string;
}): Promise<void> {
  const userIds = await resolveCxDocumentRequestNotifyUserIds({
    cxHandlerUserId: params.cxHandlerUserId,
    excludeUserId: params.actorRole === "cx" ? params.actorUserId : undefined,
  });

  if (userIds.length === 0) return;

  const actor = await getUserById(params.actorUserId);
  const actorName = actor?.fullName ?? "A team member";
  const teamLabel = TEAM_LABELS[params.sourceTeam] ?? params.sourceTeam;
  const clientLabel =
    params.clientName?.trim() ||
    (params.clientCode ? `client ${params.clientCode}` : "a client");

  await notifyUsers({
    type: "visa_case_document_request",
    userIds,
    title: "Document requested",
    body: `${actorName} (${teamLabel}) requested "${params.documentType}" for ${params.personLabel} — ${clientLabel}.`,
    priority: "high",
    entityType: "visa_case",
    entityId:
      params.legacyClientId != null && Number.isFinite(params.legacyClientId)
        ? params.legacyClientId
        : undefined,
    actionUrl: `/visa-cases/${params.visaCaseId}`,
    actorUserId: params.actorUserId,
    dedupeKey: `visa_doc_request:${params.requestId}`,
    meta: {
      requestId: params.requestId,
      visaCaseId: params.visaCaseId,
      legacyClientId: params.legacyClientId,
      clientName: params.clientName,
      clientCode: params.clientCode,
      personLabel: params.personLabel,
      documentType: params.documentType,
      sourceTeam: params.sourceTeam,
      actorRole: params.actorRole,
    },
  });
}
