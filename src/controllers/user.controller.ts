import { Request, Response } from "express";
import {
  createUser,
  getAllUsers,
  updateUserByAdmin,
  deleteUserByAdmin,
  getAllManagers,
  getAllCounsellors,
  getCounsellorsByManagerId,
  getManagersWithCounsellors,
  changePassword
} from "../models/user.model";
import bcrypt from "bcrypt";
import { db } from "../config/databaseConnection";
import { users } from "../schemas/users.schema";
import { refreshTokens } from "../schemas/refreshToken.schema";
import {
  generateAccessToken,
  generateRefreshToken,
  hashToken,
} from "../utils/token";
import { eq, gt, and } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { Role } from "../types/role";
import { AuthenticatedRequest } from "../types/express-auth";
import { logActivity } from "../services/activityLog.service";
import { redisDelByPrefix, redisGetJson, redisSetJson } from "../config/redis";

const USERS_CACHE_TTL_SECONDS = 300; // 5 min
/* ================================
   REGISTER
================================ */

export const registerUser = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;

    // normalize input: accept snake_case or variants from clients
    const body = req.body || {};
    // normalize managerId: accept numeric strings, null/empty => undefined
    const managerRaw = body.managerId ?? body.manager_id;
    let managerId: number | undefined = undefined;
    if (managerRaw !== undefined && managerRaw !== null && managerRaw !== "") {
      const parsed = Number(managerRaw);
      if (!Number.isFinite(parsed) || isNaN(parsed)) {
        return res.status(400).json({ message: "managerId must be a valid number" });
      }
      managerId = parsed;
    }

    const payload = {
      fullName: body.fullName ?? body.full_name,
      email: body.email ? body.email.toLowerCase().trim() : undefined,
      password: body.password,
      role: body.role,
      empId: body.empId ?? body.emp_id,
      managerId,
      officePhone:
        body.officePhone ??
        body.office_phone ??
        body.company_phone_no ??
        body.office_phone_no,
      personalPhone:
        body.personalPhone ?? body.personal_phone ?? body.personal_phone_no,
      designation: body.designation,
      isSupervisor: body.isSupervisor ?? body.is_supervisor,
    };

    try {
      const user = await createUser(payload as any, authReq.user.role);

      // Log activity
      try {
        await logActivity(req, {
          entityType: "user",
          entityId: user.id,
          clientId: null,
          action: "CREATE",
          newValue: {
            id: user.id,
            email: user.email,
            fullName: user.fullName,
            role: user.role,
            managerId: user.managerId,
          },
          description: `User created: ${user.fullName} (${user.role})`,
          performedBy: authReq.user.id,
        });
      } catch (activityError) {
        console.error("Activity log error in registerUser:", activityError);
      }

      try {
        await redisDelByPrefix("users:");
      } catch {
        // ignore
      }

      res.status(201).json(user);
    } catch (error: any) {
      // map common DB or validation errors to 400
      return res.status(400).json({ message: error?.message ?? String(error) });
    }
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
};

/* ================================
   LOGIN
================================ */

