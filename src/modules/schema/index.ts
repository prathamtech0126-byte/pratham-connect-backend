/**
 * Barrel export for all tables in the modules (payment) database.
 * Used by dbSecond and drizzle-kit (drizzle.modules.config.ts).
 *
 * Import order follows dependency graph — dependants after dependencies.
 */

// ─── Countries ───────────────────────────────────────────────────────────────
export * from "../countries/schemas/countries.schema";

// ─── Visa categories → sale types — must load before client_sale / product_sale_types
export * from "../sales/schemas/visaCategories.schema";
export * from "../sales/schemas/saleType.schema";

// ─── Clients ─────────────────────────────────────────────────────────────────
export * from "../clients/schemas/person.schema";
export * from "../clients/schemas/client_convert.schema";
export * from "../clients/schemas/passport.schema";
export * from "../clients/schemas/address.schema";
export * from "../clients/schemas/family_members.schema";
export * from "../clients/schemas/client_core.schema";
export * from "../clients/schemas/client_transfer.schema";
export * from "../clients/schemas/client_sale.schema";

// ─── Products ─────────────────────────────────────────────────────────────────
export * from "../products/schemas/product.schema";
export * from "../products/schemas/productContries.schema";
export * from "../products/schemas/productSaleTypes.schema";

// ─── Sales ───────────────────────────────────────────────────────────────────
export * from "../sales/schemas/sale.schema";
export * from "../sales/schemas/saleItem.schema";

// ─── Payments ────────────────────────────────────────────────────────────────
export * from "../payments/schemas/paymentBalance.schema";
export * from "../payments/schemas/amount.schema";
export * from "../payments/schemas/date.schema";
export * from "../payments/schemas/remark.schema";
export * from "../payments/schemas/invoice.schema";           // invoiceStatusEnum used by paymentVerification
export * from "../payments/schemas/approvedAmount.schema";
export * from "../payments/schemas/paymentMethod.schema";
export * from "../payments/schemas/paymentVerification.schema";
export * from "../payments/schemas/currencyRate.schema";
export * from "../payments/schemas/installmentPlan.schema";
export * from "../payments/schemas/installment.schema";
export * from "../payments/schemas/product_transactions.schema";
export * from "../payments/schemas/product_transaction_attributes.schema";

// ─── Product entity tables (typed mirrors of main CRM entity tables + client_id) ─
export * from "../payments/schemas/entities/airTicket.schema";
export * from "../payments/schemas/entities/creditCard.schema";
export * from "../payments/schemas/entities/forexCard.schema";
export * from "../payments/schemas/entities/forexFees.schema";
export * from "../payments/schemas/entities/ielts.schema";
export * from "../payments/schemas/entities/insurance.schema";
export * from "../payments/schemas/entities/loan.schema";
export * from "../payments/schemas/entities/simCard.schema";
export * from "../payments/schemas/entities/tutionFees.schema";
export * from "../payments/schemas/entities/newSell.schema";

// ─── Stages (admin-managed pipelines) ────────────────────────────────────────
export * from "../stages/schemas/stagePipeline.schema";
export * from "../stages/schemas/stageDefinition.schema";

// ─── Client Journey ───────────────────────────────────────────────────────────
export * from "../journey/schemas/clientJourney.schema";

// ─── Notifications ────────────────────────────────────────────────────────────
export * from "../notifications/schemas/notification.schema";

// ─── Client Documents (modules DB checklist templates) ───────────────────────
export * from "../clientDocuments/schemas/clientDocumentChecklist.schema";

// ─── Users (roles → users → departments → branches → teams) ─────────────────
export * from "../users/schemas/role.schema";
export * from "../users/schemas/user.schema";
export * from "../users/schemas/department.schema";
export * from "../users/schemas/branch.schema";
export * from "../users/schemas/team.schema";
