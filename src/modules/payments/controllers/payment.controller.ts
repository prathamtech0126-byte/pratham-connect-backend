import { Request, Response } from "express";
import { REVENUE_VIEW_ALL_ROLES } from "../constants/revenue.constants";
import {
  getClientPaymentDetails,
  getClientPaymentSummary,
  getClientProductEntities,
} from "../services/payment.service";
import {
  getCurrentMonthRevenueReport,
  getLastMonthRevenueReport,
} from "../services/revenue.service";

const clientIdFromParams = (req: Request): string | null => {
  const clientId = req.params.clientId;
  if (!clientId?.trim()) return null;
  return clientId.trim();
};

export const getClientPaymentDetailsController = async (
  req: Request,
  res: Response
) => {
  try {
    const clientId = clientIdFromParams(req);
    if (!clientId) {
      return res.status(400).json({
        success: false,
        message: "Client ID is required",
      });
    }

    const data = await getClientPaymentDetails(clientId);

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Client not found",
      });
    }

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch payment details";

    console.error("getClientPaymentDetailsController error:", error);

    return res.status(500).json({
      success: false,
      message,
    });
  }
};

export const getClientPaymentSummaryController = async (
  req: Request,
  res: Response
) => {
  try {
    const clientId = clientIdFromParams(req);
    if (!clientId) {
      return res.status(400).json({
        success: false,
        message: "Client ID is required",
      });
    }

    const data = await getClientPaymentSummary(clientId);

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Client not found",
      });
    }

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to fetch payment summary";

    console.error("getClientPaymentSummaryController error:", error);

    return res.status(500).json({
      success: false,
      message,
    });
  }
};

const getMonthRevenueHandler =
  (
    fetchReport: (options?: { counsellorLegacyUserId?: number }) => Promise<unknown>,
    errorLabel: string
  ) =>
  async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      const canViewAll = (REVENUE_VIEW_ALL_ROLES as readonly string[]).includes(
        req.user.role
      );

      const data = await fetchReport(
        canViewAll ? undefined : { counsellorLegacyUserId: req.user.id }
      );

      return res.status(200).json({
        success: true,
        data,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : `Failed to fetch ${errorLabel}`;

      console.error(`${errorLabel} error:`, error);

      return res.status(500).json({
        success: false,
        message,
      });
    }
  };

export const getCurrentMonthRevenueController = getMonthRevenueHandler(
  getCurrentMonthRevenueReport,
  "current month revenue"
);

export const getLastMonthRevenueController = getMonthRevenueHandler(
  getLastMonthRevenueReport,
  "last month revenue"
);

export const getClientProductEntitiesController = async (
  req: Request,
  res: Response
) => {
  try {
    const clientId = clientIdFromParams(req);
    if (!clientId) {
      return res.status(400).json({
        success: false,
        message: "Client ID is required",
      });
    }

    const data = await getClientProductEntities(clientId);

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Client not found",
      });
    }

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to fetch product entities";

    console.error("getClientProductEntitiesController error:", error);

    return res.status(500).json({
      success: false,
      message,
    });
  }
};
