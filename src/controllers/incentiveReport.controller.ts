import { Request, Response } from "express";
import {
  getIncentiveReport,
  processIncentiveAction,
  bulkApproveIncentives,
  getIncentiveReportAll,
} from "../services/incentiveReport.service";
import {
  getIncentiveBreakdownByRecordId,
  updateBreakdownStatusAction,
} from "../models/incentiveReport.model";

export const getIncentiveReportController = async (
  req: Request,
  res: Response
) => {
  try {
    const startDate = typeof req.query.startDate === "string" ? req.query.startDate : undefined;
    const endDate   = typeof req.query.endDate   === "string" ? req.query.endDate   : undefined;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "startDate and endDate are required query parameters",
      });
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      return res.status(400).json({
        success: false,
        message: "startDate and endDate must be in YYYY-MM-DD format",
      });
    }

    if (new Date(startDate) > new Date(endDate)) {
      return res.status(400).json({
        success: false,
        message: "startDate must be before or equal to endDate",
      });
    }

    const page        = Math.max(1, parseInt(String(req.query.page     ?? "1"),  10) || 1);
    const rawPageSize = parseInt(String(req.query.pageSize ?? "10"), 10) || 10;
    const fetchAll    = rawPageSize >= 99999 || rawPageSize === 0;
    const pageSize    = fetchAll ? 0 : Math.min(100, Math.max(1, rawPageSize));

    const report = await getIncentiveReport({ page, pageSize, startDate, endDate });

    return res.status(200).json({ success: true, ...report });
  } catch (error: any) {
    console.error("getIncentiveReportController", error);
    return res.status(500).json({ success: false, message: "Failed to load incentive report" });
  }
};

export const getIncentiveReportAllController = async (req: Request, res: Response) => {
  try {
    const startDate = typeof req.query.startDate === "string" ? req.query.startDate : undefined;
    const endDate = typeof req.query.endDate === "string" ? req.query.endDate : undefined;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "startDate and endDate are required query parameters",
      });
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      return res.status(400).json({
        success: false,
        message: "startDate and endDate must be in YYYY-MM-DD format",
      });
    }

    if (new Date(startDate) > new Date(endDate)) {
      return res.status(400).json({
        success: false,
        message: "startDate must be before or equal to endDate",
      });
    }

    const report = await getIncentiveReportAll(startDate, endDate);
    return res.status(200).json({ success: true, ...report });
  } catch (error: any) {
    console.error("getIncentiveReportAllController", error);
    return res.status(500).json({ success: false, message: "Failed to load incentive report" });
  }
};

