import bcrypt from "bcrypt";
import crypto from "crypto";
import { eq, and, gt } from "drizzle-orm";
import { db } from "../../../config/databaseConnection";
import { clientInformation } from "../../../schemas/clientInformation.schema";
import { users } from "../../../schemas/users.schema";
import { clientPortalAccounts } from "../schemas/clientPortalAccount.schema";
import { clientPortalRefreshTokens } from "../schemas/clientPortalRefreshToken.schema";
import {
  generateClientPortalAccessToken,
  generateClientPortalRefreshToken,
  hashToken,
  verifyClientPortalRefreshToken,
} from "../../../utils/token";
import { findPortalAccountByLoginId } from "./clientPortalCredential.service";

export class ClientPortalAuthError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface ClientPortalSession {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
  mustChangePassword: boolean;
  client: {
    clientId: number;
    fullName: string;
    username: string;
    email: string;
  };
}

export interface ClientPortalProfile {
  clientId: number;
  fullName: string;
  username: string;
  email: string;
  mustChangePassword: boolean;
  counsellor: {
    id: number;
    fullName: string;
    email: string;
  } | null;
}

async function revokeAccountSessions(accountId: number): Promise<void> {
  await db
    .update(clientPortalRefreshTokens)
    .set({ revoked: true })
    .where(eq(clientPortalRefreshTokens.accountId, accountId));
}

export async function loginClientPortal(
  loginId: string,
  password: string
): Promise<ClientPortalSession> {
  if (!loginId?.trim() || !password) {
    throw new ClientPortalAuthError("loginId and password are required", 400);
  }

  const account = await findPortalAccountByLoginId(loginId);
  if (!account) {
    throw new ClientPortalAuthError("Invalid credentials", 401);
  }

  if (account.status === "disabled") {
    throw new ClientPortalAuthError("Portal access is disabled. Contact your counsellor.", 401);
  }

  const passwordMatch = await bcrypt.compare(password, account.passwordHash);
  if (!passwordMatch) {
    throw new ClientPortalAuthError("Invalid credentials", 401);
  }

  await revokeAccountSessions(account.id);

  const refreshToken = generateClientPortalRefreshToken({ accountId: account.id });
  const [session] = await db
    .insert(clientPortalRefreshTokens)
    .values({
      accountId: account.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      revoked: false,
    })
    .returning({ id: clientPortalRefreshTokens.id });

  const accessToken = generateClientPortalAccessToken({
    clientId: account.clientId,
    accountId: account.id,
    sessionId: session.id,
  });

  const now = new Date();
  await db
    .update(clientPortalAccounts)
    .set({
      status: "active",
      lastLoginAt: now,
      updatedAt: now,
    })
    .where(eq(clientPortalAccounts.id, account.id));

  const [client] = await db
    .select({
      clientId: clientInformation.clientId,
      fullName: clientInformation.fullName,
    })
    .from(clientInformation)
    .where(eq(clientInformation.clientId, account.clientId))
    .limit(1);

  const csrfToken = crypto.randomBytes(32).toString("hex");

  return {
    accessToken,
    refreshToken,
    csrfToken,
    mustChangePassword: account.mustChangePassword,
    client: {
      clientId: account.clientId,
      fullName: client?.fullName ?? "",
      username: account.username,
      email: account.email,
    },
  };
}

