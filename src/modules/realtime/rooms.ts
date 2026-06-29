import { getIO } from "../../config/socket";

export const MODULES_REPORTS_ROOM = "modules:reports";
export const MODULES_VISA_CASE_ROOM = "modules:visa-case";
export const MODULES_FRONTDESK_ROOM = "modules:frontdesk";

export const modulesVisaCaseDetailRoom = (visaCaseId: string): string =>
  `modules:visa-case:detail:${visaCaseId.trim()}`;

export const modulesFrontDeskDetailRoom = (leadId: number | string): string =>
  `modules:frontdesk:detail:${String(leadId).trim()}`;

export const emitToModulesRoom = (
  room: string,
  event: string,
  data: unknown
): void => {
  getIO().to(room).emit(event, data);
};
