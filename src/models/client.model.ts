import { db } from "../config/databaseConnection";
import pool from "../config/databaseConnection";
import { clientInformation } from "../schemas/clientInformation.schema";
import { clientPayments } from "../schemas/clientPayment.schema";
import { clientProductPayments } from "../schemas/clientProductPayments.schema";
import { users } from "../schemas/users.schema";
import { eq, desc, inArray, and } from "drizzle-orm";
import { Request, Response } from "express";
import { getPaymentsByClientId } from "./clientPayment.model";
import { getProductPaymentsByClientId } from "./clientProductPayments.model";
import { leadTypes } from "../schemas/leadType.schema";
import { saleTypes } from "../schemas/saleType.schema";
import { parseFrontendDate } from "../utils/date";

/* ==============================
   TYPES
============================== */
interface SaveClientInput {
  clientId?: number; // 👈 optional → if present, update
  fullName: string;
  enrollmentDate: string;
  passportDetails: string;
  leadTypeId: number;
}

/* ==============================
   HELPER: Format date to DD-MM-YYYY
============================== */
const formatDateToDDMMYYYY = (date: string | Date | null | undefined): string | null => {
  if (!date) return null;

  try {
    const dateObj = typeof date === 'string' ? new Date(date) : date;

    // Check if date is valid
    if (isNaN(dateObj.getTime())) {
      return null;
    }

    const day = String(dateObj.getDate()).padStart(2, '0');
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const year = dateObj.getFullYear();

    return `${day}-${month}-${year}`;
  } catch (error) {
    return null;
  }
};

/**
 * Get year and short month from enrollment date (for grouping by enrollment, not createdAt).
 * Handles DB date string (YYYY-MM-DD) or Date. Use for list grouping so clients show under correct month.
 */
const getEnrollmentYearMonth = (enrollmentDate: string | Date | null | undefined): { year: string; month: string } | null => {
  if (!enrollmentDate) return null;
  try {
    // PostgreSQL date column is often "YYYY-MM-DD"; Date object also supported
    const s = typeof enrollmentDate === "string" ? enrollmentDate.trim() : enrollmentDate.toISOString().split("T")[0];
    const [y, m] = s.split("-");
    if (!y || !m) return null;
    const monthNum = parseInt(m, 10);
    if (monthNum < 1 || monthNum > 12) return null;
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return { year: y, month: monthNames[monthNum - 1] };
  } catch {
    return null;
  }
};

/* ==============================
   CREATE CLIENT
============================== */
export const saveClient = async (
  data: SaveClientInput,
  counsellorId: number
) => {
  // Normalize clientId - convert string to number if needed
  const clientId = data.clientId ? Number(data.clientId) : undefined;
  const { fullName, enrollmentDate, passportDetails, leadTypeId } = data;

  if (!fullName || !enrollmentDate || !passportDetails || !leadTypeId) {
    throw new Error("All fields are required");
  }

  // Frontend sends DD-MM-YYYY; normalize to YYYY-MM-DD for DB
  const normalizedEnrollmentDate = parseFrontendDate(enrollmentDate);
  if (!normalizedEnrollmentDate) {
    throw new Error("Invalid enrollmentDate format (use DD-MM-YYYY or YYYY-MM-DD)");
  }

  // Validate and normalize passportDetails
  const trimmedPassportDetails = passportDetails.trim();
  if (trimmedPassportDetails.length === 0) {
    throw new Error("passportDetails cannot be empty");
  }

  // Validate numeric fields
  const normalizedLeadTypeId = Number(leadTypeId);

  if (!Number.isFinite(normalizedLeadTypeId) || normalizedLeadTypeId <= 0) {
    throw new Error("Invalid leadTypeId");
  }

  // 🔍 validate counsellor
  const counsellor = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, counsellorId));

  if (!counsellor.length) {
    throw new Error("Invalid counsellor");
  }

  // 🔍 validate lead type
  const leadType = await db
    .select({ id: leadTypes.id })
    .from(leadTypes)
    .where(eq(leadTypes.id, normalizedLeadTypeId));

  if (!leadType.length) {
    throw new Error("Invalid lead type");
  }

  /* ==========================
     UPSERT CLIENT (with IS DISTINCT FROM check)
  ========================== */
  const trimmedFullName = fullName.trim();

  // If clientId is provided, validate it exists first
  if (clientId && Number.isFinite(clientId) && clientId > 0) {
    const existingClient = await db
      .select({ id: clientInformation.clientId, passportDetails: clientInformation.passportDetails })
      .from(clientInformation)
      .where(eq(clientInformation.clientId, clientId));

    if (!existingClient.length) {
      throw new Error("Client not found");
    }

    // Check for duplicate passportDetails if updating (exclude current client)
    if (existingClient[0].passportDetails !== trimmedPassportDetails) {
      const [duplicateCheck] = await db
        .select({ id: clientInformation.clientId })
        .from(clientInformation)
        .where(eq(clientInformation.passportDetails, trimmedPassportDetails))
        .limit(1);

      if (duplicateCheck) {
        throw new Error(`Passport details "${trimmedPassportDetails}" already exists. Please use a different passport details.`);
      }
    }
  } else {
    // Check for duplicate passportDetails when creating new client
    const [duplicateCheck] = await db
      .select({ id: clientInformation.clientId })
      .from(clientInformation)
      .where(eq(clientInformation.passportDetails, trimmedPassportDetails))
      .limit(1);

    if (duplicateCheck) {
      throw new Error(`Passport details "${trimmedPassportDetails}" already exists. Please use a different passport details.`);
    }
  }

  // Use UPSERT with IS DISTINCT FROM to only update when data actually changes
  // If clientId is provided, use it; otherwise let PostgreSQL generate it
  const upsertQuery = clientId && Number.isFinite(clientId) && clientId > 0
    ? `
      INSERT INTO client_information (
        id, counsellor_id, fullname, date, passport_details, lead_type_id
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (id) DO UPDATE SET
        counsellor_id = EXCLUDED.counsellor_id,
        fullname = EXCLUDED.fullname,
        date = EXCLUDED.date,
        passport_details = EXCLUDED.passport_details,
        lead_type_id = EXCLUDED.lead_type_id
      WHERE (
        client_information.fullname IS DISTINCT FROM EXCLUDED.fullname
        OR client_information.date IS DISTINCT FROM EXCLUDED.date
        OR client_information.passport_details IS DISTINCT FROM EXCLUDED.passport_details
        OR client_information.lead_type_id IS DISTINCT FROM EXCLUDED.lead_type_id
      )
      RETURNING id, counsellor_id, fullname, date, passport_details, lead_type_id;
    `
    : `
      INSERT INTO client_information (
        counsellor_id, fullname, date, passport_details, lead_type_id
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING id, counsellor_id, fullname, date, passport_details, lead_type_id;
    `;

  const values = clientId && Number.isFinite(clientId) && clientId > 0
    ? [clientId, counsellorId, trimmedFullName, normalizedEnrollmentDate, trimmedPassportDetails, normalizedLeadTypeId]
    : [counsellorId, trimmedFullName, normalizedEnrollmentDate, trimmedPassportDetails, normalizedLeadTypeId];

  const result = await pool.query(upsertQuery, values);
  const rowCount = result.rowCount || 0;
  const row = result.rows[0];

  if (!row) {
    throw new Error("Failed to save client");
  }

  // Determine action based on rowCount and whether it's a new record
  // rowCount === 0: No changes (data was identical) - treat as no-op
  // rowCount === 1: Real insert or real update happened
  const isNewRecord = !clientId || !Number.isFinite(clientId) || clientId <= 0;
  const action = isNewRecord ? "CREATED" : (rowCount > 0 ? "UPDATED" : "NO_CHANGE");

  return {
    action,
    client: {
      clientId: row.id,
      counsellorId: row.counsellor_id,
      fullName: row.fullname,
      enrollmentDate: row.date,
      passportDetails: row.passport_details,
      leadTypeId: row.lead_type_id,
    },
    rowCount, // Include rowCount so controller can check if real change occurred
  };
};

