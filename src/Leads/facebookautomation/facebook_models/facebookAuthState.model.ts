import crypto from "crypto";
import { and, eq, not, sql } from "drizzle-orm";
import { db } from "../../../config/databaseConnection";
import { facebookAuthState, type FacebookAccountMeta } from "../facebook_schemas/facebookAuthState.schema";

type AuthRow = typeof facebookAuthState.$inferSelect;
export const FACEBOOK_LONG_LIVED_TOKEN_DAYS = 50;

export const getDefaultFacebookTokenExpiry = (): Date =>
  new Date(Date.now() + FACEBOOK_LONG_LIVED_TOKEN_DAYS * 24 * 60 * 60 * 1000);

// ── Encryption helpers ───────────────────────────────────────────────────────

const getEncryptionKey = (): Buffer => {
  const secret = process.env.FACEBOOK_TOKEN_ENCRYPTION_KEY || process.env.JWT_SECRET || "";
  return crypto.createHash("sha256").update(secret).digest();
};

const encryptToken = (plainText: string): string => {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
};

const decryptToken = (payload: string): string | null => {
  try {
    const [ivB64, tagB64, dataB64] = payload.split(":");
    if (!ivB64 || !tagB64 || !dataB64) return null;
    const key = getEncryptionKey();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    return null;
  }
};

// ── User token functions ─────────────────────────────────────────────────────

export const upsertFacebookAuthState = async (
  userId: number,
  accessToken: string,
  account: FacebookAccountMeta | null,
  expiresAt?: Date | null
): Promise<AuthRow> => {
  const accessTokenEnc = encryptToken(accessToken);
  const fbEntityId = account?.id || String(userId);
  const fbEntityName = account?.name || null;
  const pictureUrl = account?.pictureUrl || null;
  const tokenExpiresAt = expiresAt ?? getDefaultFacebookTokenExpiry();

  // If the user switched to a different FB account, remove the old user token row
  // (page tokens referencing it will have parentId set to NULL via ON DELETE SET NULL)
  await db
    .delete(facebookAuthState)
    .where(
      and(
        eq(facebookAuthState.userId, userId),
        eq(facebookAuthState.tokenType, "user"),
        not(eq(facebookAuthState.fbEntityId, fbEntityId))
      )
    );

  const rows = await db
    .insert(facebookAuthState)
    .values({
      userId,
      tokenType: "user",
      fbEntityId,
      fbEntityName,
      pictureUrl,
      accessTokenEnc,
      account,
      expiresAt: tokenExpiresAt,
      connectedAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [facebookAuthState.userId, facebookAuthState.tokenType, facebookAuthState.fbEntityId],
      set: {
        accessTokenEnc,
        account,
        fbEntityName,
        pictureUrl,
        expiresAt: tokenExpiresAt,
        updatedAt: sql`NOW()`,
      },
    })
    .returning();

  return rows[0];
};

export const updateFacebookAccountMeta = async (
  userId: number,
  account: FacebookAccountMeta | null
): Promise<void> => {
  await db
    .update(facebookAuthState)
    .set({ account, updatedAt: new Date() })
    .where(
      and(eq(facebookAuthState.userId, userId), eq(facebookAuthState.tokenType, "user"))
    );
};

export const getFacebookAuthState = async (userId: number): Promise<AuthRow | null> => {
  const rows = await db
    .select()
    .from(facebookAuthState)
    .where(
      and(eq(facebookAuthState.userId, userId), eq(facebookAuthState.tokenType, "user"))
    )
    .limit(1);
  return rows[0] ?? null;
};

export const getFacebookAccessToken = async (
  userId: number,
  opts?: { allowExpired?: boolean }
): Promise<string | null> => {
  const row = await getFacebookAuthState(userId);
  if (!row?.accessTokenEnc) return null;
  if (!opts?.allowExpired && row.expiresAt && row.expiresAt < new Date()) return null;
  return decryptToken(row.accessTokenEnc);
};

export const listExpiredFacebookUserAuthStates = async (): Promise<AuthRow[]> => {
  const rows = await db
    .select()
    .from(facebookAuthState)
    .where(
      and(
        eq(facebookAuthState.tokenType, "user"),
        sql`${facebookAuthState.expiresAt} IS NOT NULL`,
        sql`${facebookAuthState.expiresAt} <= NOW()`
      )
    );
  return rows;
};

