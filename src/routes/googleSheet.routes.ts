import { Router } from "express";
import { requireAuth, requireRole } from "../middlewares/auth.middleware";
import {
  testConnectionController,
  getMetadataController,
  readSheetController,
  writeSheetController,
  appendSheetController,
  clearSheetController,
  batchUpdateSheetController,
} from "../controllers/googleSheet.controller";

const router = Router();

/**
 * Test Google Sheets connection
 * GET /api/google-sheets/test
 * Access: admin, manager
 */
router.get(
  "/test",
  requireAuth,
  requireRole("admin", "manager"),
  testConnectionController
);

/**
 * Get sheet metadata
 * GET /api/google-sheets/metadata
 * Access: admin, manager
 */
router.get(
  "/metadata",
  requireAuth,
  requireRole("admin", "manager"),
  getMetadataController
);

/**
 * Read data from Google Sheet
 * GET /api/google-sheets/read?range=Sheet1!A1:Z1000
 * Access: admin, manager, counsellor
 */
router.get(
  "/read",
  requireAuth,
  requireRole("admin", "manager", "counsellor"),
  readSheetController
);

/**
 * Write data to Google Sheet
 * POST /api/google-sheets/write
 * Body: { range: "Sheet1!A1", values: [[...], [...]], valueInputOption?: "RAW" | "USER_ENTERED" }
 * Access: admin, manager
 */
router.post(
  "/write",
  requireAuth,
  requireRole("admin", "manager"),
  writeSheetController
);

/**
 * Append data to Google Sheet
 * POST /api/google-sheets/append
 * Body: { range: "Sheet1!A:Z", values: [[...], [...]], valueInputOption?: "RAW" | "USER_ENTERED" }
 * Access: admin, manager
 */
router.post(
  "/append",
  requireAuth,
  requireRole("admin", "manager"),
  appendSheetController
);

/**
 * Clear data from Google Sheet
 * DELETE /api/google-sheets/clear?range=Sheet1!A1:Z1000
 * Access: admin
 */
router.delete(
  "/clear",
  requireAuth,
  requireRole("admin"),
  clearSheetController
);

/**
 * Batch update multiple ranges
 * POST /api/google-sheets/batch-update
 * Body: { data: [{ range: "...", values: [...] }, ...], valueInputOption?: "RAW" | "USER_ENTERED" }
 * Access: admin, manager
 */
router.post(
  "/batch-update",
  requireAuth,
  requireRole("admin", "manager"),
  batchUpdateSheetController
);

export default router;
