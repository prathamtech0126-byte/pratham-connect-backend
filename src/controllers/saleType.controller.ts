import { Request, Response } from "express";
import {
  createSaleType,
  getAllSaleTypes,
  updateSaleType,
  deleteSaleType,
} from "../models/saleType.model";
import { redisDel, redisGetJson, redisSetJson } from "../config/redis";

const SALE_TYPES_CACHE_KEY = "sale-types";
const SALE_TYPES_CACHE_TTL_SECONDS = 300; // 5 min

/* ==============================
   CREATE
============================== */
export const createSaleTypeController = async (
  req: Request,
  res: Response
) => {
  try {
    const saleType = await createSaleType(req.body);
    try {
      await redisDel(SALE_TYPES_CACHE_KEY);
    } catch {
      // ignore
    }
    res.status(201).json({ success: true, data: saleType });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

/* ==============================
   GET
============================== */
export const getSaleTypesController = async (
  req: Request,
  res: Response
) => {
  const cached = await redisGetJson<any[]>(SALE_TYPES_CACHE_KEY);
  if (cached) {
    return res.json({ success: true, data: cached, cached: true });
  }
  const saleTypes = await getAllSaleTypes();
  await redisSetJson(SALE_TYPES_CACHE_KEY, saleTypes, SALE_TYPES_CACHE_TTL_SECONDS);
  res.json({ success: true, data: saleTypes });
};

/* ==============================
   UPDATE
============================== */
export const updateSaleTypeController = async (
  req: Request,
  res: Response
) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) throw new Error("Invalid sale type id");
    const updated = await updateSaleType(id, req.body);
    try {
      await redisDel(SALE_TYPES_CACHE_KEY);
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
export const deleteSaleTypeController = async (
  req: Request,
  res: Response
) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) throw new Error("Invalid sale type id");

    const result = await deleteSaleType(id);
    try {
      await redisDel(SALE_TYPES_CACHE_KEY);
    } catch {
      // ignore
    }
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};
