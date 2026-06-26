import { Router } from "express";
import rateLimit from "express-rate-limit";
import { registerUser,login,logout,refreshAccessToken,getCurrentUser,getAllUsersController,getAllUserDetailsController,
    updateUserController,
    deleteUserController,
    getManagersDropdown,
    getAllCounsellorsAdminController,
    getCounsellorsByManagerController,
    getAllTelecallersController,
    getManagersWithCounsellorsController,
    changePasswordController,
    markTourPageSeenController,
    getUserDisplayNamesController,
} from "../controllers/user.controller";
import { requireAuth,requireRole } from "../middlewares/auth.middleware";
import { preventDuplicateRequests } from "../middlewares/requestDeduplication.middleware";
import { healthController } from "../controllers/health.controller";

const router = Router();

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const loginMax = Math.max(1, parseInt(process.env.RATE_LIMIT_LOGIN_MAX ?? "100", 10));
const refreshMax = Math.max(1, parseInt(process.env.RATE_LIMIT_REFRESH_MAX ?? "10000", 10));
const windowMs = Math.max(60000, parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? String(WINDOW_MS), 10));

const loginRateLimit = rateLimit({
  windowMs,
  max: loginMax,
  message: { success: false, message: "Too many login attempts, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const refreshRateLimit = rateLimit({
  windowMs,
  max: refreshMax,
  message: { success: false, message: "Too many requests, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * @openapi
 * /api/users/login:
 *   post:
 *     tags: [Users]
 *     summary: Log in and receive access token
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Logged in — access token returned, refresh token in httpOnly cookie
 *       401:
 *         description: Invalid credentials
 *       429:
 *         description: Too many login attempts
 * /api/users/refresh:
 *   post:
 *     tags: [Users]
 *     summary: Refresh access token using httpOnly refresh-token cookie
 *     security: []
 *     responses:
 *       200:
 *         description: New access token
 *       401:
 *         description: Invalid or expired refresh token
 * /api/users/logout:
 *   post:
 *     tags: [Users]
 *     summary: Log out (revokes refresh token)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logged out
 *       401:
 *         description: Unauthorized
 * /api/users/me:
 *   get:
 *     tags: [Users]
 *     summary: Get current authenticated user
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user
 *       401:
 *         description: Unauthorized
 * /api/users/change-password:
 *   put:
 *     tags: [Users]
 *     summary: Change own password
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Password changed
 *       401:
 *         description: Unauthorized
 * /api/users/tour-seen:
 *   patch:
 *     tags: [Users]
 *     summary: Mark onboarding tour as seen
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Tour marked as seen
 *       401:
 *         description: Unauthorized
 * /api/users/register:
 *   post:
 *     tags: [Users]
 *     summary: Register a new user
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: User registered
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — admin/developer only
 * /api/users/users:
 *   get:
 *     tags: [Users]
 *     summary: Get all users
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of users
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — admin/developer only
 * /api/users/users/details:
 *   get:
 *     tags: [Users]
 *     summary: Get all user details (includes extended profile)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User details
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — admin/manager/developer only
 * /api/users/users-update/{userId}:
 *   put:
 *     tags: [Users]
 *     summary: Update a user
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Updated
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/users/users-delete/{userId}:
 *   delete:
 *     tags: [Users]
 *     summary: Delete a user
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Deleted
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/users/managers:
 *   get:
 *     tags: [Users]
 *     summary: Get managers dropdown list
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of managers
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — admin/developer only
 * /api/users/counsellors:
 *   get:
 *     tags: [Users]
 *     summary: Get counsellors list
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of counsellors
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/users/managers/{managerId}/counsellors:
 *   get:
 *     tags: [Users]
 *     summary: Get counsellors for a specific manager
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: managerId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Counsellors under the manager
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/users/managers-with-counsellors:
 *   get:
 *     tags: [Users]
 *     summary: Get hierarchical view — all managers with their counsellors
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Managers with nested counsellors
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/users/telecallers:
 *   get:
 *     tags: [Users]
 *     summary: Get telecallers dropdown list
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of telecallers
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 * /api/users/health:
 *   get:
 *     tags: [Users]
 *     summary: Health check alias under /api/users
 *     security: []
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/login", loginRateLimit, login);
router.post("/refresh", refreshRateLimit, refreshAccessToken);
router.post("/logout", requireAuth,logout);
router.get("/me", requireAuth, getCurrentUser);
router.get(
  "/display-names",
  requireAuth,
  requireRole(
    "developer",
    "admin",
    "superadmin",
    "manager",
    "counsellor",
    "telecaller",
    "marketing_head"
  ),
  getUserDisplayNamesController
);
router.put("/change-password", requireAuth, preventDuplicateRequests, changePasswordController);
router.patch("/tour-seen", requireAuth, markTourPageSeenController);

// 🔐 ADMIN ONLY: Get all users
router.post("/register",requireAuth,requireRole("developer","admin"), preventDuplicateRequests, registerUser);
router.get("/users",requireAuth,requireRole("developer","admin"),getAllUsersController);
/** All user details (admin and manager only; counsellor cannot access). */
router.get("/users/details", requireAuth, requireRole("developer","admin", "manager"), getAllUserDetailsController);
router.put("/users-update/:userId",requireAuth,requireRole("developer","admin"), preventDuplicateRequests, updateUserController);
router.delete("/users-delete/:userId",requireAuth,requireRole("developer","admin"), preventDuplicateRequests, deleteUserController);
/**
 * Managers dropdown (admin only)
 */
router.get("/managers",requireAuth, requireRole("developer","admin"),getManagersDropdown);
/** Counsellors list (admin/manager: all; counsellor: self only). */
router.get(
  "/counsellors",
  requireAuth,
  requireRole(
    "developer",
    "admin",
    "superadmin",
    "manager",
    "counsellor",
    "telecaller",
    "marketing_head"
  ),
  getAllCounsellorsAdminController
);
/**
 * Get counsellors by manager ID (admin only)
 */
router.get("/managers/:managerId/counsellors",requireAuth, requireRole("developer","admin"),getCounsellorsByManagerController);
/**
 * Get all managers with their counsellors (hierarchical view) (admin only)
 */
router.get("/managers-with-counsellors",requireAuth, requireRole("developer","admin"),getManagersWithCounsellorsController);

/**
 * Telecallers dropdown (admin / developer / manager only)
 * Used in Leads filters, assignment panels, dashboards, etc.
 */
router.get(
  "/telecallers",
  requireAuth,
  requireRole("developer", "admin", "manager", "telecaller", "counsellor", "marketing_head"),
  getAllTelecallersController
);



// health check alias under /api/users
router.get("/health", healthController);

// /api/users/users-delete/:userId

// export the router
export default router;