export const login = async (req: Request, res: Response) => {
  const { email, password } = req.body;
  const emailNormalized = email ? String(email).toLowerCase().trim() : email;

  if (!email || !password) {
    return res
      .status(400)
      .json({ message: "username and password are required" });
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, emailNormalized));

  if (!user) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  // Get count of previous tokens before revoking (for logging)
  const previousTokensCount = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.userId, user.id));

  // revoke all previous refresh tokens (ensures single-device session)
  if (previousTokensCount.length > 0) {
    await db
      .update(refreshTokens)
      .set({ revoked: true })
      .where(eq(refreshTokens.userId, user.id));

    if (process.env.NODE_ENV !== "production") {
      console.log(`🔄 Revoked ${previousTokensCount.length} previous refresh token(s) for user ${user.id}`);
    }
  }

  // create a new refresh token and store its hash
  const refreshToken = generateRefreshToken({ userId: user.id });

  const [inserted] = await db
    .insert(refreshTokens)
    .values({
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    })
    .returning({ id: refreshTokens.id });

  const sessionId = inserted.id;

  // generate access token tied to this session id
  const accessToken = generateAccessToken({
    userId: user.id,
    role: user.role as Role,
    sessionId,
  });

  // set cookies (access short lived, refresh long lived)
  const isProduction = process.env.NODE_ENV === "production";
  const cookieOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: (isProduction ? "none" : "lax") as "none" | "lax" | "strict",
    path: "/",
  };

  res.cookie("accessToken", accessToken, {
    ...cookieOptions,
    maxAge: 15 * 60 * 1000, // 15 minutes
  });

  res.cookie("refreshToken", refreshToken, {
    ...cookieOptions,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });

  if (process.env.NODE_ENV !== "production") {
    console.log(`✅ Login successful for user ${user.id} (${user.email})`);
    console.log(`   New refresh token created with session ID: ${sessionId}`);
  }

  // Log activity
  try {
    await logActivity(req, {
      entityType: "user",
      entityId: user.id,
      clientId: null,
      action: "LOGIN",
      newValue: {
        userId: user.id,
        email: user.email,
        role: user.role,
        sessionId: sessionId,
      },
      description: `User logged in: ${user.email} (${user.role})`,
      metadata: {
        sessionId: sessionId,
        revokedPreviousSessions: previousTokensCount.length,
      },
      performedBy: user.id,
    });
  } catch (activityError) {
    // Don't fail the request if activity log fails
    console.error("Activity log error in login:", activityError);
  }

  res.json({
    message: "Login successful",
    fullname: user.fullName,
    email: user.email,
    empid: user.emp_id,
    officePhone: user.officePhone,
    personalPhone: user.personalPhone,
    designation: user.designation,
    role: user.role,
    accessToken,
  });
};

/* ================================
   REFRESH TOKEN
================================ */

