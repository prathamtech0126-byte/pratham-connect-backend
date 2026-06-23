import {
  getCountryById,
  listCountries,
  type CountryListFilters,
} from "../models/country.model";

export const getCountries = async (filters: CountryListFilters = {}) => {
  return listCountries(filters);
};

export const getCountry = async (countryId: string) => {
  return getCountryById(countryId);
};
