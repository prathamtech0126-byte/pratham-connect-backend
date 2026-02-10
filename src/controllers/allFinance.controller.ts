import { Request, Response } from "express";
import {
  getPendingAllFinanceApprovals,
  approveAllFinancePayment,
  rejectAllFinancePayment,
} from "../models/clientProductPayments.model";
import { logActivity } from "../services/activityLog.service";
import { emitToAdmin, emitToRoles, emitToCounsellor } from "../config/socket";
import { db } from "../config/databaseConnection";
import { allFinance } from "../schemas/allFinance.schema";
import { clientProductPayments } from "../schemas/clientProductPayments.schema";
import { clientInformation } from "../schemas/clientInformation.schema";
import { users } from "../schemas/users.schema";
import { eq,and } from "drizzle-orm";

/**
 * Get pending all finance approvals
 * GET /api/all-finance/pending
 * Access: admin, manager
 */
export const getPendingApprovalsController = async (
  req: Request,
  res: Response
) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    // Check if user is admin or manager
    const userRole = req.user.role;
    if (userRole !== "admin" && userRole !== "manager") {
      return res.status(403).json({
        success: false,
        message: "Only admins and managers can view pending approvals",
      });
    }

    const pendingApprovals = await getPendingAllFinanceApprovals();

    return res.status(200).json({
      success: true,
      data: pendingApprovals,
      count: pendingApprovals.length,
    });
  } catch (error: any) {
    console.error("Error getting pending approvals:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to get pending approvals",
    });
  }
};

/**
 * Approve all finance payment
 * POST /api/all-finance/:financeId/approve
 * Access: admin, manager
 */
export const approveAllFinanceController = async (
  req: Request,
  res: Response
) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    // Check if user is admin or manager
    const userRole = req.user.role;
    if (userRole !== "admin" && userRole !== "manager") {
      return res.status(403).json({
        success: false,
        message: "Only admins and managers can approve payments",
      });
    }

    const financeId = Number(req.params.financeId);
    if (!financeId || !Number.isFinite(financeId) || financeId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid finance ID",
      });
    }

    // Get finance record before approval
    const [financeBefore] = await db
      .select()
      .from(allFinance)
      .where(eq(allFinance.financeId, financeId))
      .limit(1);

    if (!financeBefore) {
      return res.status(404).json({
        success: false,
        message: "Finance payment not found",
      });
    }

    // Approve the payment
    let approvedFinance;
    try {
      approvedFinance = await approveAllFinancePayment(
        financeId,
        req.user.id
      );
    } catch (error: any) {
      console.error("Error in approveAllFinancePayment:", error);
      return res.status(400).json({
        success: false,
        message: error.message || "Failed to approve payment",
      });
    }

    if (!approvedFinance) {
      return res.status(500).json({
        success: false,
        message: "Payment approval failed - no data returned",
      });
    }

    // Get related info for notifications
    const [productPayment] = await db
      .select({
        productPaymentId: clientProductPayments.productPaymentId,
        clientId: clientProductPayments.clientId,
      })
      .from(clientProductPayments)
      .where(
        and(
          eq(clientProductPayments.entityId, financeId),
          eq(clientProductPayments.productName, "ALL_FINANCE_EMPLOYEMENT")
        )
      )
      .limit(1);

    if (productPayment) {
      const [client] = await db
        .select({
          fullName: clientInformation.fullName,
          counsellorId: clientInformation.counsellorId,
        })
        .from(clientInformation)
        .where(eq(clientInformation.clientId, productPayment.clientId))
        .limit(1);

      if (client?.counsellorId) {
        // Notify counsellor that payment was approved
        emitToCounsellor(client.counsellorId, "allFinance:approved", {
          financeId: financeId,
          productPaymentId: productPayment.productPaymentId,
          clientId: productPayment.clientId,
          clientName: client.fullName,
          amount: approvedFinance.amount,
        });
      }
    }

    // Emit to admin room
    emitToAdmin("allFinance:approved", {
      financeId: financeId,
      productPaymentId: productPayment?.productPaymentId,
      approvedBy: req.user.id,
    });

    // Log activity
    try {
      await logActivity(req, {
        entityType: "all_finance",
        entityId: financeId,
        clientId: productPayment?.clientId || null,
        action: "STATUS_CHANGE",
        oldValue: financeBefore,
        newValue: approvedFinance,
        description: `All finance payment approved: $${approvedFinance.amount}`,
        performedBy: req.user.id,
      });
    } catch (activityError) {
      console.error("Activity log error:", activityError);
    }

    return res.status(200).json({
      success: true,
      message: "Payment approved successfully",
      data: approvedFinance,
    });
  } catch (error: any) {
    console.error("Error approving payment:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to approve payment",
    });
  }
};

