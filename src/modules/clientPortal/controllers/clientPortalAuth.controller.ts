import { Request, Response } from "express";
import {
  changeClientPortalPassword,
  ClientPortalAuthError,
  getClientPortalProfile,
  loginClientPortal,
  logoutClientPortal,
  refreshClientPortalSession,
} from "../services/clientPortalAuth.service";

function setClientPortalCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string; csrfToken: string }
) {
  const isProduction = process.env.NODE_ENV === "production";
  const cookieOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: (isProduction ? "none" : "lax") as "none" | "lax" | "strict",
    path: "/",
  };

  res.cookie("clientAccessToken", tokens.accessToken, {
    ...cookieOptions,
    maxAge: 15 * 60 * 1000,
  });

  res.cookie("clientRefreshToken", tokens.refreshToken, {
    ...cookieOptions,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  res.cookie("clientCsrfToken", tokens.csrfToken, {
    ...cookieOptions,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function clearClientPortalCookies(res: Response) {
  const isProduction = process.env.NODE_ENV === "production";
  const cookieOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: (isProduction ? "none" : "lax") as "none" | "lax" | "strict",
    path: "/",
  };

  res.clearCookie("clientAccessToken", cookieOptions);
  res.clearCookie("clientRefreshToken", cookieOptions);
  res.clearCookie("clientCsrfToken", cookieOptions);
}

export const clientPortalLoginController = async (req: Request, res: Response) => {
  try {
    const loginId = req.body.loginId ?? req.body.email ?? req.body.username;
    const { password } = req.body;

    const session = await loginClientPortal(String(loginId ?? ""), password);
    setClientPortalCookies(res, session);

    return res.status(200).json({
      message: "Login successful",
      mustChangePassword: session.mustChangePassword,
      csrfToken: session.csrfToken,
      client: session.client,
    });
  } catch (err) {
    if (err instanceof ClientPortalAuthError) {
      return res.status(err.statusCode).json({ message: err.message });
    }
    console.error("[clientPortal] login error:", err);
    return res.status(500).json({ message: "Login failed" });
  }
};

export const clientPortalRefreshController = async (req: Request, res: Response) => {
  try {
    const refreshToken = req.cookies?.clientRefreshToken ?? req.body.refreshToken;
    const session = await refreshClientPortalSession(refreshToken);
    setClientPortalCookies(res, session);

    return res.status(200).json({
      message: "Token refreshed",
      mustChangePassword: session.mustChangePassword,
      csrfToken: session.csrfToken,
      clientId: session.clientId,
    });
  } catch (err) {
    if (err instanceof ClientPortalAuthError) {
      return res.status(err.statusCode).json({ message: err.message });
    }
    console.error("[clientPortal] refresh error:", err);
    return res.status(500).json({ message: "Refresh failed" });
  }
};

export const clientPortalLogoutController = async (req: Request, res: Response) => {
  try {
    const refreshToken = req.cookies?.clientRefreshToken ?? req.body.refreshToken;
    await logoutClientPortal(refreshToken);
    clearClientPortalCookies(res);
    return res.status(200).json({ message: "Logged out" });
  } catch (err) {
    console.error("[clientPortal] logout error:", err);
    clearClientPortalCookies(res);
    return res.status(200).json({ message: "Logged out" });
  }
};

export const clientPortalChangePasswordController = async (req: Request, res: Response) => {
  try {
    const accountId = req.clientPortalUser?.accountId;
    if (!accountId) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const currentPassword = req.body.currentPassword ?? req.body.current_password;
    const newPassword = req.body.newPassword ?? req.body.new_password;

    await changeClientPortalPassword(accountId, currentPassword, newPassword);
    clearClientPortalCookies(res);

    return res.status(200).json({
      message: "Password changed successfully. Please log in again.",
    });
  } catch (err) {
    if (err instanceof ClientPortalAuthError) {
      return res.status(err.statusCode).json({ message: err.message });
    }
    console.error("[clientPortal] change password error:", err);
    return res.status(500).json({ message: "Password change failed" });
  }
};

export const clientPortalMeController = async (req: Request, res: Response) => {
  try {
    const accountId = req.clientPortalUser?.accountId;
    if (!accountId) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const profile = await getClientPortalProfile(accountId);
    return res.status(200).json(profile);
  } catch (err) {
    if (err instanceof ClientPortalAuthError) {
      return res.status(err.statusCode).json({ message: err.message });
    }
    console.error("[clientPortal] me error:", err);
    return res.status(500).json({ message: "Failed to load profile" });
  }
};
