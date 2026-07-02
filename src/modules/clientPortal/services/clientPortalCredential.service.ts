import crypto from "crypto";
import { eq, or } from "drizzle-orm";
import { db } from "../../../config/databaseConnection";
import { clientInformation } from "../../../schemas/clientInformation.schema";
import { leads } from "../../../Leads/schemas/leads.schema";
import { clientPortalAccounts } from "../schemas/clientPortalAccount.schema";
import {
  getPoolSecond,
  isModulesDbConfigured,
} from "../../../config/databaseConnectionSecond";

const USERNAME_PREFIX = "PC";

export function generatePortalPassword(): string {
  return crypto.randomBytes(12).toString("base64url").slice(0, 16);
}

export function buildDefaultUsername(clientId: number): string {
  return `${USERNAME_PREFIX}-${clientId}`;
}

function normalizeEmail(value: string): string {
  return value.toLowerCase().trim();
}

export async function resolveClientEmail(clientId: number): Promise<string | null> {
  const [client] = await db
    .select({
      convertedLeadId: clientInformation.convertedLeadId,
    })
    .from(clientInformation)
    .where(eq(clientInformation.clientId, clientId))
    .limit(1);

  if (!client) return null;

  if (client.convertedLeadId) {
    const [lead] = await db
      .select({ email: leads.email })
      .from(leads)
      .where(eq(leads.id, client.convertedLeadId))
      .limit(1);

    if (lead?.email?.trim()) {
      return normalizeEmail(lead.email);
    }
  }

  if (isModulesDbConfigured()) {
    const { rows } = await getPoolSecond().query<{ email: string | null }>(
      `SELECT p.email
         FROM clients c
         JOIN persons p ON p.id = c.person_id
        WHERE c.legacy_client_id = $1
        LIMIT 1`,
      [clientId]
    );
    const email = rows[0]?.email?.trim();
    if (email) return normalizeEmail(email);
  }

  return null;
}

async function isUsernameTaken(username: string, excludeAccountId?: number): Promise<boolean> {
  const normalized = username.toLowerCase().trim();
  const [existing] = await db
    .select({ id: clientPortalAccounts.id })
    .from(clientPortalAccounts)
    .where(eq(clientPortalAccounts.username, normalized))
    .limit(1);

  if (!existing) return false;
  if (excludeAccountId != null && existing.id === excludeAccountId) return false;
  return true;
}

export async function generatePortalUsername(
  clientId: number,
  preferredEmail?: string | null
): Promise<string> {
  if (preferredEmail) {
    const emailUsername = normalizeEmail(preferredEmail);
    if (!(await isUsernameTaken(emailUsername))) {
      return emailUsername;
    }
  }

  const defaultUsername = buildDefaultUsername(clientId);
  if (!(await isUsernameTaken(defaultUsername))) {
    return defaultUsername;
  }

  let suffix = 1;
  while (suffix < 100) {
    const candidate = `${defaultUsername}-${suffix}`;
    if (!(await isUsernameTaken(candidate))) {
      return candidate;
    }
    suffix += 1;
  }

  throw new Error("Unable to generate a unique portal username");
}

export function normalizeLoginId(loginId: string): string {
  return loginId.trim().toLowerCase();
}

export function loginIdMatchesAccount(
  loginId: string,
  account: { username: string; email: string }
): boolean {
  const normalized = normalizeLoginId(loginId);
  return normalized === account.username.toLowerCase() || normalized === account.email.toLowerCase();
}

export async function findPortalAccountByLoginId(loginId: string) {
  const normalized = normalizeLoginId(loginId);
  const [account] = await db
    .select()
    .from(clientPortalAccounts)
    .where(
      or(
        eq(clientPortalAccounts.username, normalized),
        eq(clientPortalAccounts.email, normalized)
      )
    )
    .limit(1);

  return account ?? null;
}
