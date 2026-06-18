import { desc, eq } from "drizzle-orm";
import {
  getDbSecond,
  isModulesDbConfigured,
} from "../../../config/databaseConnectionSecond";
import { countries } from "../../countries/schemas/countries.schema";
import { clients } from "../schemas/client_convert.schema";
import { clientPassport } from "../schemas/passport.schema";
import { personModule } from "../schemas/person.schema";

export type ClientPassportSummary = {
  id: string;
  passportNumber: string;
  passportType: string;
  passportExpiryDate: string;
  passportIssuingCountry: string;
  country: {
    id: string;
    name: string | null;
    isoCode: string | null;
  } | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

/** Latest passport for a main-CRM client — same source as visa case list/detail. */
export const getClientPassportByLegacyClientId = async (
  legacyClientId: number
): Promise<ClientPassportSummary | null> => {
  if (!isModulesDbConfigured() || !Number.isFinite(legacyClientId)) {
    return null;
  }

  const [row] = await getDbSecond()
    .select({
      passport: clientPassport,
      country: {
        id: countries.id,
        name: countries.name,
        isoCode: countries.isoCode,
      },
    })
    .from(clients)
    .innerJoin(personModule, eq(clients.personId, personModule.id))
    .innerJoin(clientPassport, eq(clientPassport.personId, personModule.id))
    .leftJoin(countries, eq(clientPassport.countryId, countries.id))
    .where(eq(clients.legacyClientId, legacyClientId))
    .orderBy(desc(clientPassport.updatedAt), desc(clientPassport.createdAt))
    .limit(1);

  if (!row) return null;

  return {
    id: row.passport.id,
    passportNumber: row.passport.passportNumber,
    passportType: row.passport.passportType,
    passportExpiryDate: row.passport.passportExpiryDate,
    passportIssuingCountry: row.passport.passportIssuingCountry,
    country: row.country?.id ? row.country : null,
    createdAt: row.passport.createdAt,
    updatedAt: row.passport.updatedAt,
  };
};

export const enrichClientDetailsWithModulesPassport = async <T extends Record<string, unknown>>(
  data: T
): Promise<T & { passport: ClientPassportSummary | null }> => {
  const clientId = Number((data.client as { clientId?: number } | undefined)?.clientId);
  const client = data.client as
    | { clientId?: number; passportDetails?: string }
    | undefined;

  if (!Number.isFinite(clientId) || !client) {
    return { ...data, passport: null };
  }

  const passport = await getClientPassportByLegacyClientId(clientId);
  const passportNumber = passport?.passportNumber ?? client.passportDetails ?? null;

  return {
    ...data,
    client: {
      ...client,
      passportDetails: passportNumber ?? client.passportDetails,
      passportNumber,
    },
    passport,
  };
};
