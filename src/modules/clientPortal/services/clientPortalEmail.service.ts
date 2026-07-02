import nodemailer from "nodemailer";

export interface PortalCredentialsEmailInput {
  to: string;
  clientName: string;
  username: string;
  password: string;
  portalUrl: string;
}

export interface PortalEmailResult {
  delivered: boolean;
  reason?: string;
}

function getPortalUrl(): string {
  const explicit = (process.env.CLIENT_PORTAL_URL ?? "").trim().replace(/\/$/, "");
  if (explicit) return explicit;

  const frontend = (process.env.CLIENT_PORTAL_FRONTEND_URL ?? process.env.FRONTEND_URL ?? "")
    .trim()
    .replace(/\/$/, "");
  if (!frontend) return "";

  const path = (process.env.CLIENT_PORTAL_PATH ?? "/client-portal/login").trim();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${frontend}${normalizedPath}`;
}

function isSmtpConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_FROM &&
      (process.env.SMTP_USER ? process.env.SMTP_PASS : true)
  );
}

function buildTransporter() {
  const port = parseInt(process.env.SMTP_PORT ?? "587", 10);
  const secure = process.env.SMTP_SECURE === "true" || port === 465;

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASS
        ? {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          }
        : undefined,
  });
}

function buildEmailBody(input: PortalCredentialsEmailInput): { subject: string; text: string; html: string } {
  const subject = "Your Pratham Connect Client Portal login";
  const text = [
    `Hello ${input.clientName},`,
    "",
    "Your counsellor has invited you to the Pratham Connect client portal.",
    "",
    `Portal: ${input.portalUrl}`,
    `Username: ${input.username}`,
    `Password: ${input.password}`,
    "",
    "Please change your password after your first login.",
    "",
    "If you did not expect this email, contact your counsellor.",
  ].join("\n");

  const html = `
    <p>Hello ${input.clientName},</p>
    <p>Your counsellor has invited you to the <strong>Pratham Connect client portal</strong>.</p>
    <ul>
      <li><strong>Portal:</strong> <a href="${input.portalUrl}">${input.portalUrl}</a></li>
      <li><strong>Username:</strong> ${input.username}</li>
      <li><strong>Password:</strong> ${input.password}</li>
    </ul>
    <p>Please change your password after your first login.</p>
    <p>If you did not expect this email, contact your counsellor.</p>
  `;

  return { subject, text, html };
}

export async function sendPortalCredentialsEmail(
  input: PortalCredentialsEmailInput
): Promise<PortalEmailResult> {
  const portalUrl = input.portalUrl || getPortalUrl();

  if (!portalUrl) {
    return {
      delivered: false,
      reason: "CLIENT_PORTAL_URL (or FRONTEND_URL) is not configured",
    };
  }

  const payload = { ...input, portalUrl };

  if (!isSmtpConfigured()) {
    if (process.env.NODE_ENV !== "production") {
      console.log("[clientPortal] SMTP not configured — credentials email (dev only):");
      console.log(JSON.stringify(payload, null, 2));
    }
    return {
      delivered: false,
      reason: "SMTP is not configured (set SMTP_HOST and SMTP_FROM)",
    };
  }

  try {
    const transporter = buildTransporter();
    const { subject, text, html } = buildEmailBody(payload);

    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: payload.to,
      subject,
      text,
      html,
    });

    return { delivered: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Email delivery failed";
    console.error("[clientPortal] Failed to send credentials email:", message);
    return { delivered: false, reason: message };
  }
}

export { getPortalUrl };
