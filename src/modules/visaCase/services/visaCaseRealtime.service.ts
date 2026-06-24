import { emitToRoles, emitToUser } from "../../../config/socket";
import {
  MODULES_REALTIME_EVENTS,
  VISA_CASE_REALTIME_ROLES,
  type ModulesRefreshPayload,
  type VisaCaseAssignedPayload,
  type VisaCaseUpdatedPayload,
} from "../../realtime/constants";
import {
  emitToModulesRoom,
  MODULES_VISA_CASE_ROOM,
  modulesVisaCaseDetailRoom,
} from "../../realtime/rooms";

export type PublishVisaCaseRefreshInput = {
  reason: string;
  clientId?: string | null;
  visaCaseId?: string | null;
};

export type PublishVisaCaseUpdatedInput = {
  reason: string;
  visaCaseId: string;
  clientId?: string | null;
  assignedUserId?: number | null;
  assignedTeam?: string | null;
  currentStage?: string | null;
  currentSubStatus?: string | null;
  snapshot?: Record<string, unknown>;
};

export type PublishVisaCaseAssignedInput = {
  reason: string;
  visaCaseId: string;
  clientId?: string | null;
  assignedUserId: number;
  assignedTeam: string;
  previousUserId?: number | null;
  previousTeam?: string | null;
  assignmentType?: string;
};

const buildRefreshPayload = (
  input: PublishVisaCaseRefreshInput
): ModulesRefreshPayload => {
  const payload: ModulesRefreshPayload = {
    reason: input.reason,
    timestamp: new Date().toISOString(),
  };

  const clientId = input.clientId?.trim();
  if (clientId) payload.clientId = clientId;

  const visaCaseId = input.visaCaseId?.trim();
  if (visaCaseId) payload.visaCaseId = visaCaseId;

  return payload;
};

/** List/dashboard clients should refetch visa case APIs. */
export const publishVisaCaseRefresh = (input: PublishVisaCaseRefreshInput): void => {
  try {
    const payload = buildRefreshPayload(input);
    emitToModulesRoom(
      MODULES_VISA_CASE_ROOM,
      MODULES_REALTIME_EVENTS.VISA_CASE_REFRESH,
      payload
    );
    emitToRoles(
      VISA_CASE_REALTIME_ROLES,
      MODULES_REALTIME_EVENTS.VISA_CASE_REFRESH,
      payload
    );
  } catch {
    // ignore websocket errors in HTTP path
  }
};

/** Detail/list views for a specific visa case. */
export const publishVisaCaseUpdated = (input: PublishVisaCaseUpdatedInput): void => {
  try {
    const payload: VisaCaseUpdatedPayload = {
      visaCaseId: input.visaCaseId,
      reason: input.reason,
      timestamp: new Date().toISOString(),
      assignedUserId: input.assignedUserId,
      assignedTeam: input.assignedTeam,
      currentStage: input.currentStage,
      currentSubStatus: input.currentSubStatus,
    };

    const clientId = input.clientId?.trim();
    if (clientId) payload.clientId = clientId;
    if (input.snapshot) payload.snapshot = input.snapshot;

    const detailRoom = modulesVisaCaseDetailRoom(input.visaCaseId);
    emitToModulesRoom(detailRoom, MODULES_REALTIME_EVENTS.VISA_CASE_UPDATED, payload);
    emitToModulesRoom(
      MODULES_VISA_CASE_ROOM,
      MODULES_REALTIME_EVENTS.VISA_CASE_UPDATED,
      payload
    );
    emitToRoles(
      VISA_CASE_REALTIME_ROLES,
      MODULES_REALTIME_EVENTS.VISA_CASE_UPDATED,
      payload
    );
  } catch {
    // ignore websocket errors in HTTP path
  }
};

/** Assignment changes — also notify previous/new assignees directly. */
export const publishVisaCaseAssigned = (input: PublishVisaCaseAssignedInput): void => {
  try {
    const payload: VisaCaseAssignedPayload = {
      visaCaseId: input.visaCaseId,
      assignedUserId: input.assignedUserId,
      assignedTeam: input.assignedTeam,
      previousUserId: input.previousUserId,
      previousTeam: input.previousTeam,
      assignmentType: input.assignmentType,
      reason: input.reason,
      timestamp: new Date().toISOString(),
    };

    const clientId = input.clientId?.trim();
    if (clientId) payload.clientId = clientId;

    emitToModulesRoom(
      MODULES_VISA_CASE_ROOM,
      MODULES_REALTIME_EVENTS.VISA_CASE_ASSIGNED,
      payload
    );
    emitToRoles(
      VISA_CASE_REALTIME_ROLES,
      MODULES_REALTIME_EVENTS.VISA_CASE_ASSIGNED,
      payload
    );

    emitToUser(
      input.assignedUserId,
      MODULES_REALTIME_EVENTS.VISA_CASE_ASSIGNED,
      payload
    );

    if (
      input.previousUserId != null &&
      input.previousUserId !== input.assignedUserId
    ) {
      emitToUser(
        input.previousUserId,
        MODULES_REALTIME_EVENTS.VISA_CASE_ASSIGNED,
        payload
      );
    }
  } catch {
    // ignore websocket errors in HTTP path
  }
};
