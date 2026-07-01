import { emitToRoles, getIO } from "../../../config/socket";
import {
  FRONTDESK_REALTIME_ROLES,
  MODULES_REALTIME_EVENTS,
  type FrontDeskUpdatedPayload,
  type ModulesRefreshPayload,
} from "../../../modules/realtime/constants";
import {
  emitToModulesRoom,
  MODULES_FRONTDESK_ROOM,
  modulesFrontDeskDetailRoom,
} from "../../../modules/realtime/rooms";

/** Legacy / mistaken frontend event names — emit alongside canonical modules:* events. */
const FRONTDESK_REFRESH_ALIASES = [
  "frontdesk:refresh",
  "leads:frontdesk:refresh",
] as const;

const FRONTDESK_UPDATED_ALIASES = [
  "frontdesk:updated",
  "leads:frontdesk:updated",
] as const;

const socketDebugEnabled = (): boolean =>
  process.env.NODE_ENV !== "production" &&
  process.env.SOCKET_DEBUG === "true";

const logFrontDeskEmit = (
  event: string,
  rooms: string[],
  payload: unknown
): void => {
  if (!socketDebugEnabled()) return;

  try {
    const io = getIO();
    const counts = rooms.map((room) => {
      const size = io.sockets.adapter.rooms.get(room)?.size ?? 0;
      return `${room}=${size}`;
    });
    console.log(`📡 [frontdesk] emit ${event}`, {
      rooms: counts.join(", "),
      leadId: (payload as { leadId?: number })?.leadId,
      reason: (payload as { reason?: string })?.reason,
    });
  } catch {
    // ignore
  }
};

const emitFrontDeskEvent = (
  event: string,
  aliases: readonly string[],
  rooms: string[],
  payload: unknown
): void => {
  const io = getIO();
  const allEvents = [event, ...aliases];

  for (const room of rooms) {
    for (const evt of allEvents) {
      io.to(room).emit(evt, payload);
    }
  }

  logFrontDeskEmit(event, rooms, payload);
};

export type PublishFrontDeskRefreshInput = {
  reason: string;
  leadId?: number | null;
};

export type PublishFrontDeskUpdatedInput = {
  reason: string;
  leadId: number;
  snapshot?: Record<string, unknown>;
};

const buildRefreshPayload = (
  input: PublishFrontDeskRefreshInput
): ModulesRefreshPayload => {
  const payload: ModulesRefreshPayload = {
    reason: input.reason,
    timestamp: new Date().toISOString(),
  };

  if (input.leadId != null && input.leadId > 0) {
    payload.leadId = input.leadId;
  }

  return payload;
};

/** List/dashboard clients should refetch front desk APIs. */
export const publishFrontDeskRefresh = (input: PublishFrontDeskRefreshInput): void => {
  try {
    const payload = buildRefreshPayload(input);
    const event = MODULES_REALTIME_EVENTS.FRONTDESK_REFRESH;

    emitFrontDeskEvent(event, FRONTDESK_REFRESH_ALIASES, [MODULES_FRONTDESK_ROOM], payload);

    emitToRoles(FRONTDESK_REALTIME_ROLES, event, payload);
    for (const alias of FRONTDESK_REFRESH_ALIASES) {
      emitToRoles(FRONTDESK_REALTIME_ROLES, alias, payload);
    }
  } catch (err) {
    if (socketDebugEnabled()) {
      console.error("[frontdeskRealtime] refresh emit failed:", err);
    }
  }
};

/** Detail/list views for a specific front desk lead. */
export const publishFrontDeskUpdated = (input: PublishFrontDeskUpdatedInput): void => {
  try {
    const payload: FrontDeskUpdatedPayload = {
      leadId: input.leadId,
      reason: input.reason,
      timestamp: new Date().toISOString(),
    };

    if (input.snapshot) payload.snapshot = input.snapshot;

    const event = MODULES_REALTIME_EVENTS.FRONTDESK_UPDATED;
    const detailRoom = modulesFrontDeskDetailRoom(input.leadId);
    const rooms = [detailRoom, MODULES_FRONTDESK_ROOM];

    emitFrontDeskEvent(event, FRONTDESK_UPDATED_ALIASES, rooms, payload);

    emitToRoles(FRONTDESK_REALTIME_ROLES, event, payload);
    for (const alias of FRONTDESK_UPDATED_ALIASES) {
      emitToRoles(FRONTDESK_REALTIME_ROLES, alias, payload);
    }
  } catch (err) {
    if (socketDebugEnabled()) {
      console.error("[frontdeskRealtime] updated emit failed:", err);
    }
  }
};
