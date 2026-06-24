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
 * @openapi
 * /api/google-sheets/test:
 *   get:
 *     tags: [GoogleSheets]
 *     summary: Test Google Sheets connection
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Connection OK
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/google-sheets/metadata:
 *   get:
 *     tags: [GoogleSheets]
 *     summary: Get spreadsheet metadata
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Metadata
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/google-sheets/read:
 *   get:
 *     tags: [GoogleSheets]
 *     summary: Read data from a sheet range
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: range
 *         required: true
 *         schema:
 *           type: string
 *           example: Sheet1!A1:Z1000
 *     responses:
 *       200:
 *         description: Sheet data
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/google-sheets/write:
 *   post:
 *     tags: [GoogleSheets]
 *     summary: Write data to a sheet range
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Written
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/google-sheets/append:
 *   post:
 *     tags: [GoogleSheets]
 *     summary: Append rows to a sheet range
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Appended
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/google-sheets/clear:
 *   delete:
 *     tags: [GoogleSheets]
 *     summary: Clear a sheet range
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: range
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Cleared
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — admin/developer only
 * /api/google-sheets/batch-update:
 *   post:
 *     tags: [GoogleSheets]
 *     summary: Batch update multiple sheet ranges
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Updated
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get(
  "/test",
  requireAuth,
  requireRole("developer","admin", "manager"),
  testConnectionController
);
router.get(
  "/metadata",
  requireAuth,
  requireRole("developer","admin", "manager"),
  getMetadataController
);
router.get(
  "/read",
  requireAuth,
  requireRole("developer","admin", "manager", "counsellor","cx", "binding", "application"),
  readSheetController
);
router.post(
  "/write",
  requireAuth,
  requireRole("developer","admin", "manager"),
  writeSheetController
);
router.post(
  "/append",
  requireAuth,
  requireRole("developer","admin", "manager"),
  appendSheetController
);
router.delete(
  "/clear",
  requireAuth,
  requireRole("developer","admin"),
  clearSheetController
);
router.post(
  "/batch-update",
  requireAuth,
  requireRole("developer","admin", "manager"),
  batchUpdateSheetController
);

export default router;
