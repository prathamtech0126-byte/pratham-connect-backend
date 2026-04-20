import { and, eq, inArray, desc } from "drizzle-orm";
import { isNull } from "drizzle-orm";
import { db } from "../config/databaseConnection";
import { users } from "../schemas/users.schema";
import { deviceInventory, deviceInventoryAssignments, deviceInventoryTypeEnum } from "../schemas/deviceInventory.schema";

export type DeviceInventoryDeviceType = (typeof deviceInventoryTypeEnum.enumValues)[number];

// Expensive categories must be tracked as single units with a fixed product number.
const SINGLE_PRODUCT_NUMBER_TYPES = new Set<DeviceInventoryDeviceType>(["laptop", "monitor", "mobile"]);

type CreateDeviceInventoryInput = {
  deviceType: string;
  deviceName?: string | null;
  prathamProductCode?: string | null;
  product?: string | null;
  accessories?: string | null;
  hardwareDetail?: string | null;
  serialNumber?: string | null;
  vendorName?: string | null;
  invoice?: string | null;
  invoiceDate?: string | null;
  price?: string | null;
  productNumber?: string | null;
  companyType?: string | null;
};

export const createDeviceInventory = async (input: CreateDeviceInventoryInput) => {
  const now = new Date();

  // Normalize input
  const deviceTypeRaw = String(input.deviceType || "").trim().toLowerCase();
  const companyType = input.companyType != null ? String(input.companyType).trim() : null;
  const deviceName = input.deviceName != null ? String(input.deviceName).trim() : null;
  const prathamProductCode = input.prathamProductCode != null ? String(input.prathamProductCode).trim() : null;
  const product = input.product != null ? String(input.product).trim() : null;
  const accessories = input.accessories != null ? String(input.accessories).trim() : null;
  const hardwareDetail = input.hardwareDetail != null ? String(input.hardwareDetail).trim() : null;
  const serialNumber = input.serialNumber != null ? String(input.serialNumber).trim() : null;
  const vendorName = input.vendorName != null ? String(input.vendorName).trim() : null;
  const invoice = input.invoice != null ? String(input.invoice).trim() : null;
  const invoiceDate = input.invoiceDate != null ? String(input.invoiceDate).trim() : null;
  const price = input.price != null ? String(input.price).trim() : null;
  const productNumber = input.productNumber != null ? String(input.productNumber).trim() : null;

  if (!deviceTypeRaw) {
    throw new Error("deviceType is required");
  }
  // Validate against DB enum values early to return a clean 400.
  const allowedTypes = new Set<DeviceInventoryDeviceType>(deviceInventoryTypeEnum.enumValues as DeviceInventoryDeviceType[]);
  if (!allowedTypes.has(deviceTypeRaw as DeviceInventoryDeviceType)) {
    throw new Error(`Invalid deviceType: ${deviceTypeRaw}`);
  }
  const deviceType = deviceTypeRaw as DeviceInventoryDeviceType;
  if (deviceType === "other" && !deviceName) {
    throw new Error("deviceName is required for other");
  }

  const isSingleNumberType = SINGLE_PRODUCT_NUMBER_TYPES.has(deviceType);
  const normalizedCompanyType = companyType != null && companyType !== "" ? companyType : null;
  const normalizedDeviceName = deviceName != null && deviceName !== "" ? deviceName : null;
  const normalizedPrathamProductCode = prathamProductCode != null && prathamProductCode !== "" ? prathamProductCode : null;
  const normalizedProduct = product != null && product !== "" ? product : null;
  const normalizedAccessories = accessories != null && accessories !== "" ? accessories : null;
  const normalizedHardwareDetail = hardwareDetail != null && hardwareDetail !== "" ? hardwareDetail : null;
  const normalizedSerialNumber = serialNumber != null && serialNumber !== "" ? serialNumber : null;
  const normalizedVendorName = vendorName != null && vendorName !== "" ? vendorName : null;
  const normalizedInvoice = invoice != null && invoice !== "" ? invoice : null;
  const normalizedInvoiceDate = invoiceDate != null && invoiceDate !== "" ? invoiceDate : null;
  const normalizedPrice = price != null && price !== "" ? price : null;
  const normalizedProductNumber = productNumber != null && productNumber !== "" ? productNumber : null;

  if (isSingleNumberType && !normalizedPrathamProductCode) {
    throw new Error(`prathamProductCode is required for ${deviceType}`);
  }

  const payload = {
    deviceType,
    deviceName: normalizedDeviceName,
    prathamProductCode: normalizedPrathamProductCode,
    product: normalizedProduct,
    accessories: normalizedAccessories,
    hardwareDetail: normalizedHardwareDetail,
    serialNumber: normalizedSerialNumber,
    vendorName: normalizedVendorName,
    invoice: normalizedInvoice,
    invoiceDate: normalizedInvoiceDate,
    price: normalizedPrice,
    productNumber: normalizedProductNumber,
    companyType: normalizedCompanyType,
    currentUserId: undefined,
    pastUser1Id: undefined,
    pastUser2Id: undefined,
    pastUser3Id: undefined,
    pastUser4Id: undefined,
    onRepair: false,
    createdAt: now,
    updatedAt: now,
  };

  if (normalizedPrathamProductCode) {
    const [existing] = await db
      .select({ id: deviceInventory.id })
      .from(deviceInventory)
      .where(eq(deviceInventory.prathamProductCode, normalizedPrathamProductCode))
      .limit(1);

    if (existing) {
      throw new Error("Device with the same Pratham product code already exists.");
    }
  }

  const [inserted] = await db
    .insert(deviceInventory)
    .values(payload)
    .returning({
      id: deviceInventory.id,
    });

  return [inserted];
};

