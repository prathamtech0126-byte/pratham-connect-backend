import bcrypt from "bcrypt";
import { eq, or, desc } from "drizzle-orm";
import { db } from "../../../config/databaseConnection";
import { clientInformation } from "../../../schemas/clientInformation.schema";
import { clientPortalAccounts } from "../schemas/clientPortalAccount.schema";
import { clientPortalInvitations } from "../schemas/clientPortalInvitation.schema";
import { clientPortalRefreshTokens } from "../schemas/clientPortalRefreshToken.schema";
import { canUserModifyClient } from "../../clients/services/clientAccess.service";
import {
  generatePortalPassword,
  generatePortalUsername,
  resolveClientEmail,
} from "./clientPortalCredential.service";
import { getPortalUrl, sendPortalCredentialsEmail } from "./clientPortalEmail.service";

export class ClientPortalError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export interface PortalInvitationResult {
  clientId: number;
  accountId: number;
  username: string;
  email: string;
  status: string;
  emailDelivered: boolean;
  emailFailureReason?: string;
  portalUrl: string | null;
  /** Plain password — only returned when email was not delivered (e.g. dev / SMTP missing). */
  temporaryPassword?: string;
  resent: boolean;
}

export interface PortalStatusResult {
  clientId: number;
  hasAccount: boolean;
  status: string | null;
  username: string | null;
  email: string | null;
  mustChangePassword: boolean | null;
  invitedAt: string | null;
  lastLoginAt: string | null;
  lastInvitation: {
    status: string;
    deliveryEmail: string;
    createdAt: string;
  } | null;
}

async function getClientOrThrow(clientId: number) {
  const [client] = await db
    .select({
      clientId: clientInformation.clientId,
      fullName: clientInformation.fullName,
      archived: clientInformation.archived,
    })
    .from(clientInformation)
    .where(eq(clientInformation.clientId, clientId))
    .limit(1);

  if (!client) {
    throw new ClientPortalError("Client not found", 404);
  }

  if (client.archived) {
    throw new ClientPortalError("Cannot invite archived client", 400);
  }

  return client;
}

async function assertCounsellorCanInvite(
  clientId: number,
  userId: number,
  role: string
): Promise<void> {
  const allowed = await canUserModifyClient(clientId, userId, role);
  if (!allowed) {
    throw new ClientPortalError("Forbidden: you cannot manage this client's portal access", 403);
  }
}

export async function getClientPortalStatus(clientId: number): Promise<PortalStatusResult> {
  const [account] = await db
    .select()
    .from(clientPortalAccounts)
    .where(eq(clientPortalAccounts.clientId, clientId))
    .limit(1);

  const [lastInvitation] = await db
    .select({
      status: clientPortalInvitations.status,
      deliveryEmail: clientPortalInvitations.deliveryEmail,
      createdAt: clientPortalInvitations.createdAt,
    })
    .from(clientPortalInvitations)
    .where(eq(clientPortalInvitations.clientId, clientId))
    .orderBy(desc(clientPortalInvitations.createdAt))
    .limit(1);

  if (!account) {
    return {
      clientId,
      hasAccount: false,
      status: null,
      username: null,
      email: null,
      mustChangePassword: null,
      invitedAt: null,
      lastLoginAt: null,
      lastInvitation: lastInvitation
        ? {
            status: lastInvitation.status,
            deliveryEmail: lastInvitation.deliveryEmail,
            createdAt: lastInvitation.createdAt.toISOString(),
          }
        : null,
    };
  }

  return {
    clientId,
    hasAccount: true,
    status: account.status,
    username: account.username,
    email: account.email,
    mustChangePassword: account.mustChangePassword,
    invitedAt: account.invitedAt?.toISOString() ?? null,
    lastLoginAt: account.lastLoginAt?.toISOString() ?? null,
    lastInvitation: lastInvitation
      ? {
          status: lastInvitation.status,
          deliveryEmail: lastInvitation.deliveryEmail,
          createdAt: lastInvitation.createdAt.toISOString(),
        }
      : null,
  };
}

export async function sendClientPortalInvitation(
  clientId: number,
  sentByUserId: number,
  role: string,
  options?: { deliveryEmail?: string }
): Promise<PortalInvitationResult> {
  await assertCounsellorCanInvite(clientId, sentByUserId, role);
  const client = await getClientOrThrow(clientId);

  const resolvedEmail = options?.deliveryEmail?.trim().toLowerCase() || (await resolveClientEmail(clientId));
  if (!resolvedEmail) {
    throw new ClientPortalError(
      "Client email is required. Add email on the lead or pass deliveryEmail in the request body.",
      400
    );
  }

  const plainPassword = generatePortalPassword();
  const passwordHash = await bcrypt.hash(plainPassword, 10);
  const username = await generatePortalUsername(clientId, resolvedEmail);
  const now = new Date();
  const portalUrl = getPortalUrl() || null;

  const [existing] = await db
    .select()
    .from(clientPortalAccounts)
    .where(eq(clientPortalAccounts.clientId, clientId))
    .limit(1);

  let accountId: number;
  let resent = false;

  if (existing) {
    if (existing.status === "disabled") {
      throw new ClientPortalError("Client portal access is disabled. Contact admin.", 400);
    }

    resent = true;

    await db
      .update(clientPortalRefreshTokens)
      .set({ revoked: true })
      .where(eq(clientPortalRefreshTokens.accountId, existing.id));

    const [updated] = await db
      .update(clientPortalAccounts)
      .set({
        username,
        email: resolvedEmail,
        passwordHash,
        status: "active",
        mustChangePassword: true,
        invitedByUserId: sentByUserId,
        invitedAt: now,
        updatedAt: now,
      })
      .where(eq(clientPortalAccounts.id, existing.id))
      .returning({ id: clientPortalAccounts.id });

    accountId = updated.id;
  } else {
    const [inserted] = await db
      .insert(clientPortalAccounts)
      .values({
        clientId,
        username,
        email: resolvedEmail,
        passwordHash,
        status: "active",
        mustChangePassword: true,
        invitedByUserId: sentByUserId,
        invitedAt: now,
      })
      .returning({ id: clientPortalAccounts.id });

    accountId = inserted.id;
  }

  const emailResult = await sendPortalCredentialsEmail({
    to: resolvedEmail,
    clientName: client.fullName,
    username,
    password: plainPassword,
    portalUrl: portalUrl ?? "",
  });

  const invitationStatus = emailResult.delivered ? "sent" : "failed";

  await db.insert(clientPortalInvitations).values({
    clientId,
    accountId,
    sentByUserId,
    deliveryEmail: resolvedEmail,
    status: invitationStatus,
    failureReason: emailResult.reason ?? null,
  });

  return {
    clientId,
    accountId,
    username,
    email: resolvedEmail,
    status: "active",
    emailDelivered: emailResult.delivered,
    emailFailureReason: emailResult.reason,
    portalUrl,
    temporaryPassword: emailResult.delivered ? undefined : plainPassword,
    resent,
  };
}

export async function resetClientPortalPassword(
  clientId: number,
  sentByUserId: number,
  role: string
): Promise<PortalInvitationResult> {
  return sendClientPortalInvitation(clientId, sentByUserId, role);
}
