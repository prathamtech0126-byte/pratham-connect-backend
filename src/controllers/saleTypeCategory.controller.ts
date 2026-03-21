import { Request, Response } from "express";
import {
  createSaleTypeCategory,
  getAllSaleTypeCategories,
  getSaleTypeCategoryById,
  updateSaleTypeCategory,
  deleteSaleTypeCategory,
} from "../models/saleTypeCategory.model";

export const createSaleTypeCategoryController = async (
  req: Request,
  res: Response
) => {
  try {
    console.log("createSaleTypeCategoryController req.body", req.body);
    const category = await createSaleTypeCategory(req.body);
    res.status(201).json({ success: true, data: category });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const getSaleTypeCategoriesController = async (
  req: Request,
  res: Response
) => {
  try {
    const categories = await getAllSaleTypeCategories();
    res.json({ success: true, data: categories });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getSaleTypeCategoryByIdController = async (
  req: Request,
  res: Response
) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id))
      return res.status(400).json({ success: false, message: "Invalid id" });
    const category = await getSaleTypeCategoryById(id);
    if (!category)
      return res.status(404).json({ success: false, message: "Category not found" });
    res.json({ success: true, data: category });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateSaleTypeCategoryController = async (
  req: Request,
  res: Response
) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id))
      return res.status(400).json({ success: false, message: "Invalid id" });
    const updated = await updateSaleTypeCategory(id, req.body);
    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const deleteSaleTypeCategoryController = async (
  req: Request,
  res: Response
) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id))
      return res.status(400).json({ success: false, message: "Invalid id" });
    const result = await deleteSaleTypeCategory(id);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};
