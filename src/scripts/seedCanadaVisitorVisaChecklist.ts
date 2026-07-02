import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../config/databaseConnection";
import {
  checklists,
  countries,
  documentItems,
  documentSections,
  visaCategories,
} from "../schemas/checklist.schema";

const CHECKLIST_SLUG = "visitor-visa-checklist-canada";

const SCAN_NOTE =
  "All documents must be scanned on a printer only. Mobile scans are not allowed.";

async function seed() {
  console.log("🌱 Seeding Canada Visitor Visa Checklist...");

  const [visitorCategory] = await db
    .select()
    .from(visaCategories)
    .where(eq(visaCategories.slug, "visitor"))
    .limit(1);

  if (!visitorCategory) {
    throw new Error("VISITOR visa category not found. Run seedChecklist first.");
  }

  const [canada] = await db
    .select()
    .from(countries)
    .where(eq(countries.code, "CA"))
    .limit(1);

  if (!canada) {
    throw new Error("Canada country not found. Run seedChecklist first.");
  }

  let [checklist] = await db
    .select()
    .from(checklists)
    .where(eq(checklists.slug, CHECKLIST_SLUG))
    .limit(1);

  if (!checklist) {
    [checklist] = await db
      .insert(checklists)
      .values({
        visaCategoryId: visitorCategory.id,
        countryId: canada.id,
        title: "Visitor Visa Checklist",
        slug: CHECKLIST_SLUG,
        description: SCAN_NOTE,
        displayOrder: 1,
        isActive: true,
      })
      .returning();
    console.log("✅ Checklist created");
  } else {
    await db
      .update(checklists)
      .set({
        title: "Visitor Visa Checklist",
        description: SCAN_NOTE,
        isActive: true,
        updatedAt: new Date(),
      })
      .where(eq(checklists.id, checklist.id));
    console.log("✅ Checklist already exists — updating metadata");
  }

  const existingSections = await db
    .select({ id: documentSections.id })
    .from(documentSections)
    .where(eq(documentSections.checklistId, checklist.id))
    .limit(1);

  if (existingSections.length > 0) {
    console.log("✅ Sections already seeded — skipping items.");
    process.exit(0);
  }

  const [
    secPassport,
    secFamily,
    secSalaried,
    secBusiness,
    secSponsorIdentity,
    secSponsorEducation,
    secSponsorEmployment,
    secSponsorFinancial,
    secSponsorResidential,
    secSponsorPr,
  ] = await db
    .insert(documentSections)
    .values([
      {
        checklistId: checklist.id,
        title: "Passport",
        description: "Mandatory documents",
        displayOrder: 1,
      },
      {
        checklistId: checklist.id,
        title: "Documents of Family",
        displayOrder: 2,
      },
      {
        checklistId: checklist.id,
        title: "Employment (If Salaried)",
        isConditional: true,
        conditionText: "Only if applicant is salaried",
        displayOrder: 3,
      },
      {
        checklistId: checklist.id,
        title: "Employment (If Having Business)",
        isConditional: true,
        conditionText: "Only if applicant has a business",
        displayOrder: 4,
      },
      {
        checklistId: checklist.id,
        title: "Sponsor Documents from Canada — Identity",
        description: "For parents of child in Canada or spouse on student visa",
        isConditional: true,
        conditionText: "Parents of child in Canada / Spouse on student visa",
        displayOrder: 5,
      },
      {
        checklistId: checklist.id,
        title: "If Studying (Educational Documents)",
        isConditional: true,
        conditionText: "If sponsor is studying in Canada",
        displayOrder: 6,
      },
      {
        checklistId: checklist.id,
        title: "Employment Documents (Sponsor in Canada)",
        isConditional: true,
        conditionText: "If sponsor is working in Canada",
        displayOrder: 7,
      },
      {
        checklistId: checklist.id,
        title: "Financial Proof (Sponsor in Canada)",
        isConditional: true,
        conditionText: "Sponsor financial documents",
        displayOrder: 8,
      },
      {
        checklistId: checklist.id,
        title: "Residential Proof (Sponsor in Canada)",
        isConditional: true,
        conditionText: "Sponsor residential proof",
        displayOrder: 9,
      },
      {
        checklistId: checklist.id,
        title: "If Sponsor is on PR Status",
        isConditional: true,
        conditionText: "Only if sponsor holds PR status",
        displayOrder: 10,
      },
    ])
    .returning();

  await db.insert(documentItems).values([
    { sectionId: secPassport.id, name: "Passport (Front Page and Back Page)", displayOrder: 1 },
    {
      sectionId: secPassport.id,
      name: "Visa Stamps",
      notes: "Wherever stamps are present",
      displayOrder: 2,
    },

    { sectionId: secFamily.id, name: "Aadhar/Pan Card", displayOrder: 1 },
    { sectionId: secFamily.id, name: "Passport (Front Page and Back Page)", displayOrder: 2 },
    { sectionId: secFamily.id, name: "Marriage Certificate", displayOrder: 3 },
    {
      sectionId: secFamily.id,
      name: "Occupation Documents",
      notes: "ITR/Income Certificate",
      displayOrder: 4,
    },
    {
      sectionId: secFamily.id,
      name: "Birth Certificate",
      isConditional: true,
      conditionText: "If having a child",
      displayOrder: 5,
    },
    {
      sectionId: secFamily.id,
      name: "School Documents",
      isConditional: true,
      conditionText: "If having a child",
      displayOrder: 6,
    },

    { sectionId: secSalaried.id, name: "Current Employment Letter", displayOrder: 1 },
    {
      sectionId: secSalaried.id,
      name: "Recent 6 months Payslips",
      displayOrder: 2,
    },
    {
      sectionId: secSalaried.id,
      name: "NOC - Granting 15 days leave as per event",
      displayOrder: 3,
    },
    {
      sectionId: secSalaried.id,
      name: "ITR",
      quantityNote: "Recent 3 years",
      displayOrder: 4,
    },

    { sectionId: secBusiness.id, name: "GST/MSME Certificate", displayOrder: 1 },
    {
      sectionId: secBusiness.id,
      name: "Company's Letter Head with Stamp",
      displayOrder: 2,
    },
    { sectionId: secBusiness.id, name: "Visiting Card", displayOrder: 3 },
    {
      sectionId: secBusiness.id,
      name: "Recent 3 months Current Bank Statement",
      notes: "Stamped, if any",
      displayOrder: 4,
    },
    {
      sectionId: secBusiness.id,
      name: "ITR",
      quantityNote: "Recent 3 years",
      displayOrder: 5,
    },

    {
      sectionId: secSponsorIdentity.id,
      name: "Passport (Front and Back Page)",
      displayOrder: 1,
    },
    {
      sectionId: secSponsorIdentity.id,
      name: "Visa Stamp",
      notes: "Student/TRV/Work Permit",
      displayOrder: 2,
    },
    {
      sectionId: secSponsorIdentity.id,
      name: "Study Permit / Work Permit",
      displayOrder: 3,
    },
    {
      sectionId: secSponsorIdentity.id,
      name: "Social Insurance Number (SIN Number)",
      displayOrder: 4,
    },
    { sectionId: secSponsorIdentity.id, name: "Driving License", displayOrder: 5 },

    {
      sectionId: secSponsorEducation.id,
      name: "Convocation Letter",
      isConditional: true,
      conditionText: "If convocation is coming up",
      displayOrder: 1,
    },
    { sectionId: secSponsorEducation.id, name: "Letter of Acceptance", displayOrder: 2 },
    { sectionId: secSponsorEducation.id, name: "Tuition Fee Receipt", displayOrder: 3 },
    { sectionId: secSponsorEducation.id, name: "Transcript", displayOrder: 4 },
    {
      sectionId: secSponsorEducation.id,
      name: "Enrolment Letter from College/University",
      displayOrder: 5,
    },
    {
      sectionId: secSponsorEducation.id,
      name: "College/University ID Card",
      displayOrder: 6,
    },
    { sectionId: secSponsorEducation.id, name: "Canadian Degree", displayOrder: 7 },

    {
      sectionId: secSponsorEmployment.id,
      name: "Employment Letter",
      isConditional: true,
      conditionText: "If working",
      displayOrder: 1,
    },
    {
      sectionId: secSponsorEmployment.id,
      name: "Paystubs",
      quantityNote: "Recent 3 months",
      displayOrder: 2,
    },
    {
      sectionId: secSponsorEmployment.id,
      name: "T4",
      quantityNote: "Recent 2 years",
      displayOrder: 3,
    },

    {
      sectionId: secSponsorFinancial.id,
      name: "Recent 3 months Bank Statement",
      displayOrder: 1,
    },
    { sectionId: secSponsorFinancial.id, name: "Balance Certificate", displayOrder: 2 },
    {
      sectionId: secSponsorFinancial.id,
      name: "GIC Balance Certificate",
      displayOrder: 3,
    },

    { sectionId: secSponsorResidential.id, name: "Rental Agreement", displayOrder: 1 },
    {
      sectionId: secSponsorResidential.id,
      name: "Utility Bill",
      notes: "Mobile/Gas/Electricity",
      displayOrder: 2,
    },
    { sectionId: secSponsorResidential.id, name: "Air Ticket", displayOrder: 3 },
    {
      sectionId: secSponsorResidential.id,
      name: "Photos in Canada",
      quantityNote: "8-9 photos",
      displayOrder: 4,
    },

    { sectionId: secSponsorPr.id, name: "PR Card", displayOrder: 1 },
  ]);

  console.log("✅ Canada Visitor Visa Checklist seeded (10 sections, 44 items)");
  console.log("\n🎉 Done! Run `npm run sync:module-client-portal-checklists` to copy to modules DB.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
