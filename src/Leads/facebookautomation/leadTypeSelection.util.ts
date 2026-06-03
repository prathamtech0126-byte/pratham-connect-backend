import {
  assertLeadTypeIdExists,
  customLeadTypeGroupKey,
  parseCustomLeadTypeFromGroup,
  resolveLeadTypeLabelFromId,
} from "./facebook_models/facebookFormStrategy.model";

type StrategyLeadTypeFields = {
  leadTypeId?: number | null;
  masterDistributionGroup?: string | null;
};

export const MAX_CUSTOM_LEAD_TYPE_LENGTH = 50;

export type LeadTypeSelectionInput = {
  leadTypeId: number | null;
  customLeadTypeName?: string;
};

export type ResolvedLeadTypeSelection = {
  leadTypeId: number | null;
  label: string;
  masterDistributionGroup: string | null;
};

export function parseLeadTypeFromBody(body: {
  leadTypeId?: unknown;
  customLeadTypeName?: unknown;
}): LeadTypeSelectionInput {
  const customRaw = String(body.customLeadTypeName ?? "").trim();
  if (customRaw) {
    const name = customRaw.slice(0, MAX_CUSTOM_LEAD_TYPE_LENGTH);
    if (!name) throw new Error("LEAD_TYPE_REQUIRED");
    return { leadTypeId: null, customLeadTypeName: name };
  }
  const id = Number(body.leadTypeId);
  if (!Number.isFinite(id) || id <= 0) throw new Error("LEAD_TYPE_REQUIRED");
  return { leadTypeId: id };
}

export async function resolveLeadTypeSelection(
  input: LeadTypeSelectionInput
): Promise<ResolvedLeadTypeSelection> {
  if (input.leadTypeId == null) {
    const name = String(input.customLeadTypeName ?? "").trim();
    if (!name) throw new Error("LEAD_TYPE_REQUIRED");
    return {
      leadTypeId: null,
      label: name,
      masterDistributionGroup: customLeadTypeGroupKey(name),
    };
  }
  await assertLeadTypeIdExists(input.leadTypeId);
  const label = await resolveLeadTypeLabelFromId(input.leadTypeId);
  if (!label) throw new Error("LEAD_TYPE_INVALID");
  return {
    leadTypeId: input.leadTypeId,
    label,
    masterDistributionGroup: String(input.leadTypeId),
  };
}

export function strategyHasLeadType(row: StrategyLeadTypeFields): boolean {
  if (row.leadTypeId != null && row.leadTypeId > 0) return true;
  return !!parseCustomLeadTypeFromGroup(row.masterDistributionGroup);
}

export async function resolveLeadTypeLabelForStrategy(
  row: StrategyLeadTypeFields
): Promise<string | null> {
  const custom = parseCustomLeadTypeFromGroup(row.masterDistributionGroup);
  if (custom) return custom;
  return resolveLeadTypeLabelFromId(row.leadTypeId);
}
