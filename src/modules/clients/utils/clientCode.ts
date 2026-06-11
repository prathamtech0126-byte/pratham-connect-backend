/**
 * Client code format: {ORG}-{BRANCH}-CLI-{ENROLLMENT_YEAR}-{SEQUENCE}
 * Example: PRA-VAD-CLI-2026-000001
 */

export const CLIENT_CODE_ENTITY = "CLI";
export const CLIENT_CODE_SEQUENCE_WIDTH = 6;

export type ClientCodeParts = {
  orgPrefix: string;
  branchCode: string;
  enrollmentYear: number;
  sequence: number;
};

export function enrollmentYearFromDate(
  enrollmentDate: string | Date
): number {
  const raw =
    typeof enrollmentDate === "string"
      ? enrollmentDate.trim().slice(0, 10)
      : enrollmentDate.toISOString().slice(0, 10);
  const year = Number(raw.slice(0, 4));
  if (!Number.isFinite(year) || year < 1900 || year > 2100) {
    return new Date().getFullYear();
  }
  return year;
}

export function formatClientCode(parts: ClientCodeParts): string {
  const org = parts.orgPrefix.trim().toUpperCase();
  const branch = parts.branchCode.trim().toUpperCase();
  const seq = String(parts.sequence).padStart(CLIENT_CODE_SEQUENCE_WIDTH, "0");
  return `${org}-${branch}-${CLIENT_CODE_ENTITY}-${parts.enrollmentYear}-${seq}`;
}

export function parseClientCode(code: string): ClientCodeParts | null {
  const match = code
    .trim()
    .toUpperCase()
    .match(/^([A-Z0-9]+)-([A-Z0-9]+)-CLI-(\d{4})-(\d+)$/);
  if (!match) return null;
  return {
    orgPrefix: match[1],
    branchCode: match[2],
    enrollmentYear: Number(match[3]),
    sequence: Number(match[4]),
  };
}

export function getOrgPrefix(): string {
  return (process.env.CLIENT_CODE_ORG_PREFIX?.trim() || "PRA").toUpperCase();
}

export function getDefaultBranchCode(): string {
  return (process.env.DEFAULT_BRANCH_CODE?.trim() || "VAD").toUpperCase();
}

/** Optional JSON map: { "counsellorUserId": "VAD" } */
export function getCounsellorBranchMap(): Record<string, string> {
  const raw = process.env.CLIENT_BRANCH_MAP?.trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return Object.fromEntries(
      Object.entries(parsed).map(([k, v]) => [String(k), v.toUpperCase()])
    );
  } catch {
    return {};
  }
}

export function resolveBranchCode(counsellorId: number): string {
  const map = getCounsellorBranchMap();
  return map[String(counsellorId)] ?? getDefaultBranchCode();
}

/** Build the next client code for a new enrollment (query max sequence in DB first). */
export function buildNextClientCode(
  branchCode: string,
  enrollmentDate: string | Date,
  nextSequence: number
): string {
  return formatClientCode({
    orgPrefix: getOrgPrefix(),
    branchCode,
    enrollmentYear: enrollmentYearFromDate(enrollmentDate),
    sequence: nextSequence,
  });
}
