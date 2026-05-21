import {
  AnyPgColumn,
  bigserial,
  bigint,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "../../../schemas/users.schema";

export type FacebookAccountMeta = {
  id: string;
  name: string;
  pictureUrl?: string | null;
};

export const facebookAuthState = pgTable(
  "facebook_auth_state",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    // CRM user who connected their Facebook account
    userId: bigint("user_id", { mode: "number" }).notNull().references(() => users.id),

    // 'user' = the OAuth user token  |  'page' = a Facebook page token
    tokenType: varchar("token_type", { length: 10 }).notNull().default("user"),

    // Facebook-side entity ID: FB user ID for 'user' rows, FB page ID for 'page' rows
    fbEntityId: varchar("fb_entity_id", { length: 100 }).notNull().default(""),

    // Display name of the FB entity
    fbEntityName: text("fb_entity_name"),

    pictureUrl: text("picture_url"),

    accessTokenEnc: text("access_token_enc").notNull(),

    // null for page tokens (they are permanent); ~60-day timestamp for user tokens
    expiresAt: timestamp("expires_at"),

    // Full account meta JSON — only populated on token_type = 'user'
    account: jsonb("account").$type<FacebookAccountMeta | null>().default(null),

    // For page rows: points to the parent user token row in this same table
    parentId: bigint("parent_id", { mode: "number" }).references(
      (): AnyPgColumn => facebookAuthState.id,
      { onDelete: "set null" }
    ),

    connectedAt: timestamp("connected_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userEntityUnique: uniqueIndex("fb_auth_user_entity_unique").on(
      table.userId,
      table.tokenType,
      table.fbEntityId
    ),
  })
);
