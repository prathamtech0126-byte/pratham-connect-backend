import {
  resolveModuleClientId,
  getClientRowById,
  getPersonById,
  getAddressesByPersonId,
  getPassportsByPersonId,
  getFamilyMembersByClientId,
  getClientCoreByClientId,
  getClientSales,
  getPaymentBalancesByClientId,
  getAmountsByClientId,
  getInvoicesByAmountIds,
  getRemarksByAmountIds,
  getProductTransactionsByClientId,
  getProductTransactionAttributes,
  getProductEntitiesByClientId,
} from "../models/payment.model";

type BalanceRow = Awaited<ReturnType<typeof getPaymentBalancesByClientId>>[number];

type MoneySummary = {
  totalAmount: string;
  paidAmount: string;
  pendingAmount: string;
  count: number;
};

const parseMoney = (value: string | null | undefined): number => {
  const amount = parseFloat(value ?? "0");
  return Number.isFinite(amount) ? amount : 0;
};

const formatMoney = (value: number): string => value.toFixed(2);

const sumBalancesByScope = (
  balances: BalanceRow[],
  scope: "CORE" | "PRODUCT"
): MoneySummary => {
  const filtered = balances.filter((row) => row.balance.scope === scope);
  const totalAmount = filtered.reduce(
    (sum, row) => sum + parseMoney(row.balance.totalAmount),
    0
  );
  const paidAmount = filtered.reduce(
    (sum, row) => sum + parseMoney(row.balance.paidAmount),
    0
  );

  return {
    totalAmount: formatMoney(totalAmount),
    paidAmount: formatMoney(paidAmount),
    pendingAmount: formatMoney(Math.max(totalAmount - paidAmount, 0)),
    count: filtered.length,
  };
};

const buildPaymentSummary = (
  client: NonNullable<Awaited<ReturnType<typeof getClientRowById>>>,
  balances: BalanceRow[]
) => {
  const core = sumBalancesByScope(balances, "CORE");
  const product = sumBalancesByScope(balances, "PRODUCT");

  const combinedTotal =
    parseMoney(core.totalAmount) + parseMoney(product.totalAmount);
  const combinedPaid =
    parseMoney(core.paidAmount) + parseMoney(product.paidAmount);

  return {
    overall: {
      totalAmount: client.totalAmount,
      paidAmount: client.paidAmount,
      pendingAmount: client.pendingAmount,
    },
    core,
    product,
    combined: {
      totalAmount: formatMoney(combinedTotal),
      paidAmount: formatMoney(combinedPaid),
      pendingAmount: formatMoney(Math.max(combinedTotal - combinedPaid, 0)),
    },
  };
};

const buildSalesWithPayments = (
  clientSales: Awaited<ReturnType<typeof getClientSales>>,
  balances: BalanceRow[]
) => {
  const coreBySaleId = new Map<string, BalanceRow>();
  for (const row of balances) {
    if (row.balance.scope !== "CORE" || !row.balance.saleId) continue;
    coreBySaleId.set(row.balance.saleId, row);
  }

  return clientSales.map((row) => {
    const coreBalance = coreBySaleId.get(row.sale.id);
    return {
      ...row.sale,
      saleType: row.saleType,
      corePayment: coreBalance
        ? {
            balanceId: coreBalance.balance.id,
            totalAmount: coreBalance.balance.totalAmount,
            paidAmount: coreBalance.balance.paidAmount,
            pendingAmount: coreBalance.balance.pendingAmount,
          }
        : {
            balanceId: null,
            totalAmount: "0.00",
            paidAmount: "0.00",
            pendingAmount: "0.00",
          },
    };
  });
};

const mapPayment = (
  row: Awaited<ReturnType<typeof getAmountsByClientId>>[number],
  invoicesByAmountId: Map<
    string,
    Awaited<ReturnType<typeof getInvoicesByAmountIds>>
  >,
  remarksByAmountId: Map<
    string,
    Awaited<ReturnType<typeof getRemarksByAmountIds>>
  >
) => ({
  ...row.payment,
  sale: row.sale,
  saleType: row.saleType,
  product: row.product,
  balance: row.balance,
  invoices: invoicesByAmountId.get(row.payment.id) ?? [],
  remarks: remarksByAmountId.get(row.payment.id) ?? [],
});

const buildClientPersonalDetails = async (
  client: NonNullable<Awaited<ReturnType<typeof getClientRowById>>>
) => {
  const [personRow, addresses, passports, familyMembers, coreValues] =
    await Promise.all([
      getPersonById(client.personId),
      getAddressesByPersonId(client.personId),
      getPassportsByPersonId(client.personId),
      getFamilyMembersByClientId(client.id),
      getClientCoreByClientId(client.id),
    ]);

  return {
    ...client,
    person: personRow
      ? {
          ...personRow.person,
          nationality: personRow.nationality,
        }
      : null,
    addresses: addresses.map((row) => ({
      ...row.address,
      country: row.country,
    })),
    passports: passports.map((row) => ({
      ...row.passport,
      country: row.country,
    })),
    familyMembers: familyMembers.map((row) => ({
      ...row.member,
      person: row.person,
    })),
    coreValues,
  };
};