/* ==============================
   UPDATE CLIENT ARCHIVE STATUS
============================== */
export const updateClientArchiveStatus = async (
  clientId: number,
  archived: boolean
) => {
  // Check if client exists
  const [existingClient] = await db
    .select({
      clientId: clientInformation.clientId,
      counsellorId: clientInformation.counsellorId,
      archived: clientInformation.archived,
    })
    .from(clientInformation)
    .where(eq(clientInformation.clientId, clientId))
    .limit(1);

  if (!existingClient) {
    throw new Error("Client not found");
  }

  // Update archived status
  const [updatedClient] = await db
    .update(clientInformation)
    .set({
      archived: archived,
    })
    .where(eq(clientInformation.clientId, clientId))
    .returning({
      clientId: clientInformation.clientId,
      counsellorId: clientInformation.counsellorId,
      fullName: clientInformation.fullName,
      enrollmentDate: clientInformation.enrollmentDate,
      passportDetails: clientInformation.passportDetails,
      leadTypeId: clientInformation.leadTypeId,
      archived: clientInformation.archived,
      createdAt: clientInformation.createdAt,
    });

  return {
    action: archived ? "ARCHIVED" : "UNARCHIVED",
    client: updatedClient,
    oldValue: {
      archived: existingClient.archived,
    },
    newValue: {
      archived: updatedClient.archived,
    },
  };
};

// get client full details by id
export const getClientFullDetailsById = async (clientId: number) => {
  // 1. Get client info
  const [client] = await db
    .select()
    .from(clientInformation)
    .where(eq(clientInformation.clientId, clientId));

  if (!client) return null;

  // 2. Get lead type
  const [leadType] = await db
    .select()
    .from(leadTypes)
    .where(eq(leadTypes.id, client.leadTypeId));

  if (!leadType) return null;

  // 3. Get enhanced product payments with entity data
  const productPayments = await getProductPaymentsByClientId(clientId);

  // 4. Client payments (always fetch)
  // const payments = await db
  //   .select()
  //   .from(clientPayments)
  //   .where(eq(clientPayments.clientId, clientId));

  const payments = await db
  .select({
    paymentId: clientPayments.paymentId,
    clientId: clientPayments.clientId,
    totalPayment: clientPayments.totalPayment,
    stage: clientPayments.stage,
    amount: clientPayments.amount,
    paymentDate: clientPayments.paymentDate,
    invoiceNo: clientPayments.invoiceNo,
    remarks: clientPayments.remarks,
    saleType: {
      id: saleTypes.saleTypeId,
      saleType: saleTypes.saleType,
      isCoreProduct: saleTypes.isCoreProduct,
      amount: saleTypes.amount,
    },
    createdAt: clientPayments.createdAt,
  })
    .from(clientPayments)
    .leftJoin(saleTypes, eq(clientPayments.saleTypeId, saleTypes.saleTypeId))
    .where(eq(clientPayments.clientId, clientId))
    .orderBy(desc(clientPayments.paymentDate));

  return {
    client,
    leadType: {
      id: leadType.id,
      leadType: leadType.leadType,
    },
    payments: payments,
    productPayments: productPayments,
  };
};

