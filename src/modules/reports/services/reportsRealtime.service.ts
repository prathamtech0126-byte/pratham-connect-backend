import { emitToRoles } from "../../../config/socket";
import {
  MODULES_REALTIME_EVENTS,
  REPORTS_REALTIME_ROLES,
  type ModulesRefreshPayload,
} from "../../realtime/constants";
import { emitToModulesRoom, MODULES_REPORTS_ROOM } from "../../realtime/rooms";

export type PublishReportsRefreshInput = {
  reason: string;
  clientId?: string | null;
  visaCaseId?: string | null;
};

/**
 * Tell connected clients to refetch reports/dashboards.
 * Frontend should re-call the relevant GET endpoints (filter params unchanged).
 */
export const publishReportsRefresh = (input: PublishReportsRefreshInput): void => {
  try {
    const payload: ModulesRefreshPayload = {
      reason: input.reason,
      timestamp: new Date().toISOString(),
    };

    const clientId = input.clientId?.trim();
    if (clientId) payload.clientId = clientId;

    const visaCaseId = input.visaCaseId?.trim();
    if (visaCaseId) payload.visaCaseId = visaCaseId;

    emitToModulesRoom(MODULES_REPORTS_ROOM, MODULES_REALTIME_EVENTS.REPORTS_REFRESH, payload);
    emitToRoles(REPORTS_REALTIME_ROLES, MODULES_REALTIME_EVENTS.REPORTS_REFRESH, payload);
  } catch {
    // Non-fatal — DB/cache is source of truth.
  }
};
