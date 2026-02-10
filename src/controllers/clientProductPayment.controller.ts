import { Request, Response } from "express";
import {
  saveClientProductPayment,
  getProductPaymentsByClientId,
  getEntityDisplayDataForActivityLog,
  EntityDisplayData,
  ProductType,
} from "../models/clientProductPayments.model";
import { getClientFullDetailsById, getClientsByCounsellor, getAllClientsForAdmin } from "../models/client.model";
import { emitToCounsellor, emitToAdmin, emitDashboardUpdate, emitToRoles } from "../config/socket";
import { getDashboardStats } from "../models/dashboard.model";
import { db } from "../config/databaseConnection";
import { clientInformation } from "../schemas/clientInformation.schema";
import { clientProductPayments } from "../schemas/clientProductPayments.schema";
import { users } from "../schemas/users.schema";
import { eq, and } from "drizzle-orm";
import { logActivity } from "../services/activityLog.service";
import { createIndividualMessage } from "../models/message.model";
import { parseFrontendDate } from "../utils/date";
import { redisDel, redisDelByPrefix, redisGetJson, redisSetJson } from "../config/redis";

const CLIENT_PRODUCT_PAYMENTS_CACHE_TTL_SECONDS = 45;

/** Normalize product payment for activity log: consistent types (numbers, YYYY-MM-DD date) so oldValue/newValue are correct */
function normalizeProductPaymentForActivityLog(record: any): Record<string, unknown> | null {
  if (!record) return null;
  const dateVal = record.paymentDate ?? record.date ?? record.payment_date;
  const dateStr =
    dateVal instanceof Date
      ? dateVal.toISOString().split("T")[0]
      : dateVal != null && typeof dateVal === "string"
      ? dateVal.split("T")[0]
      : null;
  const pid = record.productPaymentId ?? record.id;
  const cid = record.clientId ?? record.client_id;
  const eid = record.entityId ?? record.entity_id;
  const openingDateVal = record.openingDate ?? record.opening_date;
  const fundingDateVal = record.fundingDate ?? record.funding_date;
  const toDateStr = (v: any) =>
    v instanceof Date ? v.toISOString().split("T")[0] : v != null && typeof v === "string" ? v.split("T")[0] : null;
  return {
    productPaymentId: pid != null ? Number(pid) : undefined,
    clientId: cid != null ? Number(cid) : undefined,
    productName: record.productName ?? record.product_name ?? null,
    entityType: record.entityType ?? record.entity_type ?? null,
    entityId: eid != null ? Number(eid) : null,
    amount: record.amount != null && record.amount !== "" ? String(record.amount) : null,
    paymentDate: dateStr,
    invoiceNo: record.invoiceNo ?? record.invoice_no ?? null,
    remarks: record.remarks ?? record.remark ?? null,
    createdAt: record.createdAt ?? record.created_at ?? null,
    ...(openingDateVal != null ? { openingDate: toDateStr(openingDateVal) ?? openingDateVal } : {}),
    ...(fundingDateVal != null ? { fundingDate: toDateStr(fundingDateVal) ?? fundingDateVal } : {}),
  };
}

// export const createClientProductPaymentController = async (
//   req: Request,
//   res: Response
// ) => {
//   try {
//     const body = req.body || {};

//     // Validate required fields
//     if (!body.clientId) {
//       return res.status(400).json({
//         success: false,
//         message: "clientId is required",
//       });
//     }

//     if (!body.productName) {
//       return res.status(400).json({
//         success: false,
//         message: "productName is required",
//       });
//     }

//     if (!body.amount) {
//       return res.status(400).json({
//         success: false,
//         message: "amount is required",
//       });
//     }

//     // Normalize and validate input
//     const payload = {
//       clientId: Number(body.clientId),
//       productName: body.productName as ProductType,
//       amount: body.amount,
//       paymentDate: body.paymentDate || body.payment_date,
//       remarks: body.remarks || body.remark,
//       entityData: body.entityData || body.entity_data,
//     };