// get all clients by counsellor (exclude archived)
export const getClientsByCounsellor = async (counsellorId: number) => {
  const clients = await db
    .select()
    .from(clientInformation)
    .where(and(eq(clientInformation.counsellorId, counsellorId), eq(clientInformation.archived, false)))
    .orderBy(desc(clientInformation.enrollmentDate));

  // Get counsellor information (id, name, designation)
  const counsellorData = await db
    .select({
      id: users.id,
      name: users.fullName,
      designation: users.designation,
    })
    .from(users)
    .where(eq(users.id, counsellorId))
    .limit(1);

  const counsellor = counsellorData.length > 0 ? {
    id: counsellorData[0].id,
    name: counsellorData[0].name,
    designation: counsellorData[0].designation || null,
  } : null;

  // Get lead types for all clients - fetch all unique leadTypeIds
  const uniqueLeadTypeIds = [...new Set(clients.map(client => client.leadTypeId))];
  const leadTypesData = uniqueLeadTypeIds.length > 0 ? await db
    .select()
    .from(leadTypes)
    .where(inArray(leadTypes.id, uniqueLeadTypeIds))
    : [];

  // Fetch payments and product payments for each client
  const clientsWithDetails = await Promise.all(
    clients.map(async (client) => {
      try {
        const payments = await getPaymentsByClientId(client.clientId);
        const productPayments = await getProductPaymentsByClientId(client.clientId);

        // Get lead type for this client
        const leadType = leadTypesData.find(lt => lt.id === client.leadTypeId);

        const enrollmentYearMonth = getEnrollmentYearMonth(client.enrollmentDate);
        return {
          ...client,
          enrollmentDate: formatDateToDDMMYYYY(client.enrollmentDate),
          enrollmentYear: enrollmentYearMonth?.year ?? null,
          enrollmentMonth: enrollmentYearMonth?.month ?? null,
          counsellor: counsellor,
          leadType: leadType ? {
            id: leadType.id,
            leadType: leadType.leadType,
          } : null,
          payments: payments,
          productPayments: productPayments || [],
        };
      } catch (error) {
        // Return client with empty arrays if there's an error
        const leadType = leadTypesData.find(lt => lt.id === client.leadTypeId);
        const enrollmentYearMonth = getEnrollmentYearMonth(client.enrollmentDate);
        return {
          ...client,
          enrollmentDate: formatDateToDDMMYYYY(client.enrollmentDate),
          enrollmentYear: enrollmentYearMonth?.year ?? null,
          enrollmentMonth: enrollmentYearMonth?.month ?? null,
          counsellor: counsellor,
          leadType: leadType ? {
            id: leadType.id,
            leadType: leadType.leadType,
          } : null,
          payments: [],
          productPayments: [],
        };
      }
    })
  );

  // Group clients by enrollment date (year/month) so clients show under correct month, not current
  const groupedClients: { [year: string]: { [month: string]: { clients: any[], total: number } } } = {};

  clientsWithDetails.forEach(client => {
    const year = (client as any).enrollmentYear;
    const month = (client as any).enrollmentMonth;
    if (!year || !month) return;

    if (!groupedClients[year]) {
      groupedClients[year] = {};
    }

    if (!groupedClients[year][month]) {
      groupedClients[year][month] = {
        clients: [],
        total: 0
      };
    }

    groupedClients[year][month].clients.push(client);
    groupedClients[year][month].total++;
  });

  // Sort years: descending (newest first: 2026 → 2025 → 2024)
  const currentYear = new Date().getFullYear().toString();
  const sortedYears = Object.keys(groupedClients).sort((a, b) => {
    return parseInt(b) - parseInt(a); // descending order (newest first)
  });

  // Sort months within each year: current month first, then chronological
  const currentDate = new Date();
  const currentMonth = currentDate.toLocaleString('default', { month: 'short' });
  const currentMonthIndex = currentDate.getMonth(); // 0-11 (Jan=0, Feb=1, etc.)
  const monthOrder = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const result: { [year: string]: { [month: string]: { clients: any[], total: number } } } = {};

  sortedYears.forEach(year => {
    result[year] = {};
    const months = Object.keys(groupedClients[year]);

    // Sort months: current month first, then chronological order
    months.sort((a, b) => {
      // For current year, put current month first
      if (year === currentYear) {
        const aIndex = monthOrder.indexOf(a);
        const bIndex = monthOrder.indexOf(b);

        // Current month comes first
        if (a === currentMonth) return -1;
        if (b === currentMonth) return 1;

        // Other months in chronological order from current month onwards
        const aFromCurrent = (aIndex - currentMonthIndex + 12) % 12;
        const bFromCurrent = (bIndex - currentMonthIndex + 12) % 12;

        return aFromCurrent - bFromCurrent;
      }

      // For other years, use normal chronological order
      return monthOrder.indexOf(a) - monthOrder.indexOf(b);
    });

    months.forEach(month => {
      result[year][month] = groupedClients[year][month];
    });
  });

  return result;
};


/* ==============================
   GET ALL COUNSELLOR IDs FROM ALL CLIENTS
============================== */
export const getAllCounsellorIds = async () => {
  // Get all counsellor IDs from all clients
  const clients = await db
    .select({ counsellorId: clientInformation.counsellorId })
    .from(clientInformation);

  // Extract unique counsellor IDs
  const uniqueCounsellorIds = [
    ...new Set(clients.map((client) => client.counsellorId)),
  ];

  return uniqueCounsellorIds;
};

