// src/schemas/refreshTokens.schema.ts
import {
  pgTable,
  bigserial,
  varchar,
  timestamp,
  boolean,
  bigint,
} from "drizzle-orm/pg-core";
import { users } from "./users.schema";

export const refreshTokens = pgTable("refresh_tokens", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: bigint("user_id", { mode: "number" })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 255 }).notNull(), // never store raw token
  expiresAt: timestamp("expires_at").notNull(), // expiration check
  revoked: boolean("revoked").default(false),   // soft revoke
  createdAt: timestamp("created_at").defaultNow(), // audit / cleanup
});
