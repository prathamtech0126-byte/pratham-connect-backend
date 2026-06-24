import { getOrSetCache } from "../../cache/getOrSetCache";
import { MODULE_CACHE_KEYS, MODULE_CACHE_TTL } from "../../cache/keys";
import {
  getCountryById,
  listCountries,
  type CountryListFilters,
} from "../models/country.model";

const listKey = (filters: CountryListFilters) =>
  `${MODULE_CACHE_KEYS.COUNTRIES_LIST}${JSON.stringify(filters)}`;

export const getCachedCountries = (filters: CountryListFilters = {}) =>
  getOrSetCache(
    listKey(filters),
    MODULE_CACHE_TTL.COUNTRIES,
    () => listCountries(filters)
  );

export const getCachedCountry = (countryId: string) =>
  getOrSetCache(
    `${MODULE_CACHE_KEYS.COUNTRIES_DETAIL}${countryId}`,
    MODULE_CACHE_TTL.COUNTRIES,
    () => getCountryById(countryId)
  );