/* ==============================
   GET ALL CLIENTS FOR MANAGER (FROM THEIR COUNSELLORS)
   Returns: { [counsellorId]: { counsellor: {...}, clients: { [year]: { [month]: {...} } } } }
============================== */
export const getAllClientsForManager = async (managerId: number) => {
  // Get all counsellors assigned to this manager
  const managerCounsellors = await db
    .select({
      id: users.id,
    })
    .from(users)
    .where(and(eq(users.role, "counsellor"), eq(users.managerId, managerId)));

  if (managerCounsellors.length === 0) {
    return {};
  }

  const counsellorIds = managerCounsellors.map(c => c.id);

  // Get all clients from these counsellors (exclude archived)
  const allClients = await db
    .select()
    .from(clientInformation)
    .where(and(inArray(clientInformation.counsellorId, counsellorIds), eq(clientInformation.archived, false)))
    .orderBy(desc(clientInformation.enrollmentDate));

  if (allClients.length === 0) {
    return {};
  }

  // Get all counsellors info
  const counsellorsData = await db
    .select({
      id: users.id,
      name: users.fullName,
      designation: users.designation,
    })
    .from(users)
    .where(inArray(users.id, counsellorIds));

  // Create counsellor map
  const counsellorMap = new Map(
    counsellorsData.map(c => [c.id, { id: c.id, name: c.name, designation: c.designation || null }])
  );

  const uniqueLeadTypeIds = [...new Set(allClients.map(client => client.leadTypeId))];
  const leadTypesData = uniqueLeadTypeIds.length > 0 ? await db
    .select()
    .from(leadTypes)
    .where(inArray(leadTypes.id, uniqueLeadTypeIds))
    : [];

  // Group clients by counsellor first
  const clientsByCounsellor = new Map<number, typeof allClients>();
  allClients.forEach(client => {
    if (!clientsByCounsellor.has(client.counsellorId)) {
      clientsByCounsellor.set(client.counsellorId, []);
    }
    clientsByCounsellor.get(client.counsellorId)!.push(client);
  });

  // Process each counsellor's clients
  const result: { [counsellorId: string]: { counsellor: any, clients: any } } = {};

  await Promise.all(
    Array.from(clientsByCounsellor.entries()).map(async ([counsellorId, counsellorClients]) => {
      // Get counsellor info
      const counsellor = counsellorMap.get(counsellorId) || null;

      // Fetch payments and product payments for each client in this counsellor's group
      const clientsWithDetails = await Promise.all(
        counsellorClients.map(async (client) => {
          try {
            const payments = await getPaymentsByClientId(client.clientId);
            const productPayments = await getProductPaymentsByClientId(client.clientId);

            const leadType = leadTypesData.find(lt => lt.id === client.leadTypeId);
            const enrollmentYearMonth = getEnrollmentYearMonth(client.enrollmentDate);

            return {
              ...client,
              enrollmentDate: formatDateToDDMMYYYY(client.enrollmentDate),
              enrollmentYear: enrollmentYearMonth?.year ?? null,
              enrollmentMonth: enrollmentYearMonth?.month ?? null,
              counsellor: counsellor,
              leadType: leadType ? {
                id: leadType.id,
                leadType: leadType.leadType,
              } : null,
              payments: payments,
              productPayments: productPayments || [],
            };
          } catch (error) {
            const leadType = leadTypesData.find(lt => lt.id === client.leadTypeId);
            const enrollmentYearMonth = getEnrollmentYearMonth(client.enrollmentDate);
            return {
              ...client,
              enrollmentDate: formatDateToDDMMYYYY(client.enrollmentDate),
              enrollmentYear: enrollmentYearMonth?.year ?? null,
              enrollmentMonth: enrollmentYearMonth?.month ?? null,
              counsellor: counsellor,
              leadType: leadType ? {
                id: leadType.id,
                leadType: leadType.leadType,
              } : null,
              payments: [],
              productPayments: [],
            };
          }
        })
      );

      // Group by enrollment date (year/month) so clients show under correct month
      const groupedClients: { [year: string]: { [month: string]: { clients: any[], total: number } } } = {};
      clientsWithDetails.forEach(client => {
        const year = (client as any).enrollmentYear;
        const month = (client as any).enrollmentMonth;
        if (!year || !month) return;
        if (!groupedClients[year]) groupedClients[year] = {};
        if (!groupedClients[year][month]) groupedClients[year][month] = { clients: [], total: 0 };
        groupedClients[year][month].clients.push(client);
        groupedClients[year][month].total++;
      });

      // Sort years: descending (newest first: 2026 → 2025 → 2024)
      const currentYear = new Date().getFullYear().toString();
      const sortedYears = Object.keys(groupedClients).sort((a, b) => {
        return parseInt(b) - parseInt(a); // descending order (newest first)
      });

      // Sort months within each year
      const currentDate = new Date();
      const currentMonth = currentDate.toLocaleString('default', { month: 'short' });
      const currentMonthIndex = currentDate.getMonth();
      const monthOrder = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

      const sortedClients: { [year: string]: { [month: string]: { clients: any[], total: number } } } = {};

      sortedYears.forEach(year => {
        sortedClients[year] = {};
        const months = Object.keys(groupedClients[year]);

        months.sort((a, b) => {
          if (year === currentYear) {
            const aIndex = monthOrder.indexOf(a);
            const bIndex = monthOrder.indexOf(b);

            if (a === currentMonth) return -1;
            if (b === currentMonth) return 1;

            const aFromCurrent = (aIndex - currentMonthIndex + 12) % 12;
            const bFromCurrent = (bIndex - currentMonthIndex + 12) % 12;

            return aFromCurrent - bFromCurrent;
          }

          return monthOrder.indexOf(a) - monthOrder.indexOf(b);
        });

        months.forEach(month => {
          sortedClients[year][month] = groupedClients[year][month];
        });
      });

      // Store result for this counsellor
      result[counsellorId.toString()] = {
        counsellor: counsellor,
        clients: sortedClients,
      };
    })
  );

  return result;
};

