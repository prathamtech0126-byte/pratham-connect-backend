import "dotenv/config";
import { db } from "../config/databaseConnection";
import { saleTypeCategories } from "../schemas/saleTypeCategory.schema";
import { saleTypes } from "../schemas/saleType.schema";
import { sql, eq } from "drizzle-orm";

const CATEGORIES = [
  { name: "spouse",  description: "Spouse visa clients" },
  { name: "visitor", description: "Visitor visa clients" },
  { name: "student", description: "Student visa clients" },
];

async function seedIncentiveCategories() {
  console.log("── Step 1: Ensure categories exist ─────────────────────────");

  const categoryIds: Record<string, number> = {};

  for (const cat of CATEGORIES) {
    const [existing] = await db
      .select({ id: saleTypeCategories.id })
      .from(saleTypeCategories)
      .where(sql`LOWER(${saleTypeCategories.name}) = ${cat.name}`);

    if (existing) {
      categoryIds[cat.name] = existing.id;
      console.log(`  ✓ "${cat.name}" already exists  (id=${existing.id})`);
    } else {
      const [inserted] = await db
        .insert(saleTypeCategories)
        .values({ name: cat.name, description: cat.description })
        .returning({ id: saleTypeCategories.id });
      categoryIds[cat.name] = inserted.id;
      console.log(`  + created "${cat.name}"  (id=${inserted.id})`);
    }
  }

  console.log("\n── Step 2: Show all sale_type rows ──────────────────────────");

  const allSaleTypes = await db
    .select({
      id: saleTypes.saleTypeId,
      name: saleTypes.saleType,
      categoryId: saleTypes.categoryId,
    })
    .from(saleTypes);

  if (allSaleTypes.length === 0) {
    console.log("  (no sale_type rows found — nothing to link)");
    process.exit(0);
  }

  for (const st of allSaleTypes) {
    console.log(
      `  id=${st.id}  name="${st.name}"  categoryId=${st.categoryId ?? "NULL"}`
    );
  }

  console.log("\n── Step 3: Link sale_type rows to categories ────────────────");

  let linked = 0;
  let skipped = 0;

  for (const st of allSaleTypes) {
    const nameLower = st.name.toLowerCase();

    let matchedCategory: string | null = null;
    if (nameLower.includes("spouse"))  matchedCategory = "spouse";
    else if (nameLower.includes("visitor")) matchedCategory = "visitor";
    else if (nameLower.includes("student")) matchedCategory = "student";

    if (!matchedCategory) {
      console.log(`  ? SKIP id=${st.id} "${st.name}" — no pattern match`);
      skipped++;
      continue;
    }

    const newCategoryId = categoryIds[matchedCategory];

    if (st.categoryId === newCategoryId) {
      console.log(`  = id=${st.id} "${st.name}" already → "${matchedCategory}"`);
      skipped++;
      continue;
    }

    await db
      .update(saleTypes)
      .set({ categoryId: newCategoryId })
      .where(eq(saleTypes.saleTypeId, st.id));

    console.log(
      `  ✓ id=${st.id} "${st.name}" → category "${matchedCategory}" (id=${newCategoryId})`
    );
    linked++;
  }

  console.log(
    `\n── Done: ${linked} linked, ${skipped} skipped ──────────────────`
  );
  console.log(
    "  If any rows were skipped with '?', update them manually via:\n" +
    "  npx drizzle-kit studio  →  sale_type table → set category_id"
  );

  process.exit(0);
}

seedIncentiveCategories().catch((err) => {
  console.error("❌ Failed:", err);
  process.exit(1);
});
