import { Router } from "express";
import rateLimit from "express-rate-limit";
import { registerUser,login,logout,refreshAccessToken,getCurrentUser,getAllUsersController,
    updateUserController,
    deleteUserController,
    getManagersDropdown,
    getAllCounsellorsAdminController,
    getCounsellorsByManagerController,
    getManagersWithCounsellorsController,
    changePasswordController
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

router.post("/login", loginRateLimit, login);
router.post("/refresh", refreshRateLimit, refreshAccessToken);
router.post("/logout", requireAuth,logout);
router.get("/me", requireAuth, getCurrentUser);
router.put("/change-password", requireAuth, preventDuplicateRequests, changePasswordController);

// 🔐 ADMIN ONLY: Get all users
router.post("/register",requireAuth,requireRole("admin"), preventDuplicateRequests, registerUser);
router.get("/users",requireAuth,requireRole("admin"),getAllUsersController);
router.put("/users-update/:userId",requireAuth,requireRole("admin"), preventDuplicateRequests, updateUserController);
router.delete("/users-delete/:userId",requireAuth,requireRole("admin"), preventDuplicateRequests, deleteUserController);
/**
 * Managers dropdown (admin only)
 */
router.get("/managers",requireAuth, requireRole("admin"),getManagersDropdown);
router.get("/counsellors",requireAuth, requireRole("admin"),getAllCounsellorsAdminController);
/**
 * Get counsellors by manager ID (admin only)
 */
router.get("/managers/:managerId/counsellors",requireAuth, requireRole("admin"),getCounsellorsByManagerController);
/**
 * Get all managers with their counsellors (hierarchical view) (admin only)
 */
router.get("/managers-with-counsellors",requireAuth, requireRole("admin"),getManagersWithCounsellorsController);


// health check alias under /api/users
router.get("/health", healthController);

// /api/users/users-delete/:userId

// export the router
export default router;