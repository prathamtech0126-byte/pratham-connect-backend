import "dotenv/config";
import { db } from "../config/databaseConnection";
import { otherProducts } from "../schemas/otherProducts.schema";

const products = [
  // ── Finance ──────────────────────────────────────────────────────────────────
  {
    productId: "allFinanceEmployement",
    name: "All Finance & Employment",
    category: "Finance",
    productName: "ALL_FINANCE_EMPLOYEMENT",
    formType: "financialEntry",
    description: "Core finance and employment package",
    displayOrder: 100,
  },
  {
    productId: "indianSideEmployement",
    name: "Indian Side Employment",
    category: "Finance",
    productName: "INDIAN_SIDE_EMPLOYEMENT",
    formType: "masterOnly",
    description: "Employment arrangement on Indian side",
    displayOrder: 90,
  },
  {
    productId: "nocLevelJobArrangement",
    name: "NOC Level Job Arrangement",
    category: "Finance",
    productName: "NOC_LEVEL_JOB_ARRANGEMENT",
    formType: "masterOnly",
    description: "National Occupational Classification job arrangement",
    displayOrder: 89,
  },
  {
    productId: "onshorePartTimeEmployement",
    name: "Onshore Part-Time Employment",
    category: "Finance",
    productName: "ONSHORE_PART_TIME_EMPLOYEMENT",
    formType: "masterOnly",
    description: "Part-time employment while onshore",
    displayOrder: 88,
  },
  {
    productId: "financeEmployement",
    name: "Finance Employment",
    category: "Finance",
    productName: "FINANCE_EMPLOYEMENT",
    formType: "masterOnly",
    description: "Finance and employment service",
    displayOrder: 87,
  },
  {
    productId: "employmentVerificationCharges",
    name: "Employment Verification Charges",
    category: "Finance",
    productName: "EMPLOYMENT_VERIFICATION_CHARGES",
    formType: "masterOnly",
    description: "Charges for employment verification",
    displayOrder: 86,
  },
  {
    productId: "loanDetails",
    name: "Loan Details",
    category: "Finance",
    productName: "LOAN_DETAILS",
    formType: "loan",
    description: "Loan arrangement details",
    displayOrder: 80,
  },
  {
    productId: "creditCard",
    name: "Credit Card",
    category: "Finance",
    productName: "CREDIT_CARD",
    formType: "creditCard",
    description: "Credit card product",
    displayOrder: 79,
  },
  {
    productId: "canadaFund",
    name: "Canada Fund",
    category: "Finance",
    productName: "CANADA_FUND",
    formType: "masterOnly",
    description: "Canada immigration fund",
    displayOrder: 78,
  },
  {
    productId: "forexCard",
    name: "Forex Card",
    category: "Finance",
    productName: "FOREX_CARD",
    formType: "forexCard",
    description: "Foreign exchange card",
    displayOrder: 77,
  },
  {
    productId: "forexFees",
    name: "Forex Fees",
    category: "Finance",
    productName: "FOREX_FEES",
    formType: "forexFees",
    description: "Foreign exchange fees",
    displayOrder: 76,
  },
  {
    productId: "additionalAmountStatementCharges",
    name: "Additional Amount Statement Charges",
    category: "Finance",
    productName: "ADDITIONAL_AMOUNT_STATEMENT_CHARGES",
    formType: "masterOnly",
    description: "Charges for additional amount statement",
    displayOrder: 75,
  },

  // ── Student ───────────────────────────────────────────────────────────────────
  {
    productId: "ieltsEnrollment",
    name: "IELTS Enrollment",
    category: "Student",
    productName: "IELTS_ENROLLMENT",
    formType: "ieltsEnrollment",
    description: "IELTS exam enrollment",
    displayOrder: 70,
  },
  {
    productId: "tutionFees",
    name: "Tuition Fees",
    category: "Student",
    productName: "TUTION_FEES",
    formType: "tutionFees",
    description: "University / college tuition fees",
    displayOrder: 69,
  },
  {
    productId: "kidsStudyPermit",
    name: "Kids Study Permit",
    category: "Student",
    productName: "KIDS_STUDY_PERMIT",
    formType: "masterOnly",
    description: "Study permit for dependent children",
    displayOrder: 68,
  },
  {
    productId: "beaconAccount",
    name: "Beacon Account",
    category: "Student",
    productName: "BEACON_ACCOUNT",
    formType: "beaconAccount",
    description: "Beacon student account",
    displayOrder: 67,
  },

  // ── Spouse ────────────────────────────────────────────────────────────────────
  {
    productId: "sponsorCharges",
    name: "Sponsor Charges",
    category: "Spouse",
    productName: "SPONSOR_CHARGES",
    formType: "masterOnly",
    description: "Charges related to sponsorship",
    displayOrder: 60,
  },
  {
    productId: "marriagePhotoForCourtMarriage",
    name: "Marriage Photo (Court Marriage)",
    category: "Spouse",
    productName: "MARRIAGE_PHOTO_FOR_COURT_MARRIAGE",
    formType: "masterOnly",
    description: "Marriage photos for court marriage process",
    displayOrder: 59,
  },
  {
    productId: "marriagePhotoCertificate",
    name: "Marriage Photo Certificate",
    category: "Spouse",
    productName: "MARRIAGE_PHOTO_CERTIFICATE",
    formType: "masterOnly",
    description: "Marriage photo certificate",
    displayOrder: 58,
  },
  {
    productId: "recenteMarriageRelationshipAffidavit",
    name: "Marriage / Relationship Affidavit",
    category: "Spouse",
    productName: "RECENTE_MARRIAGE_RELATIONSHIP_AFFIDAVIT",
    formType: "masterOnly",
    description: "Recent marriage or relationship affidavit",
    displayOrder: 57,
  },

  // ── Visitor ───────────────────────────────────────────────────────────────────
  {
    productId: "trvWorkPermitExtStudyPermitExtension",
    name: "TRV / Work Permit / Study Permit Extension",
    category: "Visitor",
    productName: "TRV_WORK_PERMIT_EXT_STUDY_PERMIT_EXTENSION",
    formType: "visaExtension",
    description: "Temporary resident visa or permit extension",
    displayOrder: 50,
  },

  // ── Common ────────────────────────────────────────────────────────────────────
  {
    productId: "airTicket",
    name: "Air Ticket",
    category: "Common",
    productName: "AIR_TICKET",
    formType: "airTicket",
    description: "Flight ticket booking",
    displayOrder: 40,
  },
  {
    productId: "insurance",
    name: "Insurance",
    category: "Common",
    productName: "INSURANCE",
    formType: "insurance",
    description: "Travel / health insurance",
    displayOrder: 39,
  },
  {
    productId: "simCardActivation",
    name: "SIM Card Activation",
    category: "Common",
    productName: "SIM_CARD_ACTIVATION",
    formType: "simCard",
    description: "International SIM card activation",
    displayOrder: 38,
  },
  {
    productId: "visaExtension",
    name: "Visa Extension",
    category: "Common",
    productName: "VISA_EXTENSION",
    formType: "visaExtension",
    description: "Visa extension service",
    displayOrder: 37,
  },
  {
    productId: "lawyerRefusalCharge",
    name: "Lawyer Refusal Charge",
    category: "Common",
    productName: "LAWYER_REFUSAL_CHARGE",
    formType: "masterOnly",
    description: "Legal fees for refusal cases",
    displayOrder: 36,
  },
  {
    productId: "judicialReviewCharge",
    name: "Judicial Review Charge",
    category: "Common",
    productName: "JUDICAL_REVIEW_CHARGE",
    formType: "masterOnly",
    description: "Fees for judicial review proceedings",
    displayOrder: 35,
  },
  {
    productId: "refusalCharges",
    name: "Refusal Charges",
    category: "Common",
    productName: "REFUSAL_CHARGES",
    formType: "masterOnly",
    description: "Charges related to visa refusal handling",
    displayOrder: 34,
  },

  // ── Other ─────────────────────────────────────────────────────────────────────
  {
    productId: "otherNewSell",
    name: "Other New Sell",
    category: "Other",
    productName: "OTHER_NEW_SELL",
    formType: "newSell",
    description: "Miscellaneous new sales",
    displayOrder: 10,
  },
] as const;

async function seedOtherProducts(): Promise<void> {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║      Pratham Connect – Other Products Seed Script    ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  console.log(`📦  Inserting ${products.length} products (ON CONFLICT DO NOTHING)…`);

  const inserted = await db
    .insert(otherProducts)
    .values(products.map(p => ({ ...p, isActive: true })))
    .onConflictDoNothing()
    .returning({ productName: otherProducts.productName });

  console.log(`   ✓ ${inserted.length} new rows inserted`);
  if (inserted.length < products.length) {
    console.log(`   = ${products.length - inserted.length} rows already existed — skipped`);
  }

  console.log("\n✅  Other products seeded.\n");
  process.exit(0);
}

seedOtherProducts().catch(err => {
  console.error("\n❌  Failed:", err);
  process.exit(1);
});
