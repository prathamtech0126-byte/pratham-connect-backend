import "dotenv/config";
import { poolSecond } from "../src/config/databaseConnectionSecond";

const checklistSlug = (process.env.CHECKLIST_SLUG || "visitor-visa-checklist-canada").trim();

async function main() {
  if (!poolSecond) {
    throw new Error("DATABASE_URL_SECOND is not configured");
  }

  const checklistResult = await poolSecond.query(
    `
    SELECT id, title, slug, visa_type, country
    FROM client_portal_checklists
    WHERE slug = $1 AND is_active = true
    LIMIT 1
    `,
    [checklistSlug]
  );

  const checklist = checklistResult.rows[0];
  if (!checklist) {
    throw new Error(`Active checklist not found for slug: ${checklistSlug}`);
  }

  const itemResult = await poolSecond.query(
    `
    SELECT i.id, i.name, s.title AS section_title
    FROM client_portal_checklist_items i
    JOIN client_portal_checklist_sections s ON s.id = i.section_id
    WHERE s.checklist_id = $1
    ORDER BY s.display_order ASC, i.display_order ASC
    LIMIT 1
    `,
    [checklist.id]
  );

  const item = itemResult.rows[0];
  if (!item) {
    throw new Error(`No checklist items found for checklist: ${checklist.id}`);
  }

  const visaType = String(checklist.visa_type || "visitor");
  const country = String(checklist.country || "Canada").toLowerCase();

  console.log(`CHECKLIST_ID=${checklist.id}`);
  console.log(`CHECKLIST_ITEM_ID=${item.id}`);
  console.log(`VISA_TYPE=${visaType}`);
  console.log(`COUNTRY=${country}`);

  await poolSecond.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
