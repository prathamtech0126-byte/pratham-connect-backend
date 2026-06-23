import type { Socket } from "socket.io";
import {
  MODULES_SOCKET_CONFIRM,
  MODULES_SOCKET_SUBSCRIBE,
} from "./constants";
import {
  MODULES_REPORTS_ROOM,
  MODULES_VISA_CASE_ROOM,
  modulesVisaCaseDetailRoom,
} from "./rooms";

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

/**
 * Register modules (reports + visa case) Socket.io room handlers on each connection.
 * Called from src/config/socket.ts during initializeSocket().
 */
export const registerModulesRealtimeHandlers = (
  socket: Socket,
  socketDebug: boolean
): void => {
  socket.on(MODULES_SOCKET_SUBSCRIBE.JOIN_REPORTS, (callback?: (response: unknown) => void) => {
    socket.join(MODULES_REPORTS_ROOM);
    const confirmation = { success: true, room: MODULES_REPORTS_ROOM };
    socket.emit(MODULES_SOCKET_CONFIRM.JOINED_REPORTS, confirmation);
    if (callback) callback(confirmation);
    if (socketDebug) {
      console.log(`📊 Socket ${socket.id} joined ${MODULES_REPORTS_ROOM}`);
    }
  });

  socket.on(MODULES_SOCKET_SUBSCRIBE.LEAVE_REPORTS, () => {
    socket.leave(MODULES_REPORTS_ROOM);
    if (socketDebug) {
      console.log(`👋 Socket ${socket.id} left ${MODULES_REPORTS_ROOM}`);
    }
  });

  socket.on(MODULES_SOCKET_SUBSCRIBE.JOIN_VISA_CASE, (callback?: (response: unknown) => void) => {
    socket.join(MODULES_VISA_CASE_ROOM);
    const confirmation = { success: true, room: MODULES_VISA_CASE_ROOM };
    socket.emit(MODULES_SOCKET_CONFIRM.JOINED_VISA_CASE, confirmation);
    if (callback) callback(confirmation);
    if (socketDebug) {
      console.log(`🛂 Socket ${socket.id} joined ${MODULES_VISA_CASE_ROOM}`);
    }
  });

  socket.on(MODULES_SOCKET_SUBSCRIBE.LEAVE_VISA_CASE, () => {
    socket.leave(MODULES_VISA_CASE_ROOM);
    if (socketDebug) {
      console.log(`👋 Socket ${socket.id} left ${MODULES_VISA_CASE_ROOM}`);
    }
  });

  socket.on(
    MODULES_SOCKET_SUBSCRIBE.JOIN_VISA_CASE_DETAIL,
    (visaCaseId: unknown, callback?: (response: unknown) => void) => {
      if (!isNonEmptyString(visaCaseId)) {
        socket.emit("error", { message: "Invalid visaCaseId" });
        if (callback) callback({ success: false, error: "Invalid visaCaseId" });
        return;
      }

      const room = modulesVisaCaseDetailRoom(visaCaseId);
      socket.join(room);
      const confirmation = { success: true, room, visaCaseId: visaCaseId.trim() };
      socket.emit(MODULES_SOCKET_CONFIRM.JOINED_VISA_CASE_DETAIL, confirmation);
      if (callback) callback(confirmation);
      if (socketDebug) {
        console.log(`🛂 Socket ${socket.id} joined ${room}`);
      }
    }
  );

  socket.on(
    MODULES_SOCKET_SUBSCRIBE.LEAVE_VISA_CASE_DETAIL,
    (visaCaseId: unknown) => {
      if (!isNonEmptyString(visaCaseId)) return;
      socket.leave(modulesVisaCaseDetailRoom(visaCaseId));
      if (socketDebug) {
        console.log(
          `👋 Socket ${socket.id} left ${modulesVisaCaseDetailRoom(visaCaseId)}`
        );
      }
    }
  );
};
