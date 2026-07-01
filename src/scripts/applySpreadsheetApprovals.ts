/**
 * Backfill visa case approvals from spreadsheet data.
 * Sets decision=APPROVED, stage=DECISION, sub_status=DECISION_APPROVED, decision_date.
 *
 * Usage:
 *   npx ts-node src/scripts/applySpreadsheetApprovals.ts          # dry-run
 *   npx ts-node src/scripts/applySpreadsheetApprovals.ts --apply  # write to DB
 */
import "dotenv/config";
import { Pool } from "pg";

type Row = {
  key: string;
  name: string;
  counsellor: string;
  expectedDate: string;
};

const ROWS: Row[] = [
  { key: "L1#1", name: "Rajesh Desai", counsellor: "Avani", expectedDate: "2025-12-10" },
  { key: "L1#2", name: "Darshana Bhatt", counsellor: "Purvish", expectedDate: "2025-12-10" },
  { key: "L1#3", name: "Vivek Bhatt", counsellor: "Purvish", expectedDate: "2025-12-10" },
  { key: "L1#4", name: "Vijaybhai Patel", counsellor: "Purvish", expectedDate: "2025-12-12" },
  { key: "L1#5", name: "Rekhaben Patel", counsellor: "Purvish", expectedDate: "2025-12-12" },
  { key: "L1#6", name: "Nileshbhai Patel", counsellor: "Purvish", expectedDate: "2025-12-12" },
  { key: "L1#7", name: "Varshaben Patel", counsellor: "Purvish", expectedDate: "2025-12-12" },
  { key: "L1#8", name: "Raxaben patel", counsellor: "Param", expectedDate: "2025-12-22" },
  { key: "L1#9", name: "Keshaben shah", counsellor: "Param", expectedDate: "2026-01-28" },
  { key: "L1#10", name: "Kalpesh Patel", counsellor: "Khushbu", expectedDate: "2026-02-02" },
  { key: "L1#11", name: "Neha Patel", counsellor: "Khushbu", expectedDate: "2026-02-02" },
  { key: "L1#12", name: "Naynaben Patel", counsellor: "Param", expectedDate: "2026-03-19" },
  { key: "L1#13", name: "Farjanaben Rathod", counsellor: "Purvish", expectedDate: "2026-03-21" },
  { key: "L1#14", name: "Arjuben Rathod", counsellor: "Purvish", expectedDate: "2026-03-21" },
  { key: "L1#15", name: "Chintan Shah", counsellor: "Purvish", expectedDate: "2026-04-03" },
  { key: "L1#16", name: "Manjibhai Patel", counsellor: "Vaibhavi", expectedDate: "2026-04-22" },
  { key: "L1#17", name: "Valiben Patel", counsellor: "Hardeep", expectedDate: "2026-04-22" },
  { key: "L1#18", name: "Geetaben Kosada", counsellor: "Purvish", expectedDate: "2026-04-27" },
  { key: "L1#19", name: "Upendra Kosada", counsellor: "Hardeep", expectedDate: "2026-04-27" },
  { key: "L1#20", name: "Tahera Gheewala", counsellor: "Hardeep", expectedDate: "2026-04-28" },
  { key: "L1#21", name: "Amarkumar Thakkar", counsellor: "Purvish", expectedDate: "2026-04-29" },
  { key: "L1#22", name: "Nirali Amarkumar Thakkar", counsellor: "Purvish", expectedDate: "2026-04-29" },
  { key: "L1#23", name: "Farjanaben Rathod", counsellor: "Mit Sir", expectedDate: "2026-05-01" },
  { key: "L1#24", name: "Sagir Vohra", counsellor: "Mit Sir", expectedDate: "2026-05-01" },
  { key: "L1#25", name: "Hemantbhai Patel", counsellor: "Param Sir", expectedDate: "2026-05-04" },
  { key: "L1#26", name: "Sangitaben Patel", counsellor: "Param Sir", expectedDate: "2026-05-04" },
  { key: "L1#27", name: "Kiran Desai", counsellor: "Purvish", expectedDate: "2026-05-04" },
  { key: "L1#28", name: "Kirit Vaidya", counsellor: "Krishna Surat", expectedDate: "2026-05-06" },
  { key: "L1#29", name: "Lalitbhai Patel", counsellor: "Purvish", expectedDate: "2026-05-07" },
  { key: "L1#30", name: "Ushaben Patel", counsellor: "Purvish", expectedDate: "2026-05-07" },
  { key: "L1#31", name: "Nileshbhai Patel", counsellor: "Avani", expectedDate: "2026-05-11" },
  { key: "L1#32", name: "Sarlaben patel", counsellor: "Avani", expectedDate: "2026-05-11" },
  { key: "L1#33", name: "Kantilal Patel", counsellor: "Param sir", expectedDate: "2026-05-12" },
  { key: "L1#34", name: "Rasila patel", counsellor: "Param sir", expectedDate: "2026-05-12" },
  { key: "L1#35", name: "Sushilaben Patel", counsellor: "Purvish Sir", expectedDate: "2026-05-20" },
  { key: "L1#36", name: "Annapurna Pandya", counsellor: "Kruti", expectedDate: "2026-05-20" },
  { key: "L1#37", name: "Chunilal Vaghasia", counsellor: "Rutika", expectedDate: "2026-05-21" },
  { key: "L1#38", name: "Jayaben Vaghasia", counsellor: "Rutika", expectedDate: "2026-05-21" },
  { key: "L1#39", name: "Jayantibhai Patel", counsellor: "Mit Sir", expectedDate: "2026-05-23" },
  { key: "L1#40", name: "Hasumatiben Patel", counsellor: "Mit Sir", expectedDate: "2026-05-23" },
  { key: "L1#41", name: "Sanjay Channariya", counsellor: "Purvish", expectedDate: "2026-05-27" },
  { key: "L1#42", name: "Bhavika Channariya", counsellor: "Purvish", expectedDate: "2026-05-27" },
  { key: "L1#43", name: "Sanjay Patel", counsellor: "Purvish", expectedDate: "2026-05-30" },
  { key: "L1#44", name: "Bhagvatiben patel", counsellor: "Purvish", expectedDate: "2026-05-30" },
  { key: "L1#45", name: "Dipal Soni", counsellor: "Hardeep", expectedDate: "2026-06-02" },
  { key: "L1#46", name: "Ganibhai Vhora", counsellor: "Hardeep", expectedDate: "2026-06-06" },
  { key: "L1#47", name: "Asmataben Vhora", counsellor: "Hardeep", expectedDate: "2026-06-06" },
  { key: "L1#48", name: "Mujeeburrehman", counsellor: "Allan", expectedDate: "2026-06-07" },
  { key: "L1#49", name: "Sheeba Parveen", counsellor: "Allan", expectedDate: "2026-06-07" },
  { key: "L1#50", name: "Chand patel", counsellor: "Purvish", expectedDate: "2026-06-10" },
  { key: "L1#51", name: "Nareshbhai Valand", counsellor: "Purvish", expectedDate: "2026-06-12" },
  { key: "L1#52", name: "Bhartiben Valand", counsellor: "Purvish", expectedDate: "2026-06-12" },
  { key: "L1#53", name: "Ashiyana Kazi", counsellor: "hardeep", expectedDate: "2026-06-17" },
  { key: "L1#54", name: "Mukeshkumar Shah", counsellor: "Hardeep", expectedDate: "2026-06-20" },
  { key: "L1#55", name: "Rajnikant patel", counsellor: "Mit Sir", expectedDate: "2026-06-21" },
  { key: "L1#56", name: "Chetnaben patel", counsellor: "Mit Sir", expectedDate: "2026-06-21" },
  { key: "L2#1", name: "Sanjaykumar Patel", counsellor: "Vaibhavi", expectedDate: "2026-01-23" },
  { key: "L2#2", name: "Manishaben Patel", counsellor: "Vaibhavi", expectedDate: "2026-01-23" },
  { key: "L2#3", name: "Maulik Patel", counsellor: "Hardeep", expectedDate: "2026-01-06" },
  { key: "L2#4", name: "Jayesh Raval", counsellor: "Hardeep", expectedDate: "2026-03-16" },
  { key: "L2#5", name: "Imtiyaz Vohra", counsellor: "Avani", expectedDate: "2026-05-07" },
  { key: "L2#6", name: "Afrin Vohra", counsellor: "Avani", expectedDate: "2026-05-07" },
  { key: "L2#7", name: "Samimben Vohra", counsellor: "Avani", expectedDate: "2026-05-07" },
  { key: "L2#8", name: "Shashin Mehta", counsellor: "Khushbu", expectedDate: "2026-03-24" },
  { key: "L2#9", name: "Anuja Mehta", counsellor: "Khushbu", expectedDate: "2026-03-24" },
  { key: "L2#10", name: "Dipaben Jain", counsellor: "Hardeep", expectedDate: "2026-06-12" },
  { key: "L4#1", name: "Pravin Satani", counsellor: "Hardeep", expectedDate: "2026-04-23" },
];

