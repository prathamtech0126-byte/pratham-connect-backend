import { Request, Response } from "express";
import {
  saveClientPayment,
  getPaymentsByClientId,
  deleteClientPayment,
} from "../models/clientPayment.model";
import { getClientFullDetailsById, getClientsByCounsellor, getAllClientsForAdmin } from "../models/client.model";
import { emitToCounsellor, emitToAdmin, emitDashboardUpdate } from "../config/socket";
import { getDashboardStats } from "../models/dashboard.model";
import { db } from "../config/databaseConnection";
import { clientInformation } from "../schemas/clientInformation.schema";
import { clientPayments } from "../schemas/clientPayment.schema";
import { eq } from "drizzle-orm";
import { logActivity } from "../services/activityLog.service";
import { redisDel, redisDelByPrefix, redisGetJson, redisSetJson } from "../config/redis";

const CLIENT_PAYMENTS_CACHE_TTL_SECONDS = 45;

/** Normalize payment for activity log: consistent types (numbers, YYYY-MM-DD date) so oldValue/newValue are correct */
function normalizePaymentForActivityLog(payment: any): Record<string, unknown> | null {
  if (!payment) return null;
  const id = payment.paymentId ?? payment.id;
  const cId = payment.clientId ?? payment.client_id;
  const dateVal = payment.paymentDate ?? payment.payment_date;
  const dateStr =
    dateVal instanceof Date
      ? dateVal.toISOString().split("T")[0]
      : dateVal != null && typeof dateVal === "string"
      ? dateVal.split("T")[0]
      : null;
  return {
    paymentId: id != null ? Number(id) : undefined,
    clientId: cId != null ? Number(cId) : undefined,
    saleTypeId: payment.saleTypeId ?? payment.sale_type_id != null ? Number(payment.saleTypeId ?? payment.sale_type_id) : undefined,
    stage: payment.stage ?? null,
    amount: payment.amount != null ? String(payment.amount) : null,
    totalPayment: payment.totalPayment ?? payment.total_payment != null ? String(payment.totalPayment ?? payment.total_payment) : null,
    paymentDate: dateStr,
    invoiceNo: payment.invoiceNo ?? payment.invoice_no ?? null,
    remarks: payment.remarks ?? null,
    createdAt: payment.createdAt ?? payment.created_at ?? null,
  };
}

/**
 * Create client payment
 */
