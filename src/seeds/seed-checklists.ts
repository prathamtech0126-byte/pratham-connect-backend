// src/seeds/seed-checklists.ts
//
// Seeds the Checklist Module (visa_categories → checklists → document_sections → document_items)
// from Pratham International's real client checklists (Canada Student/Spouse/Work Permit/Visitor,
// USA Visitor B1/B2, Schengen Visa, and pre-departure guides).
//
// Idempotent: clears all checklist data (items → sections → checklists) and re-inserts on every run.
// Categories & countries are upserted (insert-if-missing), so re-running is always safe.
//
//   npm run seed:checklists
//
import "dotenv/config";
import { db } from "../config/databaseConnection";
import {
  visaCategories,
  countries,
  checklists,
  documentSections,
  documentItems,
} from "../schemas/checklist.schema";

/* ──────────────────────────────────────────────────────────────────────────
   Types for the seed data tree
   ────────────────────────────────────────────────────────────────────────── */
interface SeedItem {
  name: string;
  notes?: string;
  mandatory?: boolean; // default true
  conditional?: boolean;
  condition?: string;
  quantity?: string;
}
interface SeedSection {
  title: string;
  description?: string;
  conditional?: boolean;
  condition?: string;
  items: SeedItem[];
}
interface SeedChecklist {
  categorySlug: string;
  countryCode?: string; // omit for country-agnostic checklists
  title: string;
  slug: string;
  subType?: string;
  description?: string;
  sections: SeedSection[];
}

/* helper: item with a quantity note */
const q = (name: string, quantity: string): SeedItem => ({ name, quantity });

/* ──────────────────────────────────────────────────────────────────────────
   Reference data
   ────────────────────────────────────────────────────────────────────────── */
const CATEGORIES = [
  { name: "Student Visa", slug: "student", description: "Study permit / student visa applications", displayOrder: 1 },
  { name: "Spouse Open Work Permit", slug: "spouse", description: "Spouse open work permit (SOWP) applications", displayOrder: 2 },
  { name: "Work Permit", slug: "work-permit", description: "Open work permit & work permit extensions", displayOrder: 3 },
  { name: "Visitor Visa", slug: "visitor", description: "Visitor / tourist visa applications", displayOrder: 4 },
  { name: "Pre-Departure", slug: "pre-departure", description: "Immigration & travel preparation guides", displayOrder: 5 },
];

const COUNTRIES = [
  { name: "Canada", code: "CA" },
  { name: "United States", code: "US" },
  { name: "Schengen Area", code: "SCH" },
  { name: "Finland", code: "FI" },
  { name: "Germany", code: "DE" },
  { name: "United Kingdom", code: "GB" },
];

/* relationship-proof section reused by both spouse checklists */
const RELATIONSHIP_SECTION: SeedSection = {
  title: "Relationship Documents and Proof",
  description: "Compulsory 9-10 photos in each event.",
  items: [
    { name: "Marriage Certificate" },
    { name: "Marriage Invitation Card (In English and A4 Size)" },
    { name: "Social Media Screenshots (Instagram or Facebook)" },
    { name: "Before Marriage Photos" },
    { name: "Engagement Photos" },
    { name: "Pre-Wedding Ceremonies Photos (Sangeet/Haldi/Mehndi)" },
    { name: "Marriage Photos (Rituals and Family members must be shown)" },
    { name: "Any Bill Generated during Marriage (Shopping/Gold/Travel Ticket/Hotel booking)" },
    { name: "Honeymoon Photos (Or any short trip photos)" },
    { name: "Photos with Family" },
    { name: "Celebrating Different Festivals" },
    { name: "Video Call Screenshots (Must be in some different outfits and background)" },
    { name: "Audio Video Call History" },
    { name: "Chat History (Directly Export showing First Name of Spouse)" },
  ],
};

/* child-documents section reused by both spouse checklists */
const CHILD_SECTION: SeedSection = {
  title: "Documents Required if the Applicant Has a Child",
  conditional: true,
  condition: "If the applicant has a child",
  items: [
    { name: "Birth Certificate" },
    { name: "Aadhar Card" },
    { name: "School ID Card" },
    { name: "School Bonafide Certificate" },
    { name: "School Report Card" },
    { name: "Photos with Child Celebrating His/Her Birthday" },
    { name: "Baby Shower Photos" },
  ],
};

const SOWP_DESCRIPTION =
  "Spouse Open Work Permit checklist. Steps: (1) Receive counsellor guidance, " +
  "(2) Retain Pratham International & complete payment, (3) Sign retainer & submit documents, " +
  "(4) We review, (5) We file once complete, (6) We keep you updated after IRCC submission. " +
  "All documents must be scanned on a printer (mobile scans not allowed) and submitted in English.";

/* ──────────────────────────────────────────────────────────────────────────
   The checklists
   ────────────────────────────────────────────────────────────────────────── */
