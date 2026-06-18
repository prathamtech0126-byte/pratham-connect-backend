import { Request, Response } from "express";
import { toApiCacheMeta } from "../../cache/cacheResponse";
import {
  getCachedCountries,
  getCachedCountry,
} from "../cache/country.cache.service";

export const listCountriesController = async (req: Request, res: Response) => {
  try {
    const isActive =
      req.query.isActive === undefined
        ? true
        : req.query.isActive === "true";

    const result = await getCachedCountries({ isActive });

    return res.status(200).json({
      success: true,
      data: result.data,
      count: result.data.length,
      ...toApiCacheMeta(result),
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to list countries";
    console.error("listCountriesController error:", error);
    return res.status(500).json({ success: false, message });
  }
};

export const getCountryController = async (req: Request, res: Response) => {
  try {
    const result = await getCachedCountry(req.params.countryId);
    if (!result.data) {
      return res.status(404).json({ success: false, message: "Country not found" });
    }

    return res.status(200).json({
      success: true,
      data: result.data,
      ...toApiCacheMeta(result),
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch country";
    console.error("getCountryController error:", error);
    return res.status(500).json({ success: false, message });
  }
};
