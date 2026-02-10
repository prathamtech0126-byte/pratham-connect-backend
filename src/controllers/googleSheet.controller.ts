import { Request, Response } from "express";
import {
  readFromSheet,
  writeToSheet,
  appendToSheet,
  clearSheet,
  getSheetMetadata,
  batchUpdateSheet,
} from "../services/googleSheet.service";
import { testGoogleSheetsConnection } from "../config/googleSheet.config";
import { redisDelByPrefix, redisGetJson, redisSetJson } from "../config/redis";

const GOOGLESHEET_CACHE_TTL_SECONDS = 60;
const GOOGLESHEET_TEST_CACHE_TTL_SECONDS = 10;

const cacheKeys = {
  test: () => "googlesheet:test",
  metadata: () => "googlesheet:metadata",
  read: (range: string) => `googlesheet:read:${range || "default"}`,
};

/** Invalidate all Google Sheet caches after any write/append/clear/batch */
const invalidateGoogleSheetCache = async () => {
  try {
    await redisDelByPrefix("googlesheet:");
  } catch {
    // ignore
  }
};

/**
 * Test Google Sheets connection
 * GET /api/google-sheets/test
 */
export const testConnectionController = async (
  req: Request,
  res: Response
) => {
  try {
    const cacheKey = cacheKeys.test();
    const cached = await redisGetJson<{ success: boolean; message: string }>(cacheKey);
    if (cached) {
      return res.status(cached.success ? 200 : 500).json(cached);
    }

    const isConnected = await testGoogleSheetsConnection();

    const payload = isConnected
      ? { success: true, message: "Google Sheets connection successful" }
      : { success: false, message: "Google Sheets connection failed" };

    await redisSetJson(cacheKey, payload, GOOGLESHEET_TEST_CACHE_TTL_SECONDS);

    if (isConnected) {
      return res.status(200).json(payload);
    } else {
      return res.status(500).json(payload);
    }
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to test Google Sheets connection",
    });
  }
};

/**
 * Get sheet metadata
 * GET /api/google-sheets/metadata
 */
export const getMetadataController = async (req: Request, res: Response) => {
  try {
    const cacheKey = cacheKeys.metadata();
    const cached = await redisGetJson<any>(cacheKey);
    if (cached) {
      return res.status(200).json({ success: true, data: cached, cached: true });
    }

    const metadata = await getSheetMetadata();

    await redisSetJson(cacheKey, metadata, GOOGLESHEET_CACHE_TTL_SECONDS);

    return res.status(200).json({
      success: true,
      data: metadata,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to get sheet metadata",
    });
  }
};

/**
 * Read data from Google Sheet
 * GET /api/google-sheets/read?range=Sheet1!A1:Z1000
 */
export const readSheetController = async (req: Request, res: Response) => {
  try {
    const range = (req.query.range as string) || "default";
    const cacheKey = cacheKeys.read(range);

    const cached = await redisGetJson<any[]>(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        data: cached,
        range: range === "default" ? "default" : range,
        cached: true,
      });
    }

    const data = await readFromSheet(range === "default" ? undefined : range);

    await redisSetJson(cacheKey, data, GOOGLESHEET_CACHE_TTL_SECONDS);

    return res.status(200).json({
      success: true,
      data: data,
      range: range === "default" ? "default" : range,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to read from Google Sheet",
    });
  }
};

/**
 * Write data to Google Sheet
 * POST /api/google-sheets/write
 * Body: { range: "Sheet1!A1", values: [[...], [...]], valueInputOption?: "RAW" | "USER_ENTERED" }
 */
export const writeSheetController = async (req: Request, res: Response) => {
  try {
    const { range, values, valueInputOption } = req.body;

    if (!range || !values) {
      return res.status(400).json({
        success: false,
        message: "range and values are required",
      });
    }

    if (!Array.isArray(values) || !Array.isArray(values[0])) {
      return res.status(400).json({
        success: false,
        message: "values must be a 2D array",
      });
    }

    await writeToSheet(range, values, valueInputOption);

    return res.status(200).json({
      success: true,
      message: "Data written to Google Sheet successfully",
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to write to Google Sheet",
    });
  }
};

/**
 * Append data to Google Sheet
 * POST /api/google-sheets/append
 * Body: { range: "Sheet1!A:Z", values: [[...], [...]], valueInputOption?: "RAW" | "USER_ENTERED" }
 */
export const appendSheetController = async (req: Request, res: Response) => {
  try {
    const { range, values, valueInputOption } = req.body;

    if (!range || !values) {
      return res.status(400).json({
        success: false,
        message: "range and values are required",
      });
    }

    if (!Array.isArray(values) || !Array.isArray(values[0])) {
      return res.status(400).json({
        success: false,
        message: "values must be a 2D array",
      });
    }

    await appendToSheet(range, values, valueInputOption);

    await invalidateGoogleSheetCache();

    return res.status(200).json({
      success: true,
      message: "Data appended to Google Sheet successfully",
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to append to Google Sheet",
    });
  }
};

/**
 * Clear data from Google Sheet
 * DELETE /api/google-sheets/clear?range=Sheet1!A1:Z1000
 */
export const clearSheetController = async (req: Request, res: Response) => {
  try {
    const range = req.query.range as string;

    if (!range) {
      return res.status(400).json({
        success: false,
        message: "range query parameter is required",
      });
    }

    await clearSheet(range);

    return res.status(200).json({
      success: true,
      message: "Sheet range cleared successfully",
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to clear Google Sheet",
    });
  }
};

/**
 * Batch update multiple ranges
 * POST /api/google-sheets/batch-update
 * Body: { data: [{ range: "...", values: [...] }, ...], valueInputOption?: "RAW" | "USER_ENTERED" }
 */
export const batchUpdateSheetController = async (
  req: Request,
  res: Response
) => {
  try {
    const { data, valueInputOption } = req.body;

    if (!data || !Array.isArray(data)) {
      return res.status(400).json({
        success: false,
        message: "data must be an array of {range, values} objects",
      });
    }

    // Validate each item in data array
    for (const item of data) {
      if (!item.range || !item.values) {
        return res.status(400).json({
          success: false,
          message: "Each item in data must have range and values",
        });
      }

      if (!Array.isArray(item.values) || !Array.isArray(item.values[0])) {
        return res.status(400).json({
          success: false,
          message: "values must be a 2D array",
        });
      }
    }

    await batchUpdateSheet(data, valueInputOption);

    await invalidateGoogleSheetCache();

    return res.status(200).json({
      success: true,
      message: "Batch update completed successfully",
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to batch update Google Sheet",
    });
  }
};
