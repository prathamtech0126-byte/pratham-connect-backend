import { Request, Response } from "express";
import {
  getRules,
  getSpouseRules,
  getVisitorRules,
  getCanadaStudentRules,
  getStudentRules,
  getAllFinanceRules,
  upsertRules,
  type IncentiveRulesPayload,
  type RangeRuleItem,
  type CategoryRuleItem,
} from "../models/incentiveRules.model";
import { logActivity } from "../services/activityLog.service";
import { redisGetJson, redisSetJson, redisDel } from "../config/redis";

const CACHE_KEY            = "incentive-rules:all";
const CACHE_KEY_SPOUSE     = "incentive-rules:spouse";
const CACHE_KEY_VISITOR    = "incentive-rules:visitor";
const CACHE_KEY_CANADA     = "incentive-rules:canada-student";
const CACHE_KEY_STUDENT    = "incentive-rules:student";
const CACHE_KEY_ALL_FINANCE = "incentive-rules:all-finance";
const CACHE_TTL = 600;

const invalidateAll = () =>
  Promise.allSettled([
    redisDel(CACHE_KEY),
    redisDel(CACHE_KEY_SPOUSE),
    redisDel(CACHE_KEY_VISITOR),
    redisDel(CACHE_KEY_CANADA),
    redisDel(CACHE_KEY_STUDENT),
    redisDel(CACHE_KEY_ALL_FINANCE),
  ]);

// ── GET all ──────────────────────────────────────────────────────────────────

