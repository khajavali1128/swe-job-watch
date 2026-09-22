import { describe, expect, it } from "vitest";

import type { CompanyConfig } from "../src/config/index.js";
import { selectEnabledCompanies } from "../src/run-scope.js";

const companies: CompanyConfig[] = [
  {
    id: "apple-company",
    name: "Apple Company",
    enabled: true,
    adapter: "apple",
    handle: "apple",
  },
  {
    id: "avature-company",
    name: "Avature Company",
    enabled: true,
    adapter: "avature",
    handle: "careers",
    apiBaseUrl: "https://example.avature.net",
  },
  {
    id: "eightfold-company",
    name: "Eightfold Company",
    enabled: true,
    adapter: "eightfold",
    handle: "example.com",
    apiBaseUrl: "https://careers.example.com",
  },
  {
    id: "greenhouse-company",
    name: "Greenhouse Company",
    enabled: true,
    adapter: "greenhouse",
    handle: "greenhouse-company",
  },
  {
    id: "bytedance-company",
    name: "ByteDance Company",
    enabled: true,
    adapter: "bytedance",
    handle: "bytedance",
    apiBaseUrl: "https://jobs.bytedance.example/api/v1/public/supplier",
    careerBaseUrl: "https://careers.bytedance.example/search",
    websitePath: "en",
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
    id: "successfactors-company",
    name: "SuccessFactors Company",
    enabled: true,
    adapter: "successfactors",
    apiBaseUrl: "https://careers.example.com",
    searchPath: "/jobs/search/",
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
        "apple-company",
        "avature-company",
        "eightfold-company",
        "greenhouse-company",
        "bytedance-company",
        "oracle-company",
        "successfactors-company",
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
    expect(
      selectEnabledCompanies(companies, "apple,eightfold").map(({ id }) => id),
    ).toEqual(["apple-company", "eightfold-company"]);
    expect(selectEnabledCompanies(companies, "bytedance").map(({ id }) => id))
      .toEqual(["bytedance-company"]);
    expect(
      selectEnabledCompanies(companies, "successfactors").map(({ id }) => id),
    ).toEqual(["successfactors-company"]);
  });

  it("rejects unsupported adapter names", () => {
    expect(() => selectEnabledCompanies(companies, "oracle,unknown"))
      .toThrow("JOB_ADAPTERS contains unsupported adapters: unknown");
  });
});