const DATA: SeedChecklist[] = [
  /* ===================== STUDENT ===================== */
  {
    categorySlug: "student",
    countryCode: "CA",
    title: "Student Visa Application Checklist",
    slug: "canada-student-visa-application",
    subType: "student-visa",
    description:
      "Financial documents must be printer-scanned, stamped, and not computerized. " +
      "Applicants can add investments of parents and in-laws. Send all documents to " +
      "admission@prathaminternational.in via email (not WhatsApp).",
    sections: [
      { title: "Passport", items: [{ name: "Passport — Front and Back page" }] },
      {
        title: "Educational Documents",
        items: [
          { name: "10th & 12th Marksheets" },
          { name: "Bachelor's Degree", conditional: true, condition: "If Bachelor's Degree" },
          { name: "Bachelor's Transcript", conditional: true, condition: "If Bachelor's Degree" },
          { name: "Bachelor's Marksheets", conditional: true, condition: "If Bachelor's Degree" },
          { name: "Master's Degree", conditional: true, condition: "If Master's Degree" },
          { name: "Master's Transcript", conditional: true, condition: "If Master's Degree" },
          { name: "Master's Marksheets", conditional: true, condition: "If Master's Degree" },
          { name: "Backlog Certificate" },
          { name: "Medium of Instruction Certificate" },
        ],
      },
      {
        title: "Medical Documents",
        items: [
          { name: "Information Sheet (both sides)" },
          { name: "Vaccination Sheet (both sides)" },
          { name: "Medical Bill" },
        ],
      },
      {
        title: "GIC Documents",
        items: [{ name: "GIC Certificate" }, { name: "GIC TT Copy" }],
      },
      {
        title: "Proof of Tuition Fees Payment",
        items: [
          { name: "Tuition Fee Receipt from University/College" },
          { name: "TT Copy" },
          { name: "Flywire Receipt" },
          { name: "Letter of Acceptance (LOA)" },
        ],
      },
      {
        title: "Digital Photo Requirements",
        items: [
          {
            name: "Digital Photo",
            notes: "Size 35x45 mm, matte finish, 80% face view, white background, without glasses.",
          },
        ],
      },
      {
        title: "Other Documents",
        items: [
          { name: "Student's Aadhaar Card and PAN Card" },
          { name: "Parents' Aadhaar Card and PAN Card" },
        ],
      },
      {
        title: "Experience Documents",
        conditional: true,
        condition: "If applicable",
        items: [
          { name: "Offer Letter" },
          { name: "Promotion Letter (if any)" },
          { name: "Experience Letter" },
          { name: "Salary Slips of the last 6 months" },
        ],
      },
      {
        title: "If the Student is Married",
        conditional: true,
        condition: "If the student is married",
        items: [
          { name: "Marriage Certificate" },
          { name: "Spouse's Passport" },
          { name: "Spouse's Experience Certificate", mandatory: false },
          { name: "Spouse's Offer Letter", mandatory: false },
          { name: "Spouse's Salary Slips (last 6 months)", mandatory: false },
          { name: "Spouse's ITR (last 3 years)", mandatory: false },
          { name: "MSME/GST Certificate", conditional: true, condition: "If spouse holds a business" },
          { name: "ITR (last 3 years)", conditional: true, condition: "If spouse holds a business" },
        ],
      },
      {
        title: "Income Proof of Family (Sponsor Documents)",
        items: [
          { name: "ITR of parents (last 3 years)" },
          {
            name: "MSME/GST Certificate of family members (mother/father/siblings)",
            conditional: true,
            condition: "If business",
          },
        ],
      },
      {
        title: "Financial Documents",
        description:
          "All documents must be printer-scanned, stamped, and not computerized. Applicants can add investments of parents and in-laws.",
        items: [
          { name: "Bank Balance Certificate", quantity: "₹8–9 Lakhs" },
          { name: "Fixed Deposit (dated before 6 months)", quantity: "₹9–10 Lakhs" },
          { name: "Provident Fund", quantity: "₹2–3 Lakhs" },
          { name: "Other Investments — Shares/Post Office/Mutual Funds/Term Deposit", quantity: "₹25–35 Lakhs" },
          { name: "Gold Valuation Report", quantity: "₹20–25 Lakhs" },
          { name: "Immovable Property — Residential/Agricultural/Commercial Land", quantity: "Min ₹1 Crore" },
          { name: "Final CA Report — Total Net Worth", quantity: "₹2 Crores" },
        ],
      },
    ],
  },
  {
    categorySlug: "student",
    countryCode: "CA",
    title: "Admission Onshore Documents",
    slug: "canada-admission-onshore",
    subType: "onshore-admission",
    description:
      "Please provide proper scanned documents rather than pictures as it delays admission. You can get it scanned at a nearby cyber cafe.",
    sections: [
      {
        title: "Required Documents",
        items: [
          { name: "Scanned Passport — Front & Back" },
          { name: "10th Marksheet" },
          { name: "12th Marksheet" },
          { name: "Bachelor Marksheets or Transcripts" },
          { name: "Bachelor's Degree or Provisional" },
          { name: "Master's Marksheets or Transcripts", conditional: true, condition: "If Master's" },
          { name: "Master's Degree or Provisional", conditional: true, condition: "If Master's" },
          { name: "IELTS Academic, Duolingo, PTE or TOEFL" },
        ],
      },
      {
        title: "Canadian Documents",
        items: [
          { name: "Study Permit" },
          { name: "Canada Visa Stamp" },
          { name: "Unofficial OR Official Transcript of 1st Sem." },
          { name: "Time Table of 1st Sem." },
          { name: "Enrollment Letter" },
          { name: "Canadian Contact Number" },
          { name: "Canadian Current Address" },
        ],
      },
    ],
  },
  {
    categorySlug: "student",
    countryCode: "CA",
    title: "TRV (Temporary Resident Visa) Checklist",
    slug: "canada-trv",
    subType: "trv",
    sections: [
      {
        title: "Documents Required for TRV",
        items: [{ name: "Passport" }, { name: "Canada Visa Stamp" }, { name: "Study Permit" }],
      },
      {
        title: "Last Education",
        items: [
          { name: "Degree" },
          { name: "Transcript" },
          { name: "LOA" },
          { name: "Fees Paid Receipt" },
        ],
      },
      {
        title: "New Education",
        items: [{ name: "LOA" }, { name: "Fees Receipt" }, { name: "Enrollment Letter" }],
      },
      { title: "Digital Photo", items: [{ name: "Digital Photo" }] },
      {
        title: "Financials",
        items: [
          { name: "Balance Certificate in CAD" },
          { name: "Bank Balance Certificate (Indian Account)", quantity: "5–6 lakhs" },
        ],
      },
      {
        title: "Other Information",
        items: [
          { name: "GC Key Credentials" },
          { name: "Current Address" },
          { name: "E-mail Address" },
        ],
      },
    ],
  },
  {
    categorySlug: "student",
    countryCode: "CA",
    title: "Study Permit Extension Checklist",
    slug: "canada-study-permit-extension",
    subType: "study-permit-extension",
    sections: [
      {
        title: "Documents Required for Study Permit Extension",
        items: [{ name: "Passport" }, { name: "Canada Visa Stamp" }, { name: "Study Permit" }],
      },
      {
        title: "Last Education",
        items: [
          { name: "Degree" },
          { name: "Transcript" },
          { name: "LOA" },
          { name: "Fees Paid Receipt" },
        ],
      },
      {
        title: "New Education",
        items: [{ name: "LOA" }, { name: "Fees Receipt" }, { name: "Enrollment Letter" }],
      },
      {
        title: "Medical",
        items: [
          { name: "Information Sheet" },
          { name: "Vaccination Sheet" },
          { name: "Bill", mandatory: false, notes: "If available" },
        ],
      },
      { title: "Digital Photo", items: [{ name: "Digital Photo" }] },
      {
        title: "Financials",
        items: [
          { name: "Bank Statement of Canadian Bank Account" },
          { name: "Bank Balance Certificate (Indian Account)", quantity: "5–6 lakhs" },
        ],
      },
      {
        title: "Other Information",
        items: [
          { name: "GC Key Credentials" },
          { name: "Current Address" },
          { name: "E-mail Address" },
        ],
      },
    ],
  },

  {
    categorySlug: "student",
    title: "Admission Documents Checklist (All Countries)",
    slug: "admission-documents-all-countries",
    subType: "admission",
    description:
      "Please provide properly scanned documents rather than pictures as it delays admission. You can get it scanned at our office or a nearby cyber cafe.",
    sections: [
      {
        title: "Required Documents",
        items: [
          { name: "Scanned Passport — Front & Back" },
          { name: "10th Marksheet" },
          { name: "12th Marksheet" },
          { name: "Bachelor Marksheets or Transcripts" },
          { name: "Bachelor Degree or Provisional" },
          { name: "Master's Marksheets or Transcripts", conditional: true, condition: "If Master's" },
          { name: "Master's Degree or Provisional", conditional: true, condition: "If Master's" },
          { name: "IELTS Academic, Duolingo, PTE or TOEFL" },
        ],
      },
      {
        title: "If Doing Job",
        conditional: true,
        condition: "If doing a job",
        items: [
          { name: "Offer letter and Experience Letter of all jobs (past and latest)" },
          { name: "Offer letter and salary slips of current job (or any proof you are still working)" },
          { name: "Updated Resume" },
        ],
      },
    ],
  },
  {
    categorySlug: "student",
    countryCode: "FI",
    title: "Finland Study Checklist",
    slug: "finland-study",
    subType: "study-visa",
    sections: [
      {
        title: "Required Documents",
        items: [
          { name: "Valid passport" },
          { name: "Certificate of acceptance/attendance from a Finnish educational institution" },
          { name: "Proof of income clarification" },
          { name: "Health insurance" },
          { name: "Clarification on tuition fees or scholarship / Tuition Fees Payment receipt" },
          { name: "Clarification on the origin of funds" },
          { name: "Educational Qualification (10th, 12th, Diploma, Bachelors, Masters)" },
          { name: "Any employment certificates (any past or present employment record)" },
          { name: "Aadhar card & PAN Card" },
          { name: "Response to a possible refusal of entry and prohibition of entry (Form MP_1)" },
        ],
      },
      {
        title: "Required Financial Support Documents",
        items: [
          { name: "Last 6 months Bank Statement", quantity: "Minimum 10 Lakhs" },
          { name: "Fixed Deposit dated before 6 months", mandatory: false, notes: "Optional" },
          { name: "Other Investments — Shares/Post/Mutual Funds/Term Deposit", mandatory: false, notes: "Optional" },
          { name: "Gold Valuation Report", mandatory: false, notes: "Optional" },
          { name: "Immovable Property — Residential/Agricultural Land/Commercial", quantity: "Min 1 Crore" },
          { name: "Final CA Report", mandatory: false, notes: "Optional" },
        ],
      },
    ],
  },
  {
    categorySlug: "student",
    countryCode: "DE",
    title: "Germany APS Checklist — Bachelors or Masters Graduates",
    slug: "germany-aps-bachelors-masters",
    subType: "aps",
    description: "Fees associated: APS Fees — ₹18,000 INR; Test AS Fees — €80.",
    sections: [
      {
        title: "Required Documents",
        items: [
          { name: "Online Form (Printed and signed)" },
          { name: "APS Fee Transfer Receipt (Screenshot of payment, printed)" },
          { name: "Aadhar Card" },
          { name: "Passport (First and Last page)" },
          { name: "Marksheet (10th and 12th, proper photocopy)" },
          { name: "Result of exam Test AS", mandatory: false, notes: "If available" },
          { name: "IELTS Result" },
          { name: "Authorization form" },
          { name: "Passport size photo (not older than 6 months)" },
          { name: "Passing Certificate (10th and 12th Grade)" },
          { name: "Bachelors Degree and Transcripts" },
          { name: "Masters Degree and Transcripts" },
        ],
      },
    ],
  },
  {
    categorySlug: "student",
    countryCode: "DE",
    title: "Germany APS Checklist — 12th Grade Graduates",
    slug: "germany-aps-12th-grade",
    subType: "aps",
    description: "Fees associated: APS Fees — ₹18,000 INR; Test AS Fees — €80.",
    sections: [
      {
        title: "Required Documents",
        items: [
          { name: "Online Form (Printed and signed)" },
          { name: "APS Fee Transfer Receipt (Screenshot of payment, printed)" },
          { name: "Aadhar Card" },
          { name: "Passport (First and Last page)" },
          { name: "Marksheet (10th and 12th, proper photocopy)" },
          { name: "Result of exam Test AS", mandatory: false, notes: "If available" },
          { name: "IELTS Result" },
          { name: "Authorization form" },
          { name: "Passport size photo (not older than 6 months)" },
          { name: "Passing Certificate (10th and 12th Grade)" },
        ],
      },
    ],
  },
  {
    categorySlug: "student",
    countryCode: "GB",
    title: "UK Embassy Document Checklist",
    slug: "uk-embassy-documents",
    subType: "embassy",
    description:
      "Carry all documents in the same numbered sequence for your embassy appointment. Sign the Family Consent Form using the signature as per your passport. The Documents Checklist (item 3) must be signed only at the time of your appointment, not beforehand. Courier charges of ₹1,290 are payable at the appointment.",
    sections: [
      {
        title: "UK Visa Documents",
        items: [
          { name: "Passport", notes: "Original" },
          { name: "Appointment letter", notes: "Print" },
          { name: "Documents Checklist", notes: "Print — sign only at the time of appointment" },
          { name: "Application form", notes: "Print" },
          { name: "CAS letter", notes: "Print" },
          { name: "IHS Email (Immigration Health Surcharge)", notes: "Print" },
          { name: "Family Consent Form (Signature as per Passport)", notes: "Print" },
          { name: "Loan Sanction Letter", notes: "Original" },
          { name: "Medical", notes: "Original" },
          { name: "Name Change Affidavit", notes: "Original" },
          { name: "All Educational Documents", notes: "Original" },
          { name: "All Work Experience", notes: "Original" },
        ],
      },
    ],
  },

  /* ===================== SPOUSE (SOWP) ===================== */
  {
    categorySlug: "spouse",
    countryCode: "CA",
    title: "Spouse Open Work Permit — If the Spouse is on Study Permit",
    slug: "canada-sowp-study-permit",
    subType: "sowp-study-permit",
    description: SOWP_DESCRIPTION,
    sections: [
      {
        title: "Documents Required from Applicant in India",
        items: [
          { name: "Aadhar & PAN card" },
          { name: "Passport" },
          { name: "Name Change Affidavit", conditional: true, condition: "If having any mistake" },
          { name: "Recent 2 years ITR (Computerized Version given by CA for Visa Purpose)" },
          { name: "Current employment letter" },
          { name: "Recent six months payslips" },
          { name: "Any Past Experience Letter" },
          { name: "Last Education Degree & transcript" },
          { name: "12th Grade Marksheet" },
          { name: "10th Grade Marksheet" },
        ],
      },
      {
        title: "Other Documents Mandatory for Filing",
        items: [
          { name: "Digital Photo", notes: "35x45 cm, white background, 80% face view, matte finish" },
          { name: "Affidavit of Support from Both sides of the Family", notes: "Sample will be provided" },
          { name: "Aadhar/PAN Card of Parents and In-laws" },
          { name: "Brief Marriage History explaining how you two met" },
          { name: "Occupation of Parents" },
          { name: "Medical Exam for Worker (Information Sheet, Vaccination Worksheet and Bill)" },
        ],
      },
      {
        title: "Documents Required from Canada",
        items: [
          { name: "Passport" },
          { name: "Visa Stamp (Student)" },
          { name: "Study Permit" },
          { name: "Letter of Introduction" },
          { name: "SIN Number" },
          { name: "Enrolment Letter" },
          { name: "University/ID Card" },
          { name: "Letter of Acceptance" },
          { name: "Tuition Fee Receipts (Including Deposit and First Year Fees)" },
          { name: "Recent 3 months Bank Statement/Balance Certificate", quantity: "Above 7k CAD" },
          { name: "9-10 photos around University/College" },
          { name: "GIC Certificate" },
          { name: "Air Ticket" },
          { name: "Rental Agreement/Utility Bill (Mobile/Gas/Electricity)" },
          { name: "Updated Resume" },
          { name: "Last/Current Semester Transcript (Official)" },
          { name: "Job Offer Letter" },
          { name: "Paystubs", quantity: "2-3" },
          { name: "Timetable (Saved as PDF)" },
          { name: "Grades Plan" },
          { name: "Spousal Support Letter", notes: "Sample will be provided" },
        ],
      },
      RELATIONSHIP_SECTION,
      CHILD_SECTION,
    ],
  },
  {
    categorySlug: "spouse",
    countryCode: "CA",
    title: "Spouse Open Work Permit — If the Spouse is on Work Permit",
    slug: "canada-sowp-work-permit",
    subType: "sowp-work-permit",
    description: SOWP_DESCRIPTION,
    sections: [
      {
        title: "Documents Required from Applicant in India",
        items: [
          { name: "Passport" },
          { name: "Name Change Affidavit", conditional: true, condition: "If having any mistake" },
          { name: "Recent 2 years ITR (Computerized Version given by CA for Visa Purpose)" },
          { name: "Any Past Experience Letter" },
          { name: "Last Education Degree" },
          { name: "12th Grade Marksheet" },
          { name: "10th Grade Marksheet" },
        ],
      },
      {
        title: "Other Documents Mandatory for Filing",
        items: [
          { name: "Digital Photo", notes: "35x45 cm, white background, 80% face view, matte finish" },
          { name: "Affidavit of Support from Both sides of the Family", notes: "Sample will be provided" },
          { name: "Aadhar/PAN Card of Parents and In-laws" },
          { name: "Brief Marriage History explaining how you two met" },
          { name: "Occupation of Parents" },
          { name: "Medical Exam for Worker (Information Sheet, Vaccination Worksheet and Bill)" },
        ],
      },
      {
        title: "Documents Required from Canada",
        items: [
          { name: "Passport" },
          { name: "Visa Stamps (Student + Visitor)" },
          { name: "Work Permit and Previous Study Permit" },
          { name: "Letter of Introduction" },
          { name: "SIN Number" },
          { name: "Recent 3 months Bank Statement/Balance Certificate", quantity: "Min 4,000 CAD" },
          { name: "Updated CV" },
          { name: "Current Employment Letter (With position and NOC Level Mentioned)" },
          { name: "Paystubs", quantity: "Recent 3-6 months" },
          { name: "T4", quantity: "Recent 2 years" },
          { name: "Utility Bill (Mobile/Gas/Electricity)" },
          { name: "Rental Agreement" },
          { name: "Air Ticket" },
          { name: "Some Photos in Canada" },
          { name: "Last Education Degree", conditional: true, condition: "If studied from Canada" },
          { name: "Course completion Letter" },
          { name: "Transcript" },
        ],
      },
      RELATIONSHIP_SECTION,
      CHILD_SECTION,
    ],
  },

  /* ===================== WORK PERMIT ===================== */
  {
    categorySlug: "work-permit",
    countryCode: "CA",
    title: "Open Work Permit — Employment Requirements",
    slug: "canada-owp-employment-requirements",
    subType: "owp-employment",
    description: "All documents must be scanned on a printer only (mobile scans not allowed).",
    sections: [
      {
        title: "Employment (If Salaried) — Requirements",
        conditional: true,
        condition: "If salaried",
        items: [
          { name: "Applicant must be on a Senior/Managerial level position" },
          { name: "Payslips showing net salary of min. ₹43,000 INR" },
          { name: "Fill out the gaps from last education to date" },
          { name: "All documents on company's letterhead with stamps and signature" },
        ],
      },
      {
        title: "Employment (If Salaried) — Documents Needed",
        conditional: true,
        condition: "If salaried",
        items: [
          { name: "Updated Resume" },
          { name: "Current Employment Letter" },
          { name: "Employee ID Card" },
          { name: "Recent 6 months Payslips" },
          { name: "Increment/Promotion Letter" },
          { name: "Offer/Appointment Letter" },
          { name: "Job Duties (9-10 photos)", notes: "Samples will be provided" },
        ],
      },
      {
        title: "Employment (If Having Business) — Requirements",
        conditional: true,
        condition: "If having business",
        items: [
          { name: "Applicant must be the owner of the business" },
          { name: "Applicant must have a current account in a bank" },
          { name: "Business must be at least 2 years old" },
          { name: "Business must be registered" },
        ],
      },
      {
        title: "Employment (If Having Business) — Documents Needed",
        conditional: true,
        condition: "If having business",
        items: [
          { name: "Updated Resume" },
          { name: "GST/MSME Certificate" },
          { name: "Employee ID Card" },
          { name: "Company's Letter Head with Stamp" },
          { name: "Visiting Card" },
          { name: "Current Account Statement with stamp (Recent 6 months, constant transactions)" },
          { name: "Business Duties (9-10 photos)", notes: "Samples will be provided" },
          { name: "Before Business proof (Any experience)" },
        ],
      },
    ],
  },
  {
    categorySlug: "work-permit",
    countryCode: "CA",
    title: "Open Work Permit — Financial Requirements",
    slug: "canada-owp-financial-requirements",
    subType: "owp-financial",
    description:
      "All financial documents must be printed (no computerized version) and stamped. The applicant can add investments of parents and in-laws. Bank balance and fixed deposit must be in the applicant's name.",
    sections: [
      {
        title: "Documents Needed",
        items: [
          { name: "Bank Balance Certificate", quantity: "8-9 Lakhs" },
          { name: "Fixed Deposit (dated before 6 months)", quantity: "9-10 Lakhs" },
          { name: "Provident Fund", quantity: "2-3 Lakhs" },
          { name: "Other Investments — Shares/Post/Mutual Funds/Term Deposit", quantity: "25-35 Lakhs" },
          { name: "Gold Valuation Report", quantity: "20-25 Lakhs" },
          { name: "Immovable Property — Residential/Agricultural Land/Commercial", quantity: "Min 1 Crore" },
          { name: "Final CA Report (Total Net Worth)", quantity: "2 Crores" },
        ],
      },
    ],
  },
  {
    categorySlug: "work-permit",
    countryCode: "CA",
    title: "Work Permit Extension Checklist",
    slug: "canada-work-permit-extension",
    subType: "work-permit-extension",
    sections: [
      {
        title: "Documents Required for Work Permit Extension",
        items: [
          { name: "Passport" },
          { name: "Work Visa Stamp" },
          { name: "Enrolment letter of spouse" },
          { name: "New LOA and Tuition fee receipt of spouse" },
          { name: "Current Job offer letter" },
          { name: "Payslips" },
          { name: "Current Address" },
          { name: "GC Key credentials and mail id credentials" },
          { name: "Digital photo" },
          { name: "Marriage certificate" },
          { name: "Driving license in Canada", mandatory: false, notes: "If available" },
          { name: "Some photos in Canada" },
        ],
      },
    ],
  },

  /* ===================== VISITOR ===================== */
  {
    categorySlug: "visitor",
    countryCode: "CA",
    title: "Canada Visitor Visa Checklist",
    slug: "canada-visitor-visa",
    subType: "visitor-visa",
    description:
      "Embassy fees: $100 CAD; $185 CAD (without refusal from Canada). All documents must be scanned on a printer only (mobile scans not allowed).",
    sections: [
      {
        title: "Passport",
        items: [
          { name: "Passport (Front Page and Back Page)" },
          { name: "Visa Stamps (Wherever stamps are there)" },
        ],
      },
      {
        title: "Documents of Family",
        items: [
          { name: "Aadhar/PAN Card" },
          { name: "Passport (Front Page and Back Page)" },
          { name: "Marriage Certificate" },
          { name: "Occupation Documents (ITR/Income Certificate)" },
          { name: "Child's Birth Certificate & School Documents", conditional: true, condition: "If having a child" },
        ],
      },
      {
        title: "Employment (If Salaried)",
        conditional: true,
        condition: "If salaried",
        items: [
          { name: "Current Employment Letter" },
          { name: "Recent 6 months Payslips" },
          { name: "NOC — Granting 15 days leave as per event" },
          { name: "ITR — Recent 3 years" },
        ],
      },
      {
        title: "Employment (If Having Business)",
        conditional: true,
        condition: "If having business",
        items: [
          { name: "GST/MSME Certificate" },
          { name: "Company's Letter Head with Stamp" },
          { name: "Visiting Card" },
          { name: "Recent 3 months Current Bank Statement (if any) (stamped)" },
          { name: "ITR — Recent 3 years" },
        ],
      },
      {
        title: "Sponsor Documents from Canada — Identity",
        description: "Documents of the student/sponsor in Canada.",
        items: [
          { name: "Passport (Front and Back Page)" },
          { name: "Visa Stamp (Student/TRV/Worker)" },
          { name: "Study Permit / Work Permit" },
          { name: "Social Insurance Number (SIN Number)" },
          { name: "Driving License", mandatory: false },
          { name: "PR Card", mandatory: false },
        ],
      },
      {
        title: "Sponsor Documents from Canada — Educational",
        conditional: true,
        condition: "If studying",
        items: [
          { name: "Convocation Letter (If convocation is coming up)", mandatory: false },
          { name: "Letter of Acceptance" },
          { name: "Tuition Fee Receipt" },
          { name: "Transcript" },
          { name: "Enrolment Letter from College/University" },
          { name: "College/University ID Card" },
          { name: "Canadian Degree" },
        ],
      },
      {
        title: "Sponsor Documents from Canada — Employment",
        items: [
          { name: "Employment Letter (If Working)", mandatory: false },
          { name: "Paystubs (Recent 3 Months)" },
          { name: "T4 (Recent 2 Years)" },
        ],
      },
      {
        title: "Sponsor Documents from Canada — Financial Proof",
        items: [
          { name: "Recent 3 months Bank Statement" },
          { name: "Balance Certificate" },
          { name: "GIC Balance Certificate" },
        ],
      },
      {
        title: "Sponsor Documents from Canada — Residential Proof",
        items: [
          { name: "Rental Agreement" },
          { name: "Utility Bill (Mobile/Gas/Electricity)" },
          { name: "Air Ticket" },
          { name: "8-9 Photos of them in Canada" },
        ],
      },
    ],
  },
  {
    categorySlug: "visitor",
    countryCode: "US",
    title: "USA Visitor Visa (B1/B2) Checklist",
    slug: "usa-visitor-b1-b2",
    subType: "b1-b2",
    description:
      "B1/B2 (Business/Tourist) visa from India. Process: determine visa type → complete DS-160 (done by us) → pay visa fee → schedule VAC + consular interview appointments → attend VAC (biometrics) → attend consular interview.",
    sections: [
      {
        title: "Required Documents",
        items: [
          { name: "Original Passport (min 6 months validity, 3 blank pages) + all old passports if any" },
          { name: "Printout of DS-160 confirmation" },
          { name: "Appointment letter confirmation" },
          { name: "US Visa Fee Payment Receipt" },
          { name: "2 recent colour photographs" },
          { name: "Personal Covering letter (Employed — plain paper / Self-Employed — letterhead)" },
          { name: "Original updated Bank Statement with sufficient balance (last 6 months)" },
          { name: "Income Tax Returns / Form 16 for last 3 years" },
          {
            name: "Supporting Financial Documents (Fixed Deposits, Property, Investments, Recurring Deposits)",
            mandatory: false,
            notes: "Optional but advisable",
          },
        ],
      },
      {
        title: "If Employed",
        conditional: true,
        condition: "If employed",
        items: [
          { name: "Original Leave sanctioned certificate with company seal and signature" },
          { name: "Last 3 months salary slip" },
        ],
      },
      {
        title: "If Self Employed",
        conditional: true,
        condition: "If self employed",
        items: [
          { name: "Business Registration License / MOA / Partnership deed" },
          { name: "Company's updated bank statement of last 6 months" },
          { name: "Company's IT returns for last 3 years" },
          { name: "GST + MSME + Incorporation (if Pvt. Ltd)" },
        ],
      },
      {
        title: "If Retired",
        conditional: true,
        condition: "If retired",
        items: [{ name: "Proof of retirement (pension book, statement, etc.)" }],
      },
      {
        title: "If Student",
        conditional: true,
        condition: "If student",
        items: [{ name: "School / College / Institute ID Card" }, { name: "Bonafide certificate" }],
      },
      {
        title: "If Minor",
        conditional: true,
        condition: "If minor",
        items: [
          { name: "Birth Certificate" },
          { name: "No Objection Certificate from parents / non-accompanying parent on ₹100 stamp paper" },
          { name: "ID proof of parent (passport or PAN card)" },
        ],
      },
      {
        title: "If Visiting Friend or Relative",
        conditional: true,
        condition: "If visiting friend or relative",
        items: [
          { name: "Invitation letter" },
          { name: "Inviter's ID proof (Passport or Resident Permit)" },
          { name: "Address proof (Electricity bill, Utility bill, etc.)" },
        ],
      },
      {
        title: "If Sponsored",
        conditional: true,
        condition: "If sponsored",
        items: [
          { name: "Sponsorship letter" },
          { name: "Sponsor's national ID proof (Passport, PAN card or Resident permit)" },
          { name: "Updated bank statement of last 6 months" },
          { name: "Income tax returns of last 3 years" },
        ],
      },
      {
        title: "For US Business Visa",
        conditional: true,
        condition: "If business visa",
        items: [{ name: "Invitation letter from host company stating purpose of trip" }],
      },
    ],
  },
  {
    categorySlug: "visitor",
    countryCode: "SCH",
    title: "Schengen Visa Checklist",
    slug: "schengen-visa",
    subType: "schengen",
    description:
      "Embassy fees: approx ₹1500 (to be paid for date booking); approx €90 (to be paid at the time of appointment).",
    sections: [
      {
        title: "Required Documents",
        items: [
          { name: "Valid Passport" },
          { name: "Recent Passport size photo — 2 (35x45 cm, white background)", quantity: "2" },
          { name: "Other financials (FD, Home Valuation, Mutual funds, Share holding)" },
          { name: "Residence proof (Aadhar card & PAN Card)" },
          { name: "Marriage Certificate", conditional: true, condition: "If married" },
        ],
      },
      {
        title: "If Business",
        conditional: true,
        condition: "If business",
        items: [
          { name: "GST/MSME" },
          { name: "ITR (Recent 3 years)" },
          { name: "Current account statement (recent 3 months) — Min 6 lakh balance" },
        ],
      },
      {
        title: "If Salaried",
        conditional: true,
        condition: "If salaried",
        items: [
          { name: "NOC (dates will be given)" },
          { name: "Employee verification letter" },
          { name: "Recent six months payslips" },
          { name: "Appointment letter" },
          { name: "3 months bank statement (highlighting salary)" },
        ],
      },
      {
        title: "Family Ties",
        items: [
          { name: "Parents Aadhar Card & PAN Card" },
          {
            name: "Child documents (Birth certificate, Aadhar Card & School Documents)",
            conditional: true,
            condition: "If you have a kid",
          },
        ],
      },
    ],
  },

  /* ===================== PRE-DEPARTURE ===================== */
  {
    categorySlug: "pre-departure",
    countryCode: "CA",
    title: "Documents Required at Immigration",
    slug: "canada-immigration-documents",
    subType: "immigration",
    description: "Pro tip: always keep your documents with you while you fly.",
    sections: [
      {
        title: "Must Have (For Immigration)",
        items: [
          { name: "Passport" },
          { name: "Air Tickets" },
          { name: "College/University — Offer Letter" },
          { name: "College/University — Fees Payment Receipt or Flywire Receipt" },
          { name: "College/University — Enrolment Letter" },
          { name: "IRCC — File Submission Letter" },
          { name: "IRCC — Biometric Instruction Letter" },
          { name: "IRCC — Biometric Confirmation Letter" },
          { name: "IRCC — Passport Request Letter (PPR)" },
          { name: "IRCC — Correspondence Letter (Port of Entry Letter)" },
          { name: "GIC Certificate / Loan Documents" },
          { name: "E-Medical Certificate (Vaccination sheet, Bill, Information sheet)" },
          { name: "Travel Insurance (Mandatory)" },
          { name: "CAQ", conditional: true, condition: "Only for Quebec students" },
          { name: "PAL Letter (Provincial Attestation Letter)" },
          { name: "Custodian Declaration Form", conditional: true, condition: "Only if under 18" },
          { name: "ArriveCAN (MAX 72 hours before flight)" },
          { name: "College Login Details" },
          { name: "Covid Related Docs — Vaccine Certificates" },
        ],
      },
      {
        title: "Must Have (For Future Use in Canada)",
        items: [
          { name: "Language Proficiency Test Result (IELTS / PTE / TOEFL)" },
          { name: "Educational Documents (10th, 12th/Diploma, Bachelor's, Master's)" },
          { name: "DL Extract" },
          { name: "Medical Prescription", mandatory: false, notes: "If you are on medication" },
        ],
      },
      {
        title: "How to Arrange Documents",
        items: [
          { name: "Put your passport in a passport wallet" },
          { name: "Put your cards, air tickets, pen and passport wallet in a document wallet" },
          { name: "Use A4 transparent sheets to file your documents" },
          { name: "Make 2 files — one with all originals, one with all photocopies" },
        ],
      },
    ],
  },
  {
    categorySlug: "pre-departure",
    countryCode: "CA",
    title: "Shopping / Packing Checklist (India to Canada)",
    slug: "canada-shopping-packing",
    subType: "packing",
    description:
      "Smart packing guide for moving from India to Canada. Buy in Canada: laptop/laptop bag, winter boots, sweaters, winter jacket, winter clothes, thermal wear.",
    sections: [
      {
        title: "Clothing & Shoes",
        items: [
          q("T-shirts (round neck)", "3-6"),
          q("T-shirts (collared)", "3-4"),
          q("Sweater (good warm ones)", "1-2"),
          q("Jeans (blue/black)", "6-7"),
          q("Formal shirts", "3"),
          q("Formal trousers", "2"),
          q("Formal suit (complete set with blazer)", "1"),
          q("Ties", "2-3"),
          q("Formal leather shoes", "1 pair"),
          q("Traditional dress for festivals", "1"),
          q("Light jacket", "1"),
          q("Undergarments (very important)", "15 pairs min"),
          q("Shorts / three-fourths", "1-3"),
          q("Swimming trunks", "1"),
          q("Track pants", "2-3"),
          q("Socks", "6-7 pairs"),
          q("Belt for jeans", "1"),
          q("Leather belts", "1-2"),
          q("Sports shoes", "1 pair"),
          { ...q("Sneakers", "1 pair"), mandatory: false },
          q("Woodland all-weather shoes", "1 pair"),
          q("Flip-flops (summer/spring)", "1 pair"),
        ],
      },
      {
        title: "Other Essentials",
        items: [
          q("Towels", "3"),
          q("Hand towels", "3-4"),
          q("Pillow covers", "3"),
          q("Bed sheets", "2"),
          { ...q("Blanket", "1"), mandatory: false },
          q("Small table clock with alarm", "1"),
          q("India-to-Canada pin converters", "2-3"),
          q("Shoe polish (not liquid)", "1"),
          q("Shoe polishing brush", "1"),
          q("Hawaii slippers (inside the apartment)", "1 pair"),
          q("Sunglasses", "1 pair"),
          q("Good umbrella", "1"),
          q("Wallet for passport", "1"),
          q("Good leather wallet", "1"),
          q("Handkerchiefs", "12"),
          q("Monkey cap", "1"),
          q("Decent wrist watch (with extra battery)", "1"),
          q("Scientific calculator (very important)", "1"),
          q("Blank DVDs", "4-5"),
        ],
      },
      {
        title: "Utensils",
        items: [
          q("Pressure cooker (keep extra weights & gaskets)", "1"),
          q("Pressure pan (same brand as cooker if possible)", "1"),
          q("Kadhai for cooking", "1"),
          q("Kadhai for boiling water/milk", "1"),
          q("Serving spoons (various sizes)", "3-4"),
          q("SS Plates", "3-4"),
          q("SS Bowls", "3-4"),
          q("SS Spoon", "6"),
          q("SS Glasses / Tumbler", "3"),
          q("SS Fork", "2"),
          q("Knives", "3-4"),
          q("Butter knives", "2"),
          q("Veg chopping board", "1"),
          q("Chapati roller", "1"),
          q("Water bottle (preferably Tupperware)", "1"),
          q("Tea strainer", "1"),
        ],
      },
      {
        title: "Specialized Food Items",
        items: [
          q("Ready to eat paste", "5-6 bottles min"),
          q("Maggi", "10-12 min"),
          q("All dals used in cooking", "2 kg each"),
          q("All powders (chili, garam masala, rasam, sambar, asafoetida, etc.)", "0.5-1 kg each"),
          q("Salt and sugar", "0.5 kg each"),
          q("Tamarind", "1 kg"),
          q("Rice (for initial use)", "3-4 kg"),
          q("Pickles", "3-4 bottles"),
          q("Papads", "2-3 packs"),
          q("Ginger-garlic paste", "2 bottles"),
          { name: "Some snacks for the initial days", mandatory: false },
          { name: "Homemade sweets (for yourself and seniors)", mandatory: false },
          { name: "Spreads (Nutella, Hershey's)", mandatory: false },
        ],
      },
      {
        title: "Stationery",
        items: [
          q("Pens", "3-4"),
          q("Pencils (with eraser & sharpener)", "3-4"),
          q("Sharpeners", "3"),
          q("Erasers", "3"),
          q("Notebooks", "2-3"),
          q("Staple machine", "1"),
          q("Glue sticks", "2"),
          q("Highlighters", "1"),
          q("Markers", "2"),
          q("Small ruler", "1"),
          q("Key chains", "2"),
          q("Pins", "2 boxes"),
          q("A4 sheets", "1 quire"),
          q("Cellophane tape", "1 roll"),
          { name: "Document Holder" },
          { name: "Phone book (with friends' & relatives' numbers written inside)" },
        ],
      },
      {
        title: "Electronics",
        items: [
          q("External Hard disk (portable)", "1 TB"),
          { name: "Laptop", mandatory: false, notes: "If you already have one, wait till Black Friday sales" },
          { name: "Earphone/Headphone", mandatory: false, notes: "For long travel hours" },
          { name: "Branded Spike Buster & Extension Board" },
          { name: "A good branded decent wrist watch" },
        ],
      },
      {
        title: "Personal Hygiene Products",
        items: [
          q("Toothpaste (large tube)", "1"),
          q("Tooth brushes", "2-3"),
          q("Soap", "1-2 bars"),
          q("Shampoo", "1 bottle"),
          q("Shaving razor (disposable)", "a couple"),
          q("Shaving foam (small can)", "1"),
          q("Cold cream", "1 bottle"),
          q("Vaseline", "1 bottle"),
          q("Good clean combs", "2-3"),
          q("Soap cases", "2"),
          q("Hair oil", "2 bottles"),
          q("Deodorant", "1 can"),
          q("Nail cutters", "2"),
          q("Ear buds", "1 small pack"),
          q("Sunscreen", "1 bottle"),
          q("Lip balm", "2 tubes"),
        ],
      },
      {
        title: "Medicines (Prescriptions are costly abroad)",
        items: [
          { name: "Cold, Fever", notes: "Crocin" },
          { name: "Body Pain", notes: "Crocin / Combiflam" },
          { name: "Indigestion, Gastric Problems", notes: "Gelusil / Zinetac" },
          { name: "Throat Infection", notes: "Erythromycin" },
          { name: "Allergies", notes: "Avil 25" },
          { name: "Vomiting", notes: "Avomine" },
          { name: "Cold, Headache", notes: "Amrutanjan" },
          { name: "Stomach Pain", notes: "Cyclopam" },
          { name: "Diarrhea", notes: "Loperamide" },
          { name: "Dizziness", notes: "Diziron" },
          { name: "Sprain", notes: "Esgypyrin" },
          { name: "Common Cold", notes: "Vicks Vaporub / Coldact" },
        ],
      },
    ],
  },
];