// Get all clients
export const  getAllClients = async () => {
  const allClients = await db
    .select()
    .from(clientInformation)
    .where(eq(clientInformation.archived, false))
    .orderBy(desc(clientInformation.enrollmentDate));
  return allClients;
};

export const updateClientCounsellor = async (clientId: number, counsellorId: number) => {
  const result = await db
    .update(clientInformation)
    .set({ counsellorId: counsellorId })
    .where(eq(clientInformation.clientId, clientId))
    .returning({ clientId: clientInformation.clientId, counsellorId: clientInformation.counsellorId });
  return result;
};

/* ==============================
   GET ALL CLIENTS FOR ADMIN (ALL COUNSELLORS)
   Returns: { [counsellorId]: { counsellor: {...}, clients: { [year]: { [month]: {...} } } } }
============================== */
export const getAllClientsForAdmin = async () => {
  // Get all clients from all counsellors (exclude archived)
  const allClients = await db
    .select()
    .from(clientInformation)
    .where(eq(clientInformation.archived, false))
    .orderBy(desc(clientInformation.enrollmentDate));

  if (allClients.length === 0) {
    return {};
  }

  // Get all unique counsellor IDs
  const uniqueCounsellorIds = [...new Set(allClients.map(client => client.counsellorId))];

  // Get all counsellors info
  const counsellorsData = uniqueCounsellorIds.length > 0 ? await db
    .select({
      id: users.id,
      name: users.fullName,
      isSupervisor: users.isSupervisor,
      role: users.role,
      designation: users.designation,
    })
    .from(users)
    .where(inArray(users.id, uniqueCounsellorIds))
    : [];

  // Create counsellor map
  const counsellorMap = new Map(
    counsellorsData.map(c => [c.id, { id: c.id, name: c.name, designation: c.designation, isSupervisor: c.isSupervisor, role: c.role || null }])
  );

  const uniqueLeadTypeIds = [...new Set(allClients.map(client => client.leadTypeId))];
  const leadTypesData = uniqueLeadTypeIds.length > 0 ? await db
    .select()
    .from(leadTypes)
    .where(inArray(leadTypes.id, uniqueLeadTypeIds))
    : [];

  // Group clients by counsellor first
  const clientsByCounsellor = new Map<number, typeof allClients>();
  allClients.forEach(client => {
    if (!clientsByCounsellor.has(client.counsellorId)) {
      clientsByCounsellor.set(client.counsellorId, []);
    }
    clientsByCounsellor.get(client.counsellorId)!.push(client);
  });

  // Process each counsellor's clients
  const result: { [counsellorId: string]: { counsellor: any, clients: any } } = {};

  await Promise.all(
    Array.from(clientsByCounsellor.entries()).map(async ([counsellorId, counsellorClients]) => {
      // Get counsellor info
      const counsellor = counsellorMap.get(counsellorId) || null;

      // Fetch payments and product payments for each client in this counsellor's group
      const clientsWithDetails = await Promise.all(
        counsellorClients.map(async (client) => {
          try {
            const payments = await getPaymentsByClientId(client.clientId);
            const productPayments = await getProductPaymentsByClientId(client.clientId);

            const leadType = leadTypesData.find(lt => lt.id === client.leadTypeId);
            const enrollmentYearMonth = getEnrollmentYearMonth(client.enrollmentDate);

            return {
              ...client,
              enrollmentDate: formatDateToDDMMYYYY(client.enrollmentDate),
              enrollmentYear: enrollmentYearMonth?.year ?? null,
              enrollmentMonth: enrollmentYearMonth?.month ?? null,
              counsellor: counsellor,
              leadType: leadType ? {
                id: leadType.id,
                leadType: leadType.leadType,
              } : null,
              payments: payments,
              productPayments: productPayments || [],
            };
          } catch (error) {
            const leadType = leadTypesData.find(lt => lt.id === client.leadTypeId);
            const enrollmentYearMonth = getEnrollmentYearMonth(client.enrollmentDate);
            return {
              ...client,
              enrollmentDate: formatDateToDDMMYYYY(client.enrollmentDate),
              enrollmentYear: enrollmentYearMonth?.year ?? null,
              enrollmentMonth: enrollmentYearMonth?.month ?? null,
              counsellor: counsellor,
              leadType: leadType ? {
                id: leadType.id,
                leadType: leadType.leadType,
              } : null,
              payments: [],
              productPayments: [],
            };
          }
        })
      );

      // Group by enrollment date (year/month) so clients show under correct month
      const groupedClients: { [year: string]: { [month: string]: { clients: any[], total: number } } } = {};
      clientsWithDetails.forEach(client => {
        const year = (client as any).enrollmentYear;
        const month = (client as any).enrollmentMonth;
        if (!year || !month) return;
        if (!groupedClients[year]) groupedClients[year] = {};
        if (!groupedClients[year][month]) groupedClients[year][month] = { clients: [], total: 0 };
        groupedClients[year][month].clients.push(client);
        groupedClients[year][month].total++;
      });

      // Sort years: descending (newest first: 2026 → 2025 → 2024)
      const currentYear = new Date().getFullYear().toString();
      const sortedYears = Object.keys(groupedClients).sort((a, b) => {
        return parseInt(b) - parseInt(a); // descending order (newest first)
      });

      // Sort months within each year
      const currentDate = new Date();
      const currentMonth = currentDate.toLocaleString('default', { month: 'short' });
      const currentMonthIndex = currentDate.getMonth();
      const monthOrder = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

      const sortedClients: { [year: string]: { [month: string]: { clients: any[], total: number } } } = {};

      sortedYears.forEach(year => {
        sortedClients[year] = {};
        const months = Object.keys(groupedClients[year]);

        months.sort((a, b) => {
          if (year === currentYear) {
            const aIndex = monthOrder.indexOf(a);
            const bIndex = monthOrder.indexOf(b);

            if (a === currentMonth) return -1;
            if (b === currentMonth) return 1;

            const aFromCurrent = (aIndex - currentMonthIndex + 12) % 12;
            const bFromCurrent = (bIndex - currentMonthIndex + 12) % 12;

            return aFromCurrent - bFromCurrent;
          }

          return monthOrder.indexOf(a) - monthOrder.indexOf(b);
        });

        months.forEach(month => {
          sortedClients[year][month] = groupedClients[year][month];
        });
      });

      // Store result for this counsellor
      result[counsellorId.toString()] = {
        counsellor: counsellor,
        clients: sortedClients,
      };
    })
  );

  return result;
};