//     // Validate clientId is a valid number
//     if (!Number.isFinite(payload.clientId) || payload.clientId <= 0) {
//       return res.status(400).json({
//         success: false,
//         message: "clientId must be a valid positive number",
//       });
//     }

//     const record = await createClientProductPayment(payload);

//     res.status(201).json({
//       success: true,
//       data: record,
//     });
//   } catch (error: any) {
//     res.status(400).json({
//       success: false,
//       message: error.message || "Failed to create product payment",
//     });
//   }
// };


export const saveClientProductPaymentController = async (
  req: Request,
  res: Response
) => {
  try {
    // Fetch old value if updating (before save)
    let oldValue: Record<string, unknown> | null = null;
    let oldEntityDisplay: EntityDisplayData = {};
    if (req.body.productPaymentId) {
      try {
        const productPaymentId = Number(req.body.productPaymentId);
        const [oldProductPayment] = await db
          .select()
          .from(clientProductPayments)
          .where(eq(clientProductPayments.productPaymentId, productPaymentId));
        if (oldProductPayment) {
          oldValue = normalizeProductPaymentForActivityLog(oldProductPayment);
          // Fetch entity data BEFORE save so we capture true previous state (amount, remarks, etc.)
          if (oldProductPayment.entityId && oldProductPayment.entityType) {
            oldEntityDisplay = await getEntityDisplayDataForActivityLog(
              oldProductPayment.entityType as any,
              oldProductPayment.entityId
            );
          }
        }
      } catch (error) {
        console.error("Error fetching old product payment value:", error);
      }
    }

    console.log("req.body client product payment", req.body);
    const result = await saveClientProductPayment(req.body);

    const clientId = Number(result.record.clientId);

    // Get counsellorId from clientId
    const [client] = await db
      .select({ counsellorId: clientInformation.counsellorId })
      .from(clientInformation)
      .where(eq(clientInformation.clientId, clientId));

    if (!client) {
      return res.status(404).json({
        success: false,
        message: "Client not found",
      });
    }

    const counsellorId = client.counsellorId;

    // Check if this is a partial payment that needs approval
    const isPartialPayment =
      result.record.productName === "ALL_FINANCE_EMPLOYEMENT" &&
      result.action === "CREATED" &&
      req.body.entityData?.partialPayment === true;

    // Send notifications for partial payment approval
    if (isPartialPayment && req.user?.id) {
      try {
        // Get counsellor info to find manager
        const [counsellor] = await db
          .select({
            id: users.id,
            fullName: users.fullName,
            managerId: users.managerId,
          })
          .from(users)
          .where(eq(users.id, counsellorId))
          .limit(1);

        // Get all super admins
        const superAdmins = await db
          .select({
            id: users.id,
            fullName: users.fullName,
          })
          .from(users)
          .where(eq(users.role, "admin"));

        // Collect target user IDs: manager + super admins
        const targetUserIds: number[] = [];

        if (counsellor?.managerId) {
          targetUserIds.push(counsellor.managerId);
        }

        superAdmins.forEach(admin => {
          if (!targetUserIds.includes(admin.id)) {
            targetUserIds.push(admin.id);
          }
        });

        if (targetUserIds.length > 0) {
          // Get client info for notification message
          const [clientInfo] = await db
            .select({
              fullName: clientInformation.fullName,
            })
            .from(clientInformation)
            .where(eq(clientInformation.clientId, clientId))
            .limit(1);

          const amount = req.body.entityData?.amount || req.body.amount || "0";
          const counsellorName = counsellor?.fullName || "Unknown";
          const clientName = clientInfo?.fullName || "Unknown";

          // Create database notification
          await createIndividualMessage(
            {
              title: "Partial Payment Approval Required",
              message: `${counsellorName} has created a partial payment of $${amount} for client ${clientName}. Please review and approve.`,
              targetUserIds: targetUserIds,
              priority: "high",
            },
            req.user.id
          );

          // Send Socket.io notification to managers and admins
          const notificationData = {
            type: "partial_payment_approval",
            financeId: result.record.entityId,
            productPaymentId: result.record.productPaymentId,
            clientId: clientId,
            clientName: clientName,
            counsellorId: counsellorId,
            counsellorName: counsellorName,
            amount: amount,
            message: `Partial payment of $${amount} requires your approval`,
          };

          // Emit to manager if exists
          if (counsellor?.managerId) {
            emitToCounsellor(counsellor.managerId, "notification:partial_payment", notificationData);
          }

          // Emit to admin room (super admins) - this requires admins to join "admin" room
          emitToAdmin("notification:partial_payment", notificationData);

          // Also emit to role-based rooms (role:admin and role:manager) - this requires users to join via join:role
          emitToRoles(["manager", "admin"], "notification:partial_payment", notificationData);

          // Also emit to all admins individually via their counsellor rooms (fallback)
          // This ensures admins get notifications even if they haven't joined admin room
          superAdmins.forEach(admin => {
            emitToCounsellor(admin.id, "notification:partial_payment", notificationData);
          });

          console.log(`📤 Sent partial payment notification to ${targetUserIds.length} users (${superAdmins.length} admins, ${counsellor?.managerId ? 1 : 0} manager)`);
        }
      } catch (notificationError) {
        // Don't fail the request if notification fails
        console.error("Notification error in saveClientProductPaymentController:", notificationError);
      }
    }

    // Log activity with full product data (amount, remarks, paymentDate, invoiceNo) for proper storage
    try {
      if (req.user?.id) {
        const action = result.action === "CREATED" ? "PRODUCT_ADDED" : "PRODUCT_UPDATED";
        const entityType = result.record.entityType || "client_product_payment";
        const body = req.body || {};
        const entityData = body.entityData || body.entity_data || {};

        // Build newValue: when frontend sends entityData, use those values first (same for all products e.g. BEACON_ACCOUNT)
        const hasEntityData = Object.keys(entityData).length > 0;
        const amountFromRequest = hasEntityData ? (entityData.amount ?? body.amount) : (body.amount ?? result.record.amount);
        const remarksFromRequest = hasEntityData ? (entityData.remarks ?? body.remarks) : (body.remarks ?? result.record.remarks);
        const paymentDateRaw =
          hasEntityData
            ? (entityData.paymentDate ?? entityData.fundingDate ?? entityData.openingDate ?? body.paymentDate)
            : (body.paymentDate ?? result.record.paymentDate);
        const paymentDateFromRequest = parseFrontendDate(paymentDateRaw) ?? (typeof paymentDateRaw === "string" ? paymentDateRaw.split("T")[0] : null) ?? result.record.paymentDate ?? null;
        const invoiceNoFromRequest = hasEntityData ? (entityData.invoiceNo ?? body.invoiceNo ?? body.invoice_no) : (body.invoiceNo ?? body.invoice_no ?? result.record.invoiceNo);

        const newValueMerged = {
          ...result.record,
          amount: amountFromRequest ?? result.record.amount ?? null,
          remarks: remarksFromRequest ?? result.record.remarks ?? null,
          paymentDate: paymentDateFromRequest,
          invoiceNo: invoiceNoFromRequest ?? result.record.invoiceNo ?? null,
          // Include product-specific entity fields in log (frontend: DD-MM-YYYY -> store YYYY-MM-DD)
          ...(hasEntityData && entityData.openingDate != null ? { openingDate: parseFrontendDate(entityData.openingDate) ?? entityData.openingDate } : {}),
          ...(hasEntityData && entityData.fundingDate != null ? { fundingDate: parseFrontendDate(entityData.fundingDate) ?? entityData.fundingDate } : {}),
        };
        const newValueForLog = normalizeProductPaymentForActivityLog(newValueMerged);

        // Build oldValue: use entity data fetched BEFORE save (oldEntityDisplay) so we store true previous state
        let oldValueForLog: Record<string, unknown> | null = oldValue;
        if (oldValue && oldValue.entityId != null && oldValue.entityType) {
          const pd = oldEntityDisplay.paymentDate ?? oldValue.paymentDate;
          const paymentDateStr =
            pd instanceof Date ? pd.toISOString().split("T")[0] : pd != null ? String(pd).split("T")[0] : null;
          oldValueForLog = normalizeProductPaymentForActivityLog({
            ...oldValue,
            amount: oldEntityDisplay.amount ?? oldValue.amount ?? null,
            remarks: oldEntityDisplay.remarks ?? oldValue.remarks ?? null,
            paymentDate: paymentDateStr,
            invoiceNo: oldEntityDisplay.invoiceNo ?? oldValue.invoiceNo ?? null,
          });
        }

        const amount = newValueForLog?.amount;
        const amountText =
          amount != null && amount !== "" ? `$${Number(amount).toFixed(2)}` : "—";
        await logActivity(req, {
          entityType: entityType,
          entityId: Number(result.record.entityId ?? result.record.productPaymentId),
          clientId: clientId,
          action: action,
          oldValue: oldValueForLog,
          newValue: newValueForLog,
          description:
            result.action === "CREATED"
              ? `Product payment added: ${result.record.productName} - ${amountText}`
              : `Product payment updated: ${result.record.productName} - ${amountText}`,
          metadata: {
            productName: result.record.productName,
            productPaymentId: result.record.productPaymentId,
            entityType: result.record.entityType,
            entityId: result.record.entityId,
            ...(amount != null && amount !== "" && newValueForLog && { amount: newValueForLog.amount }),
            isPartialPayment: isPartialPayment,
          },
          performedBy: req.user.id,
        });
      }
    } catch (activityError) {
      // Don't fail the request if activity log fails
      console.error("Activity log error in saveClientProductPaymentController:", activityError);
    }

    // Invalidate caches for this client's product payments and dashboard
    try {
      await redisDel(`client-product-payments:${clientId}`);
      await redisDelByPrefix("dashboard:");
    } catch {
      // ignore
    }

    // Get full client details with updated product payments
    const clientDetails = await getClientFullDetailsById(clientId);

    // Get updated client lists
    const counsellorClients = await getClientsByCounsellor(counsellorId);
    const adminClients = await getAllClientsForAdmin();

    // Emit WebSocket event for real-time updates
    try {
      const eventName = result.action === "CREATED" ? "productPayment:created" : "productPayment:updated";

      // Emit to counsellor's room
      emitToCounsellor(counsellorId, eventName, {
        action: result.action,
        productPayment: result.record,
        clientId: clientId,
        client: clientDetails,
        clients: counsellorClients,
      });

      // Emit to admin room
      emitToAdmin(eventName, {
        action: result.action,
        productPayment: result.record,
        clientId: clientId,
        client: clientDetails,
        clients: adminClients,
      });

      // Emit dashboard update for "today" filter
      try {
        const dashboardStats = await getDashboardStats("today");
        emitDashboardUpdate("dashboard:updated", {
          filter: "today",
          data: dashboardStats,
        });
      } catch (dashboardError) {
        console.error("Dashboard update emit error:", dashboardError);
      }
    } catch (wsError) {
      // Don't fail the request if WebSocket fails
      console.error("WebSocket emit error in saveClientProductPaymentController:", wsError);
    }

    res.status(200).json({
      success: true,
      action: result.action,
      data: result.record,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const getClientProductPaymentsController = async (
  req: Request,
  res: Response
) => {
  try {
    const clientId = Number(req.params.clientId);

    if (!Number.isFinite(clientId) || clientId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Valid clientId is required",
      });
    }

    const records = await getProductPaymentsByClientId(clientId);

    res.json({
      success: true,
      count: records.length,
      data: records,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || "Failed to fetch product payments",
    });
  }
};
