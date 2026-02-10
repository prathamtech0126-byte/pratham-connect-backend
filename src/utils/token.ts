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
