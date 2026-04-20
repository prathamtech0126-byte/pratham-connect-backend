import { emitToRoles } from "../config/socket";

export const DEVICE_INVENTORY_EVENT = "techSupport:devicesUpdated";

export const emitDeviceInventoryEvent = (payload: unknown) => {
  // Keep it consistent with other tech-support real-time updates.
  emitToRoles(["tech_support", "admin", "superadmin", "manager"], DEVICE_INVENTORY_EVENT, payload);
};