/* ==============================
   GET ARCHIVED CLIENTS BY COUNSELLOR
   Returns: { [year]: { [month]: { clients: any[], total: number } } }
============================== */
export const getArchivedClientsByCounsellor = async (counsellorId: number) => {
  // Get only archived clients for this counsellor
  const clients = await db
    .select()
    .from(clientInformation)
    .where(and(eq(clientInformation.counsellorId, counsellorId), eq(clientInformation.archived, true)))
    .orderBy(desc(clientInformation.enrollmentDate));

  // Get counsellor information
  const counsellorData = await db
    .select({
      id: users.id,
      name: users.fullName,
      designation: users.designation,
    })
    .from(users)
    .where(eq(users.id, counsellorId))
    .limit(1);

  const counsellor = counsellorData.length > 0 ? {
    id: counsellorData[0].id,
    name: counsellorData[0].name,
    designation: counsellorData[0].designation || null,
  } : null;

  const uniqueLeadTypeIds = [...new Set(clients.map(client => client.leadTypeId))];
  const leadTypesData = uniqueLeadTypeIds.length > 0 ? await db
    .select()
    .from(leadTypes)
    .where(inArray(leadTypes.id, uniqueLeadTypeIds))
    : [];

  // Fetch payments and product payments for each client
  const clientsWithDetails = await Promise.all(
    clients.map(async (client) => {
      const enrollmentYearMonth = getEnrollmentYearMonth(client.enrollmentDate);
      try {
        const payments = await getPaymentsByClientId(client.clientId);
        const productPayments = await getProductPaymentsByClientId(client.clientId);

        const leadType = leadTypesData.find(lt => lt.id === client.leadTypeId);

        return {
          ...client,
          enrollmentDate: formatDateToDDMMYYYY(client.enrollmentDate),
          enrollmentYear: enrollmentYearMonth?.year ?? null,
          enrollmentMonth: enrollmentYearMonth?.month ?? null,
          counsellor: counsellor,
          leadType: leadType ? {
            id: leadType.id,
            leadType: leadType.leadType,
          } : null,
          payments: payments,
          productPayments: productPayments || [],
        };
      } catch (error) {
        const leadType = leadTypesData.find(lt => lt.id === client.leadTypeId);
            return {
              ...client,
              enrollmentDate: formatDateToDDMMYYYY(client.enrollmentDate),
              enrollmentYear: enrollmentYearMonth?.year ?? null,
              enrollmentMonth: enrollmentYearMonth?.month ?? null,
              counsellor: counsellor,
              leadType: leadType ? {
                id: leadType.id,
                leadType: leadType.leadType,
              } : null,
              payments: [],
              productPayments: [],
            };
      }
    })
  );

  // Group clients by enrollment year and month (use explicit fields, not parsed date)
  const groupedClients: { [year: string]: { [month: string]: { clients: any[], total: number } } } = {};

  clientsWithDetails.forEach(client => {
    const year = (client as any).enrollmentYear;
    const month = (client as any).enrollmentMonth;
    if (!year || !month) return;

    if (!groupedClients[year]) {
      groupedClients[year] = {};
    }

    if (!groupedClients[year][month]) {
      groupedClients[year][month] = {
        clients: [],
        total: 0
      };
    }

    groupedClients[year][month].clients.push(client);
    groupedClients[year][month].total++;
  });

  // Sort years: descending (newest first: 2026 → 2025 → 2024)
  const currentYear = new Date().getFullYear().toString();
  const sortedYears = Object.keys(groupedClients).sort((a, b) => {
    return parseInt(b) - parseInt(a); // descending order (newest first)
  });

  // Sort months within each year: current month first, then chronological
  const currentDate = new Date();
  const currentMonth = currentDate.toLocaleString('default', { month: 'short' });
  const currentMonthIndex = currentDate.getMonth();
  const monthOrder = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const result: { [year: string]: { [month: string]: { clients: any[], total: number } } } = {};

  sortedYears.forEach(year => {
    result[year] = {};
    const months = Object.keys(groupedClients[year]);

    months.sort((a, b) => {
      if (year === currentYear) {
        const aIndex = monthOrder.indexOf(a);
        const bIndex = monthOrder.indexOf(b);

        if (a === currentMonth) return -1;
        if (b === currentMonth) return 1;

        const aFromCurrent = (aIndex - currentMonthIndex + 12) % 12;
        const bFromCurrent = (bIndex - currentMonthIndex + 12) % 12;

        return aFromCurrent - bFromCurrent;
      }

      return monthOrder.indexOf(a) - monthOrder.indexOf(b);
    });

    months.forEach(month => {
      result[year][month] = groupedClients[year][month];
    });
  });

  return result;
};

