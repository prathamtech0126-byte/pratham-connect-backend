import { Request, Response } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../config/databaseConnection";
import { redisDelByPrefix, redisGetJson, redisSetJson } from "../config/redis";
import { AuthenticatedRequest } from "../types/express-auth";
import {
  createDeviceInventory,
  getDeviceInventory,
  getAvailableDeviceInventory,
  assignDeviceInventory,
  getDeviceAssignmentHistory,
  unassignDeviceInventory,
  unassignDevicesForUser,
  updateDeviceRepairStatus,
  deleteDeviceInventory,
  getAssignedDeviceByUserId,
  updateDeviceInventory,
} from "../models/deviceInventory.model";
import { emitDeviceInventoryEvent, DEVICE_INVENTORY_EVENT } from "../services/deviceInventory.service";
import { users } from "../schemas/users.schema";

const CACHE_TTL_SECONDS = 5;
const CACHE_PREFIX = "techsupport:devices:";

const invalidateDeviceCaches = async () => {
  await redisDelByPrefix(CACHE_PREFIX);
};

const parseBodyInt = (value: unknown): number | null => {
  const num = typeof value === "string" || typeof value === "number" ? Number(value) : NaN;
  return Number.isFinite(num) ? num : null;
};

const SINGLE_PRODUCT_NUMBER_TYPES = new Set(["laptop", "monitor", "mobile"]);

const getAssignableUsers = async () => {
  // Tech support assigns devices to most non-admin roles.
  // You can tighten this later if you want only counsellor/telecaller.
  const allowedRoles = [
    "counsellor",
    "telecaller",
    "manager",
    "team_lead",
    "backend_manager",
    "customer_experience",
    "binding_team",
    "application_team",
  ];

  return db
    .select({
      id: users.id,
      fullName: users.fullName,
      role: users.role,
      empId: users.emp_id,
      designation: users.designation,
      officePhone: users.officePhone,
      personalPhone: users.personalPhone,
      status: users.status,
    })
    .from(users)
    .where(and(eq(users.status, true), inArray(users.role, allowedRoles)));
};

export const createDeviceInventoryController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.user) return res.status(401).json({ success: false, message: "Authentication required" });

    const body = req.body || {};
    const deviceType = String(body.deviceType || body.device_type || "").trim().toLowerCase();
    const deviceName = body.deviceName != null ? String(body.deviceName).trim() : body.device_name != null ? String(body.device_name).trim() : null;
    const prathamProductCode =
      body.prathamProductCode != null
        ? String(body.prathamProductCode).trim()
        : body.pratham_product_code != null
          ? String(body.pratham_product_code).trim()
          : null;
    const product = body.product != null ? String(body.product).trim() : null;
    const accessories = body.accessories != null ? String(body.accessories).trim() : null;
    const hardwareDetail = body.hardwareDetail != null ? String(body.hardwareDetail).trim() : body.hardware_detail != null ? String(body.hardware_detail).trim() : null;
    const serialNumber = body.serialNumber != null ? String(body.serialNumber).trim() : body.serial_number != null ? String(body.serial_number).trim() : null;
    const vendorName = body.vendorName != null ? String(body.vendorName).trim() : body.vendor_name != null ? String(body.vendor_name).trim() : null;
    const invoice = body.invoice != null ? String(body.invoice).trim() : null;
    const invoiceDate = body.invoiceDate != null ? String(body.invoiceDate).trim() : body.invoice_date != null ? String(body.invoice_date).trim() : null;
    const price = body.price != null ? String(body.price).trim() : null;
    const productNumber = body.productNumber != null ? String(body.productNumber).trim() : body.product_number != null ? String(body.product_number).trim() : null;
    const companyType = body.companyType != null ? String(body.companyType).trim() : body.company_type != null ? String(body.company_type).trim() : null;

    if (!deviceType) return res.status(400).json({ success: false, message: "deviceType is required" });
    if (deviceType === "other" && !deviceName) return res.status(400).json({ success: false, message: "deviceName is required for other" });

    // Expensive categories must be single unit with fixed product number.
    if (SINGLE_PRODUCT_NUMBER_TYPES.has(deviceType) && !prathamProductCode) {
      return res.status(400).json({
        success: false,
        message: `prathamProductCode is required for ${deviceType}`,
      });
    }

    const created = await createDeviceInventory({
      deviceType,
      deviceName,
      prathamProductCode,
      product,
      accessories,
      hardwareDetail,
      serialNumber,
      vendorName,
      invoice,
      invoiceDate,
      price,
      productNumber,
      companyType,
    });

    await invalidateDeviceCaches();
    emitDeviceInventoryEvent({ action: "created", deviceIds: created.map((r: any) => r.id), ts: Date.now() });

    return res.status(201).json({ success: true, data: created });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error?.message || "Failed to create device" });
  }
};

