import { getIO } from "../config/socket";
import {
  createBroadcastMessage,
  getMessageById,
  Message,
} from "../models/message.model";
import { db } from "../config/databaseConnection";
import { users } from "../schemas/users.schema";
import { eq, and, inArray } from "drizzle-orm";

/* ================================
   SEND BROADCAST MESSAGE
================================ */

export const sendBroadcastMessage = async (
  data: {
    title?: string;
    message: string;
    targetRoles: string[];
    priority?: "low" | "normal" | "high" | "urgent";
  },
  senderId: number,
  senderName: string
): Promise<Message> => {
  // Create message in database
  const message = await createBroadcastMessage(data, senderId);

  // Get sender info
  const sender = {
    id: senderId,
    name: senderName,
    role: "admin" as const,
  };

  // Prepare message data for WebSocket
  const messageData = {
    id: message.id,
    type: "broadcast" as const,
    title: message.title,
    message: message.message,
    priority: message.priority,
    createdAt: message.createdAt.toISOString(),
    sender,
    targetRoles: message.targetRoles || [],
  };

  // Emit to role-based rooms
  const io = getIO();

  // Emit to each target role room (lowercase to match join:role handler)
  for (const role of data.targetRoles) {
    const room = `role:${role.toLowerCase()}`;
    const socketsInRoom = io.sockets.adapter.rooms.get(room);
    const socketCount = socketsInRoom ? socketsInRoom.size : 0;
    io.to(room).emit("broadcast:message", messageData);
    console.log(
      `📤 Emitted broadcast message ${message.id} to room: ${room} (${socketCount} socket(s) in room)`
    );
  }

  // Also emit to combined room if multiple roles (lowercase to match join:role handler)
  if (data.targetRoles.length > 1) {
    const combinedRoom = `role:${data.targetRoles.map(r => r.toLowerCase()).join(",")}`;
    const socketsInRoom = io.sockets.adapter.rooms.get(combinedRoom);
    const socketCount = socketsInRoom ? socketsInRoom.size : 0;
    io.to(combinedRoom).emit("broadcast:message", messageData);
    console.log(
      `📤 Emitted broadcast message ${message.id} to combined room: ${combinedRoom} (${socketCount} socket(s) in room)`
    );
  }

  return message;
};

/* ================================
   GET TARGET USERS BY ROLES
================================ */

export const getTargetUsersByRoles = async (
  roles: string[]
): Promise<Array<{ id: number; fullName: string; email: string; role: string }>> => {
  const targetUsers = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      role: users.role,
    })
    .from(users)
    .where(inArray(users.role, roles));

  return targetUsers.map((u) => ({
    id: u.id,
    fullName: u.fullName,
    email: u.email,
    role: u.role,
  }));
};

/* ================================
   EMIT MESSAGE ACKNOWLEDGMENT
================================ */

export const emitMessageAcknowledged = (
  messageId: number,
  userId: number,
  acknowledgedAt: Date
) => {
  const io = getIO();
  // Emit to admin room for instant acknowledgment updates
  io.to("admin").emit("message:acknowledged", {
    messageId,
    userId,
    acknowledgedAt: acknowledgedAt.toISOString(),
  });
  console.log(
    `📤 Emitted message acknowledgment: message ${messageId} by user ${userId} to admin room`
  );
};
