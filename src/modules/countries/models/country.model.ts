import { and, asc, eq } from "drizzle-orm";
import { getDbSecond } from "../../../config/databaseConnectionSecond";
import { countries } from "../schemas/countries.schema";

export type CountryListFilters = {
  isActive?: boolean;
};

export const listCountries = async (filters: CountryListFilters = {}) => {
  const isActive = filters.isActive ?? true;

  return getDbSecond()
    .select({
      id: countries.id,
      name: countries.name,
      isoCode: countries.isoCode,
      isActive: countries.isActive,
      createdAt: countries.createdAt,
      updatedAt: countries.updatedAt,
    })
    .from(countries)
    .where(and(eq(countries.isActive, isActive)))
    .orderBy(asc(countries.name));
};

export const getCountryById = async (countryId: string) => {
  const [row] = await getDbSecond()
    .select({
      id: countries.id,
      name: countries.name,
      isoCode: countries.isoCode,
      isActive: countries.isActive,
      createdAt: countries.createdAt,
      updatedAt: countries.updatedAt,
    })
    .from(countries)
    .where(eq(countries.id, countryId))
    .limit(1);

  return row ?? null;
};