export const getIncentiveRulesController = async (_req: Request, res: Response) => {
  try {
    const cached = await redisGetJson<IncentiveRulesPayload>(CACHE_KEY);
    if (cached) return res.status(200).json({ success: true, data: cached });
    const data = await getRules();
    await redisSetJson(CACHE_KEY, data, CACHE_TTL);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ── GET per group ─────────────────────────────────────────────────────────────

export const getSpouseRulesController = async (_req: Request, res: Response) => {
  try {
    const cached = await redisGetJson(CACHE_KEY_SPOUSE);
    if (cached) return res.status(200).json({ success: true, data: cached });
    const data = await getSpouseRules();
    await redisSetJson(CACHE_KEY_SPOUSE, data, CACHE_TTL);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getVisitorRulesController = async (_req: Request, res: Response) => {
  try {
    const cached = await redisGetJson(CACHE_KEY_VISITOR);
    if (cached) return res.status(200).json({ success: true, data: cached });
    const data = await getVisitorRules();
    await redisSetJson(CACHE_KEY_VISITOR, data, CACHE_TTL);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getCanadaStudentRulesController = async (_req: Request, res: Response) => {
  try {
    const cached = await redisGetJson(CACHE_KEY_CANADA);
    if (cached) return res.status(200).json({ success: true, data: cached });
    const data = await getCanadaStudentRules();
    await redisSetJson(CACHE_KEY_CANADA, data, CACHE_TTL);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getStudentRulesController = async (_req: Request, res: Response) => {
  try {
    const cached = await redisGetJson(CACHE_KEY_STUDENT);
    if (cached) return res.status(200).json({ success: true, data: cached });
    const data = await getStudentRules();
    await redisSetJson(CACHE_KEY_STUDENT, data, CACHE_TTL);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getAllFinanceRulesController = async (_req: Request, res: Response) => {
  try {
    const cached = await redisGetJson(CACHE_KEY_ALL_FINANCE);
    if (cached) return res.status(200).json({ success: true, data: cached });
    const data = await getAllFinanceRules();
    await redisSetJson(CACHE_KEY_ALL_FINANCE, data, CACHE_TTL);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ── PUT per group ─────────────────────────────────────────────────────────────

export const upsertSpouseRulesController = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    const body = req.body as { coreSpouseRules?: RangeRuleItem[]; financeSpouseRules?: RangeRuleItem[] };
    if (!Array.isArray(body.coreSpouseRules) && !Array.isArray(body.financeSpouseRules)) {
      return res.status(400).json({ success: false, message: "coreSpouseRules or financeSpouseRules required" });
    }
    const payload: Partial<IncentiveRulesPayload> = {};
    if (Array.isArray(body.coreSpouseRules))    payload.coreSpouseRules    = body.coreSpouseRules;
    if (Array.isArray(body.financeSpouseRules)) payload.financeSpouseRules = body.financeSpouseRules;
    const saved = await upsertRules(payload);
    await invalidateAll();
    await logActivity(req, { entityType: "incentive_rules", action: "UPDATE", newValue: payload, description: "Spouse incentive rules updated", performedBy: req.user.id }).catch(() => {});
    return res.status(200).json({ success: true, data: { coreSpouseRules: saved.coreSpouseRules, financeSpouseRules: saved.financeSpouseRules } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const upsertVisitorRulesController = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    const body = req.body as { coreVisitorRules?: CategoryRuleItem[]; visitorProductRules?: CategoryRuleItem[] };
    if (!Array.isArray(body.coreVisitorRules) && !Array.isArray(body.visitorProductRules)) {
      return res.status(400).json({ success: false, message: "coreVisitorRules or visitorProductRules required" });
    }
    const payload: Partial<IncentiveRulesPayload> = {};
    if (Array.isArray(body.coreVisitorRules))    payload.coreVisitorRules    = body.coreVisitorRules;
    if (Array.isArray(body.visitorProductRules)) payload.visitorProductRules = body.visitorProductRules;
    const saved = await upsertRules(payload);
    await invalidateAll();
    await logActivity(req, { entityType: "incentive_rules", action: "UPDATE", newValue: payload, description: "Visitor incentive rules updated", performedBy: req.user.id }).catch(() => {});
    return res.status(200).json({ success: true, data: { coreVisitorRules: saved.coreVisitorRules, visitorProductRules: saved.visitorProductRules } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const upsertCanadaStudentRulesController = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    const { canadaStudentRules } = req.body as { canadaStudentRules?: RangeRuleItem[] };
    if (!Array.isArray(canadaStudentRules)) {
      return res.status(400).json({ success: false, message: "canadaStudentRules array required" });
    }
    const saved = await upsertRules({ canadaStudentRules });
    await invalidateAll();
    await logActivity(req, { entityType: "incentive_rules", action: "UPDATE", newValue: { canadaStudentRules }, description: "Canada student incentive rules updated", performedBy: req.user.id }).catch(() => {});
    return res.status(200).json({ success: true, data: saved.canadaStudentRules });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const upsertStudentRulesController = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    const { studentRules } = req.body as { studentRules?: RangeRuleItem[] };
    if (!Array.isArray(studentRules)) {
      return res.status(400).json({ success: false, message: "studentRules array required" });
    }
    const saved = await upsertRules({ studentRules });
    await invalidateAll();
    await logActivity(req, { entityType: "incentive_rules", action: "UPDATE", newValue: { studentRules }, description: "Student incentive rules updated", performedBy: req.user.id }).catch(() => {});
    return res.status(200).json({ success: true, data: saved.studentRules });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const upsertAllFinanceRulesController = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    const { allFinanceRules } = req.body as { allFinanceRules?: RangeRuleItem[] };
    if (!Array.isArray(allFinanceRules)) {
      return res.status(400).json({ success: false, message: "allFinanceRules array required" });
    }
    const saved = await upsertRules({ allFinanceRules });
    await invalidateAll();
    await logActivity(req, { entityType: "incentive_rules", action: "UPDATE", newValue: { allFinanceRules }, description: "All finance incentive rules updated", performedBy: req.user.id }).catch(() => {});
    return res.status(200).json({ success: true, data: saved.allFinanceRules });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ── PUT all (bulk replace) ────────────────────────────────────────────────────

export const upsertIncentiveRulesController = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    const body = req.body as Partial<IncentiveRulesPayload>;
    const payload: Partial<IncentiveRulesPayload> = {};
    if (Array.isArray(body.coreSpouseRules))     payload.coreSpouseRules     = body.coreSpouseRules;
    if (Array.isArray(body.financeSpouseRules))  payload.financeSpouseRules  = body.financeSpouseRules;
    if (Array.isArray(body.coreVisitorRules))    payload.coreVisitorRules    = body.coreVisitorRules;
    if (Array.isArray(body.visitorProductRules)) payload.visitorProductRules = body.visitorProductRules;
    if (Array.isArray(body.canadaStudentRules))  payload.canadaStudentRules  = body.canadaStudentRules;
    if (Array.isArray(body.studentRules))        payload.studentRules        = body.studentRules;
    if (Array.isArray(body.allFinanceRules))     payload.allFinanceRules     = body.allFinanceRules;
    const saved = await upsertRules(payload);
    await invalidateAll();
    await logActivity(req, { entityType: "incentive_rules", action: "UPDATE", newValue: saved, description: "Incentive rules updated", performedBy: req.user.id }).catch(() => {});
    return res.status(200).json({ success: true, data: saved });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
