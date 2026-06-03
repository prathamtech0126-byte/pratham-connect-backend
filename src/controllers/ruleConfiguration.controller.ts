import { Request, Response } from "express";
import {
  getAllRuleConfigurations,
  getRuleConfigurationById,
  createRuleConfiguration,
  updateRuleConfiguration,
  type CreateRuleConfigurationInput,
  type UpdateRuleConfigurationInput,
} from "../models/ruleConfiguration.model";
import { db } from "../config/databaseConnection";
import { ruleConfiguration } from "../schemas/ruleConfiguration.schema";
import { eq } from "drizzle-orm";
import { logActivity } from "../services/activityLog.service";
import { parseIncomingRuleType, type DbRuleType } from "../services/ruleConfiguration.serializer";

function jsonErr(res: Response, status: number, message: string) {
  return res.status(status).json({
    success: false,
    message,
    data: { message },
  });
}

function pickBody(req: Request) {
  const b = req.body as Record<string, unknown>;
  return {
    name: b.name,
    description: b.description ?? b.rule_description,
    rule_type: b.rule_type ?? b.ruleType,
    start_date: b.start_date ?? b.startDate,
    end_date: b.end_date ?? b.endDate,
    min_budget_threshold: b.min_budget_threshold ?? b.minBudgetThreshold,
    all_finance_sale_type_categories:
      b.all_finance_sale_type_categories ?? b.allFinanceSaleTypeCategories ?? b.all_finance_target_categories,
    sale_type_category_id: b.sale_type_category_id ?? b.saleTypeCategoryId,
    sale_type_ids: b.sale_type_ids ?? b.saleTypeIds,
    is_active: b.is_active ?? b.isActive,
    rules: b.rules,
  };
}

// ── GET all ───────────────────────────────────────────────────────────────────

