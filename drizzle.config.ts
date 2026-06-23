/// <reference types="node" />
import type { Config } from "drizzle-kit";
import "dotenv/config";

/** Main CRM database — excludes `src/modules/**` (see drizzle.modules.config.ts) */
export default {
  schema: [
    "./src/schemas/**/*.schema.ts",
    "./src/Leads/**/*.schema.ts",
    "./src/notification/schemas/**/*.schema.ts",
  ],
  out: "./src/drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL || "",
  },
  /** Ignore RBAC/finance tables in DB — managed outside drizzle-kit push */
  tablesFilter: [
    "!finance_payments",
    "!permissions",
    "!roles",
    "!role_permissions",
    "!user_roles",
    "*",
  ],
} satisfies Config;