export const createBulkDeviceInventoryController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.user) return res.status(401).json({ success: false, message: "Authentication required" });

    const body = req.body || {};
    const { baseFormData, quantity, startingPrathamProductCode } = body;

    // Validate inputs
    if (!baseFormData) return res.status(400).json({ success: false, message: "baseFormData is required" });
    if (!quantity || Number(quantity) < 2 || Number(quantity) > 100) {
      return res.status(400).json({ success: false, message: "Quantity must be between 2 and 100" });
    }
    if (!startingPrathamProductCode) return res.status(400).json({ success: false, message: "startingPrathamProductCode is required" });

    // Extract base and number from starting code
    const match = String(startingPrathamProductCode).match(/^(.*?)(\d+)$/);
    if (!match) {
      return res.status(400).json({ success: false, message: "Product code must end with a number (e.g., pratham912)" });
    }

    const [, codeBase, numberStr] = match;
    const startingNumber = Number(numberStr);
    const qty = Number(quantity);

    // Validate base form data
    const deviceType = String(baseFormData.deviceType || "").trim().toLowerCase();
    const deviceName = baseFormData.deviceName != null ? String(baseFormData.deviceName).trim() : null;
    const product = baseFormData.product != null ? String(baseFormData.product).trim() : null;
    const accessories = baseFormData.accessories != null ? String(baseFormData.accessories).trim() : null;
    const hardwareDetail = baseFormData.hardwareDetail != null ? String(baseFormData.hardwareDetail).trim() : null;
    const serialNumber = baseFormData.serialNumber != null ? String(baseFormData.serialNumber).trim() : null;
    const vendorName = baseFormData.vendorName != null ? String(baseFormData.vendorName).trim() : null;
    const invoice = baseFormData.invoice != null ? String(baseFormData.invoice).trim() : null;
    const invoiceDate = baseFormData.invoiceDate != null ? String(baseFormData.invoiceDate).trim() : null;
    const price = baseFormData.price != null ? String(baseFormData.price).trim() : null;
    const productNumber = baseFormData.productNumber != null ? String(baseFormData.productNumber).trim() : null;
    const companyType = baseFormData.companyType != null ? String(baseFormData.companyType).trim() : null;

    if (!deviceType) return res.status(400).json({ success: false, message: "deviceType is required" });
    if (deviceType === "other" && !deviceName) return res.status(400).json({ success: false, message: "deviceName is required for other" });

    // Generate device data for each quantity
    const devicesList = [];
    for (let i = 0; i < qty; i++) {
      const generatedCode = `${codeBase}${startingNumber + i}`;
      devicesList.push({
        deviceType,
        deviceName,
        prathamProductCode: generatedCode,
        product,
        accessories,
        hardwareDetail,
        serialNumber,
        vendorName,
        invoice,
        invoiceDate,
        price,
        productNumber,
        companyType,
      });
    }

    // Create all devices
    const created = await Promise.all(
      devicesList.map((deviceData) =>
        createDeviceInventory(deviceData)
      )
    );

    const flattened = created.flat();

    await invalidateDeviceCaches();
    emitDeviceInventoryEvent({ action: "created", deviceIds: flattened.map((r: any) => r.id), ts: Date.now() });

    return res.status(201).json({ success: true, data: flattened });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error?.message || "Failed to create bulk devices" });
  }
};

export const getAllDeviceInventoryController = async (_req: Request, res: Response) => {
  try {
    // Note: Cache disabled for inventory to prevent race conditions during rapid assignments/unassignments
    const devices = await getDeviceInventory();
    return res.json({ success: true, data: devices });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to fetch devices" });
  }
};