export const postIncentiveActionController = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const clientId = Number(req.body?.clientId);
    const hasPeriodId = req.body?.periodId !== undefined && req.body?.periodId !== null;
    const periodId = hasPeriodId ? Number(req.body?.periodId) : undefined;
    const hasIncentiveRecordId = req.body?.incentive_record_id !== undefined && req.body?.incentive_record_id !== null;
    const incentiveRecordId = hasIncentiveRecordId ? Number(req.body.incentive_record_id) : undefined;
    const actionRaw = String(req.body?.action ?? "").toUpperCase();
    const action =
      actionRaw === "APPROVE" || actionRaw === "REJECT" || actionRaw === "PENDING"
        ? actionRaw
        : null;
    const overrideAmount =
      req.body?.overrideAmount === undefined ? undefined : Number(req.body.overrideAmount);
    const overridesRaw = req.body?.overrides && typeof req.body.overrides === "object" ? req.body.overrides : undefined;
    const overrides = overridesRaw
      ? {
          coreSale:
            overridesRaw.coreSale === undefined ? undefined : Number(overridesRaw.coreSale),
          allFinance:
            overridesRaw.allFinance === undefined ? undefined : Number(overridesRaw.allFinance),
          otherProducts:
            overridesRaw.otherProducts === undefined ? undefined : Number(overridesRaw.otherProducts),
        }
      : undefined;
    const remark = typeof req.body?.remark === "string" ? req.body.remark : undefined;

    if (!Number.isFinite(clientId) || clientId <= 0) {
      return res.status(400).json({ success: false, message: "clientId must be a positive number" });
    }
    if (periodId !== undefined && (!Number.isFinite(periodId) || periodId <= 0)) {
      return res.status(400).json({ success: false, message: "periodId must be a positive number" });
    }
    if (incentiveRecordId !== undefined && (!Number.isFinite(incentiveRecordId) || incentiveRecordId <= 0)) {
      return res.status(400).json({ success: false, message: "incentive_record_id must be a positive number" });
    }
    if (!action) {
      return res.status(400).json({ success: false, message: "action must be APPROVE, REJECT or PENDING" });
    }

    if (overrideAmount !== undefined && (!Number.isFinite(overrideAmount) || overrideAmount <= 0)) {
      return res.status(400).json({ success: false, message: "overrideAmount must be a positive number" });
    }
    if (overrides) {
      if (overrides.coreSale !== undefined && (!Number.isFinite(overrides.coreSale) || overrides.coreSale < 0)) {
        return res.status(400).json({ success: false, message: "overrides.coreSale must be a non-negative number" });
      }
      if (overrides.allFinance !== undefined && (!Number.isFinite(overrides.allFinance) || overrides.allFinance < 0)) {
        return res.status(400).json({ success: false, message: "overrides.allFinance must be a non-negative number" });
      }
      if (
        overrides.otherProducts !== undefined &&
        (!Number.isFinite(overrides.otherProducts) || overrides.otherProducts < 0)
      ) {
        return res.status(400).json({ success: false, message: "overrides.otherProducts must be a non-negative number" });
      }
    }

    await processIncentiveAction({
      clientId,
      periodId,
      incentiveRecordId,
      action,
      overrideAmount,
      overrides,
      remark,
      actionBy: req.user.id,
    });

    return res.status(200).json({
      success: true,
      message: "Incentive processed successfully",
    });
  } catch (error: any) {
    const message = error?.message || "Failed to process incentive";
    if (message === "overrideAmount must be a positive number" || String(message).startsWith("overrides.")) {
      return res.status(400).json({ success: false, message });
    }
    if (message === "Already approved") {
      return res.status(409).json({ success: false, message });
    }
    if (message === "Invalid periodId" || message === "Client not found in selected period" || message === "Incentive record not found") {
      return res.status(404).json({ success: false, message });
    }
    console.error("postIncentiveActionController", error);
    return res.status(500).json({ success: false, message: "Failed to process incentive" });
  }
};

