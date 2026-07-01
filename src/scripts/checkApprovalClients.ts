/**
 * One-off: match spreadsheet approval rows against modules DB + CRM counsellor names.
 * Usage: npx tsx src/scripts/checkApprovalClients.ts
 */
import "dotenv/config";
import { Pool } from "pg";

type Row = {
  no: number;
  name: string;
  counsellor: string;
  expectedDate: string | null; // YYYY-MM-DD
  list: string;
};

const ROWS: Row[] = [
  // List 1 — visitor/spouse bulk
  { no: 1, list: "L1", name: "Rajesh Desai", counsellor: "Avani", expectedDate: "2025-12-10" },
  { no: 2, list: "L1", name: "Darshana Bhatt", counsellor: "Purvish", expectedDate: "2025-12-10" },
  { no: 3, list: "L1", name: "Vivek Bhatt", counsellor: "Purvish", expectedDate: "2025-12-10" },
  { no: 4, list: "L1", name: "Vijaybhai Patel", counsellor: "Purvish", expectedDate: "2025-12-12" },
  { no: 5, list: "L1", name: "Rekhaben Patel", counsellor: "Purvish", expectedDate: "2025-12-12" },
  { no: 6, list: "L1", name: "Nileshbhai Patel", counsellor: "Purvish", expectedDate: "2025-12-12" },
  { no: 7, list: "L1", name: "Varshaben Patel", counsellor: "Purvish", expectedDate: "2025-12-12" },
  { no: 8, list: "L1", name: "Raxaben patel", counsellor: "Param", expectedDate: "2025-12-22" },
  { no: 9, list: "L1", name: "Keshaben shah", counsellor: "Param", expectedDate: "2026-01-28" },
  { no: 10, list: "L1", name: "Kalpesh Patel", counsellor: "Khushbu", expectedDate: "2026-02-02" },
  { no: 11, list: "L1", name: "Neha Patel", counsellor: "Khushbu", expectedDate: "2026-02-02" },
  { no: 12, list: "L1", name: "Naynaben Patel", counsellor: "Param", expectedDate: "2026-03-19" },
  { no: 13, list: "L1", name: "Farjanaben Rathod", counsellor: "Purvish", expectedDate: "2026-03-21" },
  { no: 14, list: "L1", name: "Arjuben Rathod", counsellor: "Purvish", expectedDate: "2026-03-21" },
  { no: 15, list: "L1", name: "Chintan Shah", counsellor: "Purvish", expectedDate: "2026-04-03" },
  { no: 16, list: "L1", name: "Manjibhai Patel", counsellor: "Vaibhavi", expectedDate: "2026-04-22" },
  { no: 17, list: "L1", name: "Valiben Patel", counsellor: "Hardeep", expectedDate: "2026-04-22" },
  { no: 18, list: "L1", name: "Geetaben Kosada", counsellor: "Purvish", expectedDate: "2026-04-27" },
  { no: 19, list: "L1", name: "Upendra Kosada", counsellor: "Hardeep", expectedDate: "2026-04-27" },
  { no: 20, list: "L1", name: "Tahera Gheewala", counsellor: "Hardeep", expectedDate: "2026-04-28" },
  { no: 21, list: "L1", name: "Amarkumar Thakkar", counsellor: "Purvish", expectedDate: "2026-04-29" },
  { no: 22, list: "L1", name: "Nirali Amarkumar Thakkar", counsellor: "Purvish", expectedDate: "2026-04-29" },
  { no: 23, list: "L1", name: "Farjanaben Rathod", counsellor: "Mit Sir", expectedDate: "2026-05-01" },
  { no: 24, list: "L1", name: "Sagir Vohra", counsellor: "Mit Sir", expectedDate: "2026-05-01" },
  { no: 25, list: "L1", name: "Hemantbhai Patel", counsellor: "Param Sir", expectedDate: "2026-05-04" },
  { no: 26, list: "L1", name: "Sangitaben Patel", counsellor: "Param Sir", expectedDate: "2026-05-04" },
  { no: 27, list: "L1", name: "Kiran Desai", counsellor: "Purvish", expectedDate: "2026-05-04" },
  { no: 28, list: "L1", name: "Kirit Vaidya", counsellor: "Krishna Surat", expectedDate: "2026-05-06" },
  { no: 29, list: "L1", name: "Lalitbhai Patel", counsellor: "Purvish", expectedDate: "2026-05-07" },
  { no: 30, list: "L1", name: "Ushaben Patel", counsellor: "Purvish", expectedDate: "2026-05-07" },
  { no: 31, list: "L1", name: "Nileshbhai Patel", counsellor: "Avani", expectedDate: "2026-05-11" },
  { no: 32, list: "L1", name: "Sarlaben patel", counsellor: "Avani", expectedDate: "2026-05-11" },
  { no: 33, list: "L1", name: "Kantilal Patel", counsellor: "Param sir", expectedDate: "2026-05-12" },
  { no: 34, list: "L1", name: "Rasila patel", counsellor: "Param sir", expectedDate: "2026-05-12" },
  { no: 35, list: "L1", name: "Sushilaben Patel", counsellor: "Purvish Sir", expectedDate: "2026-05-20" },
  { no: 36, list: "L1", name: "Annapurna Pandya", counsellor: "Kruti", expectedDate: "2026-05-20" },
  { no: 37, list: "L1", name: "Chunilal Vaghasia", counsellor: "Rutika", expectedDate: "2026-05-21" },
  { no: 38, list: "L1", name: "Jayaben Vaghasia", counsellor: "Rutika", expectedDate: "2026-05-21" },
  { no: 39, list: "L1", name: "Jayantibhai Patel", counsellor: "Mit Sir", expectedDate: "2026-05-23" },
  { no: 40, list: "L1", name: "Hasumatiben Patel", counsellor: "Mit Sir", expectedDate: "2026-05-23" },
  { no: 41, list: "L1", name: "Sanjay Channariya", counsellor: "Purvish", expectedDate: "2026-05-27" },
  { no: 42, list: "L1", name: "Bhavika Channariya", counsellor: "Purvish", expectedDate: "2026-05-27" },
  { no: 43, list: "L1", name: "Sanjay Patel", counsellor: "Purvish", expectedDate: "2026-05-30" },
  { no: 44, list: "L1", name: "Bhagvatiben patel", counsellor: "Purvish", expectedDate: "2026-05-30" },
  { no: 45, list: "L1", name: "Dipal Soni", counsellor: "Hardeep", expectedDate: "2026-06-02" },
  { no: 46, list: "L1", name: "Ganibhai Vhora", counsellor: "Hardeep", expectedDate: "2026-06-06" },
  { no: 47, list: "L1", name: "Asmataben Vhora", counsellor: "Hardeep", expectedDate: "2026-06-06" },
  { no: 48, list: "L1", name: "Mujeeburrehman", counsellor: "Allan", expectedDate: "2026-06-07" },
  { no: 49, list: "L1", name: "Sheeba Parveen", counsellor: "Allan", expectedDate: "2026-06-07" },
  { no: 50, list: "L1", name: "Chand patel", counsellor: "Purvish", expectedDate: "2026-06-10" },
  { no: 51, list: "L1", name: "Nareshbhai Valand", counsellor: "Purvish", expectedDate: "2026-06-12" },
  { no: 52, list: "L1", name: "Bhartiben Valand", counsellor: "Purvish", expectedDate: "2026-06-12" },
  { no: 53, list: "L1", name: "Ashiyana Kazi", counsellor: "hardeep", expectedDate: "2026-06-17" },
  { no: 54, list: "L1", name: "Mukeshkumar Shah", counsellor: "Hardeep", expectedDate: "2026-06-20" },
  { no: 55, list: "L1", name: "Rajnikant patel", counsellor: "Mit Sir", expectedDate: "2026-06-21" },
  { no: 56, list: "L1", name: "Chetnaben patel", counsellor: "Mit Sir", expectedDate: "2026-06-21" },
  // List 2
  { no: 1, list: "L2", name: "Sanjaykumar Patel", counsellor: "Vaibhavi", expectedDate: "2026-01-23" },
  { no: 2, list: "L2", name: "Manishaben Patel", counsellor: "Vaibhavi", expectedDate: "2026-01-23" },
  { no: 3, list: "L2", name: "Maulik Patel", counsellor: "Hardeep", expectedDate: "2026-01-06" },
  { no: 4, list: "L2", name: "Jayesh Raval", counsellor: "Hardeep", expectedDate: "2026-03-16" },
  { no: 5, list: "L2", name: "Imtiyaz Vohra", counsellor: "Avani", expectedDate: "2026-05-07" },
  { no: 6, list: "L2", name: "Afrin Vohra", counsellor: "Avani", expectedDate: "2026-05-07" },
  { no: 7, list: "L2", name: "Samimben Vohra", counsellor: "Avani", expectedDate: "2026-05-07" },
  { no: 8, list: "L2", name: "Shashin Mehta", counsellor: "Khushbu", expectedDate: "2026-03-24" },
  { no: 9, list: "L2", name: "Anuja Mehta", counsellor: "Khushbu", expectedDate: "2026-03-24" },
  { no: 10, list: "L2", name: "Dipaben Jain", counsellor: "Hardeep", expectedDate: "2026-06-12" },
  // List 3 — no dates
  { no: 1, list: "L3", name: "Jayesh Jethva", counsellor: "Purvish", expectedDate: null },
  { no: 2, list: "L3", name: "Girishbhai", counsellor: "Deep", expectedDate: null },
  { no: 3, list: "L3", name: "Jignasha Oza", counsellor: "Purvish", expectedDate: null },
  // List 4
  { no: 1, list: "L4", name: "Pravin Satani", counsellor: "Hardeep", expectedDate: "2026-04-23" },
];

