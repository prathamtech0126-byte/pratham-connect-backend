import { Router } from "express";
import { requireAuth, requireRole } from "../middlewares/auth.middleware";
import { preventDuplicateRequests } from "../middlewares/requestDeduplication.middleware";
import {
  listRolesController,
  getRoleByIdController,
  createRoleController,
  updateRoleController,
  deleteRoleController,
  listPermissionsController,
  getPermissionByIdController,
  createPermissionController,
  updatePermissionController,
  deletePermissionController,
  listRolePermissionsController,
  putRolePermissionsController,
  postRolePermissionController,
  deleteRolePermissionController,
  listUserRolesController,
  putUserPrimaryRoleController,
} from "./role.controller";

const router = Router();

const admin = [requireAuth, requireRole("admin", "superadmin")] as const;

/** Application roles (catalog + CRUD). */
router.get("/roles", ...admin, listRolesController);
router.get("/roles/:roleId", ...admin, getRoleByIdController);
router.post("/roles", ...admin, preventDuplicateRequests, createRoleController);
router.put("/roles/:roleId", ...admin, preventDuplicateRequests, updateRoleController);
router.delete("/roles/:roleId", ...admin, preventDuplicateRequests, deleteRoleController);

/** Permissions catalog. */
router.get("/permissions", ...admin, listPermissionsController);
router.get("/permissions/:permissionId", ...admin, getPermissionByIdController);
router.post("/permissions", ...admin, preventDuplicateRequests, createPermissionController);
router.put(
  "/permissions/:permissionId",
  ...admin,
  preventDuplicateRequests,
  updatePermissionController
);
router.delete(
  "/permissions/:permissionId",
  ...admin,
  preventDuplicateRequests,
  deletePermissionController
);

/** Which permissions a role grants (replace or single add/remove). */
router.get("/roles/:roleId/permissions", ...admin, listRolePermissionsController);
router.put(
  "/roles/:roleId/permissions",
  ...admin,
  preventDuplicateRequests,
  putRolePermissionsController
);
router.post(
  "/roles/:roleId/permissions/:permissionId",
  ...admin,
  preventDuplicateRequests,
  postRolePermissionController
);
router.delete(
  "/roles/:roleId/permissions/:permissionId",
  ...admin,
  preventDuplicateRequests,
  deleteRolePermissionController
);

/** User role assignments (primary role ↔ JWT). */
router.get("/users/:userId/roles", ...admin, listUserRolesController);
router.put(
  "/users/:userId/primary-role",
  ...admin,
  preventDuplicateRequests,
  putUserPrimaryRoleController
);

export default router;
