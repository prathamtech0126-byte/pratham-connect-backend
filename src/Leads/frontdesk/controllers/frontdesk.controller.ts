import { Request, Response } from "express";
import {
  verifyFrontDeskLead,
  assignLeadToCounsellor,
  exportFrontDeskLeadsToExcel,
  getFrontDeskLeads,
  updateLeadDetails,
  FRONT_DESK_LEAD_EDIT_BLOCKED_MSG,
} from "../models/frontdesk.model";
import {
  getCachedFrontDeskActivityLogs,
  getCachedFrontDeskLeadDetail,
  getCachedFrontDeskLeads,
  getCachedFrontDeskSaleTypes,
  getCachedFrontDeskStats,
} from "../cache/frontdesk.cache.service";
import { toApiCacheMeta } from "../../../modules/cache/cacheResponse";
import { db } from "../../../config/databaseConnection";
import { users } from "../../../schemas/users.schema";
import { eq, and } from "drizzle-orm";

const userId = (req: Request): number => (req as any).user?.id;

// ─── Dashboard Stats ───────────────────────────────────────────────────────────

export const getDashboardStatsController = async (req: Request, res: Response): Promise<void> => {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate ? new Date(startDate as string) : undefined;
    let end: Date | undefined;
    if (endDate) {
      end = new Date(endDate as string);
      end.setHours(23, 59, 59, 999);
    }
    const result = await getCachedFrontDeskStats(start, end);
    res.json({ success: true, data: result.data, ...toApiCacheMeta(result) });
  } catch (err) {
    console.error("[frontdesk] stats error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch stats" });
  }
};

// ─── Leads List ────────────────────────────────────────────────────────────────

export const listFrontDeskLeads = async (req: Request, res: Response): Promise<void> => {
  try {
    const { search, startDate, endDate, isVerified, leadType, page, limit } = req.query;
    const filters = {
      search: search as string | undefined,
      startDate: startDate as string | undefined,
      endDate: endDate as string | undefined,
      isVerified: isVerified === "true" ? true : isVerified === "false" ? false : undefined,
      leadType: leadType as string | undefined,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 25,
    };
    const result = await getCachedFrontDeskLeads(filters);
    res.json({ success: true, ...result.data, ...toApiCacheMeta(result) });
  } catch (err) {
    console.error("[frontdesk] listLeads error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch leads" });
  }
};

// ─── Lead Detail ───────────────────────────────────────────────────────────────

export const getFrontDeskLeadDetailController = async (req: Request, res: Response): Promise<void> => {
  try {
    const leadId = Number(req.params.id);
    if (!leadId) { res.status(400).json({ success: false, message: "Invalid lead ID" }); return; }
    const result = await getCachedFrontDeskLeadDetail(leadId);
    if (!result.data) { res.status(404).json({ success: false, message: "Lead not found" }); return; }
    res.json({ success: true, data: result.data, ...toApiCacheMeta(result) });
  } catch (err) {
    console.error("[frontdesk] getLeadDetail error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch lead detail" });
  }
};

// ─── Verify ────────────────────────────────────────────────────────────────────

export const verifyLeadController = async (req: Request, res: Response): Promise<void> => {
  try {
    const leadId = Number(req.params.id);
    if (!leadId) { res.status(400).json({ success: false, message: "Invalid lead ID" }); return; }
    const { saleType, source, counsellorId } = req.body as { saleType?: string; source?: string; counsellorId?: number };
    if (!saleType) {
      res.status(400).json({ success: false, message: "saleType is required" });
      return;
    }
    await verifyFrontDeskLead(leadId, userId(req), saleType, source || "walk_in", counsellorId ? Number(counsellorId) : undefined);
    res.json({ success: true, message: "Lead verified successfully" });
  } catch (err: any) {
    res.status(err?.message === "Lead not found" ? 404 : 400).json({ success: false, message: err?.message ?? "Failed to verify lead" });
  }
};

