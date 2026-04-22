import { Request, Response } from "express";
import { getIncentiveReport } from "../services/incentiveReport.service";

export const getIncentiveReportController = async (
  req: Request,
  res: Response
) => {
  try {
    const { startDate, endDate } = req.query as Record<string, string>;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "startDate and endDate are required query parameters",
      });
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      return res.status(400).json({
        success: false,
        message: "startDate and endDate must be in YYYY-MM-DD format",
      });
    }

    if (new Date(startDate) > new Date(endDate)) {
      return res.status(400).json({
        success: false,
        message: "startDate must be before or equal to endDate",
      });
    }

    const page     = Math.max(1, parseInt(String(req.query.page     ?? "1"),  10) || 1);
    const pageSize = Math.max(1, parseInt(String(req.query.pageSize ?? "10"), 10) || 10);

    const report = await getIncentiveReport({ page, pageSize, startDate, endDate });

    return res.status(200).json({ success: true, ...report });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
