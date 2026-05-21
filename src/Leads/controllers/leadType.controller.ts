import { Request, Response } from "express";
import {
  archiveLeadType,
  createLeadType,
  getAllLeadTypes,
  unarchiveLeadType,
  updateLeadType,
  type LeadTypeStatusFilter,
} from "../models/leadType.model";
import { redisDel, redisGetJson, redisSetJson } from "../../config/redis";

const LEAD_TYPES_CACHE_TTL_SECONDS = 300; // 5 min

const STATUS_VALUES: LeadTypeStatusFilter[] = ["active", "archived", "all"];
const cacheKeyFor = (status: LeadTypeStatusFilter) => `lead-types:${status}`;

/** Drop every cached variant after any write. */
const invalidateLeadTypeCaches = async () => {
  try {
    await Promise.all(STATUS_VALUES.map((s) => redisDel(cacheKeyFor(s))));
  } catch {
    // non-fatal
  }
};

const parseStatus = (raw: unknown): LeadTypeStatusFilter => {
  const v = String(raw ?? "").trim().toLowerCase();
  return (STATUS_VALUES as string[]).includes(v)
    ? (v as LeadTypeStatusFilter)
    : "active";
};

/* ==============================
   CREATE
============================== */
export const createLeadTypeController = async (
  req: Request,
  res: Response
) => {
  try {
    const leadType = await createLeadType(req.body);
    await invalidateLeadTypeCaches();
    res.status(201).json({ success: true, data: leadType });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

/* ==============================
   GET
   Query: ?status=active|archived|all  (defaults to "active")
============================== */
export const getLeadTypesController = async (
  req: Request,
  res: Response
) => {
  const status = parseStatus(req.query.status);
  const cacheKey = cacheKeyFor(status);

  const cached = await redisGetJson<any[]>(cacheKey);
  if (cached) {
    return res.json({ success: true, data: cached, cached: true, status });
  }
  const leadTypes = await getAllLeadTypes(status);
  await redisSetJson(cacheKey, leadTypes, LEAD_TYPES_CACHE_TTL_SECONDS);
  res.json({ success: true, data: leadTypes, status });
};

/* ==============================
   UPDATE
============================== */
export const updateLeadTypeController = async (
  req: Request,
  res: Response
) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) throw new Error("Invalid lead type id");
    const updated = await updateLeadType(id, req.body);
    await invalidateLeadTypeCaches();
    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

/* ==============================
   ARCHIVE  (mounted on DELETE for backward compat)
============================== */
export const archiveLeadTypeController = async (
  req: Request,
  res: Response
) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) throw new Error("Invalid lead type id");

    const result = await archiveLeadType(id);
    await invalidateLeadTypeCaches();
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

/* ==============================
   UNARCHIVE
============================== */
export const unarchiveLeadTypeController = async (
  req: Request,
  res: Response
) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) throw new Error("Invalid lead type id");

    const result = await unarchiveLeadType(id);
    await invalidateLeadTypeCaches();
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};
