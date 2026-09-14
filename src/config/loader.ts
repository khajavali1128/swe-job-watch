import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";

import {
  AppConfigSchema,
  CompaniesConfigSchema,
  FiltersConfigSchema,
  type AppConfig,
} from "./schema.js";

export async function loadConfig(
  configDir = path.join(process.cwd(), "config"),
): Promise<AppConfig> {
  const companiesPath = path.join(configDir, "companies.yaml");
  const filtersPath = path.join(configDir, "filters.yaml");

  const [companiesSource, filtersSource] = await Promise.all([
    readFile(companiesPath, "utf8"),
    readFile(filtersPath, "utf8"),
  ]);

  const companiesConfig = CompaniesConfigSchema.parse(parse(companiesSource));
  const filters = FiltersConfigSchema.parse(parse(filtersSource));

  return AppConfigSchema.parse({
    companies: companiesConfig.companies,
    filters,
  });
}