/**
 * Reject all finance payment
 * POST /api/all-finance/:financeId/reject
 * Access: admin, manager
 */
export const rejectAllFinanceController = async (
  req: Request,
  res: Response
) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    // Check if user is admin or manager
    const userRole = req.user.role;
    if (userRole !== "admin" && userRole !== "manager") {
      return res.status(403).json({
        success: false,
        message: "Only admins and managers can reject payments",
      });
    }

    const financeId = Number(req.params.financeId);
    if (!financeId || !Number.isFinite(financeId) || financeId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid finance ID",
      });
    }

    // Get finance record before rejection
    const [financeBefore] = await db
      .select()
      .from(allFinance)
      .where(eq(allFinance.financeId, financeId))
      .limit(1);

    if (!financeBefore) {
      return res.status(404).json({
        success: false,
        message: "Finance payment not found",
      });
    }

    // Reject the payment
    let rejectedFinance;
    try {
      rejectedFinance = await rejectAllFinancePayment(
        financeId,
        req.user.id
      );
    } catch (error: any) {
      console.error("Error in rejectAllFinancePayment:", error);
      return res.status(400).json({
        success: false,
        message: error.message || "Failed to reject payment",
      });
    }

    if (!rejectedFinance) {
      return res.status(500).json({
        success: false,
        message: "Payment rejection failed - no data returned",
      });
    }

    // Get related info for notifications
    const [productPayment] = await db
      .select({
        productPaymentId: clientProductPayments.productPaymentId,
        clientId: clientProductPayments.clientId,
      })
      .from(clientProductPayments)
      .where(
        and(
          eq(clientProductPayments.entityId, financeId),
          eq(clientProductPayments.productName, "ALL_FINANCE_EMPLOYEMENT")
        )
      )
      .limit(1);

    if (productPayment) {
      const [client] = await db
        .select({
          fullName: clientInformation.fullName,
          counsellorId: clientInformation.counsellorId,
        })
        .from(clientInformation)
        .where(eq(clientInformation.clientId, productPayment.clientId))
        .limit(1);

      if (client?.counsellorId) {
        // Notify counsellor that payment was rejected
        emitToCounsellor(client.counsellorId, "allFinance:rejected", {
          financeId: financeId,
          productPaymentId: productPayment.productPaymentId,
          clientId: productPayment.clientId,
          clientName: client.fullName,
          amount: rejectedFinance.amount,
        });
      }
    }

    // Emit to admin room
    emitToAdmin("allFinance:rejected", {
      financeId: financeId,
      productPaymentId: productPayment?.productPaymentId,
      rejectedBy: req.user.id,
    });

    // Log activity
    try {
      await logActivity(req, {
        entityType: "all_finance",
        entityId: financeId,
        clientId: productPayment?.clientId || null,
        action: "STATUS_CHANGE",
        oldValue: financeBefore,
        newValue: rejectedFinance,
        description: `All finance payment rejected: $${rejectedFinance.amount}`,
        performedBy: req.user.id,
      });
    } catch (activityError) {
      console.error("Activity log error:", activityError);
    }

    return res.status(200).json({
      success: true,
      message: "Payment rejected successfully",
      data: rejectedFinance,
    });
  } catch (error: any) {
    console.error("Error rejecting payment:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to reject payment",
    });
  }
};
