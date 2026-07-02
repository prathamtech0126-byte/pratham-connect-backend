import "dotenv/config";
import { db } from "../config/databaseConnection";
import { poolSecond } from "../config/databaseConnectionSecond";
import {
  checklists,
  countries,
  documentItems,
  documentSections,
  visaCategories,
} from "../schemas/checklist.schema";
import { eq, inArray } from "drizzle-orm";

async function run() {
  if (!poolSecond) {
    throw new Error("DATABASE_URL_SECOND is not configured");
  }

  console.log("Syncing checklist templates to modules DB...");

  const sourceChecklists = await db
    .select({
      id: checklists.id,
      title: checklists.title,
      slug: checklists.slug,
      description: checklists.description,
      displayOrder: checklists.displayOrder,
      isActive: checklists.isActive,
      countryId: checklists.countryId,
      visaCategoryId: checklists.visaCategoryId,
    })
    .from(checklists);

  if (sourceChecklists.length === 0) {
    console.log("No source checklists found in old schema. Nothing to sync.");
    await poolSecond.end();
    return;
  }

  const countryIds = [
    ...new Set(sourceChecklists.map((row) => row.countryId).filter(Boolean)),
  ] as string[];
  const visaCategoryIds = [
    ...new Set(sourceChecklists.map((row) => row.visaCategoryId).filter(Boolean)),
  ] as string[];

  const [countryRows, visaCategoryRows] = await Promise.all([
    countryIds.length
      ? db
          .select({ id: countries.id, name: countries.name })
          .from(countries)
          .where(inArray(countries.id, countryIds))
      : Promise.resolve([]),
    visaCategoryIds.length
      ? db
          .select({ id: visaCategories.id, slug: visaCategories.slug })
          .from(visaCategories)
          .where(inArray(visaCategories.id, visaCategoryIds))
      : Promise.resolve([]),
  ]);

  const countryMap = new Map(countryRows.map((row) => [row.id, row.name]));
  const visaTypeMap = new Map(visaCategoryRows.map((row) => [row.id, row.slug]));

  for (const checklist of sourceChecklists) {
    const visaType = visaTypeMap.get(checklist.visaCategoryId) || "general";
    const country = checklist.countryId ? countryMap.get(checklist.countryId) || "global" : "global";

    await poolSecond.query(
      `
      INSERT INTO client_portal_checklists
        (id, title, slug, visa_type, country, description, display_order, is_active, created_at, updated_at)
      VALUES
        ($1::uuid, $2, $3, $4, $5, $6, $7, $8, now(), now())
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        slug = EXCLUDED.slug,
        visa_type = EXCLUDED.visa_type,
        country = EXCLUDED.country,
        description = EXCLUDED.description,
        display_order = EXCLUDED.display_order,
        is_active = EXCLUDED.is_active,
        updated_at = now()
      `,
      [
        checklist.id,
        checklist.title,
        checklist.slug,
        visaType,
        country,
        checklist.description,
        checklist.displayOrder ?? 0,
        checklist.isActive ?? true,
      ]
    );
  }

  const sections = await db.select().from(documentSections);
  for (const section of sections) {
    const checklistExists = await poolSecond.query(
      `SELECT id FROM client_portal_checklists WHERE id = $1::uuid LIMIT 1`,
      [section.checklistId]
    );
    if (checklistExists.rowCount === 0) continue;

    await poolSecond.query(
      `
      INSERT INTO client_portal_checklist_sections
        (id, checklist_id, title, description, display_order, is_conditional, condition_text, created_at)
      VALUES
        ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, now())
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        display_order = EXCLUDED.display_order,
        is_conditional = EXCLUDED.is_conditional,
        condition_text = EXCLUDED.condition_text
      `,
      [
        section.id,
        section.checklistId,
        section.title,
        section.description,
        section.displayOrder ?? 0,
        section.isConditional ?? false,
        section.conditionText,
      ]
    );
  }

  const items = await db.select().from(documentItems);
  for (const item of items) {
    await poolSecond.query(
      `
      INSERT INTO client_portal_checklist_items
        (id, section_id, name, notes, is_mandatory, is_conditional, condition_text, quantity_note, display_order, created_at)
      VALUES
        ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, now())
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        notes = EXCLUDED.notes,
        is_mandatory = EXCLUDED.is_mandatory,
        is_conditional = EXCLUDED.is_conditional,
        condition_text = EXCLUDED.condition_text,
        quantity_note = EXCLUDED.quantity_note,
        display_order = EXCLUDED.display_order
      `,
      [
        item.id,
        item.sectionId,
        item.name,
        item.notes,
        item.isMandatory ?? true,
        item.isConditional ?? false,
        item.conditionText,
        item.quantityNote,
        item.displayOrder ?? 0,
      ]
    );
  }

  console.log(
    `✓ Synced ${sourceChecklists.length} checklists, ${sections.length} sections, ${items.length} items to modules DB.`
  );

  await poolSecond.end();
}

run().catch((err) => {
  console.error("Checklist sync to modules DB failed:", err);
  process.exit(1);
});