const buildUserMap = async (userIds: number[]) => {
  if (userIds.length === 0) return new Map<number, string>();
  const rows = await db
    .select({
      id: users.id,
      fullName: users.fullName,
    })
    .from(users)
    .where(inArray(users.id, userIds));

  return new Map(rows.map((r) => [r.id, r.fullName]));
};

export const getDeviceInventory = async () => {
  const devices = await db
    .select({
      id: deviceInventory.id,
      deviceName: deviceInventory.deviceName,
      prathamProductCode: deviceInventory.prathamProductCode,
      product: deviceInventory.product,
      accessories: deviceInventory.accessories, // inventory-level
      hardwareDetail: deviceInventory.hardwareDetail,
      serialNumber: deviceInventory.serialNumber,
      vendorName: deviceInventory.vendorName,
      invoice: deviceInventory.invoice,
      invoiceDate: deviceInventory.invoiceDate,
      price: deviceInventory.price,
      deviceType: deviceInventory.deviceType,
      productNumber: deviceInventory.productNumber,
      companyType: deviceInventory.companyType,
      currentUserId: deviceInventory.currentUserId,
      pastUser1Id: deviceInventory.pastUser1Id,
      pastUser2Id: deviceInventory.pastUser2Id,
      pastUser3Id: deviceInventory.pastUser3Id,
      pastUser4Id: deviceInventory.pastUser4Id,
      onRepair: deviceInventory.onRepair,
      updatedAt: deviceInventory.updatedAt,
      assignmentAccessories: deviceInventoryAssignments.assignmentAccessories, // active assignment level
    })
    .from(deviceInventory)
    .leftJoin(
      deviceInventoryAssignments,
      and(
        eq(deviceInventory.id, deviceInventoryAssignments.deviceId),
        eq(deviceInventory.currentUserId, deviceInventoryAssignments.userId),
        eq(deviceInventoryAssignments.isActive, true)
      )
    )
    .orderBy(desc(deviceInventory.updatedAt));

  const userIds = new Set<number>();
  devices.forEach((d: any) => {
    if (d.currentUserId != null) userIds.add(d.currentUserId);
    if (d.pastUser1Id != null) userIds.add(d.pastUser1Id);
    if (d.pastUser2Id != null) userIds.add(d.pastUser2Id);
    if (d.pastUser3Id != null) userIds.add(d.pastUser3Id);
    if (d.pastUser4Id != null) userIds.add(d.pastUser4Id);
  });

  const userMap = await buildUserMap(Array.from(userIds));

  return devices.map((d: any) => ({
    id: d.id,
    deviceName: d.deviceName,
    prathamProductCode: d.prathamProductCode,
    product: d.product,
    accessories: d.accessories,
    hardwareDetail: d.hardwareDetail,
    serialNumber: d.serialNumber,
    vendorName: d.vendorName,
    invoice: d.invoice,
    invoiceDate: d.invoiceDate,
    price: d.price,
    deviceType: d.deviceType,
    productNumber: d.productNumber,
    companyType: d.companyType,
    status: d.onRepair ? "repair" : d.currentUserId ? "assigned" : "available",
    currentUserId: d.currentUserId,
    currentUserName: d.currentUserId != null ? userMap.get(d.currentUserId) ?? null : null,
    pastUser1Id: d.pastUser1Id,
    pastUser1Name: d.pastUser1Id != null ? userMap.get(d.pastUser1Id) ?? null : null,
    pastUser2Id: d.pastUser2Id,
    pastUser2Name: d.pastUser2Id != null ? userMap.get(d.pastUser2Id) ?? null : null,
    pastUser3Id: d.pastUser3Id,
    pastUser3Name: d.pastUser3Id != null ? userMap.get(d.pastUser3Id) ?? null : null,
    pastUser4Id: d.pastUser4Id,
    pastUser4Name: d.pastUser4Id != null ? userMap.get(d.pastUser4Id) ?? null : null,
    onRepair: d.onRepair,
    updatedAt: d.updatedAt,
    assignmentAccessories: d.assignmentAccessories,
  }));
};

