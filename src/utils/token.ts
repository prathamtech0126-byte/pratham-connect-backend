import jwt from "jsonwebtoken";
import { Role } from "../types/role";
import crypto from "crypto";

export const hashToken = (token: string) => {
  return crypto.createHash("sha256").update(token).digest("hex");
};

export const generateAccessToken = (payload: {
  userId: number;
  role: Role;
  sessionId: number | string;
}) => {
  return jwt.sign(payload, process.env.JWT_SECRET!, {
    expiresIn: "15m",
  });
};

export const generateRefreshToken = (payload: {
  userId: number;
}) => {
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET!, {
    expiresIn: "7d",
  });
};

const clientPortalJwtSecret = () =>
  process.env.CLIENT_PORTAL_JWT_SECRET || `${process.env.JWT_SECRET!}:client_portal`;

const clientPortalRefreshSecret = () =>
  process.env.CLIENT_PORTAL_JWT_REFRESH_SECRET ||
  `${process.env.JWT_REFRESH_SECRET!}:client_portal`;

export const generateClientPortalAccessToken = (payload: {
  clientId: number;
  accountId: number;
  sessionId: number;
}) => {
  return jwt.sign({ ...payload, type: "client_portal" }, clientPortalJwtSecret(), {
    expiresIn: "15m",
  });
};

export const generateClientPortalRefreshToken = (payload: { accountId: number }) => {
  return jwt.sign({ ...payload, type: "client_portal" }, clientPortalRefreshSecret(), {
    expiresIn: "7d",
  });
};

export const verifyClientPortalAccessToken = (token: string) => {
  const decoded = jwt.verify(token, clientPortalJwtSecret()) as {
    clientId: number;
    accountId: number;
    sessionId: number;
    type?: string;
  };
  if (decoded.type !== "client_portal") {
    throw new jwt.JsonWebTokenError("Invalid token type");
  }
  return decoded;
};

export const verifyClientPortalRefreshToken = (token: string) => {
  const decoded = jwt.verify(token, clientPortalRefreshSecret()) as {
    accountId: number;
    type?: string;
  };
  if (decoded.type !== "client_portal") {
    throw new jwt.JsonWebTokenError("Invalid token type");
  }
  return decoded;
};
