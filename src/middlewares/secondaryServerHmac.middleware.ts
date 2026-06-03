import { createHmac, timingSafeEqual } from "crypto";
import { NextFunction, Request, Response } from "express";

const SIGNATURE_PREFIX = "sha256=";
const MAX_SKEW_MS = 5 * 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;

function getInboundSecret(): string {
  return (
    process.env.SECONDARY_INBOUND_SECRET?.trim() ||
    process.env.SECONDARY_SECRET?.trim() ||
    ""
  );
}

/**
 * Verifies HMAC-SHA256 from a trusted secondary server.
 *
 * Expected headers (must match outbound client):
 *   X-Timestamp : Unix ms used when signing
 *   X-Signature : sha256=<HMAC-SHA256(secret, "<timestamp>.<raw_json_body>")>
 *
 * Requires express.raw() on the route so req.body is the raw Buffer.
 */
export function verifySecondaryServerHmac(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const secret = getInboundSecret();
  if (!secret) {
    res.status(503).json({ message: "Inbound webhook secret is not configured" });
    return;
  }

  const rawBody = Buffer.isBuffer(req.body) ? req.body : undefined;
  if (!rawBody?.length) {
    res.status(400).json({ message: "Empty request body" });
    return;
  }
  if (rawBody.length > MAX_BODY_BYTES) {
    res.status(413).json({ message: "Payload too large" });
    return;
  }

  const timestampHeader = req.headers["x-timestamp"];
  const signatureHeader = req.headers["x-signature"];

  if (typeof timestampHeader !== "string" || typeof signatureHeader !== "string") {
    res.status(401).json({ message: "Missing authentication headers" });
    return;
  }

  const timestampMs = Number(timestampHeader);
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) {
    res.status(401).json({ message: "Invalid timestamp" });
    return;
  }

  const skew = Math.abs(Date.now() - timestampMs);
  if (skew > MAX_SKEW_MS) {
    res.status(401).json({ message: "Request timestamp expired" });
    return;
  }

  if (!signatureHeader.startsWith(SIGNATURE_PREFIX)) {
    res.status(401).json({ message: "Invalid signature format" });
    return;
  }

  const providedHex = signatureHeader.slice(SIGNATURE_PREFIX.length);
  if (!/^[a-f0-9]{64}$/i.test(providedHex)) {
    res.status(401).json({ message: "Invalid signature" });
    return;
  }

  const payload = rawBody.toString("utf8");
  const expectedHex = createHmac("sha256", secret)
    .update(`${timestampHeader}.${payload}`)
    .digest("hex");

  const providedBuf = Buffer.from(providedHex, "hex");
  const expectedBuf = Buffer.from(expectedHex, "hex");

  if (
    providedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(providedBuf, expectedBuf)
  ) {
    res.status(401).json({ message: "Invalid signature" });
    return;
  }

  try {
    const parsed: unknown = JSON.parse(payload);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      res.status(400).json({ message: "Body must be a JSON object" });
      return;
    }
    req.body = parsed;
  } catch {
    res.status(400).json({ message: "Invalid JSON body" });
    return;
  }

  next();
}