export const getAvailableDeviceInventory = async () => {
  const devices = await db
    .select({
      id: deviceInventory.id,
      deviceName: deviceInventory.deviceName,
      prathamProductCode: deviceInventory.prathamProductCode,
      product: deviceInventory.product,
      accessories: deviceInventory.accessories,
      hardwareDetail: deviceInventory.hardwareDetail,
      serialNumber: deviceInventory.serialNumber,
      vendorName: deviceInventory.vendorName,
      invoice: deviceInventory.invoice,
      invoiceDate: deviceInventory.invoiceDate,
      price: deviceInventory.price,
      deviceType: deviceInventory.deviceType,
      productNumber: deviceInventory.productNumber,
      companyType: deviceInventory.companyType,
      currentUserId: deviceInventory.currentUserId,
      pastUser1Id: deviceInventory.pastUser1Id,
      pastUser2Id: deviceInventory.pastUser2Id,
      pastUser3Id: deviceInventory.pastUser3Id,
      pastUser4Id: deviceInventory.pastUser4Id,
      updatedAt: deviceInventory.updatedAt,
    })
    .from(deviceInventory)
    .where(and(isNull(deviceInventory.currentUserId), eq(deviceInventory.onRepair, false)))
    .orderBy(desc(deviceInventory.updatedAt));

  // Only past users can exist when currentUserId is null.
  const userIds = new Set<number>();
  devices.forEach((d: any) => {
    if (d.pastUser1Id != null) userIds.add(d.pastUser1Id);
    if (d.pastUser2Id != null) userIds.add(d.pastUser2Id);
    if (d.pastUser3Id != null) userIds.add(d.pastUser3Id);
    if (d.pastUser4Id != null) userIds.add(d.pastUser4Id);
  });

  const userMap = await buildUserMap(Array.from(userIds));

  return devices.map((d: any) => ({
    id: d.id,
    deviceName: d.deviceName,
    prathamProductCode: d.prathamProductCode,
    product: d.product,
    accessories: d.accessories,
    hardwareDetail: d.hardwareDetail,
    serialNumber: d.serialNumber,
    vendorName: d.vendorName,
    invoice: d.invoice,
    invoiceDate: d.invoiceDate,
    price: d.price,
    deviceType: d.deviceType,
    productNumber: d.productNumber,
    companyType: d.companyType,
    status: "available",
    currentUserId: null,
    currentUserName: null,
    pastUser1Id: d.pastUser1Id,
    pastUser1Name: d.pastUser1Id != null ? userMap.get(d.pastUser1Id) ?? null : null,
    pastUser2Id: d.pastUser2Id,
    pastUser2Name: d.pastUser2Id != null ? userMap.get(d.pastUser2Id) ?? null : null,
    pastUser3Id: d.pastUser3Id,
    pastUser3Name: d.pastUser3Id != null ? userMap.get(d.pastUser3Id) ?? null : null,
    pastUser4Id: d.pastUser4Id,
    pastUser4Name: d.pastUser4Id != null ? userMap.get(d.pastUser4Id) ?? null : null,
    onRepair: d.onRepair,
    updatedAt: d.updatedAt,
  }));
};

