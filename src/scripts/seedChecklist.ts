// src/scripts/seedChecklist.ts
import "dotenv/config";
import { db } from "../config/databaseConnection";
import {
  visaCategories,
  countries,
  checklists,
  documentSections,
  documentItems,
} from "../schemas/checklist.schema";

async function seed() {
  // Idempotency check
  const existing = await db.select({ id: visaCategories.id }).from(visaCategories).limit(1);
  if (existing.length > 0) {
    console.log("✅ Already seeded — skipping.");
    process.exit(0);
  }

  console.log("🌱 Seeding checklist data...");

  /* ─── 1. VISA CATEGORIES ─── */
  const [spouse, student, visitor] = await db
    .insert(visaCategories)
    .values([
      { name: "SPOUSE", slug: "spouse", description: "Spouse Open Work Permit checklists", displayOrder: 1 },
      { name: "STUDENT", slug: "student", description: "Student visa checklists", displayOrder: 2 },
      { name: "VISITOR", slug: "visitor", description: "Visitor visa checklists", displayOrder: 3 },
    ])
    .returning();
  console.log("✅ Visa categories inserted");

  /* ─── 2. COUNTRIES ─── */
  const [canada, finland, germany, uk, usa, schengen] = await db
    .insert(countries)
    .values([
      { name: "Canada", code: "CA" },
      { name: "Finland", code: "FI" },
      { name: "Germany", code: "DE" },
      { name: "UK", code: "GB" },
      { name: "USA", code: "US" },
      { name: "Schengen", code: "EU" },
    ])
    .returning();
  console.log("✅ Countries inserted");

  /* ─── 3. ALL 22 CHECKLISTS ─── */
  const insertedChecklists = await db
    .insert(checklists)
    .values([
      // SPOUSE checklists
      { visaCategoryId: spouse.id, countryId: null, title: "If the Spouse is on Work Permit", slug: "spouse-on-work-permit", subType: "Work Permit", displayOrder: 1 },
      { visaCategoryId: spouse.id, countryId: null, title: "Employment Requirements", slug: "spouse-employment-requirements", subType: "Employment", displayOrder: 2 },
      { visaCategoryId: spouse.id, countryId: null, title: "Financial Requirements", slug: "spouse-financial-requirements", subType: "Financial", displayOrder: 3 },
      { visaCategoryId: spouse.id, countryId: null, title: "If the Spouse is on Study Permit", slug: "spouse-on-study-permit", subType: "Study Permit", displayOrder: 4 },
      { visaCategoryId: spouse.id, countryId: null, title: "If the Spouse is on Study Permit (Variant)", slug: "spouse-on-study-permit-variant", subType: "Study Permit Variant", displayOrder: 5 },
      { visaCategoryId: spouse.id, countryId: null, title: "Work Permit Extension", slug: "spouse-work-permit-extension", subType: "Extension", displayOrder: 6 },
      // STUDENT — Canada
      { visaCategoryId: student.id, countryId: canada.id, title: "Student Visa Application Checklist", slug: "student-visa-application-checklist", displayOrder: 1 },
      { visaCategoryId: student.id, countryId: canada.id, title: "Admission Onshore Documents", slug: "student-admission-onshore-documents", displayOrder: 2 },
      { visaCategoryId: student.id, countryId: canada.id, title: "Checklist - TRV", slug: "student-checklist-trv", displayOrder: 3 },
      { visaCategoryId: student.id, countryId: canada.id, title: "Documents Required at Immigration", slug: "student-documents-required-at-immigration", displayOrder: 4 },
      { visaCategoryId: student.id, countryId: canada.id, title: "Quick Check of Immigration Documents", slug: "student-quick-check-immigration-documents", displayOrder: 5 },
      { visaCategoryId: student.id, countryId: canada.id, title: "Shopping Checklist", slug: "student-shopping-checklist", subType: "Shopping/Packing", displayOrder: 6 },
      { visaCategoryId: student.id, countryId: canada.id, title: "Study Permit Extension", slug: "student-study-permit-extension", subType: "Extension", displayOrder: 7 },
      // STUDENT — generic (no country)
      { visaCategoryId: student.id, countryId: null, title: "Docs Required for Admission All Countries", slug: "student-docs-required-all-countries", displayOrder: 8 },
      // STUDENT — Finland
      { visaCategoryId: student.id, countryId: finland.id, title: "Finland Checklist", slug: "student-finland-checklist", displayOrder: 9 },
      { visaCategoryId: student.id, countryId: finland.id, title: "Questionnaire Form for Finland", slug: "student-questionnaire-form-finland", subType: "Form", displayOrder: 10 },
      // STUDENT — Germany
      { visaCategoryId: student.id, countryId: germany.id, title: "Bachelors or Masters Graduates - APS Checklist", slug: "student-germany-aps-bachelors-masters", displayOrder: 11 },
      { visaCategoryId: student.id, countryId: germany.id, title: "Germany APS Checklist - 12th Grade Graduates", slug: "student-germany-aps-12th-grade", displayOrder: 12 },
      // STUDENT — UK
      { visaCategoryId: student.id, countryId: uk.id, title: "UK Embassy Checklist", slug: "student-uk-embassy-checklist", displayOrder: 13 },
      // VISITOR — Canada
      { visaCategoryId: visitor.id, countryId: canada.id, title: "Visitor Visa Checklist", slug: "visitor-visa-checklist-canada", displayOrder: 1 },
      // VISITOR — Schengen
      { visaCategoryId: visitor.id, countryId: schengen.id, title: "Schengen Visa Checklist", slug: "visitor-schengen-checklist", displayOrder: 2 },
      // VISITOR — USA
      { visaCategoryId: visitor.id, countryId: usa.id, title: "USA Visitor Visa (B1/B2)", slug: "visitor-usa-b1-b2", displayOrder: 3 },
    ])
    .returning();
  console.log(`✅ ${insertedChecklists.length} checklists inserted`);

  const findChecklist = (slug: string) => {
    const cl = insertedChecklists.find((c) => c.slug === slug);
    if (!cl) throw new Error(`Checklist not found: ${slug}`);
    return cl;
  };

  /* ═══════════════════════════════════════════════════════
     4a. FULLY SEED: "If the Spouse is on Work Permit"
  ═══════════════════════════════════════════════════════ */
  const workPermit = findChecklist("spouse-on-work-permit");

  const [secCanada, secIndia, secRelationship, secChild, secOther] = await db
    .insert(documentSections)
    .values([
      { checklistId: workPermit.id, title: "Documents Required from Canada", displayOrder: 1 },
      { checklistId: workPermit.id, title: "Documents Required from Applicant in India", displayOrder: 2 },
      { checklistId: workPermit.id, title: "Relationship Documents and Proof", description: "Compulsory 9-10 photos in each event", displayOrder: 3 },
      { checklistId: workPermit.id, title: "Documents Required if the Applicant Has a Child", displayOrder: 4, isConditional: true, conditionText: "Only if applicant has a child" },
      { checklistId: workPermit.id, title: "Other Documents Mandatory for Filing", displayOrder: 5 },
    ])
    .returning();

  await db.insert(documentItems).values([
    { sectionId: secCanada.id, name: "Passport", displayOrder: 1 },
    { sectionId: secCanada.id, name: "Visa Stamps (Student + Visitor)", displayOrder: 2 },
    { sectionId: secCanada.id, name: "Work Permit and Previous Study Permit", displayOrder: 3 },
    { sectionId: secCanada.id, name: "Letter of Introduction", displayOrder: 4 },
    { sectionId: secCanada.id, name: "SIN Number", displayOrder: 5 },
    { sectionId: secCanada.id, name: "Recent 3 months Bank Statement/Balance Certificate", quantityNote: "Min. 4,000 CAD", displayOrder: 6 },
    { sectionId: secCanada.id, name: "Updated CV", displayOrder: 7 },
    { sectionId: secCanada.id, name: "Current Employment Letter", notes: "With position and NOC Level Mentioned", displayOrder: 8 },
    { sectionId: secCanada.id, name: "Payslips", quantityNote: "Recent 3-6 months", displayOrder: 9 },
    { sectionId: secCanada.id, name: "T4", quantityNote: "Recent 2 years", displayOrder: 10 },
    { sectionId: secCanada.id, name: "Utility Bill", notes: "Mobile/Gas/Electricity", displayOrder: 11 },
    { sectionId: secCanada.id, name: "Rental Agreement", displayOrder: 12 },
    { sectionId: secCanada.id, name: "Air Ticket", displayOrder: 13 },
    { sectionId: secCanada.id, name: "Some Photos in Canada", displayOrder: 14 },
    { sectionId: secCanada.id, name: "Last Education Degree", notes: "If studied from Canada", displayOrder: 15 },
    { sectionId: secCanada.id, name: "Course Completion Letter", displayOrder: 16 },
    { sectionId: secCanada.id, name: "Transcript", displayOrder: 17 },
  ]);

  await db.insert(documentItems).values([
    { sectionId: secIndia.id, name: "Passport", displayOrder: 1 },
    { sectionId: secIndia.id, name: "Name Change Affidavit", isConditional: true, conditionText: "if having any mistake", displayOrder: 2 },
    { sectionId: secIndia.id, name: "Recent 2 years ITR", notes: "Computerized Version given by CA for Visa Purpose", displayOrder: 3 },
    { sectionId: secIndia.id, name: "Any Past Experience Letter", displayOrder: 4 },
    { sectionId: secIndia.id, name: "Last Education Degree", displayOrder: 5 },
    { sectionId: secIndia.id, name: "12th Grade Marksheet", displayOrder: 6 },
    { sectionId: secIndia.id, name: "10th Grade Marksheet", displayOrder: 7 },
  ]);

  await db.insert(documentItems).values([
    { sectionId: secRelationship.id, name: "Marriage Certificate", displayOrder: 1 },
    { sectionId: secRelationship.id, name: "Marriage Invitation Card", notes: "In English and A4 Size", displayOrder: 2 },
    { sectionId: secRelationship.id, name: "Social Media Screenshots", notes: "Instagram or Facebook", displayOrder: 3 },
    { sectionId: secRelationship.id, name: "Before Marriage Photos", quantityNote: "9-10 photos", displayOrder: 4 },
    { sectionId: secRelationship.id, name: "Engagement Photos", quantityNote: "9-10 photos", displayOrder: 5 },
    { sectionId: secRelationship.id, name: "Pre-Wedding Ceremonies Photos", notes: "Sangeet/Haldi/Mehndi", quantityNote: "9-10 photos", displayOrder: 6 },
    { sectionId: secRelationship.id, name: "Marriage Photos", notes: "Rituals and Family members must be shown", quantityNote: "9-10 photos", displayOrder: 7 },
    { sectionId: secRelationship.id, name: "Any Bill Generated during Marriage", notes: "Shopping/Gold/Travel Ticket/Hotel booking", displayOrder: 8 },
    { sectionId: secRelationship.id, name: "Honeymoon Photos", notes: "Or any short trip photos", displayOrder: 9 },
    { sectionId: secRelationship.id, name: "Photos with Family", displayOrder: 10 },
    { sectionId: secRelationship.id, name: "Celebrating Different Festivals", displayOrder: 11 },
    { sectionId: secRelationship.id, name: "Video Call Screenshots", notes: "Must be in some different outfits and background", displayOrder: 12 },
    { sectionId: secRelationship.id, name: "Audio Video Call History", displayOrder: 13 },
    { sectionId: secRelationship.id, name: "Chat History", notes: "Directly Export showing First Name of Spouse", displayOrder: 14 },
  ]);

  await db.insert(documentItems).values([
    { sectionId: secChild.id, name: "Birth Certificate", displayOrder: 1 },
    { sectionId: secChild.id, name: "Aadhar Card", displayOrder: 2 },
    { sectionId: secChild.id, name: "School ID Card", displayOrder: 3 },
    { sectionId: secChild.id, name: "School Bonafide Certificate", displayOrder: 4 },
    { sectionId: secChild.id, name: "School Report Card", displayOrder: 5 },
    { sectionId: secChild.id, name: "Photos with Child Celebrating His/Her Birthday", displayOrder: 6 },
    { sectionId: secChild.id, name: "Baby Shower Photos", displayOrder: 7 },
  ]);

  await db.insert(documentItems).values([
    { sectionId: secOther.id, name: "Digital Photo", notes: "35x45 CM, White Background, 80% Face view, Matte Finishing", displayOrder: 1 },
    { sectionId: secOther.id, name: "Affidavit of Support from Both side of the Family", notes: "Sample will be provided as an example", displayOrder: 2 },
    { sectionId: secOther.id, name: "Aadhar/Pan Card of Parents and Inlaws", displayOrder: 3 },
    { sectionId: secOther.id, name: "Brief Marriage History explaining how you two met", displayOrder: 4 },
    { sectionId: secOther.id, name: "Occupation of Parents", displayOrder: 5 },
    { sectionId: secOther.id, name: "Medical Exam for Worker", notes: "Information Sheet, Vaccination Worksheet and Bill", displayOrder: 6 },
  ]);
  console.log("✅ 'If the Spouse is on Work Permit' — fully seeded (5 sections, 51 items)");

  /* ═══════════════════════════════════════════════════════
     4b. FULLY SEED: "Employment Requirements"
  ═══════════════════════════════════════════════════════ */
  const employment = findChecklist("spouse-employment-requirements");

  const [secSalaried, secBusiness] = await db
    .insert(documentSections)
    .values([
      {
        checklistId: employment.id,
        title: "Employment (If Salaried)",
        description: "Senior/Managerial position required. Min 43,000 INR net salary. Fill employment gaps. Documents on company letterhead.",
        displayOrder: 1,
      },
      {
        checklistId: employment.id,
        title: "Employment (If Having Business)",
        description: "Must be owner. Must have current account. Business 2+ years old. Must be registered.",
        displayOrder: 2,
      },
    ])
    .returning();

  await db.insert(documentItems).values([
    { sectionId: secSalaried.id, name: "Updated Resume", displayOrder: 1 },
    { sectionId: secSalaried.id, name: "Current Employment Letter", displayOrder: 2 },
    { sectionId: secSalaried.id, name: "Employee ID Card", displayOrder: 3 },
    { sectionId: secSalaried.id, name: "Recent 6 months Payslips", displayOrder: 4 },
    { sectionId: secSalaried.id, name: "Increment/Promotion Letter", displayOrder: 5 },
    { sectionId: secSalaried.id, name: "Offer/Appointment Letter", displayOrder: 6 },
    { sectionId: secSalaried.id, name: "Job Duties", quantityNote: "9-10 photos", displayOrder: 7 },
  ]);

  await db.insert(documentItems).values([
    { sectionId: secBusiness.id, name: "Updated Resume", displayOrder: 1 },
    { sectionId: secBusiness.id, name: "GST/MSME Certificate", displayOrder: 2 },
    { sectionId: secBusiness.id, name: "Employee ID Card", displayOrder: 3 },
    { sectionId: secBusiness.id, name: "Company's Letterhead with Stamp", displayOrder: 4 },
    { sectionId: secBusiness.id, name: "Visiting Card", displayOrder: 5 },
    { sectionId: secBusiness.id, name: "Current Account Statement with stamp", quantityNote: "Recent 6 months", displayOrder: 6 },
    { sectionId: secBusiness.id, name: "Business Duties", quantityNote: "9-10 photos", displayOrder: 7 },
    { sectionId: secBusiness.id, name: "Before Business proof", displayOrder: 8 },
  ]);
  console.log("✅ 'Employment Requirements' — fully seeded (2 sections, 15 items)");

  /* ═══════════════════════════════════════════════════════
     4c. FULLY SEED: "Financial Requirements"
  ═══════════════════════════════════════════════════════ */
  const financial = findChecklist("spouse-financial-requirements");

  const [secFinancial] = await db
    .insert(documentSections)
    .values([
      {
        checklistId: financial.id,
        title: "Financial Documents Needed",
        description: "All printed (no computerized). All stamped. Can add investments of Parents/In-Laws. Bank balance and FD must be in applicant's name.",
        displayOrder: 1,
      },
    ])
    .returning();

  await db.insert(documentItems).values([
    { sectionId: secFinancial.id, name: "Bank Balance Certificate", quantityNote: "8-9 Lakhs", displayOrder: 1 },
    { sectionId: secFinancial.id, name: "Fixed Deposit dated before 6 months", quantityNote: "9-10 Lakhs", displayOrder: 2 },
    { sectionId: secFinancial.id, name: "Provident Fund", quantityNote: "2-3 Lakhs", displayOrder: 3 },
    { sectionId: secFinancial.id, name: "Other Investments - Shares/Post/Mutual Funds/Term Deposit", quantityNote: "25-35 Lakhs", displayOrder: 4 },
    { sectionId: secFinancial.id, name: "Gold Valuation Report", quantityNote: "20-25 Lakhs", displayOrder: 5 },
    { sectionId: secFinancial.id, name: "Immovable Property - Residential/Agricultural/Commercial Land", quantityNote: "Min. 1 Crore", displayOrder: 6 },
    { sectionId: secFinancial.id, name: "Final CA Report", notes: "Total Net Worth of 2 Crores", displayOrder: 7 },
  ]);
  console.log("✅ 'Financial Requirements' — fully seeded (1 section, 7 items)");

  console.log("\n🎉 Seed complete!");
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
