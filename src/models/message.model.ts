import { db, pool } from "../config/databaseConnection";
import { messages, messageAcknowledgments } from "../schemas/message.schema";
import { users } from "../schemas/users.schema";
import {
  eq,
  and,
  or,
  sql,
  inArray,
  lte,
  desc,
  count,
  isNotNull,
} from "drizzle-orm";
import { Role } from "../types/role";

/* ================================
   TYPES
================================ */

export type MessageType = "broadcast" | "individual";
export type MessagePriority = "low" | "normal" | "high" | "urgent";
export type AcknowledgmentMethod = "button" | "timer" | "auto";

export interface CreateBroadcastMessageInput {
  title?: string;
  message: string;
  targetRoles: string[]; // ['manager', 'counsellor']
  priority?: MessagePriority;
}

export interface CreateIndividualMessageInput {
  title?: string;
  message: string;
  targetUserIds: number[]; // [5, 10, 15]
  priority?: MessagePriority;
}

export interface Message {
  id: number;
  message: string;
  title: string | null;
  senderId: number;
  messageType: MessageType;
  targetRoles: string[] | null;
  targetUserIds: number[] | null;
  priority: MessagePriority;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageAcknowledgment {
  id: number;
  messageId: number;
  userId: number;
  acknowledgedAt: Date;
  acknowledgmentMethod: AcknowledgmentMethod;
  createdAt: Date;
}

export interface AcknowledgmentStatus {
  messageId: number;
  messageType: MessageType;
  totalRecipients: number;
  acknowledged: number;
  pending: number;
  acknowledgments: Array<{
    userId: number;
    userName: string;
    userRole: Role;
    acknowledgedAt: Date;
    method: AcknowledgmentMethod;
  }>;
  pendingUsers: Array<{
    userId: number;
    userName: string;
    userRole: Role;
  }>;
}

/* ================================
   CREATE BROADCAST MESSAGE
================================ */

export const createBroadcastMessage = async (
  data: CreateBroadcastMessageInput,
  senderId: number
): Promise<Message> => {
  // Validation
  if (!data.message || data.message.trim().length < 10) {
    throw new Error("Message must be at least 10 characters");
  }

  if (data.message.length > 5000) {
    throw new Error("Message must not exceed 5000 characters");
  }

  if (!data.targetRoles || data.targetRoles.length === 0) {
    throw new Error("Target roles are required for broadcast messages");
  }

  // Validate roles
  const validRoles = ["manager", "counsellor"];
  const invalidRoles = data.targetRoles.filter(
    (role) => !validRoles.includes(role)
  );
  if (invalidRoles.length > 0) {
    throw new Error(`Invalid roles: ${invalidRoles.join(", ")}`);
  }

  // Validate priority
  const priority = data.priority || "normal";
  const validPriorities: MessagePriority[] = ["low", "normal", "high", "urgent"];
  if (!validPriorities.includes(priority)) {
    throw new Error("Invalid priority");
  }

  // Validate title
  if (data.title && data.title.length > 255) {
    throw new Error("Title must not exceed 255 characters");
  }

  // Insert message
  const [newMessage] = await db
    .insert(messages)
    .values({
      message: data.message.trim(),
      title: data.title?.trim() || null,
      senderId,
      messageType: "broadcast",
      targetRoles: data.targetRoles,
      targetUserIds: [],
      priority,
      isActive: true,
      updatedAt: new Date(),
    })
    .returning();

  return newMessage as Message;
};

/* ================================
   CREATE INDIVIDUAL MESSAGE
================================ */

export const createIndividualMessage = async (
  data: CreateIndividualMessageInput,
  senderId: number
): Promise<Message> => {
  // Validation
  if (!data.message || data.message.trim().length < 10) {
    throw new Error("Message must be at least 10 characters");
  }

  if (data.message.length > 5000) {
    throw new Error("Message must not exceed 5000 characters");
  }

  if (!data.targetUserIds || data.targetUserIds.length === 0) {
    throw new Error("Target user IDs are required for individual messages");
  }

  // Validate user IDs are numbers
  const invalidIds = data.targetUserIds.filter(
    (id) => !Number.isInteger(id) || id <= 0
  );
  if (invalidIds.length > 0) {
    throw new Error(`Invalid user IDs: ${invalidIds.join(", ")}`);
  }

  // Validate users exist and are managers/counsellors
  const targetUsers = await db
    .select({
      id: users.id,
      role: users.role,
    })
    .from(users)
    .where(
      and(
        inArray(users.id, data.targetUserIds),
        or(eq(users.role, "manager"), eq(users.role, "counsellor"))
      )
    );

  const foundUserIds = targetUsers.map((u) => u.id);
  const missingUserIds = data.targetUserIds.filter(
    (id) => !foundUserIds.includes(id)
  );

  if (missingUserIds.length > 0) {
    throw new Error(
      `Users not found or invalid role: ${missingUserIds.join(", ")}`
    );
  }

  // Validate priority
  const priority = data.priority || "normal";
  const validPriorities: MessagePriority[] = ["low", "normal", "high", "urgent"];
  if (!validPriorities.includes(priority)) {
    throw new Error("Invalid priority");
  }

  // Validate title
  if (data.title && data.title.length > 255) {
    throw new Error("Title must not exceed 255 characters");
  }

  // Insert message
  const [newMessage] = await db
    .insert(messages)
    .values({
      message: data.message.trim(),
      title: data.title?.trim() || null,
      senderId,
      messageType: "individual",
      targetRoles: [],
      targetUserIds: data.targetUserIds,
      priority,
      isActive: true,
      updatedAt: new Date(),
    })
    .returning();

  return newMessage as Message;
};

/* ================================
   GET MESSAGE BY ID
================================ */

export const getMessageById = async (
  messageId: number
): Promise<Message | null> => {
  const [message] = await db
    .select()
    .from(messages)
    .where(eq(messages.id, messageId))
    .limit(1);

  return (message as Message) || null;
};

/* ================================
   GET ALL MESSAGES (ADMIN)
================================ */

export const getAllMessages = async (options?: {
  type?: MessageType | "all";
  active?: boolean;
  page?: number;
  limit?: number;
}): Promise<{
  messages: Message[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> => {
  const page = options?.page || 1;
  const limit = options?.limit || 20;
  const offset = (page - 1) * limit;

  // Build where conditions
  const conditions = [];

  if (options?.type && options.type !== "all") {
    conditions.push(eq(messages.messageType, options.type));
  }

  if (options?.active !== undefined) {
    conditions.push(eq(messages.isActive, options.active));
  }

  const whereClause =
    conditions.length > 0 ? and(...conditions) : undefined;

  // Get messages
  const messagesList = await db
    .select()
    .from(messages)
    .where(whereClause)
    .orderBy(desc(messages.createdAt))
    .limit(limit)
    .offset(offset);

  // Get total count
  const [{ total }] = await db
    .select({ total: count() })
    .from(messages)
    .where(whereClause);

  return {
    messages: messagesList as Message[],
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
};

/* ================================
   GET UNACKNOWLEDGED MESSAGES FOR USER
================================ */

export const getUnacknowledgedMessagesForUser = async (
  userId: number,
  userRole: Role
): Promise<Message[]> => {
  // Get user's role to filter broadcast messages
  if (userRole !== "manager" && userRole !== "counsellor") {
    return [];
  }

  // Get unacknowledged messages
  // For broadcast: user's role must be in target_roles
  // For individual: user's ID must be in target_user_ids
  const unacknowledgedMessages = await db
    .select({
      id: messages.id,
      message: messages.message,
      title: messages.title,
      senderId: messages.senderId,
      messageType: messages.messageType,
      targetRoles: messages.targetRoles,
      targetUserIds: messages.targetUserIds,
      priority: messages.priority,
      isActive: messages.isActive,
      createdAt: messages.createdAt,
      updatedAt: messages.updatedAt,
    })
    .from(messages)
    .where(
      and(
        eq(messages.isActive, true),
        or(
          // Broadcast messages: user's role is in target_roles
          sql`${messages.messageType} = 'broadcast' AND ${sql.raw(`'${userRole}'`)} = ANY(${messages.targetRoles}::text[])`,
          // Individual messages: user's ID is in target_user_ids
          sql`${messages.messageType} = 'individual' AND ${userId} = ANY(${messages.targetUserIds}::integer[])`
        ),
        // Not acknowledged
        sql`NOT EXISTS (
          SELECT 1
          FROM ${messageAcknowledgments} ma
          WHERE ma.message_id = ${messages.id}
            AND ma.user_id = ${userId}
        )`
      )
    )
    .orderBy(desc(messages.createdAt));

  return unacknowledgedMessages as Message[];
};

/* ================================
   GET ALL MESSAGES FOR USER (INBOX)
================================ */

export interface InboxMessage extends Message {
  isAcknowledged: boolean;
  acknowledgedAt?: Date;
}

export const getAllMessagesForUser = async (
  userId: number,
  userRole: Role
): Promise<InboxMessage[]> => {
  // Get user's role to filter broadcast messages
  if (userRole !== "manager" && userRole !== "counsellor") {
    return [];
  }

  // Get ALL messages (both acknowledged and unacknowledged)
  // For broadcast: user's role must be in target_roles
  const allMessages = await db
    .select({
      id: messages.id,
      message: messages.message,
      title: messages.title,
      senderId: messages.senderId,
      messageType: messages.messageType,
      targetRoles: messages.targetRoles,
      targetUserIds: messages.targetUserIds,
      priority: messages.priority,
      isActive: messages.isActive,
      createdAt: messages.createdAt,
      updatedAt: messages.updatedAt,
    })
    .from(messages)
    .where(
      and(
        eq(messages.isActive, true),
        // Only broadcast messages (individual removed)
        sql`${messages.messageType} = 'broadcast' AND ${sql.raw(`'${userRole}'`)} = ANY(${messages.targetRoles}::text[])`
      )
    )
    .orderBy(desc(messages.createdAt));

  // Get all acknowledgments for this user
  const userAcknowledgments = await db
    .select({
      messageId: messageAcknowledgments.messageId,
      acknowledgedAt: messageAcknowledgments.acknowledgedAt,
    })
    .from(messageAcknowledgments)
    .where(eq(messageAcknowledgments.userId, userId));

  // Create a map of messageId -> acknowledgment
  const acknowledgmentMap = new Map(
    userAcknowledgments.map((ack) => [ack.messageId, ack.acknowledgedAt])
  );

  // Combine messages with acknowledgment status
  const inboxMessages: InboxMessage[] = allMessages.map((msg) => {
    const acknowledgedAt = acknowledgmentMap.get(msg.id);
    return {
      ...msg,
      isAcknowledged: acknowledgedAt !== undefined,
      acknowledgedAt: acknowledgedAt || undefined,
    } as InboxMessage;
  });

  return inboxMessages;
};

/* ================================
   ACKNOWLEDGE MESSAGE
================================ */

export const acknowledgeMessage = async (
  messageId: number,
  userId: number,
  method: AcknowledgmentMethod = "button"
): Promise<MessageAcknowledgment> => {
  // Check if message exists and is active
  const message = await getMessageById(messageId);
  if (!message) {
    throw new Error("Message not found");
  }

  if (!message.isActive) {
    throw new Error("Message is not active");
  }

  // Check if already acknowledged
  const existingAck = await db
    .select()
    .from(messageAcknowledgments)
    .where(
      and(
        eq(messageAcknowledgments.messageId, messageId),
        eq(messageAcknowledgments.userId, userId)
      )
    )
    .limit(1);

  if (existingAck.length > 0) {
    throw new Error("Message already acknowledged");
  }

  // Insert acknowledgment
  const [acknowledgment] = await db
    .insert(messageAcknowledgments)
    .values({
      messageId,
      userId,
      acknowledgmentMethod: method,
      acknowledgedAt: new Date(),
    })
    .returning();

  return acknowledgment as MessageAcknowledgment;
};

/* ================================
   GET MESSAGE ACKNOWLEDGMENT STATUS
================================ */

export const getMessageAcknowledgmentStatus = async (
  messageId: number
): Promise<AcknowledgmentStatus> => {
  const message = await getMessageById(messageId);
  if (!message) {
    throw new Error("Message not found");
  }

  if (message.messageType === "broadcast") {
    // Get all users with target roles
    const targetUsers = await db
      .select({
        id: users.id,
        fullName: users.fullName,
        role: users.role,
      })
      .from(users)
      .where(
        sql`${users.role} = ANY(${sql.raw(`ARRAY[${message.targetRoles?.map(r => `'${r}'`).join(',') || ''}]::text[]`)})`
      );

    // Get acknowledgments
    const acknowledgments = await db
      .select({
        userId: messageAcknowledgments.userId,
        acknowledgedAt: messageAcknowledgments.acknowledgedAt,
        method: messageAcknowledgments.acknowledgmentMethod,
        userName: users.fullName,
        userRole: users.role,
      })
      .from(messageAcknowledgments)
      .innerJoin(users, eq(messageAcknowledgments.userId, users.id))
      .where(eq(messageAcknowledgments.messageId, messageId));

    const acknowledgedUserIds = acknowledgments.map((a) => a.userId);
    const pendingUsers = targetUsers.filter(
      (u) => !acknowledgedUserIds.includes(u.id)
    );

    return {
      messageId,
      messageType: "broadcast",
      totalRecipients: targetUsers.length,
      acknowledged: acknowledgments.length,
      pending: pendingUsers.length,
      acknowledgments: acknowledgments.map((a) => ({
        userId: a.userId,
        userName: a.userName,
        userRole: a.userRole as Role,
        acknowledgedAt: a.acknowledgedAt,
        method: a.method as AcknowledgmentMethod,
      })),
      pendingUsers: pendingUsers.map((u) => ({
        userId: u.id,
        userName: u.fullName,
        userRole: u.role as Role,
      })),
    };
  } else {
    // Individual message
    const targetUserIds = message.targetUserIds || [];

    if (targetUserIds.length === 0) {
      return {
        messageId,
        messageType: "individual",
        totalRecipients: 0,
        acknowledged: 0,
        pending: 0,
        acknowledgments: [],
        pendingUsers: [],
      };
    }

    // Get target users
    const targetUsers = await db
      .select({
        id: users.id,
        fullName: users.fullName,
        role: users.role,
      })
      .from(users)
      .where(inArray(users.id, targetUserIds));

    // Get acknowledgments
    const acknowledgments = await db
      .select({
        userId: messageAcknowledgments.userId,
        acknowledgedAt: messageAcknowledgments.acknowledgedAt,
        method: messageAcknowledgments.acknowledgmentMethod,
        userName: users.fullName,
        userRole: users.role,
      })
      .from(messageAcknowledgments)
      .innerJoin(users, eq(messageAcknowledgments.userId, users.id))
      .where(eq(messageAcknowledgments.messageId, messageId));

    const acknowledgedUserIds = acknowledgments.map((a) => a.userId);
    const pendingUsers = targetUsers.filter(
      (u) => !acknowledgedUserIds.includes(u.id)
    );

    return {
      messageId,
      messageType: "individual",
      totalRecipients: targetUserIds.length,
      acknowledged: acknowledgments.length,
      pending: pendingUsers.length,
      acknowledgments: acknowledgments.map((a) => ({
        userId: a.userId,
        userName: a.userName,
        userRole: a.userRole as Role,
        acknowledgedAt: a.acknowledgedAt,
        method: a.method as AcknowledgmentMethod,
      })),
      pendingUsers: pendingUsers.map((u) => ({
        userId: u.id,
        userName: u.fullName,
        userRole: u.role as Role,
      })),
    };
  }
};

/* ================================
   DEACTIVATE MESSAGE
================================ */

export const deactivateMessage = async (
  messageId: number
): Promise<Message> => {
  const [updatedMessage] = await db
    .update(messages)
    .set({
      isActive: false,
      updatedAt: new Date(),
    })
    .where(eq(messages.id, messageId))
    .returning();

  if (!updatedMessage) {
    throw new Error("Message not found");
  }

  return updatedMessage as Message;
};

/* ================================
   GET USERS FOR INDIVIDUAL MESSAGE
================================ */

export const getUsersForIndividualMessage = async (options?: {
  role?: Role | "all";
  search?: string;
}): Promise<
  Array<{
    id: number;
    fullName: string;
    email: string;
    role: Role;
    designation: string | null;
  }>
> => {
  const conditions = [];

  // Role filter
  if (options?.role && options.role !== "all") {
    if (options.role === "manager" || options.role === "counsellor") {
      conditions.push(eq(users.role, options.role));
    }
  } else {
    // Default: only managers and counsellors
    conditions.push(
      or(eq(users.role, "manager"), eq(users.role, "counsellor"))
    );
  }

  // Search filter
  if (options?.search) {
    const searchTerm = `%${options.search.toLowerCase()}%`;
    conditions.push(
      or(
        sql`LOWER(${users.fullName}) LIKE ${searchTerm}`,
        sql`LOWER(${users.email}) LIKE ${searchTerm}`
      )
    );
  }

  const whereClause =
    conditions.length > 0 ? and(...conditions) : undefined;

  const usersList = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      role: users.role,
      designation: users.designation,
    })
    .from(users)
    .where(whereClause)
    .orderBy(users.fullName);

  return usersList.map((u) => ({
    id: u.id,
    fullName: u.fullName,
    email: u.email,
    role: u.role as Role,
    designation: u.designation,
  }));
};

/* ================================
   DELETE OLD MESSAGES (AUTO CLEANUP)
================================ */

export const deleteOldMessages = async (
  retentionPeriodMs: number,
  isDebugMode: boolean = false
): Promise<{ deletedCount: number; deletedMessageIds: number[] }> => {
  // Convert retention period from milliseconds to seconds for PostgreSQL INTERVAL
  const retentionSeconds = retentionPeriodMs / 1000;

  // Simple logger - only debug in development/testing
  const isProduction = process.env.NODE_ENV === "production";
  const logDebug = (...args: any[]) => {
    if (!isProduction && isDebugMode) {
      console.log(...args);
    }
  };

  // Debug: Get current database time for logging (only in debug mode)
  let dbNow: Date | null = null;
  if (isDebugMode) {
    try {
      const result = await pool.query<{ now: Date }>("SELECT NOW() as now");
      const row = result.rows[0];
      if (row?.now) {
        dbNow = row.now instanceof Date ? row.now : new Date(row.now);
      }
    } catch (error) {
      logDebug(`🔍 [CLEANUP DEBUG] Could not get database time: ${error}`);
    }
  }

  // Debug logs (only in development/testing mode)
  if (isDebugMode && dbNow) {
    logDebug(`🔍 [CLEANUP DEBUG] Database current time: ${dbNow.toISOString()}`);
    logDebug(`🔍 [CLEANUP DEBUG] Retention period: ${retentionPeriodMs}ms (${retentionSeconds} seconds)`);

    // Get all messages for debugging (only in debug mode)
    const allMessages = await db
      .select({
        id: messages.id,
        createdAt: messages.createdAt,
      })
      .from(messages);

    logDebug(`🔍 [CLEANUP DEBUG] Total messages in database: ${allMessages.length}`);

    // Log each message's age (only in debug mode)
    allMessages.forEach((msg) => {
      const messageDate = new Date(msg.createdAt);
      const ageMs = dbNow!.getTime() - messageDate.getTime();
      const ageSeconds = ageMs / 1000;
      const isOldEnough = ageSeconds > retentionSeconds;
      logDebug(`🔍 [CLEANUP DEBUG] Message ID ${msg.id}: created=${messageDate.toISOString()}, age=${ageSeconds.toFixed(2)}s, willDelete=${isOldEnough}`);
    });
  }

  try {
    // Find messages to delete using database NOW() for accurate comparison
    const messagesToDelete = await db
      .select({
        id: messages.id,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(sql`${messages.createdAt} <= NOW() - INTERVAL ${sql.raw(`'${retentionSeconds} seconds'`)}`);

    if (isDebugMode) {
      logDebug(`🔍 [CLEANUP DEBUG] Messages found to delete: ${messagesToDelete.length}`);
    }

    if (messagesToDelete.length === 0) {
      return { deletedCount: 0, deletedMessageIds: [] };
    }

    const messageIds = messagesToDelete.map((msg) => msg.id);

    // Delete messages (cascade will handle acknowledgments)
    await db.delete(messages).where(inArray(messages.id, messageIds));

    return {
      deletedCount: messageIds.length,
      deletedMessageIds: messageIds,
    };
  } catch (error: any) {
    // When DB is unreachable, avoid spamming full stack every interval
    const msg = error?.message ?? String(error);
    const isDbError = /Failed query|ECONNREFUSED|connection|timeout/i.test(msg);
    if (isDbError && !isDebugMode) {
      console.warn("⚠️ Message cleanup skipped (database unavailable).");
    } else {
      throw error;
    }
    return { deletedCount: 0, deletedMessageIds: [] };
  }
};