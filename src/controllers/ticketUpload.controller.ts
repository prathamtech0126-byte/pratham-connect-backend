import { Request, Response } from "express";
import path from "path";
import fs from "fs";
import { AuthenticatedRequest } from "../types/express-auth";
import { db } from "../config/databaseConnection";
import { techSupportTickets } from "../schemas/techSupport.schema";
import { eq } from "drizzle-orm";
import { emitTechSupportEvent } from "../services/techSupport.service";
import { redisDelByPrefix } from "../config/redis";

// Helper to delete ticket images
const deleteTicketImagesFromDisk = (imagePaths: string[]) => {
  imagePaths.forEach((imagePath) => {
    try {
      const fullPath = path.join(process.cwd(), imagePath.replace(/^\/uploads\//, "uploads/"));
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        console.log(`[Upload] Deleted image: ${fullPath}`);
      }
    } catch (err) {
      console.error(`[Upload] Failed to delete image: ${imagePath}`, err);
    }
  });
};

// Upload images for a ticket (max 2 per ticket)
export const uploadTicketImagesController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.user) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }

    const ticketId = Number(req.params.ticketId);
    if (!Number.isFinite(ticketId) || ticketId <= 0) {
      return res.status(400).json({ success: false, message: "Invalid ticket ID" });
    }

    // Check if ticket exists and belongs to user (or user is admin/tech)
    const [ticket] = await db
      .select()
      .from(techSupportTickets)
      .where(eq(techSupportTickets.id, ticketId))
      .limit(1);

    if (!ticket) {
      return res.status(404).json({ success: false, message: "Ticket not found" });
    }

    // Only ticket owner or admin/tech can upload
    const canUpload =
      ticket.counsellorId === authReq.user.id ||
      ["admin", "superadmin", "manager", "tech_support"].includes(authReq.user.role);

    if (!canUpload) {
      return res.status(403).json({ success: false, message: "Not authorized to upload images for this ticket" });
    }

    // Get existing attachments
    const existingAttachments = (ticket.attachments as any[]) || [];
    
    // Check if already has 2 images
    if (existingAttachments.length >= 2) {
      return res.status(400).json({ 
        success: false, 
        message: "Maximum 2 images allowed per ticket. Delete existing images first." 
      });
    }

    // Get uploaded files
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ success: false, message: "No files uploaded" });
    }

    // Check if total would exceed 2
    if (existingAttachments.length + files.length > 2) {
      return res.status(400).json({ 
        success: false, 
        message: `Can only upload ${2 - existingAttachments.length} more image(s). You already have ${existingAttachments.length}.` 
      });
    }

    // Build new attachment objects with full backend URL
    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
    const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:3000";
    const baseUrl = `${protocol}://${host}`;

    const newAttachments = files.map((file) => ({
      name: file.filename,
      url: `${baseUrl}/uploads/tickets/${file.filename}`,
      mimeType: file.mimetype,
      originalName: file.originalname,
      uploadedAt: new Date().toISOString(),
    }));

    // Merge with existing
    const updatedAttachments = [...existingAttachments, ...newAttachments];

    // Update ticket
    await db
      .update(techSupportTickets)
      .set({
        attachments: updatedAttachments,
        updatedAt: new Date(),
      })
      .where(eq(techSupportTickets.id, ticketId));

    // Invalidate cache and emit socket event
    await redisDelByPrefix("techsupport:board:");
    await redisDelByPrefix("techsupport:my:tickets:");
    emitTechSupportEvent("techSupport:ticketUpdated", { 
      ticketId, 
      status: ticket.status,
      attachmentCount: updatedAttachments.length 
    });

    return res.json({
      success: true,
      message: "Images uploaded successfully",
      data: {
        ticketId,
        attachments: updatedAttachments,
      },
    });
  } catch (error: any) {
    console.error("[TicketUpload] Error:", error);
    return res.status(500).json({ success: false, message: error?.message || "Failed to upload images" });
  }
};

// Delete a specific image from a ticket
export const deleteTicketImageController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.user) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }

    const ticketId = Number(req.params.ticketId);
    const filename = req.params.filename;

    if (!Number.isFinite(ticketId) || ticketId <= 0) {
      return res.status(400).json({ success: false, message: "Invalid ticket ID" });
    }

    if (!filename) {
      return res.status(400).json({ success: false, message: "Filename required" });
    }

    // Check ticket
    const [ticket] = await db
      .select()
      .from(techSupportTickets)
      .where(eq(techSupportTickets.id, ticketId))
      .limit(1);

    if (!ticket) {
      return res.status(404).json({ success: false, message: "Ticket not found" });
    }

    // Check authorization
    const canDelete =
      ticket.counsellorId === authReq.user.id ||
      ["admin", "superadmin", "manager", "tech_support"].includes(authReq.user.role);

    if (!canDelete) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    // Get existing attachments
    const existingAttachments = (ticket.attachments as any[]) || [];
    const attachmentToDelete = existingAttachments.find((a) => a.name === filename);

    if (!attachmentToDelete) {
      return res.status(404).json({ success: false, message: "Image not found" });
    }

    // Delete file from disk
    deleteTicketImagesFromDisk([attachmentToDelete.url]);

    // Update ticket attachments
    const updatedAttachments = existingAttachments.filter((a) => a.name !== filename);

    await db
      .update(techSupportTickets)
      .set({
        attachments: updatedAttachments,
        updatedAt: new Date(),
      })
      .where(eq(techSupportTickets.id, ticketId));

    return res.json({
      success: true,
      message: "Image deleted successfully",
      data: { ticketId, attachments: updatedAttachments },
    });
  } catch (error: any) {
    console.error("[TicketUpload] Delete error:", error);
    return res.status(500).json({ success: false, message: error?.message || "Failed to delete image" });
  }
};