/** Manual disambiguation when name+counsellor still matches multiple rows. */
const CLIENT_CODE_OVERRIDE: Record<string, string> = {
  "L1#1": "PRA-VAD-CLI-2026-000521",
  "L1#10": "PRA-VAD-CLI-2025-000136",
  "L1#19": "PRA-VAD-CLI-2025-000129",
  "L1#31": "PRA-VAD-CLI-2026-000153",
  "L1#32": "PRA-VAD-CLI-2026-000153",
  "L1#43": "PRA-VAD-CLI-2025-000028",
  "L1#45": "PRA-VAD-CLI-2025-000177",
  "L1#50": "PRA-VAD-CLI-2026-000376",
  "L2#3": "PRA-VAD-CLI-2026-000172",
  "L4#1": "PRA-VAD-CLI-2026-000113",
};

function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function counsellorUserIds(counsellor: string): number[] {
  const c = counsellor.toLowerCase();
  const ids: number[] = [];
  const add = (id: number) => {
    if (!ids.includes(id)) ids.push(id);
  };
  if (c.includes("avani")) add(21);
  if (c.includes("purvish")) add(22);
  if (c.includes("param")) add(8);
  if (c.includes("khushbu")) add(27);
  if (c.includes("hardeep")) add(26);
  if (c.includes("vaibhavi")) add(28);
  if (c.includes("mit")) add(14);
  if (c.includes("krishna")) add(42);
  if (c.includes("rutika")) add(44);
  if (c.includes("kruti")) add(56);
  if (c.includes("allan")) add(34);
  if (c.includes("deep")) add(83);
  if (c.includes("nilofar")) add(57);
  if (c.includes("shital")) add(45);
  if (c.includes("shubhangi")) add(25);
  return ids;
}

