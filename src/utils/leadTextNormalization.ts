/** English letters with spaces between name/city parts. */
const ENGLISH_TEXT_REGEX = /^[A-Za-z]+(?:\s+[A-Za-z]+)*$/;
/** City allows common punctuation used in locality names. */
const CITY_TEXT_REGEX = /^[A-Za-z]+(?:[A-Za-z\s().,'-]*[A-Za-z])?$/;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function toTitleCaseWords(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export function normalizeLeadEmail(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

export function normalizeLeadName(value: string | null | undefined): string {
  return toTitleCaseWords(String(value ?? ""));
}

export function normalizeLeadCity(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return toTitleCaseWords(raw);
}

export function isEnglishPersonOrPlaceName(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return ENGLISH_TEXT_REGEX.test(trimmed);
}

export function isValidLeadEmail(value: string): boolean {
  const email = normalizeLeadEmail(value);
  return Boolean(email) && EMAIL_REGEX.test(email);
}

export class LeadFieldValidationError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "LeadFieldValidationError";
  }
}

export function assertEnglishNameField(
  value: string | null | undefined,
  label: string,
  opts?: { required?: boolean }
): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    if (opts?.required) {
      throw new LeadFieldValidationError(`${label} is required`);
    }
    return "";
  }
  if (!isEnglishPersonOrPlaceName(trimmed)) {
    throw new LeadFieldValidationError(
      `${label} must use English letters only. Please update it before continuing.`
    );
  }
  return normalizeLeadName(trimmed);
}

export function assertLeadEmailField(
  value: string | null | undefined,
  opts?: { required?: boolean }
): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    if (opts?.required) {
      throw new LeadFieldValidationError("Email is required");
    }
    return "";
  }
  const email = normalizeLeadEmail(trimmed);
  if (!EMAIL_REGEX.test(email)) {
    throw new LeadFieldValidationError("Enter a valid email address");
  }
  return email;
}

export function assertLeadCityField(
  value: string | null | undefined,
  opts?: { required?: boolean }
): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    if (opts?.required) {
      throw new LeadFieldValidationError("City is required");
    }
    return "";
  }
  if (!CITY_TEXT_REGEX.test(trimmed)) {
    throw new LeadFieldValidationError(
      "City can contain English letters, spaces, and symbols like ( ) . , ' -"
    );
  }
  return normalizeLeadCity(trimmed);
}

export type NormalizedLeadTextFields = {
  fullName?: string;
  email?: string;
  city?: string;
};

/** Normalize lead identity fields when present on create/update payloads. */
export function normalizeLeadTextPayload(
  payload: Record<string, unknown>,
  opts?: { requireEmail?: boolean; requireCity?: boolean }
): NormalizedLeadTextFields {
  const out: NormalizedLeadTextFields = {};

  if (payload.fullName !== undefined) {
    out.fullName = assertEnglishNameField(String(payload.fullName), "Full name", { required: true });
  }
  if (payload.email !== undefined) {
    out.email = assertLeadEmailField(
      payload.email as string | null,
      opts?.requireEmail ? { required: true } : undefined
    );
  }
  if (payload.city !== undefined) {
    out.city = assertLeadCityField(
      payload.city as string | null,
      opts?.requireCity ? { required: true } : undefined
    );
  }

  return out;
}

/** Telecaller transfer gate — name, email, and city must be valid English-formatted values. */
export function assertLeadTransferReady(lead: {
  fullName?: string | null;
  email?: string | null;
  city?: string | null;
}): NormalizedLeadTextFields {
  return {
    fullName: assertEnglishNameField(lead.fullName, "Full name", { required: true }),
    email: assertLeadEmailField(lead.email, { required: true }),
    city: assertLeadCityField(lead.city, { required: true }),
  };
}
