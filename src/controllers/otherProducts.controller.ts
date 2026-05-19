import { Request, Response } from "express";
import * as otherProductsModel from "../models/otherProducts.model";
import { logActivity } from "../services/activityLog.service";

// Get all products
export async function getProducts(req: Request, res: Response): Promise<void> {
  try {
    const { category, isActive, search } = req.query;
    
    const filters: {
      category?: string;
      isActive?: boolean;
      search?: string;
    } = {};
    
    if (category) filters.category = category as string;
    if (isActive !== undefined) filters.isActive = isActive === "true";
    if (search) filters.search = search as string;
    
    const products = await otherProductsModel.getAllProducts(filters);
    res.json({
      success: true,
      data: products,
      count: products.length,
    });
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch products",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

// Get products grouped by category
export async function getProductsByCategory(req: Request, res: Response): Promise<void> {
  try {
    const grouped = await otherProductsModel.getProductsByCategory();
    res.json({
      success: true,
      data: grouped,
    });
  } catch (error) {
    console.error("Error fetching grouped products:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch grouped products",
    });
  }
}

// Get single product
export async function getProduct(req: Request, res: Response): Promise<void> {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ success: false, message: "Invalid product ID" });
      return;
    }
    
    const product = await otherProductsModel.getProductById(id);
    if (!product) {
      res.status(404).json({ success: false, message: "Product not found" });
      return;
    }
    
    res.json({ success: true, data: product });
  } catch (error) {
    console.error("Error fetching product:", error);
    res.status(500).json({ success: false, message: "Failed to fetch product" });
  }
}

// Create new product
export async function createProduct(req: Request, res: Response): Promise<void> {
  try {
    const { productId, name, category, productName, formType, description, displayOrder, metadata } = req.body;
    
    // Validate required fields
    if (!productId || !name || !category || !productName || !formType) {
      res.status(400).json({
        success: false,
        message: "Missing required fields: productId, name, category, productName, formType",
      });
      return;
    }
    
    // Check if product with same productId or productName exists
    const existingById = await otherProductsModel.getProductByProductId(productId);
    if (existingById) {
      res.status(409).json({ success: false, message: "Product with this ID already exists" });
      return;
    }
    
    const existingByName = await otherProductsModel.getProductByProductName(productName);
    if (existingByName) {
      res.status(409).json({ success: false, message: "Product with this name already exists" });
      return;
    }
    
    const newProduct = await otherProductsModel.createProduct({
      productId,
      name,
      category,
      productName,
      formType,
      description: description || null,
      displayOrder: displayOrder || 0,
      metadata: metadata ? JSON.stringify(metadata) : null,
      isActive: true,
    });
    
    await logActivity(req, { entityType: "other_product", entityId: newProduct.id, action: "CREATE", description: `Created product: ${name}`, performedBy: (req as any).user?.id }).catch(() => {});
    
    res.status(201).json({
      success: true,
      message: "Product created successfully",
      data: newProduct,
    });
  } catch (error) {
    console.error("Error creating product:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create product",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

// Update product
export async function updateProduct(req: Request, res: Response): Promise<void> {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ success: false, message: "Invalid product ID" });
      return;
    }
    
    const { name, category, productName, formType, description, isActive, displayOrder, metadata } = req.body;
    
    // Check if product exists
    const existing = await otherProductsModel.getProductById(id);
    if (!existing) {
      res.status(404).json({ success: false, message: "Product not found" });
      return;
    }
    
    // If changing productName, check for conflicts
    if (productName && productName !== existing.productName) {
      const conflict = await otherProductsModel.getProductByProductName(productName);
      if (conflict && conflict.id !== id) {
        res.status(409).json({ success: false, message: "Product with this name already exists" });
        return;
      }
    }
    
    const updated = await otherProductsModel.updateProduct(id, {
      name: name || existing.name,
      category: category || existing.category,
      productName: productName || existing.productName,
      formType: formType || existing.formType,
      description: description !== undefined ? description : existing.description,
      isActive: isActive !== undefined ? isActive : existing.isActive,
      displayOrder: displayOrder !== undefined ? displayOrder : existing.displayOrder,
      metadata: metadata ? JSON.stringify(metadata) : existing.metadata,
    });
    
    await logActivity(req, { entityType: "other_product", entityId: id, action: "UPDATE", description: `Updated product: ${updated?.name}`, performedBy: (req as any).user?.id }).catch(() => {});
    
    res.json({
      success: true,
      message: "Product updated successfully",
      data: updated,
    });
  } catch (error) {
    console.error("Error updating product:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update product",
    });
  }
}

// Soft delete product (deactivate)
export async function deleteProduct(req: Request, res: Response): Promise<void> {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ success: false, message: "Invalid product ID" });
      return;
    }
    
    const product = await otherProductsModel.getProductById(id);
    if (!product) {
      res.status(404).json({ success: false, message: "Product not found" });
      return;
    }
    
    await otherProductsModel.deleteProduct(id);
    
    await logActivity(req, { entityType: "other_product", entityId: id, action: "DELETE", description: `Deactivated product: ${product.name}`, performedBy: (req as any).user?.id }).catch(() => {});
    
    res.json({
      success: true,
      message: "Product deactivated successfully",
    });
  } catch (error) {
    console.error("Error deleting product:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete product",
    });
  }
}

// Hard delete product (permanent)
export async function hardDeleteProduct(req: Request, res: Response): Promise<void> {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ success: false, message: "Invalid product ID" });
      return;
    }
    
    const product = await otherProductsModel.getProductById(id);
    if (!product) {
      res.status(404).json({ success: false, message: "Product not found" });
      return;
    }
    
    await otherProductsModel.hardDeleteProduct(id);
    
    await logActivity(req, { entityType: "other_product", entityId: id, action: "DELETE", description: `Permanently deleted product: ${product.name}`, performedBy: (req as any).user?.id }).catch(() => {});
    
    res.json({
      success: true,
      message: "Product permanently deleted",
    });
  } catch (error) {
    console.error("Error hard deleting product:", error);
    res.status(500).json({
      success: false,
      message: "Failed to permanently delete product",
    });
  }
}

// Get distinct categories
export async function getCategories(req: Request, res: Response): Promise<void> {
  try {
    const categories = await otherProductsModel.getDistinctCategories();
    res.json({
      success: true,
      data: categories,
    });
  } catch (error) {
    console.error("Error fetching categories:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch categories",
    });
  }
}

// Bulk update product status
export async function bulkUpdateStatus(req: Request, res: Response): Promise<void> {
  try {
    const { ids, isActive } = req.body;
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ success: false, message: "Invalid or empty ids array" });
      return;
    }
    
    if (typeof isActive !== "boolean") {
      res.status(400).json({ success: false, message: "isActive must be boolean" });
      return;
    }
    
    const count = await otherProductsModel.updateProductsStatus(ids, isActive);
    
    await logActivity(req, { entityType: "other_product", action: "UPDATE", description: `Bulk ${isActive ? "activated" : "deactivated"} ${count} products`, metadata: { ids }, performedBy: (req as any).user?.id }).catch(() => {});
    
    res.json({
      success: true,
      message: `${count} products ${isActive ? "activated" : "deactivated"} successfully`,
      count,
    });
  } catch (error) {
    console.error("Error bulk updating products:", error);
    res.status(500).json({
      success: false,
      message: "Failed to bulk update products",
    });
  }
}