type CaseRow = {
  visa_case_id: string;
  client_code: string;
  full_name: string;
  user_id: number;
  decision: string;
  decision_date: string | null;
  current_stage: string;
  current_sub_status: string;
};

async function main() {
  const apply = process.argv.includes("--apply");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL_SECOND });

  const { rows: cases } = await pool.query<CaseRow>(`
    SELECT
      vc.id AS visa_case_id,
      c.client_code,
      p.full_name,
      vc.user_id,
      vc.decision::text,
      vc.decision_date::text,
      vc.current_stage::text,
      vc.current_sub_status::text
    FROM visa_cases vc
    JOIN clients c ON c.id = vc.client_id
    JOIN persons p ON p.id = c.person_id
  `);

  const byCode = new Map(cases.map((c) => [c.client_code, c]));
  const updatedCaseIds = new Set<string>();

  let applied = 0;
  let skipped = 0;
  let alreadyOk = 0;

  console.log(apply ? "=== APPLYING APPROVALS ===" : "=== DRY RUN (pass --apply to write) ===\n");

  for (const row of ROWS) {
    let match: CaseRow | undefined;

    const overrideCode = CLIENT_CODE_OVERRIDE[row.key];
    if (overrideCode) {
      match = byCode.get(overrideCode);
    }

    if (!match) {
      const tokens = nameTokens(row.name);
      const counsellorIds = counsellorUserIds(row.counsellor);

      let candidates = cases.filter((c) =>
        tokens.every((t) => c.full_name.toLowerCase().includes(t))
      );

      if (counsellorIds.length) {
        const byCounsellor = candidates.filter((c) =>
          counsellorIds.includes(c.user_id)
        );
        if (byCounsellor.length) candidates = byCounsellor;
      }

      if (candidates.length === 1) {
        match = candidates[0];
      } else if (candidates.length > 1) {
        console.log(
          `SKIP ${row.key} ${row.name} — ambiguous (${candidates.map((c) => c.client_code).join(", ")})`
        );
        skipped++;
        continue;
      }
    }

    if (!match) {
      console.log(`SKIP ${row.key} ${row.name} — not found in modules DB`);
      skipped++;
      continue;
    }

    const already =
      match.decision === "APPROVED" &&
      match.current_sub_status === "DECISION_APPROVED" &&
      match.decision_date?.slice(0, 10) === row.expectedDate;

    if (already) {
      console.log(`OK   ${row.key} ${match.full_name} (${match.client_code}) — already set`);
      alreadyOk++;
      continue;
    }

    console.log(
      `${apply ? "APPLY" : "WOULD"} ${row.key} ${row.name} → ${match.full_name} (${match.client_code}) date=${row.expectedDate}`
    );

    if (apply) {
      await pool.query(
        `UPDATE visa_cases SET
           decision = 'APPROVED',
           current_stage = 'DECISION',
           current_sub_status = 'DECISION_APPROVED',
           assigned_team = 'binding',
           decision_date = $1::date,
           updated_at = NOW()
         WHERE id = $2::uuid`,
        [row.expectedDate, match.visa_case_id]
      );

      if (!updatedCaseIds.has(match.visa_case_id)) {
        await pool.query(
          `INSERT INTO visa_case_status_events (
             visa_case_id, from_stage, to_stage, from_sub_status, to_sub_status,
             changed_by, changed_by_role, notes
           ) VALUES ($1::uuid, $2::visa_processing_stage_enum, 'DECISION', $3::visa_processing_sub_status_enum, 'DECISION_APPROVED', 1, 'developer', $4)`,
          [
            match.visa_case_id,
            match.current_stage,
            match.current_sub_status,
            `Spreadsheet approval backfill (${row.key})`,
          ]
        );
        updatedCaseIds.add(match.visa_case_id);
      }

      applied++;
    }
  }

  console.log("\n=== DONE ===");
  console.log({ apply, applied, alreadyOk, skipped });

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
