const FIELD_LABELS: Record<string, string> = {
  fullName: "Name",
  phone: "Phone",
  whatsapp: "WhatsApp",
  email: "Email",
  city: "City",
  leadType: "Lead type",
  leadSource: "Lead source",
  leadQuality: "Quality",
  eligibilityStatus: "Eligibility",
  progressStatus: "Progress",
  assignmentStatus: "Assignment",
  latestNote: "Latest note",
  nextFollowupAt: "Next follow-up",
};

const formatValue = (value: unknown): string => {
  if (value == null || value === "") return "Not set";
  if (typeof value === "string") {
    return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
};

export type LeadFieldChange = {
  field: string;
  old: string;
  new: string;
};

export const buildLeadFieldChanges = (
  previous: Record<string, unknown>,
  patch: Record<string, unknown>
): LeadFieldChange[] => {
  const changes: LeadFieldChange[] = [];
  for (const key of Object.keys(patch)) {
    if (key === "updatedAt" || key === "createdAt" || key === "id") continue;
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    const oldRaw = previous[key];
    const newRaw = patch[key];
    const oldStr = formatValue(oldRaw);
    const newStr = formatValue(newRaw);
    if (oldStr === newStr) continue;
    changes.push({
      field: FIELD_LABELS[key] ?? key,
      old: oldStr,
      new: newStr,
    });
  }
  return changes;
};
