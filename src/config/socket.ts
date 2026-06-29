import { Server as HttpServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import { getNotificationRealtimeMeta } from "../notification/services/notificationRealtime.service";

let io: SocketIOServer | null = null;

/**
 * Initialize WebSocket server
 */
export const initializeSocket = (httpServer: HttpServer) => {
  const isProduction = process.env.NODE_ENV === "production";
  const socketDebug = !isProduction && process.env.SOCKET_DEBUG === "true";

  const parseOrigins = (raw?: string): string[] =>
    (raw || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  const allowedOrigins = Array.from(
    new Set(
      [
        "https://connect.easyvisa.ai",
        process.env.FRONTEND_URL,
        ...parseOrigins(process.env.CORS_ORIGINS),
      ].filter(Boolean) as string[]
    )
  );

  io = new SocketIOServer(httpServer, {
    cors: {
      origin: isProduction ? allowedOrigins : true,
      credentials: true,
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket: Socket) => {
    if (socketDebug) {
      console.log(`✅ Client connected: ${socket.id}`);
      console.log(`🔵 [BACKEND] Socket ${socket.id} - Registering event handlers...`);
    }

    // Test: Log ANY event received (for debugging)
    if (socketDebug) {
      socket.onAny((eventName, ...args) => {
        console.log(`🔵 [BACKEND] [onAny] Received event: ${eventName}`, args);
      });
    }

    // ========== REGISTER join:role FIRST (for broadcast messages) ==========
    // Join role-based room (for broadcast messages)
    // Register this handler EARLY in the connection lifecycle
    socket.on("join:role", (role: string, callback?: (response: any) => void) => {
      if (socketDebug) {
        console.log(`🔵 [BACKEND] join:role received`, { socketId: socket.id, role });
      }

      if (!role || typeof role !== "string") {
        console.error(`❌ [BACKEND] Invalid role: ${role} (type: ${typeof role})`);
        socket.emit("error", { message: "Invalid role" });
        if (callback) callback({ success: false, error: "Invalid role" });
        return;
      }

      const room = `role:${role.toLowerCase()}`;
      socket.join(room);
      const socketsInRoom = io!.sockets.adapter.rooms.get(room);
      const socketCount = socketsInRoom ? socketsInRoom.size : 0;
      if (socketDebug) {
        console.log(
          `🎭 [BACKEND] Socket ${socket.id} joined role room: ${room} (Total sockets in room: ${socketCount})`
        );
      }

      // Emit confirmation back to frontend
      const confirmation = {
        success: true,
        role: role.toLowerCase(),
        room: room,
        socketCount
      };
      socket.emit("joined:role", confirmation);
      if (callback) callback(confirmation);
      if (socketDebug) {
        console.log(`✅ [BACKEND] Sent confirmation to socket ${socket.id} for role: ${role.toLowerCase()}`);
      }
    });
    if (socketDebug) console.log(`✅ [BACKEND] join:role handler registered for socket ${socket.id}`);

    // Join room for specific counsellor
    socket.on("join:counsellor", (counsellorId: number | string) => {
      // Validate counsellorId
      const id = typeof counsellorId === "string" ? parseInt(counsellorId, 10) : counsellorId;

      if (isNaN(id) || id <= 0) {
        console.error(`❌ Invalid counsellorId: ${counsellorId}`);
        socket.emit("error", { message: "Invalid counsellor ID" });
        return;
      }

      const room = `counsellor:${id}`;
      socket.join(room);
      if (socketDebug) console.log(`👤 Socket ${socket.id} joined room: ${room}`);
    });

    // Leave room
    socket.on("leave:counsellor", (counsellorId: number | string) => {
      // Validate counsellorId
      const id = typeof counsellorId === "string" ? parseInt(counsellorId, 10) : counsellorId;

      if (isNaN(id) || id <= 0) {
        console.error(`❌ Invalid counsellorId: ${counsellorId}`);
        return;
      }

      const room = `counsellor:${id}`;
      socket.leave(room);
      if (socketDebug) console.log(`👋 Socket ${socket.id} left room: ${room}`);
    });

    // Join user-specific room (notifications, individual messages)
    socket.on(
      "join:user",
      (userId: number | string, callback?: (response: unknown) => void) => {
        const id = typeof userId === "string" ? parseInt(userId, 10) : userId;
        if (isNaN(id) || id <= 0) {
          console.error(`❌ Invalid userId for join:user: ${userId}`);
          if (callback) callback({ success: false, error: "Invalid user ID" });
          return;
        }
        const room = `user:${id}`;
        socket.join(room);
        const socketsInRoom = io!.sockets.adapter.rooms.get(room);
        const socketCount = socketsInRoom ? socketsInRoom.size : 0;
        if (socketDebug) {
          console.log(
            `👤 Socket ${socket.id} joined user room: ${room} (Total sockets in room: ${socketCount})`
          );
        }
        socket.emit("notifications:realtime", getNotificationRealtimeMeta());
        const confirmation = { success: true, room, socketCount };
        if (callback) callback(confirmation);
      }
    );

    socket.on("leave:user", (userId: number | string) => {
      const id = typeof userId === "string" ? parseInt(userId, 10) : userId;
      if (isNaN(id) || id <= 0) return;
      socket.leave(`user:${id}`);
    });

    // Join admin room
    socket.on("join:admin", () => {
      socket.join("admin");
      if (socketDebug) console.log(`👑 Socket ${socket.id} joined admin room`);
    });

    // Leave admin room
    socket.on("leave:admin", () => {
      socket.leave("admin");
      if (socketDebug) console.log(`👋 Socket ${socket.id} left admin room`);
    });

    // Join dashboard room (for admin dashboard updates)
    socket.on("join:dashboard", () => {
      socket.join("admin:dashboard");
      if (socketDebug) console.log(`📊 Socket ${socket.id} joined dashboard room`);
    });

    // Leave dashboard room
    socket.on("leave:dashboard", () => {
      socket.leave("admin:dashboard");
      if (socketDebug) console.log(`👋 Socket ${socket.id} left dashboard room`);
    });

    // Join counsellors room (for leaderboard updates - Image 1)
    socket.on("join:counsellors", () => {
      socket.join("counsellors");
      if (socketDebug) console.log(`👥 Socket ${socket.id} joined counsellors room`);
    });

    // Leave counsellors room
    socket.on("leave:counsellors", () => {
      socket.leave("counsellors");
      if (socketDebug) console.log(`👋 Socket ${socket.id} left counsellors room`);
    });

    // Leave role-based room
    socket.on("leave:role", (role: string) => {
      if (!role || typeof role !== "string") {
        console.error(`❌ Invalid role: ${role}`);
        return;
      }

      const room = `role:${role.toLowerCase()}`;
      socket.leave(room);
      if (socketDebug) console.log(`👋 Socket ${socket.id} left role room: ${room}`);
    });

    socket.on("disconnect", () => {
      if (socketDebug) console.log(`❌ Client disconnected: ${socket.id}`);
    });
  });

  if (socketDebug) console.log("🔌 WebSocket server initialized");
  return io;
};

/**
 * Get WebSocket server instance
 */
export const getIO = () => {
  if (!io) {
    throw new Error("Socket.IO not initialized. Call initializeSocket first.");
  }
  return io;
};

/**
 * Emit event to specific counsellor room
 */
export const emitToCounsellor = (counsellorId: number, event: string, data: any) => {
  const io = getIO();
  const room = `counsellor:${counsellorId}`;
  io.to(room).emit(event, data);
  // Avoid noisy logs in production
};

/**
 * Emit event to a specific user's room (join:user).
 */
export const emitToUser = (userId: number, event: string, data: unknown) => {
  const io = getIO();
  const room = `user:${userId}`;
  const roomSize = io.sockets.adapter.rooms.get(room)?.size ?? 0;
  const isProduction = process.env.NODE_ENV === "production";

  if (event.startsWith("notification:") && !isProduction) {
    if (roomSize === 0) {
      console.warn(
        `[notification] emit to empty room — event=${event} userId=${userId} room=${room}`
      );
    } else {
      console.log(
        `[notification] emit event=${event} userId=${userId} roomSize=${roomSize}`
      );
    }
  }

  io.to(room).emit(event, data);
};

/**
 * Emit event to admin room
 */
export const emitToAdmin = (event: string, data: any) => {
  const io = getIO();
  io.to("admin").emit(event, data);
};

/**
 * Emit event to all connected clients
 */
export const emitToAll = (event: string, data: any) => {
  const io = getIO();
  io.emit(event, data);
};

/**
 * Emit dashboard update to admin dashboard room
 */
export const emitDashboardUpdate = (event: string, data: any) => {
  const io = getIO();
  io.to("admin:dashboard").emit(event, data);
};

/**
 * Emit event to all counsellors room
 */
export const emitToCounsellors = (event: string, data: any) => {
  const io = getIO();
  io.to("counsellors").emit(event, data);
};

/**
 * Emit event to specific role-based rooms
 */
export const emitToRoles = (roles: string[], event: string, data: any) => {
  const io = getIO();
  for (const role of roles) {
    const room = `role:${role.toLowerCase()}`;
    io.to(room).emit(event, data);
  }
};

