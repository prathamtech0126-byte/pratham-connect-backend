import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  clientPortalChangePasswordController,
  clientPortalLoginController,
  clientPortalLogoutController,
  clientPortalMeController,
  clientPortalRefreshController,
} from "../controllers/clientPortalAuth.controller";
import { clientPortalDashboardController } from "../controllers/clientPortalDashboard.controller";
import { clientPortalTimelineController } from "../controllers/clientPortalTimeline.controller";
import { requireClientPortalAuth } from "../middlewares/clientPortalAuth.middleware";

const router = Router();

const WINDOW_MS = 15 * 60 * 1000;
const loginMax = Math.max(1, parseInt(process.env.CLIENT_PORTAL_LOGIN_RATE_LIMIT_MAX ?? "30", 10));

const loginRateLimit = rateLimit({
  windowMs: WINDOW_MS,
  max: loginMax,
  message: { message: "Too many login attempts" },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * @openapi
 * /api/client-portal/login:
 *   post:
 *     tags: [ClientPortal]
 *     summary: Client portal login (email or username + password)
 *     security: []
 * /api/client-portal/refresh:
 *   post:
 *     tags: [ClientPortal]
 *     summary: Refresh client portal session
 *     security: []
 * /api/client-portal/logout:
 *   post:
 *     tags: [ClientPortal]
 *     summary: Log out client portal session
 * /api/client-portal/change-password:
 *   post:
 *     tags: [ClientPortal]
 *     summary: Change client portal password
 * /api/client-portal/me:
 *   get:
 *     tags: [ClientPortal]
 *     summary: Get logged-in client profile
 * /api/client-portal/dashboard:
 *   get:
 *     tags: [ClientPortal]
 *     summary: Client portal home dashboard summary
 * /api/client-portal/timeline:
 *   get:
 *     tags: [ClientPortal]
 *     summary: Client application timeline (5-step progress)
 */

router.post("/login", loginRateLimit, clientPortalLoginController);
router.post("/refresh", clientPortalRefreshController);
router.post("/logout", clientPortalLogoutController);
router.post("/change-password", requireClientPortalAuth, clientPortalChangePasswordController);
router.get("/me", requireClientPortalAuth, clientPortalMeController);
router.get("/dashboard", requireClientPortalAuth, clientPortalDashboardController);
router.get("/timeline", requireClientPortalAuth, clientPortalTimelineController);

export default router;
