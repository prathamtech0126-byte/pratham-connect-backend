/**
 * seedMonthlyData.ts
 *
 * Populates the local database with realistic dev data:
 *   • Reference tables seeded once (idempotent)
 *   • 25–30 records per table per month, Jan–Apr 2026
 *
 * Usage:
 *   npx ts-node src/scripts/seedMonthlyData.ts
 *
 * Each run gets its own RUN_ID so unique-constrained fields never collide.
 * Running it multiple times simply adds more data – safe for local dev.
 */

import "dotenv/config";
import bcrypt from "bcrypt";
import { db } from "../config/databaseConnection";
import { inArray, sql } from "drizzle-orm";

import { users } from "../schemas/users.schema";
import { leadTypes } from "../Leads/schemas/leadType.schema";
import { saleTypeCategories } from "../schemas/saleTypeCategory.schema";
import { saleTypes } from "../schemas/saleType.schema";
import { teams } from "../schemas/team.schema";
import { clientInformation } from "../schemas/clientInformation.schema";
import { clientPayments } from "../schemas/clientPayment.schema";
import { clientProductPayments } from "../schemas/clientProductPayments.schema";
import { activityLog, activityActionEnum } from "../schemas/activityLog.schema";
import { airTicket } from "../schemas/airTicket.schema";
import { allFinance } from "../schemas/allFinance.schema";
import { beaconAccount } from "../schemas/beaconAccount.schema";
import { creditCard } from "../schemas/creditCard.schema";
import { forexCard } from "../schemas/forexCard.schema";
import { forexFees } from "../schemas/forexFees.schema";
import { ielts } from "../schemas/ielts.schema";
import { insurance } from "../schemas/insurance.schema";
import { leaderBoard } from "../schemas/leaderBoard.schema";
import { loan } from "../schemas/loan.schema";
import { managerTargets } from "../schemas/managerTargets.schema";
import { messages, messageAcknowledgments } from "../schemas/message.schema";
import { newSell } from "../schemas/newSell.schema";
import { simCard } from "../schemas/simCard.schema";
import { tutionFees } from "../schemas/tutionFees.schema";
import { visaExtension } from "../schemas/visaExtension.schema";
import {
  visaCategories,
  countries,
  checklists,
  documentSections,
  documentItems,
} from "../schemas/checklist.schema";
import { incentiveCategoryRules } from "../schemas/incentiveCategoryRules.schema";
import { incentiveSlabRules } from "../schemas/incentiveSlabRules.schema";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Short unique ID for this run – embedded in unique-constrained fields */
const RUN_ID = Date.now().toString(36).toUpperCase();

const pad = (n: number, len = 3) => String(n).padStart(len, "0");

/** Build a unique string like "ATK-LX4Z9F-042" that fits in varchar(50) */
const uid = (prefix: string, idx: number) =>
  `${prefix}-${RUN_ID}-${pad(idx)}`;

function dateStr(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Returns `count` dates spread evenly across the given month */
function spreadDates(year: number, month: number, count: number): string[] {
  const days = new Date(year, month, 0).getDate();
  return Array.from({ length: count }, (_, i) => {
    const day = 1 + Math.floor((i * (days - 1)) / Math.max(count - 1, 1));
    return dateStr(year, month, Math.min(day, days));
  });
}

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length];
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randDec(min: number, max: number): string {
  return (Math.random() * (max - min) + min).toFixed(2);
}

// ─── Seed identity constants (used by both seed and clear) ───────────────────

const SEED_EMAILS = [
  "superadmin@seed.local", "admin@seed.local",
  "manager1@seed.local",   "manager2@seed.local",
  "counsellor1@seed.local","counsellor2@seed.local","counsellor3@seed.local",
  "counsellor4@seed.local","counsellor5@seed.local","counsellor6@seed.local",
];
const SEED_LEAD_TYPES       = ["Spouse", "Student", "Visitor", "Worker"];
const SEED_SALE_TYPES       = ["PR Visa Package", "Study Permit", "TRV (Visitor Visa)", "IELTS Package", "Forex Package", "General Services"];
const SEED_SALE_CATEGORIES  = ["Core Sale", "Product Add-on", "Other Services"];
const SEED_TEAM_NAMES       = ["Pratham Alpha Team", "Pratham Beta Team"];
const SEED_VISA_CAT_NAMES   = ["Student Visa", "Visitor Visa", "Work Permit"];
const SEED_COUNTRY_NAMES    = ["Canada", "United States", "United Kingdom", "Australia", "Germany"];
const SEED_CHECKLIST_SLUGS  = ["student-visa-checklist-ca", "visitor-visa-checklist-ca", "work-permit-checklist-ca"];
const SEED_INCENTIVE_LABELS = ["TRV Approval", "TRV Extension", "Insurance Sale", "Forex Card Sale", "Air Ticket Booking"];

