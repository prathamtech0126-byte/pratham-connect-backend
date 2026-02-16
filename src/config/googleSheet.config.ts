import { google } from "googleapis";
import { GoogleAuth } from "google-auth-library";

/**
 * Google Sheets Configuration
 *
 * Supports two ways to provide credentials (avoids OpenSSL DECODER unsupported in production):
 * 1. GOOGLE_SERVICE_ACCOUNT_JSON = full JSON key file as string (recommended for deployment)
 * 2. GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY (with robust key cleaning)
 * GOOGLE_SHEET_ID is always required.
 */
interface GoogleSheetsConfig {
  sheetId: string;
  defaultRange?: string;
  /** When using JSON: credentials object for GoogleAuth. When using key: null and we use client_email + private_key. */
  credentialsFromJson?: object;
  serviceAccountEmail?: string;
  privateKey?: string;
}

/**
 * Normalize private key from env so OpenSSL can decode it (fixes error:1E08010C DECODER routines::unsupported).
 */
function normalizePrivateKey(raw: string): string {
  return raw
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n")
    .replace(/^["']|["']$/g, "")
    .trim();
}

export const getGoogleSheetsConfig = (): GoogleSheetsConfig => {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const jsonRaw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKeyRaw = process.env.GOOGLE_PRIVATE_KEY;

  if (!sheetId) {
    throw new Error("Missing GOOGLE_SHEET_ID. Set GOOGLE_SHEET_ID in your environment.");
  }

  // Prefer full JSON (avoids private key decoding issues in production/Coolify/Docker)
  if (jsonRaw && jsonRaw.trim()) {
    try {
      const credentials = typeof jsonRaw === "string" ? JSON.parse(jsonRaw.trim()) : jsonRaw;
      if (!credentials.client_email || !credentials.private_key) {
        throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON must contain client_email and private_key.");
      }
      return {
        sheetId,
        defaultRange: process.env.GOOGLE_SHEET_RANGE || "Sheet1!A1:Z1000",
        credentialsFromJson: credentials,
      };
    } catch (e: any) {
      throw new Error(`Invalid GOOGLE_SERVICE_ACCOUNT_JSON: ${e.message}`);
    }
  }

  if (!serviceAccountEmail || !privateKeyRaw) {
    throw new Error(
      "Missing Google Sheets credentials. Set either GOOGLE_SERVICE_ACCOUNT_JSON (recommended) or GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY."
    );
  }

  const privateKey = normalizePrivateKey(privateKeyRaw);
  return {
    sheetId,
    serviceAccountEmail,
    privateKey,
    defaultRange: process.env.GOOGLE_SHEET_RANGE || "Sheet1!A1:Z1000",
  };
};

export const createGoogleSheetsClient = () => {
  try {
    const config = getGoogleSheetsConfig();
    const { sheetId, defaultRange } = config;

    let auth: InstanceType<typeof GoogleAuth>;
    if (config.credentialsFromJson) {
      auth = new GoogleAuth({
        credentials: config.credentialsFromJson as any,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      });
    } else {
      auth = new GoogleAuth({
        credentials: {
          client_email: config.serviceAccountEmail,
          private_key: config.privateKey,
        },
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      });
    }

    const sheets = google.sheets({ version: "v4", auth });
    return { sheets, sheetId, defaultRange };
  } catch (error: any) {
    console.error("Failed to create Google Sheets client:", error);
    throw new Error(`Failed to create Google Sheets client: ${error.message}`);
  }
};

export const testGoogleSheetsConnection = async (): Promise<boolean> => {
  try {
    const { sheets, sheetId } = createGoogleSheetsClient();

    // Attempt to fetch sheet metadata (lighter than fetching values)
    const response = await sheets.spreadsheets.get({
      spreadsheetId: sheetId,
    });

    // console.log("✅ Google Sheets connection successful:", response.data.properties?.title);
    return response.status === 200;
  } catch (error: any) {
    console.error("❌ Google Sheets connection test failed:");
    // Log the specific error message for easier debugging
    console.error(error.message);
    return false;
  }
};