export const putIncentiveActionController = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const clientId = Number(req.body?.clientId);
    const hasPeriodId = req.body?.periodId !== undefined && req.body?.periodId !== null;
    const periodId = hasPeriodId ? Number(req.body?.periodId) : undefined;
    const hasIncentiveRecordId = req.body?.incentive_record_id !== undefined && req.body?.incentive_record_id !== null;
    const incentiveRecordId = hasIncentiveRecordId ? Number(req.body.incentive_record_id) : undefined;
    const actionRaw = String(req.body?.action ?? "").toUpperCase();
    const action =
      actionRaw === "APPROVE" || actionRaw === "REJECT" || actionRaw === "PENDING"
        ? actionRaw
        : null;
    const overrideAmount =
      req.body?.overrideAmount === undefined ? undefined : Number(req.body.overrideAmount);
    const overridesRaw = req.body?.overrides && typeof req.body.overrides === "object" ? req.body.overrides : undefined;
    const overrides = overridesRaw
      ? {
          coreSale:
            overridesRaw.coreSale === undefined ? undefined : Number(overridesRaw.coreSale),
          allFinance:
            overridesRaw.allFinance === undefined ? undefined : Number(overridesRaw.allFinance),
          otherProducts:
            overridesRaw.otherProducts === undefined ? undefined : Number(overridesRaw.otherProducts),
        }
      : undefined;
    const remark = typeof req.body?.remark === "string" ? req.body.remark : undefined;

    if (!Number.isFinite(clientId) || clientId <= 0) {
      return res.status(400).json({ success: false, message: "clientId must be a positive number" });
    }
    if (periodId !== undefined && (!Number.isFinite(periodId) || periodId <= 0)) {
      return res.status(400).json({ success: false, message: "periodId must be a positive number" });
    }
    if (incentiveRecordId !== undefined && (!Number.isFinite(incentiveRecordId) || incentiveRecordId <= 0)) {
      return res.status(400).json({ success: false, message: "incentive_record_id must be a positive number" });
    }
    if (!action) {
      return res.status(400).json({ success: false, message: "action must be APPROVE, REJECT or PENDING" });
    }

    if (overrideAmount !== undefined && (!Number.isFinite(overrideAmount) || overrideAmount <= 0)) {
      return res.status(400).json({ success: false, message: "overrideAmount must be a positive number" });
    }
    if (overrides) {
      if (overrides.coreSale !== undefined && (!Number.isFinite(overrides.coreSale) || overrides.coreSale < 0)) {
        return res.status(400).json({ success: false, message: "overrides.coreSale must be a non-negative number" });
      }
      if (overrides.allFinance !== undefined && (!Number.isFinite(overrides.allFinance) || overrides.allFinance < 0)) {
        return res.status(400).json({ success: false, message: "overrides.allFinance must be a non-negative number" });
      }
      if (
        overrides.otherProducts !== undefined &&
        (!Number.isFinite(overrides.otherProducts) || overrides.otherProducts < 0)
      ) {
        return res.status(400).json({ success: false, message: "overrides.otherProducts must be a non-negative number" });
      }
    }

    await processIncentiveAction({
      clientId,
      periodId,
      incentiveRecordId,
      action,
      overrideAmount,
      overrides,
      remark,
      actionBy: req.user.id,
      allowApprovedEdit: true,
    });

    return res.status(200).json({
      success: true,
      message: "Incentive updated successfully",
    });
  } catch (error: any) {
    const message = error?.message || "Failed to update incentive";
    if (message === "overrideAmount must be a positive number" || String(message).startsWith("overrides.")) {
      return res.status(400).json({ success: false, message });
    }
    if (message === "Invalid periodId" || message === "Client not found in selected period" || message === "Incentive record not found") {
      return res.status(404).json({ success: false, message });
    }
    console.error("putIncentiveActionController", error);
    return res.status(500).json({ success: false, message: "Failed to update incentive" });
  }
};

