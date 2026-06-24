import { eq, inArray, desc } from "drizzle-orm";
import { dbSecond } from "../../../config/databaseConnectionSecond";
import { clients } from "../../clients/schemas/client_convert.schema";
import { personModule } from "../../clients/schemas/person.schema";
import { clientAddresses } from "../../clients/schemas/address.schema";
import { clientPassport } from "../../clients/schemas/passport.schema";
import { clientFamilyMembers } from "../../clients/schemas/family_members.schema";
import { clientCore } from "../../clients/schemas/client_core.schema";
import { sales } from "../../sales/schemas/sale.schema";
import { saleTypes } from "../../sales/schemas/saleType.schema";
import { products } from "../../products/schemas/product.schema";
import { paymentBalances } from "../schemas/paymentBalance.schema";
import { amounts } from "../schemas/amount.schema";
import { invoices } from "../schemas/invoice.schema";
import { remarks } from "../schemas/remark.schema";
import { productTransactions } from "../schemas/product_transactions.schema";
import { productTransactionAttributes } from "../schemas/product_transaction_attributes.schema";
import { paymentAirTicket } from "../schemas/entities/airTicket.schema";
import { paymentCreditCard } from "../schemas/entities/creditCard.schema";
import { paymentForexCard } from "../schemas/entities/forexCard.schema";
import { paymentForexFees } from "../schemas/entities/forexFees.schema";
import { paymentIelts } from "../schemas/entities/ielts.schema";
import { paymentInsurance } from "../schemas/entities/insurance.schema";
import { paymentLoan } from "../schemas/entities/loan.schema";
import { paymentSimCard } from "../schemas/entities/simCard.schema";
import { paymentTutionFees } from "../schemas/entities/tutionFees.schema";
import { paymentNewSell } from "../schemas/entities/newSell.schema";
import { countries } from "../../countries/schemas/countries.schema";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: string): boolean => UUID_REGEX.test(value);

export const resolveModuleClientId = async (
  clientIdParam: string
): Promise<string | null> => {
  if (isUuid(clientIdParam)) {
    const [row] = await dbSecond
      .select({ id: clients.id })
      .from(clients)
      .where(eq(clients.id, clientIdParam))
      .limit(1);
    return row?.id ?? null;
  }

  const legacyId = Number(clientIdParam);
  if (!Number.isFinite(legacyId)) return null;

  const [row] = await dbSecond
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.legacyClientId, legacyId))
    .limit(1);

  return row?.id ?? null;
};

export const getClientRowById = async (clientId: string) => {
  const [client] = await dbSecond
    .select()
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);

  return client ?? null;
};

export const getPersonById = async (personId: string) => {
  const [person] = await dbSecond
    .select({
      person: personModule,
      nationality: {
        id: countries.id,
        name: countries.name,
        isoCode: countries.isoCode,
      },
    })
    .from(personModule)
    .leftJoin(countries, eq(personModule.nationalityId, countries.id))
    .where(eq(personModule.id, personId))
    .limit(1);

  return person ?? null;
};

export const getAddressesByPersonId = async (personId: string) => {
  return dbSecond
    .select({
      address: clientAddresses,
      country: {
        id: countries.id,
        name: countries.name,
        isoCode: countries.isoCode,
      },
    })
    .from(clientAddresses)
    .leftJoin(countries, eq(clientAddresses.countryId, countries.id))
    .where(eq(clientAddresses.personId, personId));
};

export const getPassportsByPersonId = async (personId: string) => {
  return dbSecond
    .select({
      passport: clientPassport,
      country: {
        id: countries.id,
        name: countries.name,
        isoCode: countries.isoCode,
      },
    })
    .from(clientPassport)
    .leftJoin(countries, eq(clientPassport.countryId, countries.id))
    .where(eq(clientPassport.personId, personId));
};

export const getFamilyMembersByClientId = async (clientId: string) => {
  return dbSecond
    .select({
      member: clientFamilyMembers,
      person: personModule,
    })
    .from(clientFamilyMembers)
    .innerJoin(personModule, eq(clientFamilyMembers.personId, personModule.id))
    .where(eq(clientFamilyMembers.clientId, clientId));
};

export const getClientCoreByClientId = async (clientId: string) => {
  return dbSecond
    .select()
    .from(clientCore)
    .where(eq(clientCore.clientId, clientId));
};

export const getClientSales = async (clientId: string) => {
  return dbSecond
    .select({
      sale: sales,
      saleType: saleTypes,
    })
    .from(sales)
    .innerJoin(saleTypes, eq(sales.saleTypeId, saleTypes.saleTypeId))
    .where(eq(sales.clientId, clientId))
    .orderBy(desc(sales.createdAt));
};

