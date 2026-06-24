import { Request, Response } from "express";
import {
  listRoles,
  getRoleById,
  createRole,
  updateRole,
  deleteRole,
} from "./models/roles.model";
import {
  listPermissions,
  getPermissionById,
  createPermission,
  updatePermission,
  deletePermission,
} from "./models/permissions.model";
import {
  listPermissionsForRole,
  setRolePermissions,
  addRolePermission,
  removeRolePermission,
} from "./models/rolePermissions.model";
import {
  listRolesForUser,
  setUserPrimaryRoleByRoleId,
} from "./models/userRolesAdmin.model";

function parseId(param: string | undefined, label: string): number {
  const n = parseInt(String(param), 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(`Invalid ${label}`);
  }
  return n;
}

function pgUniqueMessage(err: unknown): string | null {
  const e = err as { code?: string; constraint?: string };
  if (e?.code === "23505") {
    return "A record with this unique value already exists";
  }
  return null;
}

/* ---------- Roles ---------- */

export const listRolesController = async (_req: Request, res: Response) => {
  try {
    const data = await listRoles();
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const getRoleByIdController = async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.roleId, "role id");
    const row = await getRoleById(id);
    if (!row) {
      return res.status(404).json({ success: false, message: "Role not found" });
    }
    res.json({ success: true, data: row });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const createRoleController = async (req: Request, res: Response) => {
  try {
    const row = await createRole({
      name: req.body.name,
      description: req.body.description,
    });
    res.status(201).json({ success: true, data: row });
  } catch (error: any) {
    const dup = pgUniqueMessage(error);
    res
      .status(dup ? 409 : 400)
      .json({ success: false, message: dup ?? error.message });
  }
};

export const updateRoleController = async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.roleId, "role id");
    const row = await updateRole(id, {
      name: req.body.name,
      description: req.body.description,
    });
    if (!row) {
      return res.status(404).json({ success: false, message: "Role not found" });
    }
    res.json({ success: true, data: row });
  } catch (error: any) {
    const dup = pgUniqueMessage(error);
    res
      .status(dup ? 409 : 400)
      .json({ success: false, message: dup ?? error.message });
  }
};

export const deleteRoleController = async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.roleId, "role id");
    const ok = await deleteRole(id);
    if (!ok) {
      return res.status(404).json({ success: false, message: "Role not found" });
    }
    res.json({ success: true, message: "Role deleted" });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

/* ---------- Permissions ---------- */

export const listPermissionsController = async (_req: Request, res: Response) => {
  try {
    const data = await listPermissions();
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const getPermissionByIdController = async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.permissionId, "permission id");
    const row = await getPermissionById(id);
    if (!row) {
      return res
        .status(404)
        .json({ success: false, message: "Permission not found" });
    }
    res.json({ success: true, data: row });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const createPermissionController = async (req: Request, res: Response) => {
  try {
    const row = await createPermission({
      name: req.body.name,
      description: req.body.description,
    });
    res.status(201).json({ success: true, data: row });
  } catch (error: any) {
    const dup = pgUniqueMessage(error);
    res
      .status(dup ? 409 : 400)
      .json({ success: false, message: dup ?? error.message });
  }
};

export const updatePermissionController = async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.permissionId, "permission id");
    const row = await updatePermission(id, {
      name: req.body.name,
      description: req.body.description,
    });
    if (!row) {
      return res
        .status(404)
        .json({ success: false, message: "Permission not found" });
    }
    res.json({ success: true, data: row });
  } catch (error: any) {
    const dup = pgUniqueMessage(error);
    res
      .status(dup ? 409 : 400)
      .json({ success: false, message: dup ?? error.message });
  }
};

export const deletePermissionController = async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.permissionId, "permission id");
    const ok = await deletePermission(id);
    if (!ok) {
      return res
        .status(404)
        .json({ success: false, message: "Permission not found" });
    }
    res.json({ success: true, message: "Permission deleted" });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

/* ---------- Role ↔ Permission ---------- */

export const listRolePermissionsController = async (req: Request, res: Response) => {
  try {
    const roleId = parseId(req.params.roleId, "role id");
    const data = await listPermissionsForRole(roleId);
    if (data === null) {
      return res.status(404).json({ success: false, message: "Role not found" });
    }
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const putRolePermissionsController = async (req: Request, res: Response) => {
  try {
    const roleId = parseId(req.params.roleId, "role id");
    const ids = req.body.permissionIds;
    if (!Array.isArray(ids) || !ids.every((x: unknown) => Number.isInteger(x))) {
      throw new Error("Body must include permissionIds: number[]");
    }
    await setRolePermissions(roleId, ids as number[]);
    const data = await listPermissionsForRole(roleId);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const postRolePermissionController = async (req: Request, res: Response) => {
  try {
    const roleId = parseId(req.params.roleId, "role id");
    const permissionId = parseId(req.params.permissionId, "permission id");
    await addRolePermission(roleId, permissionId);
    const data = await listPermissionsForRole(roleId);
    res.status(201).json({ success: true, data });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const deleteRolePermissionController = async (req: Request, res: Response) => {
  try {
    const roleId = parseId(req.params.roleId, "role id");
    const permissionId = parseId(req.params.permissionId, "permission id");
    const ok = await removeRolePermission(roleId, permissionId);
    if (!ok) {
      return res
        .status(404)
        .json({ success: false, message: "Mapping not found" });
    }
    res.json({ success: true, message: "Permission removed from role" });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

/* ---------- User ↔ Role (admin) ---------- */

export const listUserRolesController = async (req: Request, res: Response) => {
  try {
    const userId = parseId(req.params.userId, "user id");
    const data = await listRolesForUser(userId);
    if (data === null) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const putUserPrimaryRoleController = async (req: Request, res: Response) => {
  try {
    const userId = parseId(req.params.userId, "user id");
    const raw = req.body?.roleId;
    const roleId =
      typeof raw === "number" && Number.isInteger(raw)
        ? raw
        : parseId(String(raw), "role id");
    await setUserPrimaryRoleByRoleId(userId, roleId);
    const data = await listRolesForUser(userId);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};