/* ==============================
   GET ALL ARCHIVED CLIENTS FOR MANAGER (FROM THEIR COUNSELLORS)
   Returns: { [counsellorId]: { counsellor: {...}, clients: { [year]: { [month]: {...} } } } }
============================== */
export const getAllArchivedClientsForManager = async (managerId: number) => {
  // Get all counsellors assigned to this manager
  const managerCounsellors = await db
    .select({
      id: users.id,
    })
    .from(users)
    .where(and(eq(users.role, "counsellor"), eq(users.managerId, managerId)));

  if (managerCounsellors.length === 0) {
    return {};
  }

  const counsellorIds = managerCounsellors.map(c => c.id);

  // Get only archived clients from these counsellors
  const allClients = await db
    .select()
    .from(clientInformation)
    .where(and(inArray(clientInformation.counsellorId, counsellorIds), eq(clientInformation.archived, true)))
    .orderBy(desc(clientInformation.enrollmentDate));

  if (allClients.length === 0) {
    return {};
  }

  // Get all counsellors info
  const counsellorsData = await db
    .select({
      id: users.id,
      name: users.fullName,
      isSupervisor: users.isSupervisor,
      role: users.role,
      designation: users.designation,
    })
    .from(users)
    .where(inArray(users.id, counsellorIds));

  // Create counsellor map
  const counsellorMap = new Map(
    counsellorsData.map(c => [c.id, { id: c.id, name: c.name, designation: c.designation, isSupervisor: c.isSupervisor, role: c.role || null }])
  );

  const uniqueLeadTypeIds = [...new Set(allClients.map(client => client.leadTypeId))];
  const leadTypesData = uniqueLeadTypeIds.length > 0 ? await db
    .select()
    .from(leadTypes)
    .where(inArray(leadTypes.id, uniqueLeadTypeIds))
    : [];

  // Group clients by counsellor first
  const clientsByCounsellor = new Map<number, typeof allClients>();
  allClients.forEach(client => {
    if (!clientsByCounsellor.has(client.counsellorId)) {
      clientsByCounsellor.set(client.counsellorId, []);
    }
    clientsByCounsellor.get(client.counsellorId)!.push(client);
  });

  // Process each counsellor's clients
  const result: { [counsellorId: string]: { counsellor: any, clients: any } } = {};

  await Promise.all(
    Array.from(clientsByCounsellor.entries()).map(async ([counsellorId, counsellorClients]) => {
      const counsellor = counsellorMap.get(counsellorId) || null;

      const clientsWithDetails = await Promise.all(
        counsellorClients.map(async (client) => {
          const enrollmentYearMonth = getEnrollmentYearMonth(client.enrollmentDate);
          try {
            const payments = await getPaymentsByClientId(client.clientId);
            const productPayments = await getProductPaymentsByClientId(client.clientId);

            const leadType = leadTypesData.find(lt => lt.id === client.leadTypeId);

            return {
              ...client,
              enrollmentDate: formatDateToDDMMYYYY(client.enrollmentDate),
              enrollmentYear: enrollmentYearMonth?.year ?? null,
              enrollmentMonth: enrollmentYearMonth?.month ?? null,
              counsellor: counsellor,
              leadType: leadType ? {
                id: leadType.id,
                leadType: leadType.leadType,
              } : null,
              payments: payments,
              productPayments: productPayments || [],
            };
          } catch (error) {
            const leadType = leadTypesData.find(lt => lt.id === client.leadTypeId);
            return {
              ...client,
              enrollmentDate: formatDateToDDMMYYYY(client.enrollmentDate),
              enrollmentYear: enrollmentYearMonth?.year ?? null,
              enrollmentMonth: enrollmentYearMonth?.month ?? null,
              counsellor: counsellor,
              leadType: leadType ? {
                id: leadType.id,
                leadType: leadType.leadType,
              } : null,
              payments: [],
              productPayments: [],
            };
          }
        })
      );

      // Group by enrollment year and month (use explicit fields)
      const groupedClients: { [year: string]: { [month: string]: { clients: any[], total: number } } } = {};

      clientsWithDetails.forEach(client => {
        const year = (client as any).enrollmentYear;
        const month = (client as any).enrollmentMonth;
        if (!year || !month) return;

        if (!groupedClients[year]) {
          groupedClients[year] = {};
        }

        if (!groupedClients[year][month]) {
          groupedClients[year][month] = {
            clients: [],
            total: 0
          };
        }

        groupedClients[year][month].clients.push(client);
        groupedClients[year][month].total++;
      });

      // Sort years: descending (newest first)
      const currentYear = new Date().getFullYear().toString();
      const sortedYears = Object.keys(groupedClients).sort((a, b) => {
        return parseInt(b) - parseInt(a);
      });

      // Sort months
      const currentDate = new Date();
      const currentMonth = currentDate.toLocaleString('default', { month: 'short' });
      const currentMonthIndex = currentDate.getMonth();
      const monthOrder = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

      const sortedClients: { [year: string]: { [month: string]: { clients: any[], total: number } } } = {};

      sortedYears.forEach(year => {
        sortedClients[year] = {};
        const months = Object.keys(groupedClients[year]);

        months.sort((a, b) => {
          if (year === currentYear) {
            const aIndex = monthOrder.indexOf(a);
            const bIndex = monthOrder.indexOf(b);

            if (a === currentMonth) return -1;
            if (b === currentMonth) return 1;

            const aFromCurrent = (aIndex - currentMonthIndex + 12) % 12;
            const bFromCurrent = (bIndex - currentMonthIndex + 12) % 12;

            return aFromCurrent - bFromCurrent;
          }

          return monthOrder.indexOf(a) - monthOrder.indexOf(b);
        });

        months.forEach(month => {
          sortedClients[year][month] = groupedClients[year][month];
        });
      });

      result[counsellorId.toString()] = {
        counsellor: counsellor,
        clients: sortedClients,
      };
    })
  );

  return result;
};

