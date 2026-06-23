import { alias } from "drizzle-orm/pg-core";
import { and, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from "drizzle-orm";
import { getDbSecond } from "../../../config/databaseConnectionSecond";
import { invalidateModulesCachesOnWrite } from "../../cache/invalidate";
import { clients } from "../../clients/schemas/client_convert.schema";
import { personModule } from "../../clients/schemas/person.schema";
import { clientPassport } from "../../clients/schemas/passport.schema";
import { countries } from "../../countries/schemas/countries.schema";
import { sales } from "../../sales/schemas/sale.schema";
import { saleTypes } from "../../sales/schemas/saleType.schema";
import { visaCategories } from "../../sales/schemas/visaCategories.schema";
import { visaCases } from "../schemas/visaCase.schema";
import { visaCaseStatusEvents } from "../schemas/visaCaseStatusEvent.schema";
import {
  DECISION_SUB_STATUS_TO_OUTCOME,
  isDecisionOutcomeFilter,
  assignedTeamsForFilter,
  toDisplayAssignedTeam,
} from "../constants/visaCase.constants";

const saleTypeCountries = alias(countries, "sale_type_countries");

/** One passport per person — avoids duplicate visa case rows when multiple passports exist. */
const primaryPassportNumber = sql<string | null>`(
  SELECT ${clientPassport.passportNumber}
  FROM ${clientPassport}
  WHERE ${clientPassport.personId} = ${personModule.id}
  ORDER BY ${clientPassport.updatedAt} DESC NULLS LAST, ${clientPassport.createdAt} DESC
  LIMIT 1
)`.as("passport_number");

export type VisaCaseListFilters = {
  fromDate?: string;
  toDate?: string;
  userId?: number;
  destinationCountryId?: string;
  /** Matches travel destination or sale type country */
  countryId?: string;
  currentStage?: string;
  currentSubStatus?: string;
  assignedTeam?: string;
  assignedUserId?: number;
  /** Current assignee or anyone in visa_case_assignments history */
  involvedUserId?: number;
  /** Counsellor-visible clients (modules legacy ids) */
  legacyClientIds?: number[];
  unassigned?: boolean;
  /** Modules DB sale_type.id (UUID) */
  saleTypeId?: string;
  /** Main CRM sale_type.id */
  legacySaleTypeId?: number;
  /** Visa category slug: visitor | spouse | student */
  visaCategory?: string;
  limit: number;
  offset: number;
};

export const getVisaCaseById = async (visaCaseId: string) => {
  const [row] = await getDbSecond()
    .select({
      visaCase: visaCases,
      client: clients,
      person: personModule,
      passportNumber: primaryPassportNumber,
      destinationCountry: {
        id: countries.id,
        name: countries.name,
        isoCode: countries.isoCode,
      },
      saleTypeCountry: {
        id: saleTypeCountries.id,
        name: saleTypeCountries.name,
        isoCode: saleTypeCountries.isoCode,
      },
      sale: sales,
      saleType: saleTypes,
      visaCategorySlug: visaCategories.slug,
    })
    .from(visaCases)
    .innerJoin(clients, eq(visaCases.clientId, clients.id))
    .innerJoin(personModule, eq(clients.personId, personModule.id))
    .leftJoin(countries, eq(visaCases.destinationCountryId, countries.id))
    .innerJoin(sales, eq(visaCases.saleId, sales.id))
    .innerJoin(saleTypes, eq(sales.saleTypeId, saleTypes.saleTypeId))
    .leftJoin(saleTypeCountries, eq(saleTypes.countryId, saleTypeCountries.id))
    .leftJoin(visaCategories, eq(saleTypes.visaCategoryId, visaCategories.id))
    .where(eq(visaCases.id, visaCaseId))
    .limit(1);

  return row ?? null;
};

export const getVisaCaseBySaleId = async (saleId: string) => {
  const [row] = await getDbSecond()
    .select()
    .from(visaCases)
    .where(eq(visaCases.saleId, saleId))
    .limit(1);

  return row ?? null;
};

const buildListConditions = (filters: VisaCaseListFilters): SQL[] => {
  const conditions: SQL[] = [];

  if (filters.fromDate) {
    conditions.push(gte(clients.enrollmentDate, filters.fromDate));
  }
  if (filters.toDate) {
    conditions.push(lte(clients.enrollmentDate, filters.toDate));
  }
  if (filters.userId != null) {
    conditions.push(eq(visaCases.userId, filters.userId));
  }
  if (filters.destinationCountryId) {
    conditions.push(
      eq(visaCases.destinationCountryId, filters.destinationCountryId)
    );
  }
  if (filters.countryId) {
    // Match the displayed country: travel destination, else sale type country.
    conditions.push(
      sql`coalesce(${visaCases.destinationCountryId}, ${saleTypes.countryId}) = ${filters.countryId}`
    );
  }
  if (filters.currentStage) {
    conditions.push(
      eq(
        visaCases.currentStage,
        filters.currentStage as (typeof visaCases.$inferSelect)["currentStage"]
      )
    );
  }
  if (filters.currentSubStatus) {
    if (isDecisionOutcomeFilter(filters.currentSubStatus)) {
      conditions.push(
        eq(
          visaCases.decision,
          DECISION_SUB_STATUS_TO_OUTCOME[filters.currentSubStatus]
        )
      );
    } else {
      conditions.push(
        eq(
          visaCases.currentSubStatus,
          filters.currentSubStatus as (typeof visaCases.$inferSelect)["currentSubStatus"]
        )
      );
    }
  }
  if (filters.assignedTeam) {
    const teams = assignedTeamsForFilter(filters.assignedTeam);
    if (teams?.length === 1) {
      conditions.push(
        eq(
          visaCases.assignedTeam,
          teams[0] as (typeof visaCases.$inferSelect)["assignedTeam"]
        )
      );
    } else if (teams && teams.length > 1) {
      conditions.push(
        inArray(
          visaCases.assignedTeam,
          teams as (typeof visaCases.$inferSelect)["assignedTeam"][]
        )
      );
    }
  }
  if (filters.assignedUserId != null) {
    conditions.push(eq(visaCases.assignedUserId, filters.assignedUserId));
  }
  if (filters.involvedUserId != null) {
    conditions.push(sql`(
      ${visaCases.assignedUserId} = ${filters.involvedUserId}
      OR EXISTS (
        SELECT 1 FROM visa_case_assignments a
        WHERE a.visa_case_id = ${visaCases.id}
          AND (
            a.assigned_user_id = ${filters.involvedUserId}
            OR a.previous_user_id = ${filters.involvedUserId}
          )
      )
    )`);
  }
  if (filters.legacyClientIds?.length) {
    conditions.push(inArray(clients.legacyClientId, filters.legacyClientIds));
  }
  if (filters.unassigned) {
    conditions.push(isNull(visaCases.assignedUserId));
  }
  if (filters.saleTypeId) {
    conditions.push(eq(sales.saleTypeId, filters.saleTypeId));
  }
  if (filters.legacySaleTypeId != null) {
    conditions.push(eq(saleTypes.legacySaleTypeId, filters.legacySaleTypeId));
  }
  if (filters.visaCategory) {
    conditions.push(eq(visaCategories.slug, filters.visaCategory));
  }

  return conditions;
};

const listVisaCasesBaseQuery = () =>
  getDbSecond()
    .select({ count: sql<number>`count(*)::int` })
    .from(visaCases)
    .innerJoin(clients, eq(visaCases.clientId, clients.id))
    .innerJoin(sales, eq(visaCases.saleId, sales.id))
    .innerJoin(saleTypes, eq(sales.saleTypeId, saleTypes.saleTypeId))
    .leftJoin(countries, eq(visaCases.destinationCountryId, countries.id))
    .leftJoin(saleTypeCountries, eq(saleTypes.countryId, saleTypeCountries.id))
    .leftJoin(visaCategories, eq(saleTypes.visaCategoryId, visaCategories.id));

export const listVisaCases = async (filters: VisaCaseListFilters) => {
  const conditions = buildListConditions(filters);
  const whereClause = conditions.length ? and(...conditions) : undefined;

  const rows = await getDbSecond()
    .select({
      visaCase: visaCases,
      client: clients,
      person: personModule,
      passportNumber: primaryPassportNumber,
      destinationCountry: {
        id: countries.id,
        name: countries.name,
        isoCode: countries.isoCode,
      },
      saleTypeCountry: {
        id: saleTypeCountries.id,
        name: saleTypeCountries.name,
        isoCode: saleTypeCountries.isoCode,
      },
      saleTypeId: saleTypes.saleTypeId,
      saleTypeName: saleTypes.saleType,
      legacySaleTypeId: saleTypes.legacySaleTypeId,
      visaCategorySlug: visaCategories.slug,
    })
    .from(visaCases)
    .innerJoin(clients, eq(visaCases.clientId, clients.id))
    .innerJoin(personModule, eq(clients.personId, personModule.id))
    .leftJoin(countries, eq(visaCases.destinationCountryId, countries.id))
    .innerJoin(sales, eq(visaCases.saleId, sales.id))
    .innerJoin(saleTypes, eq(sales.saleTypeId, saleTypes.saleTypeId))
    .leftJoin(saleTypeCountries, eq(saleTypes.countryId, saleTypeCountries.id))
    .leftJoin(visaCategories, eq(saleTypes.visaCategoryId, visaCategories.id))
    .where(whereClause)
    .orderBy(desc(visaCases.createdAt))
    .limit(filters.limit)
    .offset(filters.offset);

  const [countRow] = await listVisaCasesBaseQuery().where(whereClause);

  return {
    rows,
    total: countRow?.count ?? 0,
  };
};

export const insertVisaCase = async (values: typeof visaCases.$inferInsert) => {
  const [row] = await getDbSecond().insert(visaCases).values(values).returning();
  if (row) {
    await invalidateModulesCachesOnWrite({
      clientId: row.clientId,
      reason: "visa-case:created",
      visaCase: {
        id: row.id,
        clientId: row.clientId,
        assignedUserId: row.assignedUserId,
        assignedTeam: row.assignedTeam,
        currentStage: row.currentStage,
        currentSubStatus: row.currentSubStatus,
      },
    });
  }
  return row;
};

export const updateVisaCase = async (
  visaCaseId: string,
  patch: Partial<typeof visaCases.$inferInsert>
) => {
  const [row] = await getDbSecond()
    .update(visaCases)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(visaCases.id, visaCaseId))
    .returning();

  if (row) {
    await invalidateModulesCachesOnWrite({
      clientId: row.clientId,
      reason: "visa-case:updated",
      visaCase: {
        id: row.id,
        clientId: row.clientId,
        assignedUserId: row.assignedUserId,
        assignedTeam: row.assignedTeam,
        currentStage: row.currentStage,
        currentSubStatus: row.currentSubStatus,
      },
    });
  }

  return row ?? null;
};

export const insertVisaCaseStatusEvent = async (
  values: typeof visaCaseStatusEvents.$inferInsert
) => {
  const [row] = await getDbSecond()
    .insert(visaCaseStatusEvents)
    .values(values)
    .returning();

  return row;
};

export const listVisaCaseStatusEvents = async (visaCaseId: string) => {
  return getDbSecond()
    .select()
    .from(visaCaseStatusEvents)
    .where(eq(visaCaseStatusEvents.visaCaseId, visaCaseId))
    .orderBy(desc(visaCaseStatusEvents.changedAt));
};