function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function counsellorToken(counsellor: string): string {
  return counsellor.toLowerCase().replace(/sir/g, "").trim().split(/\s+/)[0] ?? "";
}

type DbMatch = {
  client_code: string;
  full_name: string;
  counsellor_name: string;
  user_id: number;
  visa_case_id: string;
  decision: string;
  decision_date: string | null;
  current_sub_status: string;
  accompanying_members_count: number;
};

async function main() {
  const modulesPool = new Pool({ connectionString: process.env.DATABASE_URL_SECOND });
  const mainPool = new Pool({ connectionString: process.env.DATABASE_URL });

  const usersRes = await mainPool.query<{ id: number; full_name: string }>(
    `SELECT id, full_name FROM users WHERE status = true`
  );
  const usersById = new Map(usersRes.rows.map((u) => [u.id, u.full_name]));

  const allCases = await modulesPool.query<{
    client_code: string;
    full_name: string;
    user_id: number;
    visa_case_id: string;
    decision: string;
    decision_date: string | null;
    current_sub_status: string;
    accompanying_members_count: number;
  }>(`
    SELECT
      c.client_code,
      p.full_name,
      vc.user_id,
      vc.id AS visa_case_id,
      vc.decision::text,
      vc.decision_date::text,
      vc.current_sub_status::text,
      vc.accompanying_members_count
    FROM visa_cases vc
    JOIN clients c ON c.id = vc.client_id
    JOIN persons p ON p.id = c.person_id
  `);

  const enriched: DbMatch[] = allCases.rows.map((r) => ({
    ...r,
    counsellor_name: usersById.get(r.user_id) ?? `user#${r.user_id}`,
  }));

  const summary = {
    found: 0,
    notFound: 0,
    approvedWithDate: 0,
    approvedMissingDate: 0,
    notApproved: 0,
    dateMismatch: 0,
    counsellorMismatch: 0,
  };

  console.log("\n=== APPROVAL CLIENT LOOKUP ===\n");
  console.log(
    "List | # | Spreadsheet Name | Counsellor | Expected | DB Name | DB Counsellor | Decision | DB Date | Status"
  );
  console.log("-".repeat(140));

  for (const row of ROWS) {
    const tokens = nameTokens(row.name);
    const cToken = counsellorToken(row.counsellor);

    const candidates = enriched.filter((db) => {
      const dbName = db.full_name.toLowerCase();
      const nameMatch = tokens.every((t) => dbName.includes(t));
      if (!nameMatch) return false;
      if (cToken) {
        const counsellorMatch = db.counsellor_name.toLowerCase().includes(cToken);
        return counsellorMatch;
      }
      return true;
    });

    if (candidates.length === 0) {
      // fallback: name only
      const nameOnly = enriched.filter((db) =>
        tokens.every((t) => db.full_name.toLowerCase().includes(t))
      );
      if (nameOnly.length === 1) {
        candidates.push(nameOnly[0]!);
      } else if (nameOnly.length > 1) {
        summary.notFound++;
        console.log(
          `${row.list} | ${row.no} | ${row.name} | ${row.counsellor} | ${row.expectedDate ?? "—"} | — | — | — | — | AMBIGUOUS (${nameOnly.length} name matches: ${nameOnly.map((m) => m.full_name).join("; ")})`
        );
        continue;
      }
    }

    if (candidates.length === 0) {
      summary.notFound++;
      console.log(
        `${row.list} | ${row.no} | ${row.name} | ${row.counsellor} | ${row.expectedDate ?? "—"} | — | — | — | — | NOT FOUND`
      );
      continue;
    }

    if (candidates.length > 1) {
      summary.notFound++;
      console.log(
        `${row.list} | ${row.no} | ${row.name} | ${row.counsellor} | ${row.expectedDate ?? "—"} | — | — | — | — | MULTIPLE (${candidates.map((m) => `${m.full_name} [${m.counsellor_name}]`).join("; ")})`
      );
      continue;
    }

    const m = candidates[0]!;
    summary.found++;

    const isApproved =
      m.decision === "APPROVED" || m.current_sub_status === "DECISION_APPROVED";
    const dbDate = m.decision_date?.slice(0, 10) ?? null;
    const dateOk = !row.expectedDate || dbDate === row.expectedDate;
    const counsellorOk = m.counsellor_name.toLowerCase().includes(cToken);

    let status: string;
    if (!isApproved) {
      status = `NOT APPROVED (${m.decision}/${m.current_sub_status})`;
      summary.notApproved++;
    } else if (!dbDate) {
      status = "APPROVED but decision_date MISSING";
      summary.approvedMissingDate++;
    } else if (!dateOk) {
      status = `DATE MISMATCH (expected ${row.expectedDate})`;
      summary.dateMismatch++;
    } else {
      status = "OK";
      summary.approvedWithDate++;
    }

    if (!counsellorOk) summary.counsellorMismatch++;

    console.log(
      `${row.list} | ${row.no} | ${row.name} | ${row.counsellor} | ${row.expectedDate ?? "—"} | ${m.full_name} | ${m.counsellor_name} | ${m.decision} | ${dbDate ?? "NULL"} | ${status}`
    );
  }

  // Second pass: NOT FOUND / AMBIGUOUS → search main CRM client_information
  const notFoundRows = ROWS.filter((row) => {
    const tokens = nameTokens(row.name);
    const cToken = counsellorToken(row.counsellor);
    const candidates = enriched.filter((db) => {
      const dbName = db.full_name.toLowerCase();
      if (!tokens.every((t) => dbName.includes(t))) return false;
      if (!cToken) return true;
      return db.counsellor_name.toLowerCase().includes(cToken);
    });
    return candidates.length !== 1;
  });

  const crmClients = await mainPool.query<{
    id: number;
    fullname: string;
    counsellor_name: string;
  }>(`
    SELECT ci.id, ci.fullname, u.full_name AS counsellor_name
    FROM client_information ci
    LEFT JOIN users u ON u.id = ci.counsellor_id
  `);

  console.log("\n=== MAIN CRM LOOKUP (not found / ambiguous in modules) ===\n");
  for (const row of notFoundRows) {
    const tokens = nameTokens(row.name);
    const cToken = counsellorToken(row.counsellor);
    const matches = crmClients.rows.filter((c) => {
      const n = c.fullname.toLowerCase();
      if (!tokens.every((t) => n.includes(t))) return false;
      if (!cToken) return true;
      return (c.counsellor_name ?? "").toLowerCase().includes(cToken);
    });

    if (matches.length === 0) {
      const nameOnly = crmClients.rows.filter((c) =>
        tokens.every((t) => c.fullname.toLowerCase().includes(t))
      );
      console.log(
        `${row.list}#${row.no} ${row.name} | CRM: ${nameOnly.length ? nameOnly.map((m) => `${m.fullname} [${m.counsellor_name}] id=${m.id}`).join("; ") : "NOT IN CRM"}`
      );
    } else {
      console.log(
        `${row.list}#${row.no} ${row.name} | CRM: ${matches.map((m) => `${m.fullname} [${m.counsellor_name}] id=${m.id}`).join("; ")}`
      );
    }
  }

  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(summary, null, 2));

  await modulesPool.end();
  await mainPool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