export async function refreshClientPortalSession(
  refreshToken: string
): Promise<Omit<ClientPortalSession, "client"> & { clientId: number; accountId: number }> {
  if (!refreshToken) {
    throw new ClientPortalAuthError("Refresh token required", 401);
  }

  let decoded: { accountId: number };
  try {
    decoded = verifyClientPortalRefreshToken(refreshToken);
  } catch {
    throw new ClientPortalAuthError("Invalid or expired refresh token", 401);
  }

  const tokenHash = hashToken(refreshToken);
  const now = new Date();

  const [session] = await db
    .select()
    .from(clientPortalRefreshTokens)
    .where(
      and(
        eq(clientPortalRefreshTokens.tokenHash, tokenHash),
        eq(clientPortalRefreshTokens.accountId, decoded.accountId),
        eq(clientPortalRefreshTokens.revoked, false),
        gt(clientPortalRefreshTokens.expiresAt, now)
      )
    )
    .limit(1);

  if (!session) {
    throw new ClientPortalAuthError("Session expired or revoked", 401);
  }

  const [account] = await db
    .select()
    .from(clientPortalAccounts)
    .where(eq(clientPortalAccounts.id, decoded.accountId))
    .limit(1);

  if (!account || account.status === "disabled") {
    throw new ClientPortalAuthError("Portal access is disabled", 401);
  }

  await db
    .update(clientPortalRefreshTokens)
    .set({ revoked: true })
    .where(eq(clientPortalRefreshTokens.id, session.id));

  const newRefreshToken = generateClientPortalRefreshToken({ accountId: account.id });
  const [newSession] = await db
    .insert(clientPortalRefreshTokens)
    .values({
      accountId: account.id,
      tokenHash: hashToken(newRefreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      revoked: false,
    })
    .returning({ id: clientPortalRefreshTokens.id });

  const accessToken = generateClientPortalAccessToken({
    clientId: account.clientId,
    accountId: account.id,
    sessionId: newSession.id,
  });

  const csrfToken = crypto.randomBytes(32).toString("hex");

  return {
    accessToken,
    refreshToken: newRefreshToken,
    csrfToken,
    mustChangePassword: account.mustChangePassword,
    clientId: account.clientId,
    accountId: account.id,
  };
}

export async function logoutClientPortal(refreshToken: string | undefined): Promise<void> {
  if (!refreshToken) return;

  try {
    const decoded = verifyClientPortalRefreshToken(refreshToken);
    const tokenHash = hashToken(refreshToken);
    await db
      .update(clientPortalRefreshTokens)
      .set({ revoked: true })
      .where(
        and(
          eq(clientPortalRefreshTokens.tokenHash, tokenHash),
          eq(clientPortalRefreshTokens.accountId, decoded.accountId)
        )
      );
  } catch {
    // ignore invalid logout tokens
  }
}

export async function changeClientPortalPassword(
  accountId: number,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  if (!currentPassword || !newPassword) {
    throw new ClientPortalAuthError("currentPassword and newPassword are required", 400);
  }

  if (newPassword.length < 8) {
    throw new ClientPortalAuthError("New password must be at least 8 characters", 400);
  }

  const [account] = await db
    .select()
    .from(clientPortalAccounts)
    .where(eq(clientPortalAccounts.id, accountId))
    .limit(1);

  if (!account) {
    throw new ClientPortalAuthError("Account not found", 404);
  }

  const match = await bcrypt.compare(currentPassword, account.passwordHash);
  if (!match) {
    throw new ClientPortalAuthError("Current password is incorrect", 400);
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  const now = new Date();

  await db
    .update(clientPortalAccounts)
    .set({
      passwordHash,
      mustChangePassword: false,
      updatedAt: now,
    })
    .where(eq(clientPortalAccounts.id, accountId));

  await revokeAccountSessions(accountId);
}

export async function getClientPortalProfile(accountId: number): Promise<ClientPortalProfile> {
  const [account] = await db
    .select()
    .from(clientPortalAccounts)
    .where(eq(clientPortalAccounts.id, accountId))
    .limit(1);

  if (!account) {
    throw new ClientPortalAuthError("Account not found", 404);
  }

  const [client] = await db
    .select({
      clientId: clientInformation.clientId,
      fullName: clientInformation.fullName,
      counsellorId: clientInformation.counsellorId,
    })
    .from(clientInformation)
    .where(eq(clientInformation.clientId, account.clientId))
    .limit(1);

  let counsellor: ClientPortalProfile["counsellor"] = null;
  if (client?.counsellorId) {
    const [counsellorUser] = await db
      .select({
        id: users.id,
        fullName: users.fullName,
        email: users.email,
      })
      .from(users)
      .where(eq(users.id, client.counsellorId))
      .limit(1);

    if (counsellorUser) {
      counsellor = counsellorUser;
    }
  }

  return {
    clientId: account.clientId,
    fullName: client?.fullName ?? "",
    username: account.username,
    email: account.email,
    mustChangePassword: account.mustChangePassword,
    counsellor,
  };
}