export const getPaymentBalancesByClientId = async (clientId: string) => {
  return dbSecond
    .select({
      balance: paymentBalances,
      sale: sales,
      saleType: saleTypes,
      product: products,
    })
    .from(paymentBalances)
    .leftJoin(sales, eq(paymentBalances.saleId, sales.id))
    .leftJoin(saleTypes, eq(sales.saleTypeId, saleTypes.saleTypeId))
    .leftJoin(products, eq(paymentBalances.productId, products.id))
    .where(eq(paymentBalances.clientId, clientId))
    .orderBy(desc(paymentBalances.createdAt));
};

export const getAmountsByClientId = async (clientId: string) => {
  return dbSecond
    .select({
      payment: amounts,
      sale: sales,
      saleType: saleTypes,
      product: products,
      balance: paymentBalances,
    })
    .from(amounts)
    .innerJoin(sales, eq(amounts.saleId, sales.id))
    .innerJoin(saleTypes, eq(sales.saleTypeId, saleTypes.saleTypeId))
    .leftJoin(products, eq(amounts.productId, products.id))
    .leftJoin(paymentBalances, eq(amounts.balanceId, paymentBalances.id))
    .where(eq(amounts.clientId, clientId))
    .orderBy(desc(amounts.createdAt));
};

export const getInvoicesByAmountIds = async (amountIds: string[]) => {
  if (amountIds.length === 0) return [];

  return dbSecond
    .select()
    .from(invoices)
    .where(inArray(invoices.amountId, amountIds))
    .orderBy(desc(invoices.createdAt));
};

export const getRemarksByAmountIds = async (amountIds: string[]) => {
  if (amountIds.length === 0) return [];

  return dbSecond
    .select()
    .from(remarks)
    .where(inArray(remarks.amountId, amountIds))
    .orderBy(desc(remarks.createdAt));
};

export const getProductTransactionsByClientId = async (clientId: string) => {
  return dbSecond
    .select({
      transaction: productTransactions,
      product: products,
      balance: paymentBalances,
    })
    .from(productTransactions)
    .innerJoin(products, eq(productTransactions.productId, products.id))
    .leftJoin(
      paymentBalances,
      eq(productTransactions.balanceId, paymentBalances.id)
    )
    .where(eq(productTransactions.clientId, clientId))
    .orderBy(desc(productTransactions.createdAt));
};

export const getProductTransactionAttributes = async (
  transactionIds: string[]
) => {
  if (transactionIds.length === 0) return [];

  return dbSecond
    .select()
    .from(productTransactionAttributes)
    .where(
      inArray(
        productTransactionAttributes.productTransactionId,
        transactionIds
      )
    );
};

export const getProductEntitiesByClientId = async (clientId: string) => {
  const [
    airTickets,
    creditCards,
    forexCards,
    forexFees,
    ieltsRows,
    insuranceRows,
    loans,
    simCards,
    tutionFeesRows,
    newSells,
  ] = await Promise.all([
    dbSecond
      .select()
      .from(paymentAirTicket)
      .where(eq(paymentAirTicket.clientId, clientId))
      .orderBy(desc(paymentAirTicket.createdAt)),
    dbSecond
      .select()
      .from(paymentCreditCard)
      .where(eq(paymentCreditCard.clientId, clientId))
      .orderBy(desc(paymentCreditCard.createdAt)),
    dbSecond
      .select()
      .from(paymentForexCard)
      .where(eq(paymentForexCard.clientId, clientId))
      .orderBy(desc(paymentForexCard.createdAt)),
    dbSecond
      .select()
      .from(paymentForexFees)
      .where(eq(paymentForexFees.clientId, clientId))
      .orderBy(desc(paymentForexFees.createdAt)),
    dbSecond
      .select()
      .from(paymentIelts)
      .where(eq(paymentIelts.clientId, clientId))
      .orderBy(desc(paymentIelts.createdAt)),
    dbSecond
      .select()
      .from(paymentInsurance)
      .where(eq(paymentInsurance.clientId, clientId))
      .orderBy(desc(paymentInsurance.createdAt)),
    dbSecond
      .select()
      .from(paymentLoan)
      .where(eq(paymentLoan.clientId, clientId))
      .orderBy(desc(paymentLoan.createdAt)),
    dbSecond
      .select()
      .from(paymentSimCard)
      .where(eq(paymentSimCard.clientId, clientId))
      .orderBy(desc(paymentSimCard.createdAt)),
    dbSecond
      .select()
      .from(paymentTutionFees)
      .where(eq(paymentTutionFees.clientId, clientId))
      .orderBy(desc(paymentTutionFees.createdAt)),
    dbSecond
      .select()
      .from(paymentNewSell)
      .where(eq(paymentNewSell.clientId, clientId))
      .orderBy(desc(paymentNewSell.createdAt)),
  ]);

  return {
    airTickets,
    creditCards,
    forexCards,
    forexFees,
    ielts: ieltsRows,
    insurance: insuranceRows,
    loans,
    simCards,
    tutionFees: tutionFeesRows,
    newSells,
  };
};