export const refreshAccessToken = async (req: Request, res: Response) => {
  // Try to get refresh token from cookie, body, or Authorization header (for Postman/testing)
  const refreshTokenFromCookie = req.cookies?.refreshToken;
  const refreshTokenFromBody = req.body?.refreshToken;
  const refreshTokenFromHeader = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.split(" ")[1]
    : null;

  const refreshToken = refreshTokenFromCookie || refreshTokenFromBody || refreshTokenFromHeader;

  // Debug logging in development
  if (process.env.NODE_ENV !== "production") {
    console.log("[REFRESH] Token sources:", {
      hasCookie: !!refreshTokenFromCookie,
      hasBody: !!refreshTokenFromBody,
      hasHeader: !!refreshTokenFromHeader,
      cookies: Object.keys(req.cookies || {}),
    });
  }

  if (!refreshToken) {
    return res.status(401).json({
      message: "Refresh token missing",
      hint: "Please provide refresh token via cookie, request body, or Authorization header"
    });
  }

  // Trim token to avoid whitespace issues
  const trimmedToken = refreshToken.trim();

  let decoded: { userId: number };
  try {
    decoded = jwt.verify(
      trimmedToken,
      process.env.JWT_REFRESH_SECRET!
    ) as { userId: number };
  } catch (jwtError: any) {
    // JWT verification failed (expired, invalid signature, etc.)
    const errorMessage =
      jwtError.name === "TokenExpiredError"
        ? "Refresh token expired"
        : "Invalid refresh token format";

    if (process.env.NODE_ENV !== "production") {
      console.error("JWT verification failed:", jwtError.message);
    }

    return res.status(401).json({ message: errorMessage });
  }

  // Hash the token for database lookup
  const tokenHash = hashToken(trimmedToken);
  const now = new Date();

  // First, try to find the token by hash only (to get detailed error info)
  const [tokenByHash] = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash));

  if (!tokenByHash) {
    if (process.env.NODE_ENV !== "production") {
      console.error("Token hash not found in database:", {
        tokenHash: tokenHash.substring(0, 20) + "...",
        userId: decoded.userId,
      });
    }
    return res.status(401).json({ message: "Refresh token not found" });
  }

  // Check if token is revoked
  if (tokenByHash.revoked) {
    if (process.env.NODE_ENV !== "production") {
      console.error("❌ Token is revoked:", {
        tokenId: tokenByHash.id,
        userId: decoded.userId,
        createdAt: tokenByHash.createdAt,
        expiresAt: tokenByHash.expiresAt,
        message: "This token was revoked, likely because user logged in again. Use the refresh token from the most recent login.",
      });
    }
    return res.status(401).json({
      message: "Refresh token has been revoked",
      hint: "This token was revoked because you logged in from another device or session. Please login again to get a new refresh token."
    });
  }

  // Check if token is expired (using UTC for consistency)
  const expiresAt = new Date(tokenByHash.expiresAt);
  if (expiresAt <= now) {
    if (process.env.NODE_ENV !== "production") {
      console.error("Token expired in database:", {
        tokenId: tokenByHash.id,
        expiresAt: expiresAt.toISOString(),
        now: now.toISOString(),
        userId: decoded.userId,
      });
    }
    return res.status(401).json({ message: "Refresh token has expired" });
  }

  // Verify user ID matches
  if (tokenByHash.userId !== decoded.userId) {
    if (process.env.NODE_ENV !== "production") {
      console.error("User ID mismatch:", {
        tokenUserId: tokenByHash.userId,
        decodedUserId: decoded.userId,
      });
    }
    return res.status(401).json({ message: "Token user mismatch" });
  }

  // Load the user's current role from the database
  const [dbUser] = await db
    .select()
    .from(users)
    .where(eq(users.id, decoded.userId));

  if (!dbUser) {
    return res.status(401).json({ message: "User not found" });
  }

  // Generate new access token
  const newAccessToken = generateAccessToken({
    userId: decoded.userId,
    role: dbUser.role as Role,
    sessionId: tokenByHash.id,
  });

  // Set cookie with new access token
  const isProduction = process.env.NODE_ENV === "production";
  res.cookie("accessToken", newAccessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    maxAge: 15 * 60 * 1000, // 15 minutes
    path: "/",
  });

  // Also update refresh token cookie expiration (extend it)
  res.cookie("refreshToken", trimmedToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: "/",
  });

  if (process.env.NODE_ENV !== "production") {
    console.log(`✅ Token refreshed for user ${decoded.userId} (session: ${tokenByHash.id})`);
  }

  res.json({
    message: "Token refreshed successfully",
    accessToken: newAccessToken,
    role: dbUser.role,
    expiresIn: "15m",
  });
};

/* ================================
   LOGOUT
================================ */

export const logout = async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.user?.id;

  const refreshToken = req.cookies.refreshToken;

  if (refreshToken) {
    try {
      await db
        .update(refreshTokens)
        .set({ revoked: true })
        .where(eq(refreshTokens.tokenHash, hashToken(refreshToken)));
    } catch (err) {
      // log and continue
      console.error("Failed to revoke refresh token on logout", err);
    }
  }

  // Log activity (before clearing cookies)
  if (userId) {
    try {
      await logActivity(req, {
        entityType: "user",
        entityId: userId,
        clientId: null,
        action: "LOGOUT",
        description: `User logged out`,
        performedBy: userId,
      });
    } catch (activityError) {
      // Don't fail the request if activity log fails
      console.error("Activity log error in logout:", activityError);
    }
  }

  // Clear cookies with same options as when they were set
  const isProduction = process.env.NODE_ENV === "production";
  const clearCookieOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: (isProduction ? "none" : "lax") as "none" | "lax" | "strict",
    path: "/",
  };

  res.clearCookie("accessToken", clearCookieOptions);
  res.clearCookie("refreshToken", clearCookieOptions);
  res.json({ message: "Logged out successfully" });
};

/* ================================
   GET CURRENT USER PROFILE
================================ */

