/**
 * seedReference.ts
 *
 * Seeds the essential lookup / configuration tables once.
 * Safe to re-run – all inserts use ON CONFLICT DO NOTHING.
 *
 * Tables seeded:
 *   lead_type · sale_type_category · sale_type
 *
 * Usage:
 *   npm run seed:reference
 */

import "dotenv/config";
import { db } from "../config/databaseConnection";
import { leadTypes } from "../schemas/leadType.schema";
import { saleTypeCategories } from "../schemas/saleTypeCategory.schema";
import { saleTypes } from "../schemas/saleType.schema";

async function seedReference(): Promise<void> {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║        Pratham Connect – Reference Seed Script       ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  // ── Lead types ──────────────────────────────────────────────────────────────
  console.log("📌  Lead types…");
  await db
    .insert(leadTypes)
    .values([
      { leadType: "Spouse"  },
      { leadType: "Student" },
      { leadType: "Visitor" },
      { leadType: "Worker"  },
    ])
    .onConflictDoNothing();
  console.log("   ✓ done");

  // ── Sale type categories ────────────────────────────────────────────────────
  console.log("📌  Sale type categories…");
  await db
    .insert(saleTypeCategories)
    .values([
      { name: "Spouse",  description: "Spouse & partner visa products" },
      { name: "Visitor", description: "Visitor / TRV products"         },
      { name: "Student", description: "Student visa products"           },
    ])
    .onConflictDoNothing();

  // Fetch IDs for FK
  const cats = await db
    .select({ id: saleTypeCategories.id, name: saleTypeCategories.name })
    .from(saleTypeCategories);

  const catId = (name: string) => cats.find(c => c.name === name)?.id ?? null;
  console.log("   ✓ done");

  // ── Sale types ──────────────────────────────────────────────────────────────
  console.log("📌  Sale types…");
  await db
    .insert(saleTypes)
    .values([
      // ── Spouse ──
      { saleType: "Spouse",         amount: "3129880.00", categoryId: catId("Spouse"),  isCoreProduct: true  },
      { saleType: "Canada Spouse",  amount: "2816000.00", categoryId: catId("Spouse"),  isCoreProduct: true  },
      { saleType: "Spousal PR",     amount: "82600.00",   categoryId: catId("Spouse"),  isCoreProduct: true  },
      { saleType: "Finland Spouse", amount: "118000.00",  categoryId: catId("Spouse"),  isCoreProduct: true  },
      { saleType: "UK Spouse",      amount: "113280.00",  categoryId: catId("Spouse"),  isCoreProduct: true  },
      // ── Visitor ──
      { saleType: "Visitor",        amount: "50000.00",   categoryId: catId("Visitor"), isCoreProduct: false },
      // ── Student ──
      { saleType: "Student",        amount: "100000.00",  categoryId: catId("Student"), isCoreProduct: false },
    ])
    .onConflictDoNothing();
  console.log("   ✓ done");

  console.log("\n✅  Reference data seeded.");
  console.log("   Run npm run seed:monthly next to add Jan–Apr 2026 client data.\n");
  process.exit(0);
}

seedReference().catch(err => {
  console.error("\n❌  Failed:", err);
  process.exit(1);
});
