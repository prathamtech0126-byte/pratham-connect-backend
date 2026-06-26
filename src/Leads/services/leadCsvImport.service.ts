import { insertLeadRecord } from "./leadInsert.service";
import type { Role } from "../../types/role";

export type CsvImportRowError = { row: number; message: string };

export type CsvImportResult = {
  created: number;
  failed: number;
  errors: CsvImportRowError[];
};

const HEADER_ALIASES: Record<string, string> = {
  name: "fullName",
  full_name: "fullName",
  fullname: "fullName",
  "full name": "fullName",
  phone: "phone",
  phone_number: "phone",
  mobile: "phone",
  mobileno: "phone",
  "mobile number": "phone",
  email: "email",
  email_address: "email",
  city: "city",
  location: "city",
  whatsapp: "whatsapp",
  whats_app: "whatsapp",
  lead_source: "leadSource",
  source: "leadSource",
  "lead source": "leadSource",
  lead_type: "leadType",
  type: "leadType",
  "lead type": "leadType",
  sale_type: "leadType",
  latest_note: "latestNote",
  note: "latestNote",
  notes: "latestNote",
};

function normalizeHeader(h: string): string {
  return h.replace(/^\uFEFF/, "").trim().toLowerCase();
}

function normalizePhone(raw: string): string {
  const cleaned = raw.replace(/[^\d+]/g, "");
  return cleaned || raw.trim();
}

/** Minimal RFC-style CSV row parser (handles quoted commas). */
export function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const text = content.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || (ch === "\r" && next === "\n")) {
      row.push(field);
      field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      if (ch === "\r") i++;
    } else if (ch !== "\r") {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((c) => c.trim() !== "")) rows.push(row);
  }

  return rows;
}

function mapRow(headers: string[], values: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((h, i) => {
    const key = HEADER_ALIASES[normalizeHeader(h)];
    if (!key) return;
    const val = (values[i] ?? "").trim();
    if (val) out[key] = val;
  });
  return out;
}

const MAX_ROWS = 500;

export async function importLeadsFromCsvBuffer(
  buffer: Buffer,
  ctx: { userId: number; role: Role }
): Promise<CsvImportResult> {
  const content = buffer.toString("utf8");
  const table = parseCsv(content);
  if (table.length === 0) {
    throw new Error("CSV file is empty");
  }

  const headers = table[0].map(normalizeHeader);
  const dataRows = table.slice(1);
  if (dataRows.length > MAX_ROWS) {
    throw new Error(`CSV exceeds maximum of ${MAX_ROWS} data rows`);
  }

  const result: CsvImportResult = { created: 0, failed: 0, errors: [] };
  const now = new Date();

  for (let i = 0; i < dataRows.length; i++) {
    const rowNumber = i + 2;
    const mapped = mapRow(headers, dataRows[i]);

    const fullName = mapped.fullName?.trim();
    const phoneRaw = mapped.phone?.trim();
    if (!fullName || !phoneRaw) {
      result.failed++;
      result.errors.push({
        row: rowNumber,
        message: "fullName and phone are required",
      });
      continue;
    }

    const phone = normalizePhone(phoneRaw);
    if (phone.length < 8) {
      result.failed++;
      result.errors.push({ row: rowNumber, message: "Invalid phone number" });
      continue;
    }

    try {
      const insert: Record<string, unknown> = {
        fullName,
        phone,
        email: mapped.email || null,
        city: mapped.city || null,
        whatsapp: mapped.whatsapp ? normalizePhone(mapped.whatsapp) : null,
        leadSource: mapped.leadSource || "csv_import",
        leadType: mapped.leadType || null,
        latestNote: mapped.latestNote || null,
        createdAt: now,
        updatedAt: now,
        assignmentStatus: "not_assigned",
        progressStatus: "not_contacted",
        assignedBy: ctx.userId,
      };

      if (ctx.role === "telecaller") {
        insert.currentTelecallerId = ctx.userId;
        insert.assignmentStatus = "assigned";
      } else if (ctx.role === "counsellor") {
        insert.currentCounsellorId = ctx.userId;
        insert.assignmentStatus = "transferred";
      }

      await insertLeadRecord(insert as any, null, {
        userId: ctx.userId,
        performerName: null,
      });

      result.created++;
    } catch (err: unknown) {
      result.failed++;
      result.errors.push({
        row: rowNumber,
        message: err instanceof Error ? err.message : "Failed to create lead",
      });
    }
  }

  return result;
}

export const CSV_IMPORT_TEMPLATE = [
  "full_name,phone,email,city,whatsapp,lead_source,lead_type,latest_note",
  "John Doe,+919876543210,john@example.com,Mumbai,+919876543210,website,USA Student,Imported via CSV",
].join("\n");