export const getCurrentUser = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user.id;

    // Fetch user from database
    const [user] = await db
      .select({
        id: users.id,
        fullName: users.fullName,
        email: users.email,
        empId: users.emp_id,
        officePhone: users.officePhone,
        personalPhone: users.personalPhone,
        designation: users.designation,
        role: users.role,
        managerId: users.managerId,
        isSupervisor: users.isSupervisor,
      })
      .from(users)
      .where(eq(users.id, userId));

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Return same format as login response
    res.json({
      message: "User profile retrieved successfully",
      userId: user.id,
      fullname: user.fullName,
      email: user.email,
      empid: user.empId,
      officePhone: user.officePhone,
      personalPhone: user.personalPhone,
      designation: user.designation,
      role: user.role,
      managerId: user.managerId,
      isSupervisor: user.isSupervisor,
    });
  } catch (error: any) {
    console.error("Error fetching current user:", error);
    res.status(500).json({ message: "Failed to fetch user profile" });
  }
};

/* ================================
   ADMIN CONTROLLERS
================================ */

export const updateUserController = async (req: Request, res: Response) => {
  const userId = Number(req.params.userId);

  const body = req.body || {};

  // normalize managerId: accept numeric strings, null/empty => undefined
  const managerRaw = body.managerId ?? body.manager_id;
  let managerId: number | undefined = undefined;
  if (managerRaw !== undefined && managerRaw !== null && managerRaw !== "") {
    const parsed = Number(managerRaw);
    if (!Number.isFinite(parsed) || isNaN(parsed)) {
      return res.status(400).json({ message: "managerId must be a valid number" });
    }
    managerId = parsed;
  }

  // Normalize empty strings to undefined for optional fields
  const normalizeOptional = (value: any) => {
    if (value === null || value === undefined || value === "") return undefined;
    return value;
  };

  const payload = {
    fullName: body.fullName ?? body.full_name,
    email: body.email ? body.email.toLowerCase().trim() : undefined,
    password: body.password,
    role: body.role,
    empId: normalizeOptional(body.empId ?? body.emp_id),
    managerId,
    officePhone: normalizeOptional(
      body.officePhone ??
      body.office_phone ??
      body.company_phone_no ??
      body.office_phone_no
    ),
    personalPhone: normalizeOptional(
      body.personalPhone ?? body.personal_phone ?? body.personal_phone_no
    ),
    designation: normalizeOptional(body.designation),
    isSupervisor: body.isSupervisor ?? body.is_supervisor,
  };

  try {
    const authReq = req as AuthenticatedRequest;

    // Fetch old value before updating
    let oldValue = null;
    try {
      const [oldUser] = await db
        .select({
          id: users.id,
          fullName: users.fullName,
          email: users.email,
          role: users.role,
          empId: users.emp_id,
          managerId: users.managerId,
          officePhone: users.officePhone,
          personalPhone: users.personalPhone,
          designation: users.designation,
        })
        .from(users)
        .where(eq(users.id, userId));
      if (oldUser) {
        oldValue = oldUser;
      }
    } catch (error) {
      console.error("Error fetching old user value:", error);
    }

    const updatedUser = await updateUserByAdmin(userId, payload as any);

    // Log activity
    try {
      await logActivity(req, {
        entityType: "user",
        entityId: userId,
        clientId: null,
        action: "UPDATE",
        oldValue: oldValue,
        newValue: {
          id: updatedUser.id,
          email: updatedUser.email,
          fullName: updatedUser.fullName,
          role: updatedUser.role,
          managerId: updatedUser.managerId,
        },
        description: `User updated: ${updatedUser.fullName} (${updatedUser.role})`,
        performedBy: authReq.user.id,
      });
    } catch (activityError) {
      console.error("Activity log error in updateUserController:", activityError);
    }

    try {
      await redisDelByPrefix("users:");
    } catch {
      // ignore
    }

    res.json({ success: true, data: updatedUser });
  } catch (error: any) {
    // Validation and uniqueness errors are returned as 400
    res
      .status(400)
      .json({ success: false, message: error?.message ?? String(error) });
  }
};

