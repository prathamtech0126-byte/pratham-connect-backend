import { Request } from "express";
import { Role } from "./role";

export interface AuthUser {
  id: number;
  role: Role;
}

export interface AuthenticatedRequest extends Request {
  user: AuthUser; // guaranteed
}
