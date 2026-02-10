import type { Config } from "drizzle-kit";
import "dotenv/config";

export default {
  schema: "./src/schemas/*.ts",
  out: "./src/drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} satisfies Config;
