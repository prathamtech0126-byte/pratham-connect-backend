import { Request, Response, NextFunction } from "express";

/**
 * CSRF protection for cookie-based auth.
 *
 * Works even when frontend is on a different origin:
 * - Backend stores a CSRF token in an httpOnly cookie `csrfToken`
 * - Backend also returns the same token in the login/refresh JSON response
 * - Frontend stores it and sends it back on state-changing requests via header `X-CSRF-Token`
 * - Server verifies header token matches cookie token
 */
export function requireCsrf(req: Request, res: Response, next: NextFunction) {
  const isProduction = process.env.NODE_ENV === "production";

  // Only enforce in production (dev UX is easier without CSRF).
  if (!isProduction) return next();

  // Allow safe methods.
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();

  // Skip CSRF checks for endpoints that create/refresh tokens.
  const path = req.path || "";
  if (
    path === "/health" ||
    path === "/api/users/login" ||
    path === "/api/users/refresh"
  ) {
    return next();
  }

  // Only apply when using cookie-based auth.
  const hasAuthCookies = Boolean(req.cookies?.accessToken || req.cookies?.refreshToken);
  if (!hasAuthCookies) return next();

  const cookieToken = req.cookies?.csrfToken;
  const headerToken =
    (req.headers["x-csrf-token"] as string | undefined) ||
    (req.headers["x-xsrf-token"] as string | undefined);

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ message: "CSRF validation failed" });
  }

  return next();
}