export const postBulkApproveIncentivesController = async (req: Request, res: Response) => {
  try {
    const mode = String(req.body?.mode ?? "").toUpperCase() as "COUNSELLOR" | "FILTER" | "SELECTED";
    const status = String(req.body?.status ?? (mode === "SELECTED" ? "APPROVED" : "")).toUpperCase() as "APPROVED" | "REJECTED" | "PENDING";
    const approvedBy = mode === "SELECTED" ? req.user!.id : Number(req.body?.approvedBy);
    const counsellorId = req.body?.counsellorId === undefined ? undefined : Number(req.body?.counsellorId);
    const rawRecordIds = req.body?.incentive_record_ids ?? req.body?.recordIds;
    const recordIds = Array.isArray(rawRecordIds) ? rawRecordIds.map(Number) : undefined;
    const filters = req.body?.filters && typeof req.body.filters === "object" ? req.body.filters : undefined;
    const filterCounsellorIds = Array.isArray(filters?.counsellorIds)
      ? filters.counsellorIds.map(Number)
      : undefined;
    const filterSaleTypeCategoryIds = Array.isArray(filters?.saleTypeCategoryIds)
      ? filters.saleTypeCategoryIds.map(Number)
      : undefined;

    if (!["COUNSELLOR", "FILTER", "SELECTED"].includes(mode)) {
      return res.status(400).json({ success: false, message: "mode must be COUNSELLOR, FILTER, or SELECTED" });
    }
    if (!["APPROVED", "REJECTED", "PENDING"].includes(status)) {
      return res.status(400).json({ success: false, message: "status must be APPROVED, REJECTED or PENDING" });
    }
    if (mode !== "SELECTED" && (!Number.isFinite(approvedBy) || approvedBy <= 0)) {
      return res.status(400).json({ success: false, message: "approvedBy must be a positive number" });
    }
    if (mode === "COUNSELLOR" && (!Number.isFinite(counsellorId) || Number(counsellorId) <= 0)) {
      return res.status(400).json({ success: false, message: "counsellorId must be a positive number" });
    }
    if (mode === "SELECTED" && (!recordIds?.length || recordIds.some((v: number) => !Number.isFinite(v) || v <= 0))) {
      return res.status(400).json({ success: false, message: "incentive_record_ids must be a non-empty array of positive numbers" });
    }
    if (mode !== "SELECTED" && recordIds?.some((v: number) => !Number.isFinite(v) || v <= 0)) {
      return res.status(400).json({ success: false, message: "recordIds must contain only positive numbers" });
    }
    if (
      filterCounsellorIds?.some((v: number) => !Number.isFinite(v) || v <= 0) ||
      filterSaleTypeCategoryIds?.some((v: number) => !Number.isFinite(v) || v <= 0)
    ) {
      return res.status(400).json({
        success: false,
        message: "filters must contain only positive numbers",
      });
    }

    await bulkApproveIncentives({
      mode,
      status,
      counsellorId,
      recordIds,
      filters,
      approvedBy,
    });

    return res.status(200).json({
      success: true,
      message: "Bulk approval completed",
    });
  } catch (error) {
    console.error("postBulkApproveIncentivesController", error);
    return res.status(500).json({ success: false, message: "Bulk approval failed" });
  }
};

export const getIncentiveBreakdownController = async (req: Request, res: Response) => {
  try {
    const incentiveRecordId = Number(req.params.incentiveRecordId);
    if (!Number.isFinite(incentiveRecordId) || incentiveRecordId <= 0) {
      return res.status(400).json({
        success: false,
        message: "incentiveRecordId must be a positive number",
      });
    }

    const breakdownRows = await getIncentiveBreakdownByRecordId(incentiveRecordId);
    if (!breakdownRows.length) {
      return res.status(404).json({
        success: false,
        message: "Breakdown not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: breakdownRows,
    });
  } catch (error) {
    console.error("getIncentiveBreakdownController", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load breakdown",
    });
  }
};

export const postIncentiveBreakdownActionController = async (
  req: Request,
  res: Response
) => {
  try {
    const breakdownIdsRaw: unknown[] = Array.isArray(req.body?.breakdownIds) ? req.body.breakdownIds : [];
    const breakdownIds = breakdownIdsRaw
      .map((id: unknown) => Number(id))
      .filter((id: number) => Number.isFinite(id) && id > 0);
    const status = String(req.body?.status ?? "").toUpperCase() as "APPROVED" | "REJECTED" | "PENDING";
    const approvedBy = Number(req.body?.approvedBy);

    if (!breakdownIds.length || breakdownIds.length !== breakdownIdsRaw.length) {
      return res.status(400).json({
        success: false,
        message: "breakdownIds must be a non-empty array of positive numbers",
      });
    }

    if (!["APPROVED", "REJECTED", "PENDING"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "status must be APPROVED, REJECTED or PENDING",
      });
    }

    if (!Number.isFinite(approvedBy) || approvedBy <= 0) {
      return res.status(400).json({
        success: false,
        message: "approvedBy must be a positive number",
      });
    }

    const updatedCount = await updateBreakdownStatusAction({
      breakdownIds,
      status,
      approvedBy,
    });

    if (!updatedCount) {
      return res.status(404).json({
        success: false,
        message: "Failed to update breakdown",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Breakdown updated successfully",
    });
  } catch (error) {
    console.error("postIncentiveBreakdownActionController", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update breakdown",
    });
  }
};