export const getAssignedDeviceByUserId = async (userId: number) => {
  const [device] = await db
    .select({
      id: deviceInventory.id,
      deviceName: deviceInventory.deviceName,
      prathamProductCode: deviceInventory.prathamProductCode,
      product: deviceInventory.product,
      accessories: deviceInventory.accessories,
      hardwareDetail: deviceInventory.hardwareDetail,
      serialNumber: deviceInventory.serialNumber,
      vendorName: deviceInventory.vendorName,
      invoice: deviceInventory.invoice,
      invoiceDate: deviceInventory.invoiceDate,
      price: deviceInventory.price,
      deviceType: deviceInventory.deviceType,
      productNumber: deviceInventory.productNumber,
      companyType: deviceInventory.companyType,
      currentUserId: deviceInventory.currentUserId,
      onRepair: deviceInventory.onRepair,
      updatedAt: deviceInventory.updatedAt,
      assignmentAccessories: deviceInventoryAssignments.assignmentAccessories,
    })
    .from(deviceInventory)
    .leftJoin(
      deviceInventoryAssignments,
      and(
        eq(deviceInventory.id, deviceInventoryAssignments.deviceId),
        eq(deviceInventory.currentUserId, deviceInventoryAssignments.userId),
        eq(deviceInventoryAssignments.isActive, true)
      )
    )
    .where(eq(deviceInventory.currentUserId, userId))
    .limit(1);

  return device || null;
};

