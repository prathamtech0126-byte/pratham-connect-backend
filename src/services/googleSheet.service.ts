import { createGoogleSheetsClient } from "../config/googleSheet.config";

/**
 * Google Sheets Service
 * Provides methods to interact with Google Sheets
 */

/**
 * Read data from Google Sheet
 * @param range - Sheet range (e.g., "Sheet1!A1:Z1000")
 * @returns Array of rows
 */
export const readFromSheet = async (range?: string): Promise<any[][]> => {
  try {
    const { sheets, sheetId, defaultRange } = createGoogleSheetsClient();
    const targetRange = range || defaultRange || "Sheet1";

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: targetRange,
    });

    return response.data.values || [];
  } catch (error: any) {
    throw new Error(`Failed to read from Google Sheet: ${error.message}`);
  }
};

/**
 * Write data to Google Sheet
 * @param range - Sheet range (e.g., "Sheet1!A1")
 * @param values - Array of rows to write
 * @param valueInputOption - "RAW" or "USER_ENTERED" (default: "USER_ENTERED")
 */
export const writeToSheet = async (
  range: string,
  values: any[][],
  valueInputOption: "RAW" | "USER_ENTERED" = "USER_ENTERED"
): Promise<void> => {
  try {
    const { sheets, sheetId } = createGoogleSheetsClient();

    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: range,
      valueInputOption: valueInputOption,
      requestBody: {
        values: values,
      },
    });
  } catch (error: any) {
    throw new Error(`Failed to write to Google Sheet: ${error.message}`);
  }
};

/**
 * Append data to Google Sheet
 * @param range - Sheet range (e.g., "Sheet1!A:Z")
 * @param values - Array of rows to append
 * @param valueInputOption - "RAW" or "USER_ENTERED" (default: "USER_ENTERED")
 */
export const appendToSheet = async (
  range: string,
  values: any[][],
  valueInputOption: "RAW" | "USER_ENTERED" = "USER_ENTERED"
): Promise<void> => {
  try {
    const { sheets, sheetId } = createGoogleSheetsClient();

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: range,
      valueInputOption: valueInputOption,
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: values,
      },
    });
  } catch (error: any) {
    throw new Error(`Failed to append to Google Sheet: ${error.message}`);
  }
};

/**
 * Clear data from Google Sheet
 * @param range - Sheet range to clear
 */
export const clearSheet = async (range: string): Promise<void> => {
  try {
    const { sheets, sheetId } = createGoogleSheetsClient();

    await sheets.spreadsheets.values.clear({
      spreadsheetId: sheetId,
      range: range,
    });
  } catch (error: any) {
    throw new Error(`Failed to clear Google Sheet: ${error.message}`);
  }
};

/**
 * Get sheet metadata (titles, etc.)
 */
export const getSheetMetadata = async () => {
  try {
    const { sheets, sheetId } = createGoogleSheetsClient();

    const response = await sheets.spreadsheets.get({
      spreadsheetId: sheetId,
    });

    return {
      title: response.data.properties?.title,
      sheets: response.data.sheets?.map((sheet) => ({
        sheetId: sheet.properties?.sheetId,
        title: sheet.properties?.title,
        index: sheet.properties?.index,
      })),
    };
  } catch (error: any) {
    throw new Error(`Failed to get sheet metadata: ${error.message}`);
  }
};

/**
 * Batch update multiple ranges
 * @param data - Array of {range, values} objects
 * @param valueInputOption - "RAW" or "USER_ENTERED" (default: "USER_ENTERED")
 */
export const batchUpdateSheet = async (
  data: Array<{ range: string; values: any[][] }>,
  valueInputOption: "RAW" | "USER_ENTERED" = "USER_ENTERED"
): Promise<void> => {
  try {
    const { sheets, sheetId } = createGoogleSheetsClient();

    const requestBody = {
      valueInputOption: valueInputOption,
      data: data.map((item) => ({
        range: item.range,
        values: item.values,
      })),
    };

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: requestBody,
    });
  } catch (error: any) {
    throw new Error(`Failed to batch update Google Sheet: ${error.message}`);
  }
};