export const getAssignedDeviceByUserIdController = async (req: Request, res: Response) => {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }

    const device = await getAssignedDeviceByUserId(userId);
    return res.json({ success: true, data: device });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to fetch assigned device" });
  }
};

export const getAvailableDeviceInventoryController = async (req: Request, res: Response) => {
  try {
    const deviceType = req.query.deviceType ? String(req.query.deviceType).trim().toLowerCase() : null;
    const cacheKey = `${CACHE_PREFIX}available:v1:${deviceType || "all"}`;

    const cached = await redisGetJson<any[]>(cacheKey);
    if (cached) return res.json({ success: true, data: cached });

    const devices = await getAvailableDeviceInventory();
    const filtered = deviceType ? devices.filter((d: any) => d.deviceType === deviceType) : devices;
    await redisSetJson(cacheKey, filtered, CACHE_TTL_SECONDS);

    return res.json({ success: true, data: filtered });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to fetch available devices" });
  }
};

export const assignDeviceInventoryController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.user) return res.status(401).json({ success: false, message: "Authentication required" });

    const deviceId = Number(req.params.deviceId);
    const userId = parseBodyInt(req.body?.userId);
    const assignmentAccessories =
      req.body?.assignmentAccessories != null
        ? String(req.body.assignmentAccessories).trim()
        : req.body?.assignment_accessories != null
          ? String(req.body.assignment_accessories).trim()
          : null;

    if (!Number.isFinite(deviceId) || deviceId <= 0) return res.status(400).json({ success: false, message: "Invalid deviceId" });
    if (!userId) return res.status(400).json({ success: false, message: "userId is required" });

    const updated = await assignDeviceInventory({
      deviceId,
      userId,
      actorId: authReq.user.id,
      assignmentAccessories,
    });

    if (!updated) return res.status(404).json({ success: false, message: "Device not found" });

    await invalidateDeviceCaches();
    emitDeviceInventoryEvent({ action: "assigned", deviceId, userId, ts: Date.now() });

    return res.json({ success: true, data: updated });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error?.message || "Failed to assign device" });
  }
};

export const unassignDeviceInventoryController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.user) return res.status(401).json({ success: false, message: "Authentication required" });

    const deviceId = Number(req.params.deviceId);
    if (!Number.isFinite(deviceId) || deviceId <= 0) return res.status(400).json({ success: false, message: "Invalid deviceId" });

    const updated = await unassignDeviceInventory({ deviceId });
    if (!updated) return res.status(404).json({ success: false, message: "Device not found" });

    await invalidateDeviceCaches();
    emitDeviceInventoryEvent({ action: "unassigned", deviceId, ts: Date.now(), byUserId: authReq.user.id });

    return res.json({ success: true, data: updated });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error?.message || "Failed to unassign device" });
  }
};

export const unassignDevicesForUserLeavingController = async (userId: number) => {
  // Controller helper used from `user.controller.ts` when status flips to false.
  await unassignDevicesForUser({ userId });
  await invalidateDeviceCaches();
  emitDeviceInventoryEvent({ action: "user_left", userId, ts: Date.now() });
};

export const getDeviceAssignmentHistoryController = async (req: Request, res: Response) => {
  try {
    const deviceId = Number(req.query.deviceId || req.query.device_id);
    const userId = req.query.userId || req.query.user_id;

    if (!Number.isFinite(deviceId) || deviceId <= 0) {
      return res.status(400).json({ success: false, message: "deviceId is required" });
    }

    const userIdNum = userId != null && userId !== "" ? Number(userId) : undefined;
    if (userIdNum != null && (!Number.isFinite(userIdNum) || userIdNum <= 0)) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }

    const cacheKey = `${CACHE_PREFIX}assignment-history:v1:${deviceId}:${userIdNum ?? "all"}`;
    const cached = await redisGetJson<any[]>(cacheKey);
    if (cached) return res.json({ success: true, data: cached });

    const history = await getDeviceAssignmentHistory({ deviceId, userId: userIdNum });
    await redisSetJson(cacheKey, history, CACHE_TTL_SECONDS);
    return res.json({ success: true, data: history });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to fetch assignment history" });
  }
};

