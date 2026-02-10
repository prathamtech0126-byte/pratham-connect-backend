// import { Request, Response, NextFunction } from "express";
// import jwt from "jsonwebtoken";
// import { Role } from "../types/role";
// import { db } from "../config/databaseConnection";
// import { refreshTokens } from "../schemas/refreshToken.schema";
// import { eq, gt, and } from "drizzle-orm";

// export const requireAuth = async (
//   req: Request,
//   res: Response,
//   next: NextFunction
// ) => {
//   const tokenFromCookie = req.cookies?.accessToken;

//   const authHeader = req.headers.authorization;
//   const tokenFromHeader =
//     authHeader?.startsWith("Bearer ")
//       ? authHeader.split(" ")[1]
//       : null;

//   const token = tokenFromCookie || tokenFromHeader;

//   if (!token) {
//     return res.status(401).json({ message: "Authentication required" });
//   }

//   try {
//     const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
//       userId: number;
//       role: Role;
//       sessionId?: number | string;
//     };

//     // validate session is active by checking the refresh_tokens table
//     if (!decoded.sessionId) {
//       return res.status(401).json({ message: "Invalid session" });
//     }

//     const [session] = await db
//       .select()
//       .from(refreshTokens)
//       .where(
//         and(
//           eq(refreshTokens.id, Number(decoded.sessionId)),
//           eq(refreshTokens.userId, decoded.userId),
//           eq(refreshTokens.revoked, false),
//           gt(refreshTokens.expiresAt, new Date())
//         )
//       )
//       .limit(1);

//     if (!session) {
//       return res.status(401).json({ message: "Session expired or revoked" });
//     }

//     // ✅ match Express.User augmentation
//     req.user = {
//       id: decoded.userId,
//       role: decoded.role,
//     };

//     next();
//   } catch {
//     return res.status(401).json({ message: "Invalid or expired token" });
//   }
// };

// // middleware to check for required role
// export const requireRole = (requiredRole: Role) => (
//   req: Request,
//   res: Response,
//   next: NextFunction
// ) => {
//   const user = req.user as { id: number; role: Role } | undefined;

//   if (!user) {
//     return res.status(401).json({ message: "Authentication required" });
//   }

//   if (user.role !== requiredRole) {
//     return res.status(403).json({ message: "Forbidden: insufficient role" });
//   }

//   next();
// };
// auth.middleware.ts
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { Role } from "../types/role";
import { db } from "../config/databaseConnection";
import { refreshTokens } from "../schemas/refreshToken.schema";
import { eq, gt, and } from "drizzle-orm";

export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const token =
    req.cookies?.accessToken ||
    (req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.split(" ")[1]
      : null);

  if (!token) {
    return res.status(401).json({ message: "Authentication required" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      userId: string;       // ✅ nanoid
      role: Role;
      sessionId: number;
    };

    const [session] = await db
      .select()
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.id, decoded.sessionId),
          eq(refreshTokens.userId, Number(decoded.userId)),
          eq(refreshTokens.revoked, false),
          gt(refreshTokens.expiresAt, new Date())
        )
      );

    if (!session) {
      return res.status(401).json({ message: "Session expired or revoked" });
    }

    req.user = {
      id: decoded.userId as any,
      role: decoded.role,
    };

    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};
export const requireRole =
  (...allowedRoles: Role[]) =>
  (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ message: "Authentication required" });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        message: "Forbidden: insufficient role",
      });
    }

    next();
  };