const assemblePaymentPayload = async (clientUuid: string) => {
  const client = await getClientRowById(clientUuid);
  if (!client) return null;

  const [
    clientPersonal,
    clientSales,
    paymentBalances,
    payments,
    productTransactions,
    productEntities,
  ] = await Promise.all([
    buildClientPersonalDetails(client),
    getClientSales(clientUuid),
    getPaymentBalancesByClientId(clientUuid),
    getAmountsByClientId(clientUuid),
    getProductTransactionsByClientId(clientUuid),
    getProductEntitiesByClientId(clientUuid),
  ]);

  const amountIds = payments.map((row) => row.payment.id);
  const transactionIds = productTransactions.map((row) => row.transaction.id);

  const [invoices, remarksList, attributes] = await Promise.all([
    getInvoicesByAmountIds(amountIds),
    getRemarksByAmountIds(amountIds),
    getProductTransactionAttributes(transactionIds),
  ]);

  const invoicesByAmountId = new Map<string, typeof invoices>();
  for (const invoice of invoices) {
    if (!invoice.amountId) continue;
    const list = invoicesByAmountId.get(invoice.amountId) ?? [];
    list.push(invoice);
    invoicesByAmountId.set(invoice.amountId, list);
  }

  const remarksByAmountId = new Map<string, typeof remarksList>();
  for (const remark of remarksList) {
    const list = remarksByAmountId.get(remark.amountId) ?? [];
    list.push(remark);
    remarksByAmountId.set(remark.amountId, list);
  }

  const attributesByTransactionId = new Map<string, typeof attributes>();
  for (const attribute of attributes) {
    const list =
      attributesByTransactionId.get(attribute.productTransactionId) ?? [];
    list.push(attribute);
    attributesByTransactionId.set(attribute.productTransactionId, list);
  }

  const paymentsByBalanceId = new Map<string, ReturnType<typeof mapPayment>[]>();
  const mappedPayments = payments.map((row) => {
    const payment = mapPayment(row, invoicesByAmountId, remarksByAmountId);
    if (row.payment.balanceId) {
      const list = paymentsByBalanceId.get(row.payment.balanceId) ?? [];
      list.push(payment);
      paymentsByBalanceId.set(row.payment.balanceId, list);
    }
    return payment;
  });

  const paymentsByTransactionId = new Map<string, typeof mappedPayments>();
  for (const payment of mappedPayments) {
    if (payment.type !== "PRODUCT") continue;
    const list = paymentsByTransactionId.get(payment.amountId) ?? [];
    list.push(payment);
    paymentsByTransactionId.set(payment.amountId, list);
  }

  const coreBalances = paymentBalances.filter(
    (row) => row.balance.scope === "CORE"
  );
  const productBalances = paymentBalances.filter(
    (row) => row.balance.scope === "PRODUCT"
  );

  return {
    client: clientPersonal,
    summary: buildPaymentSummary(client, paymentBalances),
    sales: buildSalesWithPayments(clientSales, paymentBalances),
    core: {
      balances: coreBalances.map((row) => ({
        ...row.balance,
        sale: row.sale,
        saleType: row.saleType,
        payments: paymentsByBalanceId.get(row.balance.id) ?? [],
      })),
      payments: mappedPayments.filter((row) => row.type === "CORE"),
    },
    product: {
      balances: productBalances.map((row) => ({
        ...row.balance,
        product: row.product,
        payments: paymentsByBalanceId.get(row.balance.id) ?? [],
      })),
      transactions: productTransactions.map((row) => ({
        ...row.transaction,
        product: row.product,
        balance: row.balance,
        attributes: attributesByTransactionId.get(row.transaction.id) ?? [],
        payments: paymentsByTransactionId.get(row.transaction.id) ?? [],
      })),
      entities: productEntities,
      payments: mappedPayments.filter((row) => row.type === "PRODUCT"),
    },
    paymentBalances: paymentBalances.map((row) => ({
      ...row.balance,
      sale: row.sale,
      saleType: row.saleType,
      product: row.product,
      payments: paymentsByBalanceId.get(row.balance.id) ?? [],
    })),
    payments: mappedPayments,
    products: productTransactions.map((row) => ({
      ...row.transaction,
      product: row.product,
      balance: row.balance,
      attributes: attributesByTransactionId.get(row.transaction.id) ?? [],
      payments: paymentsByTransactionId.get(row.transaction.id) ?? [],
    })),
  };
};

export const getClientPaymentDetails = async (clientIdParam: string) => {
  const clientUuid = await resolveModuleClientId(clientIdParam);
  if (!clientUuid) return null;

  return assemblePaymentPayload(clientUuid);
};

export const getClientPaymentSummary = async (clientIdParam: string) => {
  const clientUuid = await resolveModuleClientId(clientIdParam);
  if (!clientUuid) return null;

  const client = await getClientRowById(clientUuid);
  if (!client) return null;

  const [clientPersonal, clientSales, paymentBalances] = await Promise.all([
    buildClientPersonalDetails(client),
    getClientSales(clientUuid),
    getPaymentBalancesByClientId(clientUuid),
  ]);

  return {
    client: {
      id: clientPersonal.id,
      legacyClientId: clientPersonal.legacyClientId,
      clientCode: clientPersonal.clientCode,
      enrollmentDate: clientPersonal.enrollmentDate,
      person: clientPersonal.person
        ? {
            fullName: clientPersonal.person.fullName,
            email: clientPersonal.person.email,
            phone: clientPersonal.person.phone,
            whatsappNumber: clientPersonal.person.whatsappNumber,
          }
        : null,
    },
    summary: buildPaymentSummary(client, paymentBalances),
    sales: buildSalesWithPayments(clientSales, paymentBalances),
  };
};

export const getClientProductEntities = async (clientIdParam: string) => {
  const clientUuid = await resolveModuleClientId(clientIdParam);
  if (!clientUuid) return null;

  const [client, entities] = await Promise.all([
    getClientRowById(clientUuid),
    getProductEntitiesByClientId(clientUuid),
  ]);

  if (!client) return null;

  return {
    clientId: client.id,
    legacyClientId: client.legacyClientId,
    clientCode: client.clientCode,
    entities,
  };
};