export const getTechAssignableUsersController = async (_req: Request, res: Response) => {
  try {
    // Note: Cache disabled to prevent stale data during rapid device assignments
    const rows = await getAssignableUsers();
    // Keep tech support dropdown snappy: return only what is needed for display.
    const simplified = rows.map((r: any) => ({
      id: r.id,
      fullName: r.fullName,
      role: r.role,
      empId: r.empId,
      designation: r.designation,
      officePhone: r.officePhone,
      personalPhone: r.personalPhone,
    }));

    return res.json({ success: true, data: simplified });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to fetch assignable users" });
  }
};

export const toggleDeviceRepairStatusController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.user) return res.status(401).json({ success: false, message: "Authentication required" });

    const deviceId = Number(req.params.deviceId);
    const onRepair = req.body.onRepair === true;

    if (!Number.isFinite(deviceId) || deviceId <= 0) {
      return res.status(400).json({ success: false, message: "Invalid deviceId" });
    }

    const updated = await updateDeviceRepairStatus({ deviceId, onRepair });
    if (!updated) return res.status(404).json({ success: false, message: "Device not found" });

    await invalidateDeviceCaches();
    emitDeviceInventoryEvent({ action: "repair_status_updated", deviceId, onRepair, ts: Date.now() });

    return res.json({ success: true, data: updated });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error?.message || "Failed to update repair status" });
  }
};

export const updateDeviceInventoryController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.user) return res.status(401).json({ success: false, message: "Authentication required" });

    const deviceId = Number(req.params.deviceId);
    if (!Number.isFinite(deviceId) || deviceId <= 0) {
      return res.status(400).json({ success: false, message: "Invalid deviceId" });
    }

    const body = req.body || {};
    const updated = await updateDeviceInventory({
      deviceId,
      deviceType: body.deviceType ? String(body.deviceType).trim().toLowerCase() : undefined,
      deviceName: body.deviceName !== undefined ? (body.deviceName ? String(body.deviceName).trim() : null) : undefined,
      prathamProductCode: body.prathamProductCode !== undefined ? (body.prathamProductCode ? String(body.prathamProductCode).trim() : null) : undefined,
      hardwareDetail: body.hardwareDetail !== undefined ? (body.hardwareDetail ? String(body.hardwareDetail).trim() : null) : undefined,
      serialNumber: body.serialNumber !== undefined ? (body.serialNumber ? String(body.serialNumber).trim() : null) : undefined,
      vendorName: body.vendorName !== undefined ? (body.vendorName ? String(body.vendorName).trim() : null) : undefined,
      invoice: body.invoice !== undefined ? (body.invoice ? String(body.invoice).trim() : null) : undefined,
      invoiceDate: body.invoiceDate !== undefined ? (body.invoiceDate ? String(body.invoiceDate).trim() : null) : undefined,
      price: body.price !== undefined ? (body.price ? String(body.price).trim() : null) : undefined,
      companyType: body.companyType !== undefined ? (body.companyType ? String(body.companyType).trim() : null) : undefined,
      productNumber: body.productNumber !== undefined ? (body.productNumber ? String(body.productNumber).trim() : null) : undefined,
    });

    if (!updated) return res.status(404).json({ success: false, message: "Device not found" });

    await invalidateDeviceCaches();
    emitDeviceInventoryEvent({ action: "updated", deviceId, ts: Date.now() });

    return res.json({ success: true, data: updated });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error?.message || "Failed to update device" });
  }
};

export const deleteDeviceInventoryController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.user) return res.status(401).json({ success: false, message: "Authentication required" });

    const deviceId = Number(req.params.deviceId);
    if (!Number.isFinite(deviceId) || deviceId <= 0) {
      return res.status(400).json({ success: false, message: "Invalid deviceId" });
    }

    const deleted = await deleteDeviceInventory({ deviceId });
    if (!deleted) return res.status(404).json({ success: false, message: "Device not found" });

    await invalidateDeviceCaches();
    emitDeviceInventoryEvent({ action: "deleted", deviceId, ts: Date.now() });

    return res.json({ success: true, message: "Device deleted successfully" });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error?.message || "Failed to delete device" });
  }
};