export const clearFacebookAuthState = async (userId: number): Promise<void> => {
  // Delete page tokens first (parentId FK), then user token
  await db
    .delete(facebookAuthState)
    .where(
      and(eq(facebookAuthState.userId, userId), eq(facebookAuthState.tokenType, "page"))
    );
  await db
    .delete(facebookAuthState)
    .where(
      and(eq(facebookAuthState.userId, userId), eq(facebookAuthState.tokenType, "user"))
    );
};

// ── Page token functions ─────────────────────────────────────────────────────

export const upsertFacebookPageTokens = async (
  userId: number,
  pages: Array<{ id: string; name: string; pictureUrl?: string | null; accessToken: string }>
): Promise<void> => {
  if (!pages.length) return;

  const userRow = await getFacebookAuthState(userId);
  const parentId = userRow?.id ?? null;

  for (const p of pages) {
    await db
      .insert(facebookAuthState)
      .values({
        userId,
        tokenType: "page",
        fbEntityId: p.id,
        fbEntityName: p.name,
        pictureUrl: p.pictureUrl ?? null,
        accessTokenEnc: encryptToken(p.accessToken),
        expiresAt: null, // page tokens are permanent
        parentId,
        connectedAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [facebookAuthState.userId, facebookAuthState.tokenType, facebookAuthState.fbEntityId],
        set: {
          fbEntityName: p.name,
          pictureUrl: p.pictureUrl ?? null,
          accessTokenEnc: encryptToken(p.accessToken),
          parentId,
          updatedAt: sql`NOW()`,
        },
      });
  }
};

export const listFacebookPagesFromDb = async (userId: number) => {
  const rows = await db
    .select({
      pageId: facebookAuthState.fbEntityId,
      pageName: facebookAuthState.fbEntityName,
      pictureUrl: facebookAuthState.pictureUrl,
    })
    .from(facebookAuthState)
    .where(
      and(eq(facebookAuthState.userId, userId), eq(facebookAuthState.tokenType, "page"))
    );

  return rows.map((r) => ({
    id: r.pageId,
    name: r.pageName || r.pageId,
    pictureUrl: r.pictureUrl ?? null,
  }));
};

export const getFacebookPageAccessToken = async (
  userId: number,
  pageId: string
): Promise<string | null> => {
  const rows = await db
    .select({ accessTokenEnc: facebookAuthState.accessTokenEnc })
    .from(facebookAuthState)
    .where(
      and(
        eq(facebookAuthState.userId, userId),
        eq(facebookAuthState.tokenType, "page"),
        eq(facebookAuthState.fbEntityId, pageId)
      )
    )
    .limit(1);
  const enc = rows[0]?.accessTokenEnc;
  return enc ? decryptToken(enc) : null;
};

export const clearFacebookPageTokens = async (userId: number): Promise<void> => {
  await db
    .delete(facebookAuthState)
    .where(
      and(eq(facebookAuthState.userId, userId), eq(facebookAuthState.tokenType, "page"))
    );
};

export const syncFacebookPages = async (
  userId: number,
  pages: Array<{ id: string; name: string; pictureUrl?: string | null; accessToken: string }>
): Promise<void> => {
  if (pages.length === 0) {
    await clearFacebookPageTokens(userId);
    return;
  }

  await upsertFacebookPageTokens(userId, pages);

  // Delete page rows not in the new list (user revoked access to those pages)
  const newPageIds = pages.map((p) => p.id);
  const existing = await db
    .select({ fbEntityId: facebookAuthState.fbEntityId })
    .from(facebookAuthState)
    .where(
      and(eq(facebookAuthState.userId, userId), eq(facebookAuthState.tokenType, "page"))
    );

  const toDelete = existing.map((r) => r.fbEntityId).filter((id) => !newPageIds.includes(id));
  for (const pageId of toDelete) {
    await db
      .delete(facebookAuthState)
      .where(
        and(
          eq(facebookAuthState.userId, userId),
          eq(facebookAuthState.tokenType, "page"),
          eq(facebookAuthState.fbEntityId, pageId)
        )
      );
  }
};
