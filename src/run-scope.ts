import type { CompanyConfig } from "./config/index.js";

const SUPPORTED_ADAPTERS = new Set<CompanyConfig["adapter"]>([
  "ashby",
  "greenhouse",
  "lever",
  "oracle",
  "smartrecruiters",
  "workday",
]);

export function selectEnabledCompanies(
  companies: CompanyConfig[],
  adapterList = process.env.JOB_ADAPTERS,
): CompanyConfig[] {
  const enabledCompanies = companies.filter((company) => company.enabled);

  if (!adapterList?.trim()) {
    return enabledCompanies;
  }

  const requestedAdapters = new Set(
    adapterList
      .split(",")
      .map((adapter) => adapter.trim().toLowerCase())
      .filter((adapter) => adapter.length > 0),
  );
  const unsupportedAdapters = [...requestedAdapters].filter(
    (adapter) => !SUPPORTED_ADAPTERS.has(adapter as CompanyConfig["adapter"]),
  );

  if (unsupportedAdapters.length > 0) {
    throw new Error(
      `JOB_ADAPTERS contains unsupported adapters: ${unsupportedAdapters.join(", ")}`,
    );
  }

  return enabledCompanies.filter((company) =>
    requestedAdapters.has(company.adapter)
  );
}