export const saveClientPaymentController = async (
  req: Request,
  res: Response
) => {
  try {
    // Fetch old value if updating
    let oldValue = null;
    if (req.body.paymentId) {
      try {
        const paymentId = Number(req.body.paymentId);
        const [oldPayment] = await db
          .select()
          .from(clientPayments)
          .where(eq(clientPayments.paymentId, paymentId));
        if (oldPayment) {
          oldValue = normalizePaymentForActivityLog(oldPayment);
        }
      } catch (error) {
        console.error("Error fetching old payment value:", error);
      }
    }

    console.log("req.body client payment", req.body);
    const result = await saveClientPayment(req.body);
    const clientId = Number(result.payment.clientId);

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

    // Invalidate caches for this client's payments and dashboard
    try {
      await redisDel(`client-payments:${clientId}`);
      await redisDelByPrefix("dashboard:");
    } catch {
      // ignore
    }

    // Log activity ONLY when a real insert or real update happens (rowCount > 0 or action is CREATED)
    // Skip logging if action is NO_CHANGE (data was identical, no actual update occurred)
    if (result.action !== "NO_CHANGE") {
      try {
        if (req.user?.id) {
          const action = result.action === "CREATED" ? "PAYMENT_ADDED" : "PAYMENT_UPDATED";
          const newValueForLog = normalizePaymentForActivityLog(result.payment);
          await logActivity(req, {
            entityType: "client_payment",
            entityId: Number(result.payment.paymentId),
            clientId: clientId,
            action: action,
            oldValue: oldValue,
            newValue: newValueForLog,
            description: result.action === "CREATED"
              ? `Payment added: ${result.payment.stage} - $${result.payment.amount}`
              : `Payment updated: ${result.payment.stage} - $${result.payment.amount}`,
            metadata: {
              stage: result.payment.stage,
              amount: result.payment.amount != null ? String(result.payment.amount) : null,
              totalPayment: result.payment.totalPayment != null ? String(result.payment.totalPayment) : null,
            },
            performedBy: req.user.id,
          });
        }
      } catch (activityError) {
        // Don't fail the request if activity log fails
        console.error("Activity log error in saveClientPaymentController:", activityError);
      }
    }

    // Get full client details with updated payments
    const clientDetails = await getClientFullDetailsById(clientId);

    // Get updated client lists
    const counsellorClients = await getClientsByCounsellor(counsellorId);
    const adminClients = await getAllClientsForAdmin();

    // Emit WebSocket event for real-time updates
    try {
      const eventName = result.action === "CREATED" ? "payment:created" : "payment:updated";

      // Emit to counsellor's room
      emitToCounsellor(counsellorId, eventName, {
        action: result.action,
        payment: result.payment,
        clientId: clientId,
        client: clientDetails,
        clients: counsellorClients,
      });

      // Emit to admin room
      // emitToAdmin(eventName, {
      //   action: result.action,
      //   payment: result.payment,
      //   clientId: clientId,
      //   client: clientDetails,
      //   clients: adminClients,
      // });

      // Emit to admin room
      emitToAdmin(eventName, {
        action: result.action,
        payment: result.payment,
        clientId: clientId,
        client: clientDetails,
        clients: counsellorClients,  // Counsellor's list (for counsellor room)
        allClients: adminClients,     // ✅ ADD THIS - Full admin list
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
      console.error("WebSocket emit error in saveClientPaymentController:", wsError);
    }

    res.status(200).json({
      success: true,
      action: result.action,
      data: result.payment,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Get payments by client id
 */
export const getClientPaymentsController = async (
  req: Request,
  res: Response
) => {
  try {
    const clientId = Number(req.params.clientId);

    if (Number.isNaN(clientId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid clientId",
      });
    }

    const cacheKey = `client-payments:${clientId}`;
    const cached = await redisGetJson<any[]>(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        count: cached.length,
        data: cached,
        cached: true,
      });
    }

    const payments = await getPaymentsByClientId(clientId);
    await redisSetJson(cacheKey, payments, CLIENT_PAYMENTS_CACHE_TTL_SECONDS);

    res.status(200).json({
      success: true,
      count: payments.length,
      data: payments,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const deleteClientPaymentController = async (
  req: Request,
  res: Response
) => {
  try {
    const paymentId = Number(req.params.paymentId);

    // 1. Validate ID
    if (!Number.isInteger(paymentId) || paymentId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid paymentId",
      });
    }

    // 2. Call service
    const deleted = await deleteClientPayment(paymentId);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Payment not found",
      });
    }

    // Invalidate Redis caches so frontend sees updated list immediately
    const clientId = Number(deleted.clientId);
    try {
      await redisDel([
        `client-payments:${clientId}`,
        `clients:complete:${clientId}`,
        `clients:full:${clientId}`,
      ]);
    } catch (e) {
      console.error("Redis invalidate after payment delete failed:", e);
    }
    try {
      await redisDelByPrefix("dashboard:");
    } catch (e) {
      console.error("Redis invalidate dashboard after payment delete failed:", e);
    }
    try {
      await redisDelByPrefix("leaderboard:");
    } catch (e) {
      console.error("Redis invalidate leaderboard after payment delete failed:", e);
    }

    // 3. Activity log: who deleted which client's payment + reason from admin/manager
    const performedBy = (req as any).user?.id;
    if (performedBy) {
      const reason = [req.body?.reason, req.body?.description].find(Boolean);
      const parts = [
        deleted.stage,
        deleted.amount != null ? `Amount: ${deleted.amount}` : null,
      ].filter(Boolean);
      const description = reason
        ? `Reason: ${String(reason).trim()}`
        : `Payment deleted: ${parts.join(", ")}`;
      await logActivity(req, {
        entityType: "clientPayment",
        entityId: paymentId,
        clientId: deleted.clientId,
        action: "PAYMENT_DELETED",
        oldValue: normalizePaymentForActivityLog(deleted),
        description,
        performedBy,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Payment deleted successfully",
      data: deleted,
    });

  } catch (error: any) {
    console.error("Delete payment error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
