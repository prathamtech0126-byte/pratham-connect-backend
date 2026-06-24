export class VisaCaseServiceError extends Error {
  readonly statusCode: number;
  readonly code?: string;

  constructor(message: string, statusCode = 400, code?: string) {
    super(message);
    this.name = "VisaCaseServiceError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const visaCaseNotAssignedError = () =>
  new VisaCaseServiceError(
    "This visa case is not assigned to you",
    403,
    "VISA_CASE_NOT_ASSIGNED"
  );

export const visaCaseForbiddenError = (
  message: string,
  code = "VISA_CASE_FORBIDDEN"
) => new VisaCaseServiceError(message, 403, code);

const stripForbiddenPrefix = (message: string): string =>
  message.replace(/^Forbidden:\s*/i, "").trim();

export const resolveVisaCaseError = (
  error: unknown,
  fallbackMessage: string,
  options?: { defaultStatus?: number }
): { status: number; message: string; code?: string } => {
  if (error instanceof VisaCaseServiceError) {
    return {
      status: error.statusCode,
      message: error.message,
      code: error.code,
    };
  }

  const message = error instanceof Error ? error.message : fallbackMessage;
  const defaultStatus = options?.defaultStatus ?? 400;

  if (message === "Visa case not found") {
    return { status: 404, message, code: "VISA_CASE_NOT_FOUND" };
  }

  if (message.startsWith("Forbidden:")) {
    return {
      status: 403,
      message: stripForbiddenPrefix(message),
      code: "VISA_CASE_FORBIDDEN",
    };
  }

  if (
    /visa_case_assignments/i.test(message) &&
    (/does not exist|relation/i.test(message) || /Failed query/i.test(message))
  ) {
    return {
      status: 503,
      message:
        "visa_case_assignments table is missing on modules DB. " +
        "Run: npm run migrate:module-visa-case-assignments (or npm run db:push:modules)",
      code: "VISA_CASE_ASSIGNMENTS_TABLE_MISSING",
    };
  }

  if (message.includes("visa_case_assignments table is missing")) {
    return { status: 503, message, code: "VISA_CASE_ASSIGNMENTS_TABLE_MISSING" };
  }

  if (
    /visa_case_document_requests/i.test(message) &&
    (/does not exist|relation/i.test(message) || /Failed query/i.test(message))
  ) {
    return {
      status: 503,
      message:
        "visa_case_document_requests table is missing on modules DB. " +
        "Run: npm run migrate:module-visa-case-document-requests (or npm run db:push:modules)",
      code: "VISA_CASE_DOCUMENT_REQUESTS_TABLE_MISSING",
    };
  }

  if (message.includes("Assignee user not found")) {
    return { status: 400, message, code: "VISA_CASE_ASSIGNEE_NOT_FOUND" };
  }

  if (
    message.includes("is required") ||
    message.includes("Cannot assign") ||
    message.includes("can only assign") ||
    message.includes("Cannot skip") ||
    message.includes("Cannot move backwards") ||
    message.includes("Invalid processing") ||
    message.includes("Sub-status")
  ) {
    return { status: 400, message };
  }

  if (/Failed query/i.test(message)) {
    return { status: 503, message, code: "VISA_CASE_DB_ERROR" };
  }

  return { status: defaultStatus, message };
};