// ─── Assign ────────────────────────────────────────────────────────────────────

export const assignLeadController = async (req: Request, res: Response): Promise<void> => {
  try {
    const leadId = Number(req.params.id);
    const { counsellorId, leadType } = req.body;
    if (!leadId || !counsellorId) {
      res.status(400).json({ success: false, message: "leadId and counsellorId are required" });
      return;
    }
    await assignLeadToCounsellor(leadId, Number(counsellorId), userId(req), leadType as string | undefined);
    res.json({ success: true, message: "Lead assigned to counsellor successfully" });
  } catch (err: any) {
    const isClient =
      err?.message?.includes("verified") ||
      err?.message?.includes("converted") ||
      err?.message?.includes("dropped") ||
      err?.message?.includes("sale type") ||
      err?.message === "Lead not found";
    res.status(isClient ? 422 : 500).json({ success: false, message: err?.message ?? "Failed to assign lead" });
  }
};

// ─── Edit Lead Details ─────────────────────────────────────────────────────────

export const updateLeadDetailsController = async (req: Request, res: Response): Promise<void> => {
  try {
    const leadId = Number(req.params.id);
    if (!leadId) { res.status(400).json({ success: false, message: "Invalid lead ID" }); return; }
    await updateLeadDetails(leadId, req.body, userId(req));
    res.json({ success: true, message: "Lead details updated successfully" });
  } catch (err: any) {
    const msg = err?.message ?? "Failed to update lead";
    const status =
      msg === "Lead not found" ? 404 : msg === FRONT_DESK_LEAD_EDIT_BLOCKED_MSG ? 403 : 500;
    res.status(status).json({ success: false, message: msg });
  }
};

// ─── Counsellors ───────────────────────────────────────────────────────────────

export const getCounsellorsForAssignment = async (_req: Request, res: Response): Promise<void> => {
  try {
    const counsellors = await db
      .select({ id: users.id, fullName: users.fullName, email: users.email })
      .from(users)
      .where(and(eq(users.role, "counsellor"), eq(users.status, true)));
    res.json({ success: true, data: counsellors });
  } catch (err) {
    console.error("[frontdesk] getCounsellors error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch counsellors" });
  }
};

// ─── Sale Types ────────────────────────────────────────────────────────────────

export const getSaleTypesController = async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await getCachedFrontDeskSaleTypes();
    res.json({ success: true, data: result.data, ...toApiCacheMeta(result) });
  } catch (err) {
    console.error("[frontdesk] getSaleTypes error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch sale types" });
  }
};

// ─── Activity Log ──────────────────────────────────────────────────────────────

export const getActivityLogsController = async (req: Request, res: Response): Promise<void> => {
  try {
    const { page, limit } = req.query;
    const pageNum = page ? Number(page) : 1;
    const limitNum = limit ? Number(limit) : 30;
    const viewerRole = (req as any).user?.role ?? "front_desk";
    const result = await getCachedFrontDeskActivityLogs(
      userId(req),
      viewerRole,
      pageNum,
      limitNum
    );
    res.json({ success: true, ...result.data, ...toApiCacheMeta(result) });
  } catch (err) {
    console.error("[frontdesk] activityLog error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch activity log" });
  }
};

// ─── Export ────────────────────────────────────────────────────────────────────

export const exportLeadsController = async (req: Request, res: Response): Promise<void> => {
  try {
    const { search, startDate, endDate, isVerified, leadType } = req.query;
    const buffer = await exportFrontDeskLeadsToExcel({
      search: search as string | undefined,
      startDate: startDate as string | undefined,
      endDate: endDate as string | undefined,
      isVerified: isVerified === "true" ? true : isVerified === "false" ? false : undefined,
      leadType: leadType as string | undefined,
    });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="front-desk-leads-${Date.now()}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    console.error("[frontdesk] exportLeads error:", err);
    res.status(500).json({ success: false, message: "Failed to export leads" });
  }
};
