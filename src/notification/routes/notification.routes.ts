import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware";
import {
  dismissNotificationController,
  getUnreadCountController,
  listNotificationsController,
  markAllReadController,
  markReadController,
} from "../controllers/notification.controller";

const router = Router();

router.get("/", requireAuth, listNotificationsController);
router.get("/unread-count", requireAuth, getUnreadCountController);
router.patch("/read-all", requireAuth, markAllReadController);
router.patch("/:id/read", requireAuth, markReadController);
router.patch("/:id/dismiss", requireAuth, dismissNotificationController);

export default router;
