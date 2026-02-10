import { Request, Response } from "express";
import { createLeadType, deleteLeadType, getAllLeadTypes, updateLeadType } from "../models/leadType.model";
import { redisDel, redisGetJson, redisSetJson } from "../config/redis";

const LEAD_TYPES_CACHE_KEY = "lead-types";
const LEAD_TYPES_CACHE_TTL_SECONDS = 300; // 5 min

/* ==============================
   CREATE
============================== */
export const createLeadTypeController = async (
  req: Request,
  res: Response
) => {
  try {
    const leadType = await createLeadType(req.body);
    try {
      await redisDel(LEAD_TYPES_CACHE_KEY);
    } catch {
      // ignore
    }
    res.status(201).json({ success: true, data: leadType });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

/* ==============================
   GET
============================== */
export const getLeadTypesController = async (
  req: Request,
  res: Response
) => {
  const cached = await redisGetJson<any[]>(LEAD_TYPES_CACHE_KEY);
  if (cached) {
    return res.json({ success: true, data: cached, cached: true });
  }
  const leadTypes = await getAllLeadTypes();
  await redisSetJson(LEAD_TYPES_CACHE_KEY, leadTypes, LEAD_TYPES_CACHE_TTL_SECONDS);
  res.json({ success: true, data: leadTypes });
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
    try {
      await redisDel(LEAD_TYPES_CACHE_KEY);
    } catch {
      // ignore
    }
    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

/* ==============================
   DELETE
============================== */
export const deleteLeadTypeController = async (
  req: Request,
  res: Response
) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) throw new Error("Invalid lead type id");

    const result = await deleteLeadType(id);
    try {
      await redisDel(LEAD_TYPES_CACHE_KEY);
    } catch {
      // ignore
    }
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};
