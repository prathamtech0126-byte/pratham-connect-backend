import { Role } from "../../types/role";

declare global {
  namespace Express {
    interface User {
      id: number;
      role: Role;
    }

    interface Request {
      user?: User;
    }
  }
}

// Ensure this file is treated as a module
export {};
