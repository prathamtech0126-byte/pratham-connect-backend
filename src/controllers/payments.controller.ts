import { Request, Response } from "express";
import { db } from "../config/databaseConnection";
import { users } from "../schemas/users.schema";
import { clientInformation } from "../schemas/clientInformation.schema";
import { clientPayments } from "../schemas/clientPayment.schema";
import { clientProductPayments } from "../schemas/clientProductPayments.schema";
import { eq } from "drizzle-orm";
import { logActivity } from "../services/activityLog.service";
import { redisDel, redisDelByPrefix } from "../config/redis";

export const assignCounsellorToPaymentController = async (
  req: Request,
  res: Response
) => {
  try {
    const { paymentId, clientId, source, field, counsellorId } = req.body;

    // Validate required fields
    if (
      !Number.isFinite(Number(paymentId)) ||
      !Number.isFinite(Number(clientId)) ||
      !Number.isFinite(Number(counsellorId)) ||
      !["payment", "product"].includes(source) ||
      !["clientOwner", "addedBy"].includes(field)
    ) {
      return res.status(400).json({
        message:
          "Invalid request body. Required: paymentId, clientId, source (payment|product), field (clientOwner|addedBy), counsellorId",
      });
    }

    const pId = Number(paymentId);
    const cId = Number(clientId);
    const newCounsellorId = Number(counsellorId);

    // Look up the counsellor
    const [counsellor] = await db
      .select({ id: users.id, fullName: users.fullName, role: users.role })
      .from(users)
      .where(eq(users.id, newCounsellorId))
      .limit(1);

    if (!counsellor) {
      return res.status(404).json({ message: "Counsellor not found" });
    }

    if (field === "clientOwner") {
      // Update counsellor_id on the client record
      const [existingClient] = await db
        .select({ clientId: clientInformation.clientId, counsellorId: clientInformation.counsellorId })
        .from(clientInformation)
        .where(eq(clientInformation.clientId, cId))
        .limit(1);

      if (!existingClient) {
        return res.status(404).json({ message: "Client not found" });
      }

      const oldCounsellorId = existingClient.counsellorId;

      await db
        .update(clientInformation)
        .set({ counsellorId: newCounsellorId })
        .where(eq(clientInformation.clientId, cId));

      try {
        await redisDel([
          `clients:full:${cId}`,
          `clients:complete:${cId}`,
          `clients:list:counsellor:${oldCounsellorId}`,
          `clients:list:counsellor:${newCounsellorId}`,
        ]);
        await redisDelByPrefix(`clients:list:`);
        await redisDelByPrefix("reports:");
      } catch {
        // ignore cache errors
      }

      await logActivity(req, {
        entityType: "client_information",
        entityId: cId,
        clientId: cId,
        action: "UPDATE",
        description: `Client owner reassigned to ${counsellor.fullName} (ID: ${newCounsellorId})`,
        metadata: { newCounsellorId, counsellorName: counsellor.fullName, source },
        performedBy: req.user!.id,
      });

      return res.status(200).json({ success: true });
    }

    // field === "addedBy": update handledBy on the payment record
    if (source === "payment") {
      const [existing] = await db
        .select({ paymentId: clientPayments.paymentId })
        .from(clientPayments)
        .where(eq(clientPayments.paymentId, pId))
        .limit(1);

      if (!existing) {
        return res.status(404).json({ message: "Payment not found" });
      }

      await db
        .update(clientPayments)
        .set({ handledBy: newCounsellorId })
        .where(eq(clientPayments.paymentId, pId));

      try {
        await redisDel(`client-payments:${cId}`);
        await redisDelByPrefix("reports:");
      } catch {
        // ignore cache errors
      }

      await logActivity(req, {
        entityType: "client_payment",
        entityId: pId,
        clientId: cId,
        action: "PAYMENT_UPDATED",
        description: `Payment addedBy reassigned to ${counsellor.fullName} (ID: ${newCounsellorId})`,
        metadata: { field: "handledBy", newCounsellorId, counsellorName: counsellor.fullName },
        performedBy: req.user!.id,
      });
    } else {
      // source === "product"
      const [existing] = await db
        .select({ productPaymentId: clientProductPayments.productPaymentId })
        .from(clientProductPayments)
        .where(eq(clientProductPayments.productPaymentId, pId))
        .limit(1);

      if (!existing) {
        return res.status(404).json({ message: "Product payment not found" });
      }

      await db
        .update(clientProductPayments)
        .set({ handledBy: newCounsellorId })
        .where(eq(clientProductPayments.productPaymentId, pId));

      try {
        await redisDel(`client-product-payments:${cId}`);
        await redisDelByPrefix("reports:");
      } catch {
        // ignore cache errors
      }

      await logActivity(req, {
        entityType: "client_product_payment",
        entityId: pId,
        clientId: cId,
        action: "PAYMENT_UPDATED",
        description: `Product payment addedBy reassigned to ${counsellor.fullName} (ID: ${newCounsellorId})`,
        metadata: { field: "handledBy", newCounsellorId, counsellorName: counsellor.fullName },
        performedBy: req.user!.id,
      });
    }

    return res.status(200).json({ success: true });
  } catch (error: any) {
    console.error("assignCounsellorToPayment error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
