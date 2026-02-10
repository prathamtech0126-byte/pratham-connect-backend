import { google } from "googleapis";
import { GoogleAuth } from "google-auth-library";

/**
 * Google Sheets Configuration
 */
interface GoogleSheetsConfig {
  sheetId: string;
  serviceAccountEmail: string;
  privateKey: string;
  defaultRange?: string;
}

export const getGoogleSheetsConfig = (): GoogleSheetsConfig => {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKeyRaw = process.env.GOOGLE_PRIVATE_KEY;

  if (!sheetId || !serviceAccountEmail || !privateKeyRaw) {
    throw new Error(
      "Missing Google Sheets configuration. Please set GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, and GOOGLE_PRIVATE_KEY in your .env file"
    );
  }

  /**
   * ROBUST KEY CLEANING:
   * 1. Replaces literal "\n" strings with actual newlines.
   * 2. Removes any wrapping quotes (common .env issue).
   * 3. Trims whitespace.
   */
  const privateKey = privateKeyRaw
    .replace(/\\n/g, "\n")
    .replace(/^"|"$/g, "") // Remove surrounding quotes if they exist
    .replace(/^'|'$/g, "")
    .trim();

  return {
    sheetId,
    serviceAccountEmail,
    privateKey,
    defaultRange: process.env.GOOGLE_SHEET_RANGE || "Sheet1!A1:Z1000",
  };
};

export const createGoogleSheetsClient = () => {
  try {
    const { sheetId, serviceAccountEmail, privateKey, defaultRange } = getGoogleSheetsConfig();

    // Use GoogleAuth instead of JWT directly. It auto-detects formatting better.
    const auth = new GoogleAuth({
      credentials: {
        client_email: serviceAccountEmail,
        private_key: privateKey,
      },
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

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

    console.log("✅ Google Sheets connection successful:", response.data.properties?.title);
    return response.status === 200;
  } catch (error: any) {
    console.error("❌ Google Sheets connection test failed:");
    // Log the specific error message for easier debugging
    console.error(error.message);
    return false;
  }
};