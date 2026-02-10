import { Request } from "express";
import { db } from "../config/databaseConnection";
import { activityLog } from "../schemas/activityLog.schema";

/**
 * Activity Log Service
 * Handles creating activity logs for all user actions
 */

interface CreateActivityLogInput {
  entityType: string;
  entityId?: number | null;
  clientId?: number | null;
  action: "CREATE" | "UPDATE" | "DELETE" | "STATUS_CHANGE" | "PAYMENT_ADDED" | "PAYMENT_UPDATED" | "PAYMENT_DELETED" | "PRODUCT_ADDED" | "PRODUCT_UPDATED" | "PRODUCT_DELETED" | "ARCHIVE" | "UNARCHIVE" | "LOGIN" | "LOGOUT";
  oldValue?: any;
  newValue?: any;
  description?: string;
  metadata?: any;
  performedBy: number;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Create an activity log entry
 * This function should never throw errors - it should fail silently
 * to avoid breaking the main operation
 */
export const createActivityLog = async (input: CreateActivityLogInput): Promise<void> => {
  try {
    await db.insert(activityLog).values({
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      clientId: input.clientId ?? null,
      action: input.action,
      oldValue: input.oldValue ?? null, // jsonb stores objects directly
      newValue: input.newValue ?? null, // jsonb stores objects directly
      description: input.description ?? null,
      metadata: input.metadata ?? null, // jsonb stores objects directly
      performedBy: input.performedBy,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    });
  } catch (error) {
    // Fail silently - don't break the main operation
    console.error("Failed to create activity log:", error);
  }
};

/**
 * Extract IP address from request
 */
export const getIpAddress = (req: Request): string | undefined => {
  return (
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    (req.headers["x-real-ip"] as string) ||
    req.socket.remoteAddress ||
    req.ip
  );
};

/**
 * Extract user agent from request
 */
export const getUserAgent = (req: Request): string | undefined => {
  return req.headers["user-agent"];
};

/**
 * Helper to create activity log from Express request
 */
export const logActivity = async (
  req: Request,
  options: {
    entityType: string;
    entityId?: number | null;
    clientId?: number | null;
    action: CreateActivityLogInput["action"];
    oldValue?: any;
    newValue?: any;
    description?: string;
    metadata?: any;
    performedBy: number;
  }
): Promise<void> => {
  await createActivityLog({
    ...options,
    ipAddress: getIpAddress(req),
    userAgent: getUserAgent(req),
  });
};