export const deleteUserController = async (req: Request, res: Response) => {
  const targetUserId = Number(req.params.userId);
  const authReq = req as AuthenticatedRequest;
  const adminUserId = authReq.user.id;

  const result = await deleteUserByAdmin(targetUserId, adminUserId);

  // Log activity
  try {
    await logActivity(req, {
      entityType: "user",
      entityId: targetUserId,
      clientId: null,
      action: "DELETE",
      description: `User deleted: ID ${targetUserId}`,
      performedBy: adminUserId,
    });
  } catch (activityError) {
    console.error("Activity log error in deleteUserController:", activityError);
  }

  try {
    await redisDelByPrefix("users:");
  } catch {
    // ignore
  }

  res.json({ success: true, message: result.message });
};

export const getManagersDropdown = async (_req: Request, res: Response) => {
  const cacheKey = "users:managers";
  const cached = await redisGetJson<any[]>(cacheKey);
  if (cached) {
    return res.json({ success: true, count: cached.length, data: cached, cached: true });
  }
  const managers = await getAllManagers();
  await redisSetJson(cacheKey, managers, USERS_CACHE_TTL_SECONDS);
  res.json({ success: true, count: managers.length, data: managers });
};

export const getAllUsersController = async (_req: Request, res: Response) => {
  const cacheKey = "users:all";
  const cached = await redisGetJson<any[]>(cacheKey);
  if (cached) {
    return res.json({ success: true, count: cached.length, data: cached, cached: true });
  }
  const usersList = await getAllUsers();
  await redisSetJson(cacheKey, usersList, USERS_CACHE_TTL_SECONDS);
  res.json({ success: true, count: usersList.length, data: usersList });
};

export const getAllCounsellorsAdminController = async (_req: Request, res: Response) => {
  const cacheKey = "users:counsellors";
  const cached = await redisGetJson<any[]>(cacheKey);
  if (cached) {
    return res.json({ success: true, count: cached.length, data: cached, cached: true });
  }
  const counsellors = await getAllCounsellors();
  await redisSetJson(cacheKey, counsellors, USERS_CACHE_TTL_SECONDS);
  res.json({ success: true, count: counsellors.length, data: counsellors });
};

export const getCounsellorsByManagerController = async (req: Request, res: Response) => {
  try {
    const managerId = Number(req.params.managerId);

    if (!Number.isFinite(managerId) || isNaN(managerId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid manager ID"
      });
    }

    const cacheKey = `users:counsellors:manager:${managerId}`;
    const cached = await redisGetJson<any>(cacheKey);
    if (cached) {
      return res.json({ success: true, data: cached, cached: true });
    }

    const result = await getCounsellorsByManagerId(managerId);
    await redisSetJson(cacheKey, result, USERS_CACHE_TTL_SECONDS);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error?.message ?? String(error)
    });
  }
};

export const getManagersWithCounsellorsController = async (_req: Request, res: Response) => {
  try {
    const cacheKey = "users:managers-with-counsellors";
    const cached = await redisGetJson<any[]>(cacheKey);
    if (cached) {
      return res.json({
        success: true,
        count: cached.length,
        data: cached,
        cached: true,
      });
    }
    const managersWithCounsellors = await getManagersWithCounsellors();
    await redisSetJson(cacheKey, managersWithCounsellors, USERS_CACHE_TTL_SECONDS);
    res.json({
      success: true,
      count: managersWithCounsellors.length,
      data: managersWithCounsellors
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error?.message ?? String(error)
    });
  }
};

/* ================================
   CHANGE PASSWORD (USER)
================================ */

export const changePasswordController = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;

    if (!authReq.user || !authReq.user.id) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const userId = authReq.user.id;
    const { oldPassword, newPassword } = req.body;

    // Validate input
    if (!oldPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Old password and new password are required",
      });
    }

    // Change password
    const result = await changePassword(userId, oldPassword, newPassword);

    // Log activity
    try {
      await logActivity(req, {
        entityType: "user",
        entityId: userId,
        clientId: null,
        action: "UPDATE",
        description: `User changed password: ${result.email}`,
        performedBy: userId,
      });
    } catch (activityError) {
      // Don't fail the request if activity log fails
      console.error("Activity log error in changePassword:", activityError);
    }

    res.status(200).json({
      success: true,
      message: result.message,
      data: {
        userId: result.userId,
        email: result.email,
      },
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error?.message || "Failed to change password",
    });
  }
};
