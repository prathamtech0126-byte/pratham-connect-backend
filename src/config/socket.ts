import { Server as HttpServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";

let io: SocketIOServer | null = null;

/**
 * Initialize WebSocket server
 */
export const initializeSocket = (httpServer: HttpServer) => {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL || "http://localhost:5173",
      credentials: true,
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket: Socket) => {
    console.log(`✅ Client connected: ${socket.id}`);
    console.log(`🔵 [BACKEND] Socket ${socket.id} - Registering event handlers...`);

    // Test: Log ANY event received (for debugging)
    socket.onAny((eventName, ...args) => {
      // Log ALL events to see what's being received
      console.log(`🔵 [BACKEND] [onAny] Received event: ${eventName}`, args);
    });

    // ========== REGISTER join:role FIRST (for broadcast messages) ==========
    // Join role-based room (for broadcast messages)
    // Register this handler EARLY in the connection lifecycle
    socket.on("join:role", (role: string, callback?: (response: any) => void) => {
      console.log(`🔵 [BACKEND] ========== join:role EVENT RECEIVED ==========`);
      console.log(`🔵 [BACKEND] Socket ID: ${socket.id}`);
      console.log(`🔵 [BACKEND] Socket connected: ${socket.connected}`);
      console.log(`🔵 [BACKEND] Role received: ${role} (type: ${typeof role})`);

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
      console.log(
        `🎭 [BACKEND] Socket ${socket.id} joined role room: ${room} (Total sockets in room: ${socketCount})`
      );

      // Emit confirmation back to frontend
      const confirmation = {
        success: true,
        role: role.toLowerCase(),
        room: room,
        socketCount
      };
      socket.emit("joined:role", confirmation);
      if (callback) callback(confirmation);
      console.log(`✅ [BACKEND] Sent confirmation to socket ${socket.id} for role: ${role.toLowerCase()}`);
      console.log(`🔵 [BACKEND] ========== join:role HANDLER COMPLETE ==========`);
    });
    console.log(`✅ [BACKEND] join:role handler registered for socket ${socket.id}`);

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
      console.log(`👤 Socket ${socket.id} joined room: ${room}`);
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
      console.log(`👋 Socket ${socket.id} left room: ${room}`);
    });

    // Join admin room
    socket.on("join:admin", () => {
      socket.join("admin");
      console.log(`👑 Socket ${socket.id} joined admin room`);
    });

    // Leave admin room
    socket.on("leave:admin", () => {
      socket.leave("admin");
      console.log(`👋 Socket ${socket.id} left admin room`);
    });

    // Join dashboard room (for admin dashboard updates)
    socket.on("join:dashboard", () => {
      socket.join("admin:dashboard");
      console.log(`📊 Socket ${socket.id} joined dashboard room`);
    });

    // Leave dashboard room
    socket.on("leave:dashboard", () => {
      socket.leave("admin:dashboard");
      console.log(`👋 Socket ${socket.id} left dashboard room`);
    });

    // Join counsellors room (for leaderboard updates - Image 1)
    socket.on("join:counsellors", () => {
      socket.join("counsellors");
      console.log(`👥 Socket ${socket.id} joined counsellors room`);
    });

    // Leave counsellors room
    socket.on("leave:counsellors", () => {
      socket.leave("counsellors");
      console.log(`👋 Socket ${socket.id} left counsellors room`);
    });

    // Leave role-based room
    socket.on("leave:role", (role: string) => {
      if (!role || typeof role !== "string") {
        console.error(`❌ Invalid role: ${role}`);
        return;
      }

      const room = `role:${role.toLowerCase()}`;
      socket.leave(room);
      console.log(`👋 Socket ${socket.id} left role room: ${room}`);
    });

    socket.on("disconnect", () => {
      console.log(`❌ Client disconnected: ${socket.id}`);
    });
  });

  console.log("🔌 WebSocket server initialized");
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
  console.log(`📤 Emitted '${event}' to room: ${room}`);
};

/**
 * Emit event to admin room
 */
export const emitToAdmin = (event: string, data: any) => {
  const io = getIO();
  io.to("admin").emit(event, data);
  console.log(`📤 Emitted '${event}' to admin room`);
};

/**
 * Emit event to all connected clients
 */
export const emitToAll = (event: string, data: any) => {
  const io = getIO();
  io.emit(event, data);
  console.log(`📤 Emitted '${event}' to all clients`);
};

/**
 * Emit dashboard update to admin dashboard room
 */
export const emitDashboardUpdate = (event: string, data: any) => {
  const io = getIO();
  io.to("admin:dashboard").emit(event, data);
  console.log(`📊 Emitted '${event}' to dashboard room`);
};

/**
 * Emit event to all counsellors room
 */
export const emitToCounsellors = (event: string, data: any) => {
  const io = getIO();
  io.to("counsellors").emit(event, data);
  console.log(`📤 Emitted '${event}' to counsellors room`);
};

/**
 * Emit event to specific role-based rooms
 */
export const emitToRoles = (roles: string[], event: string, data: any) => {
  const io = getIO();
  for (const role of roles) {
    const room = `role:${role.toLowerCase()}`;
    io.to(room).emit(event, data);
    console.log(`📤 Emitted '${event}' to role room: ${room}`);
  }
};

