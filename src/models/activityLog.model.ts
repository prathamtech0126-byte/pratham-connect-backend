import { db } from "../config/databaseConnection";
import { activityLog } from "../schemas/activityLog.schema";
import { users } from "../schemas/users.schema";
import { clientInformation } from "../schemas/clientInformation.schema";
import { eq, and, or, desc, sql, gte, lte, isNotNull } from "drizzle-orm";
import { Role } from "../types/role";

/** Humanize product enum for display (e.g. ALL_FINANCE_EMPLOYEMENT -> All Finance Employment) */
const humanizeProductName = (value: string | null | undefined): string | null => {
  if (value == null || value === "") return null;
  return value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
};

/** Derive product name and display label from log row for frontend */
const getProductFromLogRow = (row: {
  metadata?: unknown;
  newValue?: unknown;
  oldValue?: unknown;
}): { productName: string | null; productLabel: string | null } => {
  const meta = row.metadata as { productName?: string } | null | undefined;
  const nv = row.newValue as { productName?: string } | null | undefined;
  const ov = row.oldValue as { productName?: string } | null | undefined;
  const raw = meta?.productName ?? nv?.productName ?? ov?.productName ?? null;
  return {
    productName: raw ?? null,
    productLabel: raw ? humanizeProductName(raw) : null,
  };
};

/**
 * Sanitize value for JSON response: recursively remove null/undefined so frontend gets clean objects.
 * Keeps primitives, arrays (sanitize elements), and plain objects (omit null/undefined keys).
 */
const sanitizeValueForJson = (value: unknown): unknown => {
  if (value === null || value === undefined) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeValueForJson);
  }
  if (typeof value === "object" && value !== null && !(value instanceof Date)) {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      // Keep null so oldValue/newValue have same keys for frontend (e.g. paymentDate, remarks, invoiceNo)
      if (v !== undefined) {
        out[k] = sanitizeValueForJson(v);
      }
    }
    return out;
  }
  return value;
};

interface GetActivityLogsFilters {
  userId?: number;
  userRole?: Role;
  clientId?: number;
  action?: string;
  entityType?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

/**
 * Get activity logs with role-based filtering
 */
export const getActivityLogs = async (filters: GetActivityLogsFilters) => {
  const {
    userId,
    userRole,
    clientId,
    action,
    entityType,
    startDate,
    endDate,
    limit = 50,
    offset = 0,
  } = filters;

  let query = db
    .select({
      logId: activityLog.logId,
      entityType: activityLog.entityType,
      entityId: activityLog.entityId,
      clientId: activityLog.clientId,
      action: activityLog.action,
      oldValue: activityLog.oldValue,
      newValue: activityLog.newValue,
      description: activityLog.description,
      metadata: activityLog.metadata,
      performedBy: activityLog.performedBy,
      ipAddress: activityLog.ipAddress,
      userAgent: activityLog.userAgent,
      createdAt: activityLog.createdAt,
      // Performer info
      performerName: users.fullName,
      performerEmail: users.email,
      performerRole: users.role,
      // Client info (if applicable)
      clientName: clientInformation.fullName,
    })
    .from(activityLog)
    .leftJoin(users, eq(activityLog.performedBy, users.id))
    .leftJoin(
      clientInformation,
      eq(activityLog.clientId, clientInformation.clientId)
    );

  const conditions: any[] = [];

  // Role-based filtering
  if (userRole === "admin") {
    // Admin sees all logs - no filter needed
  } else if (userRole === "manager") {
    // Manager sees only counsellor activities
    conditions.push(eq(users.role, "counsellor"));
  } else if (userRole === "counsellor" && userId) {
    // Counsellor sees:
    // 1. Their own activities
    // 2. Manager activities on their clients
    conditions.push(
      or(
        eq(activityLog.performedBy, userId),
        and(
          isNotNull(activityLog.clientId),
          eq(clientInformation.counsellorId, userId),
          eq(users.role, "manager")
        )
      )
    );
  }

  // Additional filters
  if (clientId) {
    conditions.push(eq(activityLog.clientId, clientId));
  }

  if (action) {
    conditions.push(eq(activityLog.action, action as any));
  }

  if (entityType) {
    conditions.push(eq(activityLog.entityType, entityType));
  }

  if (startDate) {
    conditions.push(gte(activityLog.createdAt, startDate));
  }

  if (endDate) {
    conditions.push(lte(activityLog.createdAt, endDate));
  }

  // Apply all conditions
  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as any;
  }

  // Order by newest first
  query = query.orderBy(desc(activityLog.createdAt)) as any;

  // Pagination
  query = query.limit(limit).offset(offset) as any;

  const rows = await query;

  // Normalize response: add productName/productLabel, sanitize oldValue/newValue/metadata for proper JSON
  return rows.map((row) => {
    const { productName, productLabel } = getProductFromLogRow(row);
    return {
      ...row,
      productName,
      productLabel,
      oldValue: row.oldValue != null ? sanitizeValueForJson(row.oldValue) : null,
      newValue: row.newValue != null ? sanitizeValueForJson(row.newValue) : null,
      metadata: row.metadata != null ? sanitizeValueForJson(row.metadata) : null,
    };
  });
};

/**
 * Get total count of activity logs (for pagination)
 */
export const getActivityLogsCount = async (filters: GetActivityLogsFilters) => {
  const { userId, userRole, clientId, action, entityType, startDate, endDate } =
    filters;

  let query = db
    .select({ count: sql<number>`count(*)` })
    .from(activityLog)
    .leftJoin(users, eq(activityLog.performedBy, users.id))
    .leftJoin(
      clientInformation,
      eq(activityLog.clientId, clientInformation.clientId)
    );

  const conditions: any[] = [];

  // Role-based filtering (same as getActivityLogs)
  if (userRole === "admin") {
    // Admin sees all logs
  } else if (userRole === "manager") {
    conditions.push(eq(users.role, "counsellor"));
  } else if (userRole === "counsellor" && userId) {
    conditions.push(
      or(
        eq(activityLog.performedBy, userId),
        and(
          isNotNull(activityLog.clientId),
          eq(clientInformation.counsellorId, userId),
          eq(users.role, "manager")
        )
      )
    );
  }

  // Additional filters
  if (clientId) {
    conditions.push(eq(activityLog.clientId, clientId));
  }

  if (action) {
    conditions.push(eq(activityLog.action, action as any));
  }

  if (entityType) {
    conditions.push(eq(activityLog.entityType, entityType));
  }

  if (startDate) {
    conditions.push(gte(activityLog.createdAt, startDate));
  }

  if (endDate) {
    conditions.push(lte(activityLog.createdAt, endDate));
  }

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as any;
  }

  const result = await query;
  return result[0]?.count || 0;
};