/* ──────────────────────────────────────────────────────────────────────────
   Runner
   ────────────────────────────────────────────────────────────────────────── */
async function seedChecklists(): Promise<void> {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║      Pratham Connect – Checklist Module Seed         ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  // 1. Clear existing checklist data (items → sections → checklists).
  //    document_sections does NOT cascade from checklists, so order matters.
  console.log("🧹  Clearing existing checklist data…");
  await db.delete(documentItems);
  await db.delete(documentSections);
  await db.delete(checklists);

  // 2. Upsert categories (slug is unique).
  console.log("📁  Upserting categories…");
  await db.insert(visaCategories).values(CATEGORIES).onConflictDoNothing();
  const catRows = await db.select().from(visaCategories);
  const catBySlug = new Map(catRows.map((c) => [c.slug, c.id]));

  // 3. Upsert countries (name is unique).
  console.log("🌍  Upserting countries…");
  await db.insert(countries).values(COUNTRIES).onConflictDoNothing();
  const countryRows = await db.select().from(countries);
  const countryByCode = new Map(countryRows.map((c) => [c.code, c.id]));

  // 4. Insert checklists → sections → items.
  let nChecklists = 0;
  let nSections = 0;
  let nItems = 0;

  for (let ci = 0; ci < DATA.length; ci++) {
    const cl = DATA[ci];
    const categoryId = catBySlug.get(cl.categorySlug);
    if (!categoryId) throw new Error(`Unknown category slug: ${cl.categorySlug}`);
    const countryId = cl.countryCode ? countryByCode.get(cl.countryCode) ?? null : null;

    const [checklistRow] = await db
      .insert(checklists)
      .values({
        visaCategoryId: categoryId,
        countryId,
        title: cl.title,
        slug: cl.slug,
        subType: cl.subType ?? null,
        description: cl.description ?? null,
        displayOrder: ci,
        isActive: true,
      })
      .returning({ id: checklists.id });
    nChecklists++;

    for (let si = 0; si < cl.sections.length; si++) {
      const sec = cl.sections[si];
      const [sectionRow] = await db
        .insert(documentSections)
        .values({
          checklistId: checklistRow.id,
          title: sec.title,
          description: sec.description ?? null,
          displayOrder: si,
          isConditional: sec.conditional ?? false,
          conditionText: sec.condition ?? null,
        })
        .returning({ id: documentSections.id });
      nSections++;

      if (sec.items.length === 0) continue;
      await db.insert(documentItems).values(
        sec.items.map((it, ii) => ({
          sectionId: sectionRow.id,
          name: it.name,
          notes: it.notes ?? null,
          isMandatory: it.mandatory ?? true,
          isConditional: it.conditional ?? false,
          conditionText: it.condition ?? null,
          quantityNote: it.quantity ?? null,
          displayOrder: ii,
        }))
      );
      nItems += sec.items.length;
    }

    console.log(`   ✓ ${cl.title}`);
  }

  console.log(
    `\n✅  Seeded ${CATEGORIES.length} categories, ${COUNTRIES.length} countries, ` +
      `${nChecklists} checklists, ${nSections} sections, ${nItems} items.\n`
  );
  process.exit(0);
}

seedChecklists().catch((err) => {
  console.error("\n❌  Failed:", err);
  process.exit(1);
});
