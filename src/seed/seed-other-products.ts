import { db } from "../config/databaseConnection";
import { otherProducts } from "../schemas/otherProducts.schema";
import { eq } from "drizzle-orm";

const availableProducts = [
  // Finance & Employment
  {
    productId: "financeAndEmployment",
    name: "All Finance & Employment",
    category: "Finance",
    productName: "ALL_FINANCE_EMPLOYEMENT",
    formType: "financialEntry",
    description: "Base fee for all products",
    displayOrder: 1,
  },
  {
    productId: "indianSideEmployment",
    name: "Indian Side Employment",
    category: "Finance",
    productName: "INDIAN_SIDE_EMPLOYEMENT",
    formType: "financialEntry",
    description: "Indian side employment charges",
    displayOrder: 2,
  },
  {
    productId: "canadaFund",
    name: "Canada Fund",
    category: "Finance",
    productName: "CANADA_FUND",
    formType: "financialEntry",
    description: "Canada Fund charges",
    displayOrder: 3,
  },
  {
    productId: "employmentVerificationCharges",
    name: "Canada Side Employment Verification Charges",
    category: "Finance",
    productName: "EMPLOYMENT_VERIFICATION_CHARGES",
    formType: "financialEntry",
    description: "Employment verification charges",
    displayOrder: 4,
  },
  {
    productId: "additionalAmountStatementCharges",
    name: "Additional Amount Statement Charges",
    category: "Finance",
    productName: "ADDITIONAL_AMOUNT_STATEMENT_CHARGES",
    formType: "financialEntry",
    description: "Additional amount statement charges",
    displayOrder: 5,
  },
  
  // Student Products
  {
    productId: "ieltsEnrollment",
    name: "IELTS Enrollment",
    category: "Student",
    productName: "IELTS_ENROLLMENT",
    formType: "ieltsEnrollment",
    description: "IELTS enrollment details",
    displayOrder: 10,
  },
  {
    productId: "loan",
    name: "Loan Details",
    category: "Student",
    productName: "LOAN_DETAILS",
    formType: "loan",
    description: "Loan information and disbursement",
    displayOrder: 11,
  },
  {
    productId: "forexCard",
    name: "Forex Card",
    category: "Student",
    productName: "FOREX_CARD",
    formType: "forexCard",
    description: "Forex card activation",
    displayOrder: 12,
  },
  {
    productId: "forexFees",
    name: "Forex Fees",
    category: "Student",
    productName: "FOREX_FEES",
    formType: "forexFees",
    description: "Forex fees payment",
    displayOrder: 13,
  },
  {
    productId: "tuitionFee",
    name: "Tuition Fee",
    category: "Student",
    productName: "TUTION_FEES",
    formType: "tuitionFee",
    description: "Tuition fee payment",
    displayOrder: 14,
  },
  {
    productId: "creditCard",
    name: "Credit Card",
    category: "Student",
    productName: "CREDIT_CARD",
    formType: "creditCard",
    description: "Credit card information",
    displayOrder: 15,
  },
  
  // Spouse Products
  {
    productId: "nocLevelJob",
    name: "NOC Level Job Arrangement",
    category: "Spouse",
    productName: "NOC_LEVEL_JOB_ARRANGEMENT",
    formType: "financialEntry",
    description: "NOC level job arrangement charges",
    displayOrder: 20,
  },
  {
    productId: "lawyerRefuge",
    name: "Lawyer Refusal Charge",
    category: "Spouse",
    productName: "LAWYER_REFUSAL_CHARGE",
    formType: "financialEntry",
    description: "Lawyer refusal charges",
    displayOrder: 21,
  },
  {
    productId: "onshorePartTime",
    name: "Onshore Part-Time Employment",
    category: "Spouse",
    productName: "ONSHORE_PART_TIME_EMPLOYEMENT",
    formType: "financialEntry",
    description: "Onshore part-time employment",
    displayOrder: 22,
  },
  {
    productId: "trvExtension",
    name: "TRV/Work Permit Extension",
    category: "Spouse",
    productName: "TRV_WORK_PERMIT_EXT_STUDY_PERMIT_EXTENSION",
    formType: "trvExtension",
    description: "TRV or work permit extension",
    displayOrder: 23,
  },
  {
    productId: "marriagePhoto",
    name: "Marriage Photo for Court Marriage",
    category: "Spouse",
    productName: "MARRIAGE_PHOTO_FOR_COURT_MARRIAGE",
    formType: "financialEntry",
    description: "Marriage photo charges",
    displayOrder: 24,
  },
  {
    productId: "marriageCertificate",
    name: "Marriage Photo + Certificate",
    category: "Spouse",
    productName: "MARRIAGE_PHOTO_CERTIFICATE",
    formType: "financialEntry",
    description: "Marriage certificate charges",
    displayOrder: 25,
  },
  {
    productId: "relationshipAffidavit",
    name: "Relationship Affidavit",
    category: "Spouse",
    productName: "RECENTE_MARRIAGE_RELATIONSHIP_AFFIDAVIT",
    formType: "relationshipAffidavit",
    description: "Relationship affidavit charges",
    displayOrder: 26,
  },
  {
    productId: "judicialReview",
    name: "Judicial Review Charge",
    category: "Spouse",
    productName: "JUDICAL_REVIEW_CHARGE",
    formType: "financialEntry",
    description: "Judicial review charges",
    displayOrder: 27,
  },
  {
    productId: "refusalCharges",
    name: "Refusal Charges",
    category: "Spouse",
    productName: "REFUSAL_CHARGES",
    formType: "financialEntry",
    description: "Refusal charges",
    displayOrder: 28,
  },
  {
    productId: "kidsStudyPermit",
    name: "Kids Study Permit",
    category: "Spouse",
    productName: "KIDS_STUDY_PERMIT",
    formType: "financialEntry",
    description: "Kids study permit charges",
    displayOrder: 29,
  },
  
  // Visitor Products
  {
    productId: "sponsorCharges",
    name: "Sponsor Charges",
    category: "Visitor",
    productName: "SPONSOR_CHARGES",
    formType: "sponsorCharges",
    description: "Sponsor charges (₹10,000 + GST)",
    displayOrder: 30,
  },
  
  // Common Services
  {
    productId: "simCard",
    name: "SIM Card Activation",
    category: "Common",
    productName: "SIM_CARD_ACTIVATION",
    formType: "simCard",
    description: "SIM card activation and plan",
    displayOrder: 40,
  },
  {
    productId: "insurance",
    name: "Insurance",
    category: "Common",
    productName: "INSURANCE",
    formType: "insurance",
    description: "Insurance policy details",
    displayOrder: 41,
  },
  {
    productId: "beaconAccount",
    name: "Beacon Account",
    category: "Common",
    productName: "BEACON_ACCOUNT",
    formType: "beaconAccount",
    description: "Beacon account opening and funding",
    displayOrder: 42,
  },
  {
    productId: "airTicket",
    name: "Air Ticket",
    category: "Common",
    productName: "AIR_TICKET",
    formType: "airTicket",
    description: "Air ticket booking details",
    displayOrder: 43,
  },
  
  // Other Product
  {
    productId: "otherProduct",
    name: "Other Product",
    category: "Other",
    productName: "OTHER_NEW_SELL",
    formType: "otherProduct",
    description: "Add a custom product with custom name and details",
    displayOrder: 100,
  },
];

export async function seedOtherProducts() {
  console.log("🌱 Seeding other_products table...");
  
  try {
    // Clear existing data (optional - comment out if you want to keep existing)
    await db.delete(otherProducts);
    console.log("✓ Cleared existing products");
    
    // Insert all products
    const inserted = await db.insert(otherProducts).values(availableProducts).returning();
    console.log(`✓ Inserted ${inserted.length} products`);
    
    console.log("✅ Other products seeding completed!");
    return inserted;
  } catch (error) {
    console.error("❌ Error seeding other_products:", error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  seedOtherProducts()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}