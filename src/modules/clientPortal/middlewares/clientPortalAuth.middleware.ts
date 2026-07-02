import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { eq, and, gt } from "drizzle-orm";
import { db } from "../../../config/databaseConnection";
import { clientPortalRefreshTokens } from "../schemas/clientPortalRefreshToken.schema";
import { clientPortalAccounts } from "../schemas/clientPortalAccount.schema";

export interface ClientPortalUser {
  accountId: number;
  clientId: number;
}

declare global {
  namespace Express {
    interface Request {
      clientPortalUser?: ClientPortalUser;
    }
  }
}

const clientPortalJwtSecret = () =>
  process.env.CLIENT_PORTAL_JWT_SECRET || `${process.env.JWT_SECRET!}:client_portal`;

export const requireClientPortalAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const token =
    req.cookies?.clientAccessToken ||
    (req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.split(" ")[1]
      : null);

  if (!token) {
    return res.status(401).json({ message: "Authentication required" });
  }

  try {
    const decoded = jwt.verify(token, clientPortalJwtSecret()) as {
      clientId: number;
      accountId: number;
      sessionId: number;
      type?: string;
    };

    if (decoded.type !== "client_portal") {
      return res.status(401).json({ message: "Invalid token" });
    }

    const [session] = await db
      .select()
      .from(clientPortalRefreshTokens)
      .where(
        and(
          eq(clientPortalRefreshTokens.id, decoded.sessionId),
          eq(clientPortalRefreshTokens.accountId, decoded.accountId),
          eq(clientPortalRefreshTokens.revoked, false),
          gt(clientPortalRefreshTokens.expiresAt, new Date())
        )
      )
      .limit(1);

    if (!session) {
      return res.status(401).json({ message: "Session expired or revoked" });
    }

    const [account] = await db
      .select({ status: clientPortalAccounts.status })
      .from(clientPortalAccounts)
      .where(eq(clientPortalAccounts.id, decoded.accountId))
      .limit(1);

    if (!account || account.status === "disabled") {
      return res.status(401).json({ message: "Portal access is disabled" });
    }

    req.clientPortalUser = {
      accountId: decoded.accountId,
      clientId: decoded.clientId,
    };

    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};