// ─── Clear all data ───────────────────────────────────────────────────────────
// Deletes every row from every seeded table in strict FK-safe order.
// No pre-queries, no filtering – a full dev reset.

async function clearSeedData(): Promise<void> {
  console.log("🗑️   Clearing all data (FK-safe order)…\n");

  // Each entry: [display label, delete thunk]
  const steps: [string, () => Promise<unknown>][] = [
    // Must go before clients & users (FK RESTRICT – no CASCADE)
    ["activity_log",             () => db.delete(activityLog)],
    ["message_acknowledgments",  () => db.delete(messageAcknowledgments)],
    ["messages",                 () => db.delete(messages)],
    ["leader_board",             () => db.delete(leaderBoard)],
    ["manager_targets",          () => db.delete(managerTargets)],

    // Clients – CASCADE wipes client_payment + client_product_payment
    ["client_information",       () => db.delete(clientInformation)],

    // Standalone product tables (no FK to clients)
    ["air_ticket",               () => db.delete(airTicket)],
    ["insurance",                () => db.delete(insurance)],
    ["sim_card",                 () => db.delete(simCard)],
    ["forex_card",               () => db.delete(forexCard)],
    ["forex_fees",               () => db.delete(forexFees)],
    ["loan",                     () => db.delete(loan)],
    ["ielts",                    () => db.delete(ielts)],
    ["credit_card",              () => db.delete(creditCard)],
    ["tution_fees",              () => db.delete(tutionFees)],
    ["beacon_account",           () => db.delete(beaconAccount)],
    ["visa_extension",           () => db.delete(visaExtension)],
    ["new_sell",                 () => db.delete(newSell)],
    ["all_finance",              () => db.delete(allFinance)],

    // Checklists – CASCADE wipes document_sections → document_items
    ["checklists",               () => db.delete(checklists)],
    ["visa_categories",          () => db.delete(visaCategories)],
    ["countries",                () => db.delete(countries)],

    // Config / lookup tables
    ["incentive_category_rules", () => db.delete(incentiveCategoryRules)],
    ["incentive_slab_rules",     () => db.delete(incentiveSlabRules)],
    ["sale_type",                () => db.delete(saleTypes)],
    ["sale_type_category",       () => db.delete(saleTypeCategories)],
    ["lead_type",                () => db.delete(leadTypes)],
    ["teams",                    () => db.delete(teams)],

    // Users last – CASCADE wipes refresh_tokens
    ["users",                    () => db.delete(users)],
  ];

  for (const [label, fn] of steps) {
    try {
      await fn();
      console.log(`   ✓  ${label}`);
    } catch (err: any) {
      console.error(`   ✗  ${label}: ${err.message}`);
      throw err;
    }
  }

  console.log("\n   All tables cleared.\n");
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface RefData {
  superadminId: number;
  adminId: number;
  managerIds: number[];
  counsellorIds: number[];
  leadTypeIds: number[];
  saleTypeIds: number[];
}

// ─── Reference data (idempotent) ─────────────────────────────────────────────

async function seedReferenceData(): Promise<RefData> {
  console.log("📦  Seeding reference data…");

  const passwordHash = await bcrypt.hash("Seed@12345", 10);

  // ── Users ──
  const SEED_USER_ROWS = [
    { emp_id: "SEED-SA", fullName: "Dev SuperAdmin",         email: SEED_EMAILS[0], passwordHash, role: "superadmin", designation: "Super Admin",            isSupervisor: true  },
    { emp_id: "SEED-AD", fullName: "Dev Admin",              email: SEED_EMAILS[1], passwordHash, role: "admin",      designation: "Admin",                  isSupervisor: false },
    { emp_id: "SEED-M1", fullName: "Rajesh Kumar",           email: SEED_EMAILS[2], passwordHash, role: "manager",   designation: "Senior Manager",         isSupervisor: true  },
    { emp_id: "SEED-M2", fullName: "Sunita Sharma",          email: SEED_EMAILS[3], passwordHash, role: "manager",   designation: "Manager",                isSupervisor: false },
    { emp_id: "SEED-C1", fullName: "Arjun Verma",            email: SEED_EMAILS[4], passwordHash, role: "counsellor",designation: "Immigration Counsellor", isSupervisor: false },
    { emp_id: "SEED-C2", fullName: "Priya Patel",            email: SEED_EMAILS[5], passwordHash, role: "counsellor",designation: "Immigration Counsellor", isSupervisor: false },
    { emp_id: "SEED-C3", fullName: "Rahul Singh",            email: SEED_EMAILS[6], passwordHash, role: "counsellor",designation: "Immigration Counsellor", isSupervisor: false },
    { emp_id: "SEED-C4", fullName: "Anjali Mehta",           email: SEED_EMAILS[7], passwordHash, role: "counsellor",designation: "Immigration Counsellor", isSupervisor: false },
    { emp_id: "SEED-C5", fullName: "Vikram Nair",            email: SEED_EMAILS[8], passwordHash, role: "counsellor",designation: "Immigration Counsellor", isSupervisor: false },
    { emp_id: "SEED-C6", fullName: "Shreya Gupta",           email: SEED_EMAILS[9], passwordHash, role: "counsellor",designation: "Immigration Counsellor", isSupervisor: false },
  ];

  await db.insert(users).values(SEED_USER_ROWS).onConflictDoNothing();

  const allUsers = await db
    .select({ id: users.id, email: users.email, role: users.role })
    .from(users)
    .where(inArray(users.email, SEED_EMAILS));

  const superadminId  = allUsers.find(u => u.role === "superadmin")!.id;
  const adminId       = allUsers.find(u => u.role === "admin")!.id;
  const managerIds    = allUsers.filter(u => u.role === "manager").map(u => u.id);
  const counsellorIds = allUsers.filter(u => u.role === "counsellor").map(u => u.id);

  // ── Lead types ──
  await db
    .insert(leadTypes)
    .values([
      { leadType: "Spouse"  },
      { leadType: "Student" },
      { leadType: "Visitor" },
      { leadType: "Worker"  },
    ])
    .onConflictDoNothing();

  const allLeadTypes  = await db.select({ id: leadTypes.id }).from(leadTypes);
  const leadTypeIds   = allLeadTypes.map(l => l.id);

  // ── Sale type categories ──
  await db
    .insert(saleTypeCategories)
    .values([
      { name: "Core Sale",       description: "Primary visa products"      },
      { name: "Product Add-on",  description: "Secondary product sales"    },
      { name: "Other Services",  description: "Miscellaneous services"     },
    ])
    .onConflictDoNothing();

  const allCats  = await db.select({ id: saleTypeCategories.id }).from(saleTypeCategories);
  const catIds   = allCats.map(c => c.id);

  // ── Sale types ──
  await db
    .insert(saleTypes)
    .values([
      { saleType: "PR Visa Package",    amount: "150000.00", categoryId: catIds[0], isCoreProduct: true  },
      { saleType: "Study Permit",       amount: "120000.00", categoryId: catIds[0], isCoreProduct: true  },
      { saleType: "TRV (Visitor Visa)", amount: "50000.00",  categoryId: catIds[0], isCoreProduct: false },
      { saleType: "IELTS Package",      amount: "35000.00",  categoryId: catIds[1], isCoreProduct: false },
      { saleType: "Forex Package",      amount: "15000.00",  categoryId: catIds[1], isCoreProduct: false },
      { saleType: "General Services",   amount: "10000.00",  categoryId: catIds[2], isCoreProduct: false },
    ])
    .onConflictDoNothing();

  const allSaleTypes = await db.select({ id: saleTypes.saleTypeId }).from(saleTypes);
  const saleTypeIds  = allSaleTypes.map(s => s.id);

  // ── Teams ──
  const teamCount = await db.select({ c: sql<number>`count(*)` }).from(teams);
  if (Number(teamCount[0].c) === 0) {
    await db.insert(teams).values([
      { name: "Pratham Alpha Team", isActive: true },
      { name: "Pratham Beta Team",  isActive: true },
    ]);
  }

  // ── Visa categories ──
  await db
    .insert(visaCategories)
    .values([
      { name: "Student Visa", slug: "student-visa", description: "Study permit and student visas",   displayOrder: 1 },
      { name: "Visitor Visa", slug: "visitor-visa", description: "TRV and visitor visas",            displayOrder: 2 },
      { name: "Work Permit",  slug: "work-permit",  description: "Work permits and PR visas",        displayOrder: 3 },
    ])
    .onConflictDoNothing();

  // ── Countries ──
  await db
    .insert(countries)
    .values([
      { name: "Canada",         code: "CA" },
      { name: "United States",  code: "US" },
      { name: "United Kingdom", code: "GB" },
      { name: "Australia",      code: "AU" },
      { name: "Germany",        code: "DE" },
    ])
    .onConflictDoNothing();

  // ── Checklists + sections + items (seed once) ──
  const vcRows   = await db.select({ id: visaCategories.id, slug: visaCategories.slug }).from(visaCategories);
  const ctryRows = await db.select({ id: countries.id }).from(countries);

  await db
    .insert(checklists)
    .values(
      vcRows.map((vc, i) => ({
        visaCategoryId: vc.id,
        countryId: ctryRows[i % ctryRows.length].id,
        title: `${vc.slug === "student-visa" ? "Study Permit" : vc.slug === "visitor-visa" ? "TRV Application" : "Work Permit"} Checklist – Canada`,
        slug: `${vc.slug}-checklist-ca`,
        description: "Standard document checklist for Canada applications",
        displayOrder: i + 1,
        isActive: true,
      }))
    )
    .onConflictDoNothing();

  const clRows = await db.select({ id: checklists.id }).from(checklists);
  const secCount = await db.select({ c: sql<number>`count(*)` }).from(documentSections);

  if (Number(secCount[0].c) === 0 && clRows.length > 0) {
    const secRows = clRows.flatMap(cl => [
      { checklistId: cl.id, title: "Identity Documents",  displayOrder: 1 },
      { checklistId: cl.id, title: "Financial Documents", displayOrder: 2 },
    ]);
    const insertedSecs = await db.insert(documentSections).values(secRows).returning({ id: documentSections.id });

    await db.insert(documentItems).values(
      insertedSecs.flatMap((sec, si) => [
        { sectionId: sec.id, name: si % 2 === 0 ? "Passport (all pages)"        : "Bank Statements (6 months)",  isMandatory: true,  displayOrder: 1 },
        { sectionId: sec.id, name: si % 2 === 0 ? "Birth Certificate"           : "ITR / Tax Returns",           isMandatory: true,  displayOrder: 2 },
        { sectionId: sec.id, name: si % 2 === 0 ? "National ID / Aadhaar Card"  : "Employment Letter",           isMandatory: false, displayOrder: 3 },
      ])
    );
  }

  // ── Incentive category rules ──
  const icCount = await db.select({ c: sql<number>`count(*)` }).from(incentiveCategoryRules);
  if (Number(icCount[0].c) === 0) {
    await db.insert(incentiveCategoryRules).values([
      { rule_group: "core_visitor",    label: "TRV Approval",        incentive_amount: 500, sort_order: 1 },
      { rule_group: "core_visitor",    label: "TRV Extension",       incentive_amount: 300, sort_order: 2 },
      { rule_group: "visitor_product", label: "Insurance Sale",      incentive_amount: 200, sort_order: 1 },
      { rule_group: "visitor_product", label: "Forex Card Sale",     incentive_amount: 150, sort_order: 2 },
      { rule_group: "visitor_product", label: "Air Ticket Booking",  incentive_amount: 250, sort_order: 3 },
    ]);
  }

  // ── Incentive slab rules ──
  const isCount = await db.select({ c: sql<number>`count(*)` }).from(incentiveSlabRules);
  if (Number(isCount[0].c) === 0) {
    await db.insert(incentiveSlabRules).values([
      { rule_group: "core_spouse",     min_count: 1,  max_count: 5,  incentive_amount: 1000, sort_order: 1 },
      { rule_group: "core_spouse",     min_count: 6,  max_count: 15, incentive_amount: 1500, sort_order: 2 },
      { rule_group: "canada_student",  min_count: 1,  max_count: 5,  incentive_amount: 800,  sort_order: 1 },
      { rule_group: "canada_student",  min_count: 6,  max_count: 15, incentive_amount: 1200, sort_order: 2 },
      { rule_group: "all_finance",     min_count: 1,  max_count: 10, incentive_amount: 500,  sort_order: 1 },
      { rule_group: "student",         min_count: 1,  max_count: 5,  incentive_amount: 700,  sort_order: 1 },
    ]);
  }

  console.log(`   ✓ Users: ${allUsers.length} | Lead types: ${leadTypeIds.length} | Sale types: ${saleTypeIds.length}`);
  return { superadminId, adminId, managerIds, counsellorIds, leadTypeIds, saleTypeIds };
}

// ─── Monthly data ─────────────────────────────────────────────────────────────

const CLIENT_NAMES = [
  "Aditya Sharma",   "Priyanka Singh",  "Rajesh Patel",    "Neha Gupta",
  "Amit Verma",      "Sunita Nair",     "Vikas Mehta",     "Kavya Reddy",
  "Deepak Joshi",    "Anita Rao",       "Suresh Iyer",     "Meera Pillai",
  "Ravi Tiwari",     "Pooja Malhotra",  "Kiran Bhatia",    "Rohit Dubey",
  "Shweta Goel",     "Manish Chopra",   "Divya Shetty",    "Ashok Kaur",
  "Seema Bajaj",     "Tarun Mishra",    "Nidhi Pandey",    "Aryan Saxena",
  "Geeta Chandra",   "Vinod Naik",      "Pallavi Hegde",   "Sachin Kulkarni",
  "Rekha Jain",      "Sunil Thakur",
];

async function seedMonth(year: number, month: number, ref: RefData): Promise<void> {
  const monthName = new Date(year, month - 1, 1).toLocaleString("en-US", { month: "long" });
  console.log(`\n📅  ${monthName} ${year}…`);

  const {
    adminId, managerIds, counsellorIds,
    leadTypeIds, saleTypeIds,
  } = ref;

  const N       = 28;   // clients / main records per month
  const staffIds = [...counsellorIds, ...managerIds];
  const dates   = spreadDates(year, month, N);

  // ── Clients (28) ──────────────────────────────────────────────────────────
  const insertedClients = await db
    .insert(clientInformation)
    .values(
      Array.from({ length: N }, (_, i) => ({
        counsellorId:    pick(counsellorIds, i),
        fullName:        pick(CLIENT_NAMES, i),
        enrollmentDate:  dates[i],
        passportDetails: uid("PP", i + month * 100),
        leadTypeId:      pick(leadTypeIds, i),
        archived:        false,
      }))
    )
    .returning({ clientId: clientInformation.clientId });

  const clientIds = insertedClients.map(r => r.clientId);
  console.log(`   clients       : ${clientIds.length}`);

  // ── Product entity tables ─────────────────────────────────────────────────

  // Air tickets (12)
  const AT_N = 12;
  const atDates = spreadDates(year, month, AT_N);
  const insAT = await db
    .insert(airTicket)
    .values(
      Array.from({ length: AT_N }, (_, i) => ({
        isTicketBooked:  i % 3 !== 0,
        amount:          randDec(15000, 80000),
        airTicketNumber: uid("ATK", i + month * 100),
        ticketDate:      atDates[i],
        remarks:         "Seed record",
      }))
    )
    .returning({ id: airTicket.id });

  // Insurance (12)
  const INS_N = 12;
  const insDates = spreadDates(year, month, INS_N);
  const insINS = await db
    .insert(insurance)
    .values(
      Array.from({ length: INS_N }, (_, i) => ({
        amount:         randDec(5000, 25000),
        policyNumber:   uid("POL", i + month * 100),
        insuranceDate:  insDates[i],
        remarks:        "Seed record",
      }))
    )
    .returning({ id: insurance.id });

  // Sim cards (10)
  const SIM_N = 10;
  const simDates = spreadDates(year, month, SIM_N);
  const insSIM = await db
    .insert(simCard)
    .values(
      Array.from({ length: SIM_N }, (_, i) => ({
        activatedStatus:    i % 2 === 0,
        simcardPlan:        pick(["Rogers 50GB", "Telus Unlimited", "Fido Basic", "Bell 30GB"], i),
        simCardGivingDate:  simDates[i],
        simActivationDate:  i % 2 === 0 ? simDates[i] : null,
        remarks:            "Seed record",
      }))
    )
    .returning({ id: simCard.id });

  // Forex cards (8)
  const FC_N = 8;
  const fcDates = spreadDates(year, month, FC_N);
  const insFC = await db
    .insert(forexCard)
    .values(
      Array.from({ length: FC_N }, (_, i) => ({
        forexCardStatus: pick(["Issued", "Activated", "Pending"], i),
        cardDate:        fcDates[i],
        remarks:         "Seed record",
      }))
    )
    .returning({ id: forexCard.id });

  // Forex fees (8)
  const FF_N = 8;
  const ffDates = spreadDates(year, month, FF_N);
  const insFF = await db
    .insert(forexFees)
    .values(
      Array.from({ length: FF_N }, (_, i) => ({
        side:    (i % 2 === 0 ? "PI" : "TP") as "PI" | "TP",
        feeDate: ffDates[i],
        amount:  randDec(2000, 10000),
        remarks: "Seed record",
      }))
    )
    .returning({ id: forexFees.id });

  // Loans (6)
  const LN_N = 6;
  const lnDates = spreadDates(year, month, LN_N);
  const insLN = await db
    .insert(loan)
    .values(
      Array.from({ length: LN_N }, (_, i) => ({
        amount:          randDec(200000, 1500000),
        disbursmentDate: lnDates[i],
        remarks:         "Seed record",
      }))
    )
    .returning({ id: loan.id });

  // IELTS (6)
  const IE_N = 6;
  const ieDates = spreadDates(year, month, IE_N);
  const insIE = await db
    .insert(ielts)
    .values(
      Array.from({ length: IE_N }, (_, i) => ({
        enrolledStatus:  i % 2 === 0,
        amount:          randDec(14000, 18000),
        enrollmentDate:  ieDates[i],
        remarks:         "Seed record",
      }))
    )
    .returning({ id: ielts.id });

  // Credit cards (6)
  const CC_N = 6;
  const ccDates = spreadDates(year, month, CC_N);
  const insCC = await db
    .insert(creditCard)
    .values(
      Array.from({ length: CC_N }, (_, i) => ({
        activatedStatus:     i % 2 === 0,
        cardPlan:            pick(["HDFC Regalia", "ICICI Amazon Pay", "SBI Simply Click", "Axis Ace"], i),
        cardGivingDate:      ccDates[i],
        cardActivationDate:  i % 2 === 0 ? ccDates[i] : null,
        cardDate:            ccDates[i],
        remarks:             "Seed record",
      }))
    )
    .returning({ id: creditCard.id });

  // Tution fees (6)
  const TF_N = 6;
  const tfDates = spreadDates(year, month, TF_N);
  const insTF = await db
    .insert(tutionFees)
    .values(
      Array.from({ length: TF_N }, (_, i) => ({
        tutionFeesStatus: (i % 2 === 0 ? "paid" : "pending") as "paid" | "pending",
        feeDate:  tfDates[i],
        remarks:  "Seed record",
      }))
    )
    .returning({ id: tutionFees.id });

  // Beacon accounts (4)
  const BA_N = 4;
  const baDates = spreadDates(year, month, BA_N);
  const insBA = await db
    .insert(beaconAccount)
    .values(
      Array.from({ length: BA_N }, (_, i) => ({
        openingDate:  baDates[i],
        fundingDate:  baDates[i],
        amount:       randDec(10000, 50000),
        remarks:      "Seed record",
      }))
    )
    .returning({ id: beaconAccount.id });

  // Visa extensions (6)
  const VE_N = 6;
  const veDates = spreadDates(year, month, VE_N);
  const insVE = await db
    .insert(visaExtension)
    .values(
      Array.from({ length: VE_N }, (_, i) => ({
        type:          pick(["Study Permit Extension", "Work Permit Extension", "TRV Extension"], i),
        amount:        randDec(20000, 80000),
        extensionDate: veDates[i],
        invoiceNo:     uid("VE", i + month * 100),
        remarks:       "Seed record",
      }))
    )
    .returning({ id: visaExtension.id });

  // New sells (6)
  const NS_N = 6;
  const nsDates = spreadDates(year, month, NS_N);
  const insNS = await db
    .insert(newSell)
    .values(
      Array.from({ length: NS_N }, (_, i) => ({
        serviceName:        pick(["Canada Fund Service", "Employment Verification", "Kids Study Permit", "Sponsor Documentation", "Refusal Review", "Judicial Review"], i),
        serviceInformation: "Seed service",
        amount:             randDec(5000, 30000),
        sellDate:           nsDates[i],
        invoiceNo:          uid("NS", i + month * 100),
        remarks:            "Seed record",
      }))
    )
    .returning({ id: newSell.id });

  // All finance (4)
  const AF_N = 4;
  const afDates = spreadDates(year, month, AF_N);
  const insAF = await db
    .insert(allFinance)
    .values(
      Array.from({ length: AF_N }, (_, i) => ({
        totalAmount:      randDec(100000, 500000),
        amount:           randDec(50000, 250000),
        paymentDate:      afDates[i],
        invoiceNo:        uid("AF", i + month * 100),
        partialPayment:   i % 2 === 0,
        approvalStatus:   pick(["pending", "approved", "approved", "rejected"] as const, i),
        approvedBy:       i % 2 === 0 ? adminId : null,
        approvedAt:       i % 2 === 0 ? new Date() : null,
        remarks:          "Seed record",
      }))
    )
    .returning({ id: allFinance.financeId });

  console.log(`   product tables: AT${insAT.length} INS${insINS.length} SIM${insSIM.length} FC${insFC.length} FF${insFF.length} LN${insLN.length} IE${insIE.length} CC${insCC.length} TF${insTF.length} BA${insBA.length} VE${insVE.length} NS${insNS.length} AF${insAF.length}`);

  // ── Client payments (28 – one per client) ──────────────────────────────────
  await db.insert(clientPayments).values(
    clientIds.map((cid, i) => ({
      clientId:     cid,
      saleTypeId:   pick(saleTypeIds, i),
      totalPayment: randDec(50000, 200000),
      stage:        pick(["INITIAL", "BEFORE_VISA", "AFTER_VISA", "SUBMITTED_VISA"] as const, i),
      amount:       randDec(20000, 100000),
      paymentDate:  dates[i],
      invoiceNo:    uid("CP", i + month * 1000),
      handledBy:    pick(staffIds, i),
      remarks:      "Seed client payment",
    }))
  );

  // ── Client product payments (one per product entity) ───────────────────────
  type PEntry = {
    entityId:    number;
    entityType:  "airTicket_id"|"insurance_id"|"simCard_id"|"forexCard_id"|"forexFees_id"|"loan_id"|"ielts_id"|"creditCard_id"|"tutionFees_id"|"beaconAccount_id"|"visaextension_id"|"newSell_id"|"allFinance_id";
    productName: string;
    amount:      string;
    date:        string;
  };

  const productEntries: PEntry[] = [
    ...insAT.map((r, i) => ({ entityId: r.id, entityType: "airTicket_id"     as const, productName: "AIR_TICKET",              amount: randDec(15000, 80000),    date: atDates[i]  })),
    ...insINS.map((r, i)=> ({ entityId: r.id, entityType: "insurance_id"     as const, productName: "INSURANCE",               amount: randDec(5000,  25000),    date: insDates[i] })),
    ...insSIM.map((r, i)=> ({ entityId: r.id, entityType: "simCard_id"        as const, productName: "SIM_CARD_ACTIVATION",     amount: randDec(1500,  5000),     date: simDates[i] })),
    ...insFC.map((r, i) => ({ entityId: r.id, entityType: "forexCard_id"      as const, productName: "FOREX_CARD",              amount: randDec(3000,  10000),    date: fcDates[i]  })),
    ...insFF.map((r, i) => ({ entityId: r.id, entityType: "forexFees_id"      as const, productName: "FOREX_FEES",              amount: randDec(2000,  10000),    date: ffDates[i]  })),
    ...insLN.map((r, i) => ({ entityId: r.id, entityType: "loan_id"           as const, productName: "LOAN_DETAILS",            amount: randDec(200000,1500000),  date: lnDates[i]  })),
    ...insIE.map((r, i) => ({ entityId: r.id, entityType: "ielts_id"          as const, productName: "IELTS_ENROLLMENT",        amount: randDec(14000, 18000),    date: ieDates[i]  })),
    ...insCC.map((r, i) => ({ entityId: r.id, entityType: "creditCard_id"     as const, productName: "CREDIT_CARD",             amount: randDec(5000,  15000),    date: ccDates[i]  })),
    ...insTF.map((r, i) => ({ entityId: r.id, entityType: "tutionFees_id"     as const, productName: "TUTION_FEES",             amount: randDec(50000, 300000),   date: tfDates[i]  })),
    ...insBA.map((r, i) => ({ entityId: r.id, entityType: "beaconAccount_id"  as const, productName: "BEACON_ACCOUNT",          amount: randDec(10000, 50000),    date: baDates[i]  })),
    ...insVE.map((r, i) => ({ entityId: r.id, entityType: "visaextension_id"  as const, productName: "VISA_EXTENSION",          amount: randDec(20000, 80000),    date: veDates[i]  })),
    ...insNS.map((r, i) => ({ entityId: r.id, entityType: "newSell_id"        as const, productName: "OTHER_NEW_SELL",          amount: randDec(5000,  30000),    date: nsDates[i]  })),
    ...insAF.map((r, i) => ({ entityId: r.id, entityType: "allFinance_id"     as const, productName: "ALL_FINANCE_EMPLOYEMENT", amount: randDec(50000, 250000),   date: afDates[i]  })),
  ];

  await db.insert(clientProductPayments).values(
    productEntries.map((e, i) => ({
      clientId:    pick(clientIds, i),
      productName: e.productName as any,
      amount:      e.amount,
      paymentDate: e.date,
      invoiceNo:   uid("PP", i + month * 1000),
      entityId:    e.entityId,
      entityType:  e.entityType as any,
      handledBy:   pick(staffIds, i),
      remarks:     "Seed product payment",
    }))
  );

  console.log(`   product pmts  : ${productEntries.length}`);

  // ── Activity logs (25) ────────────────────────────────────────────────────
  type ActivityAction = typeof activityActionEnum.enumValues[number];
  const AL_ACTIONS: ActivityAction[] = ["CREATE", "UPDATE", "PAYMENT_ADDED", "PRODUCT_ADDED", "STATUS_CHANGE"];
  const AL_DESCS = [
    "New client enrolled",
    "Client record updated",
    "Payment added to client",
    "Product payment recorded",
    "Client status changed",
  ];
  const alDates = spreadDates(year, month, 25);

  await db.insert(activityLog).values(
    Array.from({ length: 25 }, (_, i) => ({
      entityType:  pick(["client", "payment", "product_payment"], i),
      entityId:    pick(clientIds, i),
      clientId:    pick(clientIds, i),
      action:      pick(AL_ACTIONS, i),
      description: pick(AL_DESCS, i),
      performedBy: pick(staffIds, i),
      ipAddress:   `192.168.1.${(i % 254) + 1}`,
      userAgent:   "Seed/1.0",
      createdAt:   new Date(alDates[i]),
    }))
  );

  // ── Messages (4) + acknowledgments ────────────────────────────────────────
  const msgDates = spreadDates(year, month, 4);
  const insertedMsgs = await db
    .insert(messages)
    .values([
      {
        message:     `Monthly target review for ${monthName} ${year} – please update client statuses.`,
        title:       `${monthName} Target Review`,
        senderId:    pick(managerIds, 0),
        messageType: "broadcast" as const,
        targetRoles: ["counsellor", "telecaller"],
        targetUserIds: [],
        priority:    "normal" as const,
        isActive:    true,
        createdAt:   new Date(msgDates[0]),
        updatedAt:   new Date(msgDates[0]),
      },
      {
        message:     `Policy update ${monthName} ${year} – immigration rules revised. Review required.`,
        title:       `Policy Update – ${monthName}`,
        senderId:    adminId,
        messageType: "broadcast" as const,
        targetRoles: ["manager", "counsellor"],
        targetUserIds: [],
        priority:    "high" as const,
        isActive:    true,
        createdAt:   new Date(msgDates[1]),
        updatedAt:   new Date(msgDates[1]),
      },
      {
        message:     `Training session on ${monthName} 15, ${year}. Attendance mandatory for all counsellors.`,
        title:       "Training Session",
        senderId:    pick(managerIds, 1),
        messageType: "broadcast" as const,
        targetRoles: ["counsellor"],
        targetUserIds: [],
        priority:    "normal" as const,
        isActive:    true,
        createdAt:   new Date(msgDates[2]),
        updatedAt:   new Date(msgDates[2]),
      },
      {
        message:     `${monthName} performance summary – great work team! Keep the momentum going.`,
        title:       `${monthName} Performance`,
        senderId:    adminId,
        messageType: "broadcast" as const,
        targetRoles: ["manager", "counsellor", "telecaller"],
        targetUserIds: [],
        priority:    "low" as const,
        isActive:    true,
        createdAt:   new Date(msgDates[3]),
        updatedAt:   new Date(msgDates[3]),
      },
    ])
    .returning({ id: messages.id });

  // Acknowledgments: first 4 counsellors ack each message
  const ackRows = insertedMsgs.flatMap(msg =>
    counsellorIds.slice(0, 4).map(userId => ({
      messageId:             msg.id,
      userId,
      acknowledgedAt:        new Date(),
      acknowledgmentMethod:  "button" as const,
      createdAt:             new Date(),
    }))
  );
  if (ackRows.length > 0) {
    await db.insert(messageAcknowledgments).values(ackRows).onConflictDoNothing();
  }

  // ── Leader board (one entry per counsellor) ───────────────────────────────
  const achieved = counsellorIds.map(() => randInt(8, 38));
  const ranked   = [...achieved].sort((a, b) => b - a);

  await db.insert(leaderBoard).values(
    counsellorIds.map((cid, i) => ({
      manager_id:       pick(managerIds, i),
      counsellor_id:    cid,
      target:           30,
      achieved_target:  achieved[i],
      rank:             ranked.indexOf(achieved[i]) + 1,
      createdAt:        new Date(dates[0]),
    }))
  );

  // ── Manager targets (one per manager per month) ───────────────────────────
  const monthStart = dateStr(year, month, 1);
  const monthEnd   = dateStr(year, month, new Date(year, month, 0).getDate());

  await db.insert(managerTargets).values(
    managerIds.map(mid => ({
      manager_id:                   mid,
      manager_ids:                  [mid],
      start_date:                   monthStart,
      end_date:                     monthEnd,
      core_sale_target_clients:     randInt(15, 25),
      core_sale_target_revenue:     randDec(1500000, 3000000),
      core_product_target_clients:  randInt(20, 40),
      core_product_target_revenue:  randDec(500000, 1500000),
      other_product_target_clients: randInt(10, 20),
      other_product_target_revenue: randDec(200000, 800000),
      overall:                      randDec(2500000, 5000000),
    }))
  );

  console.log(`   messages      : ${insertedMsgs.length}  |  leaderboard: ${counsellorIds.length}  |  manager targets: ${managerIds.length}`);
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║         Pratham Connect – Monthly Seed Script        ║");
  console.log("╚══════════════════════════════════════════════════════╝");

  const args       = process.argv.slice(2);
  const doClear    = args.includes("--clear") || args.includes("--clear-only");
  const seedOnly   = !args.includes("--clear-only");

  if (doClear) {
    console.log("Flag : --clear  →  old seed data will be removed first\n");
  } else {
    console.log(`Run ID : ${RUN_ID}  (embedded in all unique fields this run)\n`);
  }

  try {
    if (doClear) {
      await clearSeedData();
      if (!seedOnly) {
        console.log("\n✅  Clear complete.");
        process.exit(0);
      }
      console.log(`\nRun ID : ${RUN_ID}  (new seed)\n`);
    }

    const ref = await seedReferenceData();

    for (const month of [1, 2, 3, 4]) {
      await seedMonth(2026, month, ref);
    }

    console.log("\n✅  Seed complete – Jan → Apr 2026 data inserted.");
    console.log(`   Seed user password : Seed@12345`);
    console.log(`   Emails             : superadmin@seed.local  admin@seed.local`);
    console.log(`                        manager1/2@seed.local  counsellor1-6@seed.local\n`);
  } catch (err) {
    console.error("\n❌  Failed:", err);
    process.exit(1);
  }

  process.exit(0);
}

main();
