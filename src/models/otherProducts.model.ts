import { eq, desc, and, like, or, SQL } from "drizzle-orm";
import { db } from "../config/databaseConnection";
import { otherProducts, OtherProduct, NewOtherProduct } from "../schemas/otherProducts.schema";
import { redisDel, redisGetJson, redisSetJson } from "../config/redis";

const CACHE_TTL = 600; // 10 minutes
const CACHE_KEY_PREFIX = "other_products";

// Get all products with optional filtering
export async function getAllProducts(filters?: {
  category?: string;
  isActive?: boolean;
  search?: string;
}): Promise<OtherProduct[]> {
  const cacheKey = `${CACHE_KEY_PREFIX}:all:${JSON.stringify(filters || {})}`;
  
  // Try to get from cache
  const cached = await redisGetJson<OtherProduct[]>(cacheKey);
  if (cached) return cached;

  const conditions: SQL[] = [];

  if (filters?.category) {
    conditions.push(eq(otherProducts.category, filters.category));
  }

  if (filters?.isActive !== undefined) {
    conditions.push(eq(otherProducts.isActive, filters.isActive));
  }

  if (filters?.search) {
    conditions.push(
      or(
        like(otherProducts.name, `%${filters.search}%`),
        like(otherProducts.productName, `%${filters.search}%`),
        like(otherProducts.description, `%${filters.search}%`)
      ) as SQL
    );
  }

  const results = await db
    .select()
    .from(otherProducts)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(otherProducts.displayOrder), otherProducts.name);
  
  // Cache the results
  await redisSetJson(cacheKey, results, CACHE_TTL);
  
  return results;
}

// Get active products grouped by category
export async function getProductsByCategory(): Promise<Record<string, OtherProduct[]>> {
  const cacheKey = `${CACHE_KEY_PREFIX}:grouped`;
  
  const cached = await redisGetJson<Record<string, OtherProduct[]>>(cacheKey);
  if (cached) return cached;

  const products = await getAllProducts({ isActive: true });
  const grouped = products.reduce((acc, product) => {
    if (!acc[product.category]) {
      acc[product.category] = [];
    }
    acc[product.category].push(product);
    return acc;
  }, {} as Record<string, OtherProduct[]>);

  await redisSetJson(cacheKey, grouped, CACHE_TTL);
  return grouped;
}

// Get product by ID
export async function getProductById(id: number): Promise<OtherProduct | undefined> {
  const cacheKey = `${CACHE_KEY_PREFIX}:id:${id}`;
  
  const cached = await redisGetJson<OtherProduct>(cacheKey);
  if (cached) return cached;

  const results = await db.select().from(otherProducts).where(eq(otherProducts.id, id));
  const product = results[0];
  
  if (product) {
    await redisSetJson(cacheKey, product, CACHE_TTL);
  }
  
  return product;
}

// Get product by productId (string identifier)
export async function getProductByProductId(productId: string): Promise<OtherProduct | undefined> {
  const results = await db.select().from(otherProducts).where(eq(otherProducts.productId, productId));
  return results[0];
}

// Get product by productName (enum value)
export async function getProductByProductName(productName: string): Promise<OtherProduct | undefined> {
  const results = await db.select().from(otherProducts).where(eq(otherProducts.productName, productName));
  return results[0];
}

// Create new product
export async function createProduct(data: Omit<NewOtherProduct, "id" | "createdAt" | "updatedAt">): Promise<OtherProduct> {
  const results = await db.insert(otherProducts).values(data).returning();
  await invalidateProductCache();
  return results[0];
}

// Update product
export async function updateProduct(id: number, data: Partial<Omit<NewOtherProduct, "id" | "createdAt" | "updatedAt">>): Promise<OtherProduct | undefined> {
  const results = await db.update(otherProducts)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(otherProducts.id, id))
    .returning();
  
  if (results[0]) {
    await invalidateProductCache(id);
  }
  
  return results[0];
}

// Delete product (soft delete by setting isActive=false)
export async function deleteProduct(id: number): Promise<boolean> {
  const result = await db.update(otherProducts)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(otherProducts.id, id));
  
  await invalidateProductCache(id);
  return (result.rowCount ?? 0) > 0;
}

// Hard delete product (permanent)
export async function hardDeleteProduct(id: number): Promise<boolean> {
  const result = await db.delete(otherProducts).where(eq(otherProducts.id, id));
  await invalidateProductCache(id);
  return (result.rowCount ?? 0) > 0;
}

// Bulk insert products (for seeding)
export async function bulkInsertProducts(products: Omit<NewOtherProduct, "id" | "createdAt" | "updatedAt">[]): Promise<OtherProduct[]> {
  const results = await db.insert(otherProducts).values(products).returning();
  await invalidateProductCache();
  return results;
}

// Bulk update product status
export async function updateProductsStatus(ids: number[], isActive: boolean): Promise<number> {
  const result = await db.update(otherProducts)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(otherProducts.id, ids[0])); // This only works for single ID, need to fix
  
  // Better approach for multiple IDs:
  for (const id of ids) {
    await db.update(otherProducts)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(otherProducts.id, id));
  }
  
  await invalidateProductCache();
  return ids.length;
}

// Helper to invalidate cache
async function invalidateProductCache(productId?: number): Promise<void> {
  // Clear all product-related caches
  const patterns = [
    `${CACHE_KEY_PREFIX}:all:*`,
    `${CACHE_KEY_PREFIX}:grouped`,
  ];
  
  if (productId) {
    patterns.push(`${CACHE_KEY_PREFIX}:id:${productId}`);
  }
  
  for (const pattern of patterns) {
    await redisDel(pattern);
  }
}

// Get distinct categories
export async function getDistinctCategories(): Promise<string[]> {
  const cacheKey = `${CACHE_KEY_PREFIX}:categories`;
  
  const cached = await redisGetJson<string[]>(cacheKey);
  if (cached) return cached;

  const results = await db.select({ category: otherProducts.category })
    .from(otherProducts)
    .groupBy(otherProducts.category);
  
  const categories = results.map(r => r.category);
  await redisSetJson(cacheKey, categories, CACHE_TTL);
  
  return categories;
}