export const assignDeviceInventory = async (args: {
  deviceId: number;
  userId: number;
  actorId: number;
  assignmentAccessories?: string | null;
}) => {
  const now = new Date();
  const { deviceId, userId, actorId, assignmentAccessories } = args;

  const [device] = await db
    .select({
      id: deviceInventory.id,
      currentUserId: deviceInventory.currentUserId,
    })
    .from(deviceInventory)
    .where(eq(deviceInventory.id, deviceId))
    .limit(1);

  if (!device) return null;
  
  if (device.currentUserId != null && device.currentUserId !== userId) {
    throw new Error("Device is already assigned to someone else");
  }

  if (device.currentUserId === userId) {
    // Just update the current active assignment's accessories
    await db
      .update(deviceInventoryAssignments)
      .set({ 
        assignmentAccessories,
        assignedByUserId: actorId, // Update who last modified it
        assignedAt: now      // Update the modification timestamp
      })
      .where(
        and(
          eq(deviceInventoryAssignments.deviceId, deviceId),
          eq(deviceInventoryAssignments.userId, userId),
          eq(deviceInventoryAssignments.isActive, true)
        )
      );
    
    return { ...device, assignmentAccessories };
  }

  // Auto-unassign user's previous device if they have one
  // NOTE: Multiple devices per user are allowed — we do NOT auto-unassign here.

  await db
    .update(deviceInventory)
    .set({
      currentUserId: userId,
      updatedAt: now,
    })
    .where(eq(deviceInventory.id, deviceId));

  await db.insert(deviceInventoryAssignments).values({
    deviceId,
    userId,
    assignedByUserId: actorId,
    assignmentAccessories: assignmentAccessories ?? null,
    assignedAt: now,
    isActive: true,
  });

  const [assignedDevice] = await db
    .select({
      id: deviceInventory.id,
      deviceName: deviceInventory.deviceName,
      prathamProductCode: deviceInventory.prathamProductCode,
      serialNumber: deviceInventory.serialNumber,
      deviceType: deviceInventory.deviceType,
      productNumber: deviceInventory.productNumber,
      companyType: deviceInventory.companyType,
      currentUserId: deviceInventory.currentUserId,
      pastUser1Id: deviceInventory.pastUser1Id,
      pastUser2Id: deviceInventory.pastUser2Id,
      pastUser3Id: deviceInventory.pastUser3Id,
      pastUser4Id: deviceInventory.pastUser4Id,
      updatedAt: deviceInventory.updatedAt,
    })
    .from(deviceInventory)
    .where(eq(deviceInventory.id, deviceId))
    .limit(1);

  const [userRow] = await db
    .select({ fullName: users.fullName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  // History Limitation: Keep only up to 5 records for this device
  const existingAssignments = await db
    .select({ id: deviceInventoryAssignments.id })
    .from(deviceInventoryAssignments)
    .where(eq(deviceInventoryAssignments.deviceId, deviceId))
    .orderBy(desc(deviceInventoryAssignments.assignedAt));

  if (existingAssignments.length > 5) {
    const oldestIds = existingAssignments.slice(5).map((r) => r.id);
    await db
      .delete(deviceInventoryAssignments)
      .where(inArray(deviceInventoryAssignments.id, oldestIds));
  }

  return {
    ...assignedDevice,
    status: "assigned",
    currentUserName: userRow?.fullName ?? null,
    currentUserId: userId,
  };
};

const shiftPastUsersOnUnassign = (
  leavingUserId: number,
  past: Array<number | null>
): [number | null, number | null, number | null, number | null] => {
  const withoutLeaving = past.filter((id) => id != null && id !== leavingUserId) as number[];
  const next: Array<number | null> = [leavingUserId, ...withoutLeaving].slice(0, 4) as Array<number | null>;

  while (next.length < 4) next.push(null);
  return [next[0], next[1], next[2], next[3]];
};

export const unassignDeviceInventory = async (args: { deviceId: number }) => {
  const now = new Date();
  const { deviceId } = args;

  const [device] = await db
    .select({
      id: deviceInventory.id,
      currentUserId: deviceInventory.currentUserId,
      pastUser1Id: deviceInventory.pastUser1Id,
      pastUser2Id: deviceInventory.pastUser2Id,
      pastUser3Id: deviceInventory.pastUser3Id,
      pastUser4Id: deviceInventory.pastUser4Id,
    })
    .from(deviceInventory)
    .where(eq(deviceInventory.id, deviceId))
    .limit(1);

  if (!device) return null;
  if (device.currentUserId == null) {
    throw new Error("Device is already available");
  }

  const leavingUserId = device.currentUserId;

  // Close active assignment
  await db
    .update(deviceInventoryAssignments)
    .set({
      unassignedAt: now,
      isActive: false,
    })
    .where(and(eq(deviceInventoryAssignments.deviceId, deviceId), eq(deviceInventoryAssignments.isActive, true)));

  // Shift past history: current user becomes past_user_1
  const [newPast1, newPast2, newPast3, newPast4] = shiftPastUsersOnUnassign(leavingUserId, [
    device.pastUser1Id ?? null,
    device.pastUser2Id ?? null,
    device.pastUser3Id ?? null,
    device.pastUser4Id ?? null,
  ]);

  await db
    .update(deviceInventory)
    .set({
      currentUserId: null,
      pastUser1Id: newPast1,
      pastUser2Id: newPast2,
      pastUser3Id: newPast3,
      pastUser4Id: newPast4,
      updatedAt: now,
    })
    .where(eq(deviceInventory.id, deviceId));

  const [updated] = await db
    .select()
    .from(deviceInventory)
    .where(eq(deviceInventory.id, deviceId))
    .limit(1);

  return updated;
};

export const unassignDevicesForUser = async (args: { userId: number }) => {
  const { userId } = args;
  const devices = await db
    .select({ id: deviceInventory.id })
    .from(deviceInventory)
    .where(eq(deviceInventory.currentUserId, userId));

  const deviceIds = devices.map((d) => d.id);
  if (deviceIds.length === 0) {
    return { unassignedCount: 0, deviceIds: [] };
  }

  // Sequential is fine (typically small number of devices per user)
  for (const id of deviceIds) {
    await unassignDeviceInventory({ deviceId: id });
  }

  return { unassignedCount: deviceIds.length, deviceIds };
};

export const getDeviceAssignmentHistory = async (args: { deviceId: number; userId?: number }) => {
  const { deviceId, userId } = args;

  const conditions = [eq(deviceInventoryAssignments.deviceId, deviceId)];
  if (userId != null) {
    conditions.push(eq(deviceInventoryAssignments.userId, userId));
  }

  const rowsQuery = db
    .select({
      id: deviceInventoryAssignments.id,
      deviceId: deviceInventoryAssignments.deviceId,
      userId: deviceInventoryAssignments.userId,
      assignedAt: deviceInventoryAssignments.assignedAt,
      unassignedAt: deviceInventoryAssignments.unassignedAt,
      isActive: deviceInventoryAssignments.isActive,
      assignmentAccessories: deviceInventoryAssignments.assignmentAccessories,
      userName: users.fullName,
    })
    .from(deviceInventoryAssignments)
    .leftJoin(users, eq(deviceInventoryAssignments.userId, users.id))
    .where(and(...conditions))
    .orderBy(desc(deviceInventoryAssignments.assignedAt));

  return rowsQuery;
};

export const updateDeviceRepairStatus = async (args: { deviceId: number; onRepair: boolean }) => {
  const { deviceId, onRepair } = args;
  const now = new Date();

  const [updated] = await db
    .update(deviceInventory)
    .set({
      onRepair,
      updatedAt: now,
    })
    .where(eq(deviceInventory.id, deviceId))
    .returning();

  return updated;
};

export const updateDeviceInventory = async (args: {
  deviceId: number;
  deviceType?: string;
  deviceName?: string | null;
  prathamProductCode?: string | null;
  hardwareDetail?: string | null;
  serialNumber?: string | null;
  vendorName?: string | null;
  invoice?: string | null;
  invoiceDate?: string | null;
  price?: string | null;
  companyType?: string | null;
  productNumber?: string | null;
}) => {
  const now = new Date();
  const payload: Record<string, any> = { updatedAt: now };

  if (args.deviceType !== undefined) payload.deviceType = args.deviceType;
  if (args.deviceName !== undefined) payload.deviceName = args.deviceName || null;
  if (args.prathamProductCode !== undefined) payload.prathamProductCode = args.prathamProductCode || null;
  if (args.hardwareDetail !== undefined) payload.hardwareDetail = args.hardwareDetail || null;
  if (args.serialNumber !== undefined) payload.serialNumber = args.serialNumber || null;
  if (args.vendorName !== undefined) payload.vendorName = args.vendorName || null;
  if (args.invoice !== undefined) payload.invoice = args.invoice || null;
  if (args.invoiceDate !== undefined) payload.invoiceDate = args.invoiceDate || null;
  if (args.price !== undefined) payload.price = args.price || null;
  if (args.companyType !== undefined) payload.companyType = args.companyType || null;
  if (args.productNumber !== undefined) payload.productNumber = args.productNumber || null;

  const [updated] = await db
    .update(deviceInventory)
    .set(payload)
    .where(eq(deviceInventory.id, args.deviceId))
    .returning();

  return updated || null;
};

export const deleteDeviceInventory = async (args: { deviceId: number }) => {
  const { deviceId } = args;

  // Assignments are deleted via cascade (see schema)
  const [deleted] = await db
    .delete(deviceInventory)
    .where(eq(deviceInventory.id, deviceId))
    .returning();

  return deleted;
};