/* ==============================
   GET ALL ARCHIVED CLIENTS FOR ADMIN (ALL COUNSELLORS)
   Returns: { [counsellorId]: { counsellor: {...}, clients: { [year]: { [month]: {...} } } } }
============================== */
export const getAllArchivedClientsForAdmin = async () => {
  // Get all archived clients from all counsellors
  const allClients = await db
    .select()
    .from(clientInformation)
    .where(eq(clientInformation.archived, true))
    .orderBy(desc(clientInformation.enrollmentDate));

  if (allClients.length === 0) {
    return {};
  }

  // Get all unique counsellor IDs
  const uniqueCounsellorIds = [...new Set(allClients.map(client => client.counsellorId))];

  // Get all counsellors info
  const counsellorsData = uniqueCounsellorIds.length > 0 ? await db
    .select({
      id: users.id,
      name: users.fullName,
      isSupervisor: users.isSupervisor,
      role: users.role,
      designation: users.designation,
    })
    .from(users)
    .where(inArray(users.id, uniqueCounsellorIds))
    : [];

  // Create counsellor map
  const counsellorMap = new Map(
    counsellorsData.map(c => [c.id, { id: c.id, name: c.name, designation: c.designation, isSupervisor: c.isSupervisor, role: c.role || null }])
  );

  const uniqueLeadTypeIds = [...new Set(allClients.map(client => client.leadTypeId))];
  const leadTypesData = uniqueLeadTypeIds.length > 0 ? await db
    .select()
    .from(leadTypes)
    .where(inArray(leadTypes.id, uniqueLeadTypeIds))
    : [];

  // Group clients by counsellor first
  const clientsByCounsellor = new Map<number, typeof allClients>();
  allClients.forEach(client => {
    if (!clientsByCounsellor.has(client.counsellorId)) {
      clientsByCounsellor.set(client.counsellorId, []);
    }
    clientsByCounsellor.get(client.counsellorId)!.push(client);
  });

  // Process each counsellor's clients
  const result: { [counsellorId: string]: { counsellor: any, clients: any } } = {};

  await Promise.all(
    Array.from(clientsByCounsellor.entries()).map(async ([counsellorId, counsellorClients]) => {
      const counsellor = counsellorMap.get(counsellorId) || null;

      const clientsWithDetails = await Promise.all(
        counsellorClients.map(async (client) => {
          const enrollmentYearMonth = getEnrollmentYearMonth(client.enrollmentDate);
          try {
            const payments = await getPaymentsByClientId(client.clientId);
            const productPayments = await getProductPaymentsByClientId(client.clientId);

            const leadType = leadTypesData.find(lt => lt.id === client.leadTypeId);

            return {
              ...client,
              enrollmentDate: formatDateToDDMMYYYY(client.enrollmentDate),
              enrollmentYear: enrollmentYearMonth?.year ?? null,
              enrollmentMonth: enrollmentYearMonth?.month ?? null,
              counsellor: counsellor,
              leadType: leadType ? {
                id: leadType.id,
                leadType: leadType.leadType,
              } : null,
              payments: payments,
              productPayments: productPayments || [],
            };
          } catch (error) {
            const leadType = leadTypesData.find(lt => lt.id === client.leadTypeId);
            return {
              ...client,
              enrollmentDate: formatDateToDDMMYYYY(client.enrollmentDate),
              enrollmentYear: enrollmentYearMonth?.year ?? null,
              enrollmentMonth: enrollmentYearMonth?.month ?? null,
              counsellor: counsellor,
              leadType: leadType ? {
                id: leadType.id,
                leadType: leadType.leadType,
              } : null,
              payments: [],
              productPayments: [],
            };
          }
        })
      );

      // Group by enrollment year and month (use explicit fields)
      const groupedClients: { [year: string]: { [month: string]: { clients: any[], total: number } } } = {};

      clientsWithDetails.forEach(client => {
        const year = (client as any).enrollmentYear;
        const month = (client as any).enrollmentMonth;
        if (!year || !month) return;

        if (!groupedClients[year]) {
          groupedClients[year] = {};
        }

        if (!groupedClients[year][month]) {
          groupedClients[year][month] = {
            clients: [],
            total: 0
          };
        }

        groupedClients[year][month].clients.push(client);
        groupedClients[year][month].total++;
      });

      // Sort years: descending (newest first)
      const currentYear = new Date().getFullYear().toString();
      const sortedYears = Object.keys(groupedClients).sort((a, b) => {
        return parseInt(b) - parseInt(a);
      });

      // Sort months
      const currentDate = new Date();
      const currentMonth = currentDate.toLocaleString('default', { month: 'short' });
      const currentMonthIndex = currentDate.getMonth();
      const monthOrder = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

      const sortedClients: { [year: string]: { [month: string]: { clients: any[], total: number } } } = {};

      sortedYears.forEach(year => {
        sortedClients[year] = {};
        const months = Object.keys(groupedClients[year]);

        months.sort((a, b) => {
          if (year === currentYear) {
            const aIndex = monthOrder.indexOf(a);
            const bIndex = monthOrder.indexOf(b);

            if (a === currentMonth) return -1;
            if (b === currentMonth) return 1;

            const aFromCurrent = (aIndex - currentMonthIndex + 12) % 12;
            const bFromCurrent = (bIndex - currentMonthIndex + 12) % 12;

            return aFromCurrent - bFromCurrent;
          }

          return monthOrder.indexOf(a) - monthOrder.indexOf(b);
        });

        months.forEach(month => {
          sortedClients[year][month] = groupedClients[year][month];
        });
      });

      result[counsellorId.toString()] = {
        counsellor: counsellor,
        clients: sortedClients,
      };
    })
  );

  return result;
};
