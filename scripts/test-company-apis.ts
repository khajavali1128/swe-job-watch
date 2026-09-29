import { AppleAdapter } from "../src/adapters/apple.js";
import { AshbyAdapter } from "../src/adapters/ashby.js";
import { AvatureAdapter } from "../src/adapters/avature.js";
import { ByteDanceAdapter } from "../src/adapters/bytedance.js";
import { EightfoldAdapter } from "../src/adapters/eightfold.js";
import { GreenhouseAdapter } from "../src/adapters/greenhouse.js";
import { IcimsAdapter } from "../src/adapters/icims.js";
import { LeverAdapter } from "../src/adapters/lever.js";
import { OracleAdapter } from "../src/adapters/oracle.js";
import { SmartRecruitersAdapter } from "../src/adapters/smartrecruiters.js";
import { SuccessFactorsAdapter } from "../src/adapters/successfactors.js";
import { WorkdayAdapter } from "../src/adapters/workday.js";
import type { JobAdapter } from "../src/adapters/types.js";
import { loadConfig, type CompanyConfig } from "../src/config/index.js";
import type { JobSummary } from "../src/types.js";

type CheckStatus = "PASS" | "EMPTY" | "FAIL";

interface CompanyCheckResult {
  company: string;
  adapter: CompanyConfig["adapter"];
  enabled: boolean;
  status: CheckStatus;
  postings: number;
  sampleTitle: string;
  error: string;
}

async function checkCompany(
  company: CompanyConfig,
): Promise<CompanyCheckResult> {
  const label = `${company.name} (${company.adapter})`;
  process.stdout.write(`[${label}] Checking... `);

  try {
    const summaries = await createAdapter(company).fetchJobSummaries(company);

    if (summaries.length === 0) {
      console.log("EMPTY - API responded but returned no postings");
      return result(company, "EMPTY", summaries);
    }

    const invalidSummary = summaries.find((summary) =>
      !isUsableSummary(summary, company)
    );

    if (invalidSummary) {
      throw new Error(
        `returned a malformed normalized posting with job ID ${invalidSummary.jobId || "<missing>"}`,
      );
    }

    console.log(`PASS - ${summaries.length} postings`);
    return result(company, "PASS", summaries);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`FAIL - ${message}`);
    return result(company, "FAIL", [], message);
  }
}

function result(
  company: CompanyConfig,
  status: CheckStatus,
  summaries: JobSummary[],
  error = "",
): CompanyCheckResult {
  return {
    company: company.name,
    adapter: company.adapter,
    enabled: company.enabled,
    status,
    postings: summaries.length,
    sampleTitle: summaries[0]?.title ?? "",
    error,
  };
}

function isUsableSummary(
  summary: JobSummary,
  company: CompanyConfig,
): boolean {
  return (
    summary.companyId === company.id &&
    summary.companyName === company.name &&
    summary.source === company.adapter &&
    summary.jobId.trim().length > 0 &&
    summary.title.trim().length > 0 &&
    /^https?:\/\//i.test(summary.url)
  );
}

function createAdapter(company: CompanyConfig): JobAdapter {
  switch (company.adapter) {
    case "apple":
      return new AppleAdapter();
    case "ashby":
      return new AshbyAdapter();
    case "avature":
      return new AvatureAdapter();
    case "bytedance":
      return new ByteDanceAdapter();
    case "eightfold":
      return new EightfoldAdapter();
    case "greenhouse":
      return new GreenhouseAdapter();
    case "icims":
      return new IcimsAdapter();
    case "lever":
      return new LeverAdapter();
    case "oracle":
      return new OracleAdapter();
    case "smartrecruiters":
      return new SmartRecruitersAdapter();
    case "successfactors":
      return new SuccessFactorsAdapter();
    case "workday":
      return new WorkdayAdapter();
  }
}

async function main(): Promise<void> {
  const { companies } = await loadConfig();
  const companySelector = process.argv[2]?.trim().toLowerCase();
  const selectedCompanies = companySelector
    ? companies.filter(
        (company) =>
          company.id.toLowerCase() === companySelector ||
          company.name.toLowerCase() === companySelector,
      )
    : companies;

  if (selectedCompanies.length === 0) {
    throw new Error(`Unknown company: ${process.argv[2]}`);
  }

  const results: CompanyCheckResult[] = [];

  console.log(
    companySelector
      ? `Checking listing API for ${selectedCompanies[0].name}...\n`
      : `Checking listing APIs for all ${companies.length} configured companies...\n`,
  );

  for (const company of selectedCompanies) {
    results.push(await checkCompany(company));
  }

  const totals = results.reduce(
    (counts, check) => {
      counts[check.status] += 1;
      return counts;
    },
    { PASS: 0, EMPTY: 0, FAIL: 0 },
  );

  console.log("\nCompany API results:");
  console.table(results);
  console.log("\nSummary:");
  console.table(totals);

  if (totals.EMPTY > 0 || totals.FAIL > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
