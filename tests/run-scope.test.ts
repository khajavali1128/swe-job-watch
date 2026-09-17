import { describe, expect, it } from "vitest";

import type { CompanyConfig } from "../src/config/index.js";
import { selectEnabledCompanies } from "../src/run-scope.js";

const companies: CompanyConfig[] = [
  {
    id: "avature-company",
    name: "Avature Company",
    enabled: true,
    adapter: "avature",
    handle: "careers",
    apiBaseUrl: "https://example.avature.net",
  },
  {
    id: "greenhouse-company",
    name: "Greenhouse Company",
    enabled: true,
    adapter: "greenhouse",
    handle: "greenhouse-company",
  },
  {
    id: "oracle-company",
    name: "Oracle Company",
    enabled: true,
    adapter: "oracle",
    handle: "careers",
    apiBaseUrl: "https://example.oraclecloud.com",
    siteNumber: "CX_1",
    publicJobBaseUrl: "https://example.oraclecloud.com/jobs",
  },
  {
    id: "disabled-workday-company",
    name: "Disabled Workday Company",
    enabled: false,
    adapter: "workday",
    handle: "careers",
    apiBaseUrl: "https://example.myworkdayjobs.com",
    tenant: "example",
  },
];

describe("selectEnabledCompanies", () => {
  it("returns every enabled company when no adapter scope is configured", () => {
    expect(selectEnabledCompanies(companies, undefined).map(({ id }) => id))
      .toEqual([
        "avature-company",
        "greenhouse-company",
        "oracle-company",
      ]);
  });

  it("selects only enabled companies using requested adapters", () => {
    expect(
      selectEnabledCompanies(companies, " GREENHOUSE, oracle ").map(
        ({ id }) => id,
      ),
    ).toEqual(["greenhouse-company", "oracle-company"]);
    expect(selectEnabledCompanies(companies, "workday")).toEqual([]);
    expect(selectEnabledCompanies(companies, "avature").map(({ id }) => id))
      .toEqual(["avature-company"]);
  });

  it("rejects unsupported adapter names", () => {
    expect(() => selectEnabledCompanies(companies, "oracle,unknown"))
      .toThrow("JOB_ADAPTERS contains unsupported adapters: unknown");
  });
});