export const getAllRuleConfigurationsController = async (_req: Request, res: Response) => {
  try {
    const data = await getAllRuleConfigurations();
    return res.status(200).json({ success: true, data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Server error";
    return res.status(500).json({ success: false, message, data: { message } });
  }
};

// ── GET by id ─────────────────────────────────────────────────────────────────

export const getRuleConfigurationByIdController = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!id) return jsonErr(res, 400, "Invalid id");

    const data = await getRuleConfigurationById(id);
    if (!data) return jsonErr(res, 404, "Not found");

    return res.status(200).json({ success: true, data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Server error";
    return res.status(500).json({ success: false, message, data: { message } });
  }
};

// ── POST ──────────────────────────────────────────────────────────────────────

export const createRuleConfigurationController = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return jsonErr(res, 401, "Unauthorized");

    const p = pickBody(req);
    const { name, start_date, end_date, sale_type_category_id, sale_type_ids, rules } = p;

    if (!name || typeof name !== "string") {
      return jsonErr(res, 400, "name is required");
    }
    if (p.rule_type === undefined || p.rule_type === null) {
      return jsonErr(res, 400, "rule_type is required");
    }
    let rule_type: DbRuleType;
    try {
      rule_type = parseIncomingRuleType(p.rule_type);
    } catch (e) {
      return jsonErr(res, 400, e instanceof Error ? e.message : "Invalid rule_type");
    }
    if (!start_date || typeof start_date !== "string") {
      return jsonErr(res, 400, "start_date is required");
    }
    if (!Array.isArray(rules)) {
      return jsonErr(res, 400, "rules must be an array");
    }

    const input: CreateRuleConfigurationInput = {
      name: name.trim(),
      rule_type,
      start_date,
      end_date: (end_date as string | null | undefined) ?? null,
      description: p.description != null ? String(p.description) : null,
      min_budget_threshold:
        p.min_budget_threshold === undefined || p.min_budget_threshold === null
          ? null
          : Number(p.min_budget_threshold),
      all_finance_sale_type_categories: Array.isArray(p.all_finance_sale_type_categories)
        ? (p.all_finance_sale_type_categories as string[])
        : null,
      sale_type_category_id:
        sale_type_category_id === undefined ? undefined : (sale_type_category_id as number | null) ?? null,
      sale_type_ids: Array.isArray(sale_type_ids) ? (sale_type_ids as Array<number | string>) : undefined,
      added_by: req.user.id,
      rules,
    };

    const data = await createRuleConfiguration(input);
    await logActivity(req, {
      entityType: "rule_configuration",
      action: "CREATE",
      newValue: data,
      description: `Rule configuration "${String(name).trim()}" created`,
      performedBy: req.user.id,
    }).catch(() => {});

    return res.status(201).json({ success: true, data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Server error";
    const isValidation = message.match(
      /ascending|duplicate|overlap|null|unique|less than|negative|"& Above"|required|must be a number|already assigned|Invalid|cannot be null/i
    );
    return jsonErr(res, isValidation ? 400 : 500, message);
  }
};

// ── PUT ───────────────────────────────────────────────────────────────────────

export const updateRuleConfigurationController = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return jsonErr(res, 401, "Unauthorized");

    const id = Number(req.params.id);
    if (!id) return jsonErr(res, 400, "Invalid id");

    const existing = await getRuleConfigurationById(id);
    if (!existing) return jsonErr(res, 404, "Not found");

    const p = pickBody(req);
    const { name, start_date, end_date, sale_type_category_id, sale_type_ids, is_active, rules } = p;

    const input: UpdateRuleConfigurationInput = {};
    if (name !== undefined) input.name = String(name).trim();
    if (start_date !== undefined) input.start_date = start_date as string;
    if (end_date !== undefined) input.end_date = (end_date as string | null) ?? null;
    if (p.description !== undefined) {
      input.description = p.description != null ? String(p.description) : null;
    }
    if (p.min_budget_threshold !== undefined) {
      const raw = p.min_budget_threshold;
      input.min_budget_threshold = raw === null ? null : Number(raw);
    }
    if (p.all_finance_sale_type_categories !== undefined) {
      input.all_finance_sale_type_categories = Array.isArray(p.all_finance_sale_type_categories)
        ? (p.all_finance_sale_type_categories as string[])
        : null;
    }
    if (sale_type_category_id !== undefined) {
      input.sale_type_category_id = (sale_type_category_id as number | null) ?? null;
    }
    if (Array.isArray(sale_type_ids)) input.sale_type_ids = sale_type_ids as Array<number | string>;
    if (is_active !== undefined) input.is_active = Boolean(is_active);
    if (Array.isArray(rules)) input.rules = rules as unknown[];

    const rule_type = parseIncomingRuleType(
      (existing as { rule_type?: string; ruleType?: string }).rule_type ??
        (existing as { ruleType?: string }).ruleType
    );

    const data = await updateRuleConfiguration(id, input, rule_type, {
      name: existing.name,
      start_date: existing.start_date as string,
      end_date: (existing.end_date as string | null) ?? null,
      sale_type_category_id: (existing.sale_type_category_id as number | null) ?? null,
      period_id: (existing as { period_id?: number | null }).period_id ?? null,
    });
    await logActivity(req, {
      entityType: "rule_configuration",
      action: "UPDATE",
      newValue: data,
      description: `Rule configuration id=${id} updated`,
      performedBy: req.user.id,
    }).catch(() => {});

    return res.status(200).json({ success: true, data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Server error";
    const isValidation = message.match(
      /ascending|duplicate|overlap|null|unique|less than|negative|"& Above"|required|must be a number|already assigned|Invalid|cannot be null/i
    );
    return jsonErr(res, isValidation ? 400 : 500, message);
  }
};

// ── DELETE (soft — toggle is_active) ─────────────────────────────────────────

export const deleteRuleConfigurationController = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return jsonErr(res, 401, "Unauthorized");

    const id = Number(req.params.id);
    if (!id) return jsonErr(res, 400, "Invalid id");

    const [row] = await db
      .select({ id: ruleConfiguration.id, name: ruleConfiguration.name })
      .from(ruleConfiguration)
      .where(eq(ruleConfiguration.id, id));

    if (!row) return jsonErr(res, 404, "Not found");

    await db
      .update(ruleConfiguration)
      .set({ is_active: false })
      .where(eq(ruleConfiguration.id, id));

    await logActivity(req, {
      entityType: "rule_configuration",
      action: "STATUS_CHANGE",
      description: `Rule configuration "${row.name}" deactivated`,
      performedBy: req.user.id,
    }).catch(() => {});

    const msg = "Rule configuration deactivated";
    return res.status(200).json({ success: true, message: msg, data: { message: msg } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Server error";
    return res.status(500).json({ success: false, message, data: { message } });
  }
};
