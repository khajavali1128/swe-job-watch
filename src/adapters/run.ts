import { createAdapter, isAdapterName } from "./registry.js";
import { loadConfig, type CompanyConfig } from "../config/index.js";

interface AdapterRunResult {
  company: string;
  companyId: string;
  jobs: number;
  newestPosting: string;
  sampleTitle: string;
  status: "PASS" | "EMPTY" | "FAIL";
  error: string;
}

async function main(): Promise<void> {
  const [adapterArgument, companyArgument] = process.argv.slice(2);
  const adapterName = adapterArgument?.trim().toLowerCase();

  if (!adapterName || adapterName === "--help" || adapterName === "-h") {
    printUsage();
    return;
  }

  if (!isAdapterName(adapterName)) {
    throw new Error(`Unknown adapter: ${adapterArgument}`);
  }

  const config = await loadConfig();
  const companySelector = companyArgument?.trim().toLowerCase();
  const companies = config.companies.filter((company) => {
    if (company.adapter !== adapterName) {
      return false;
    }

    if (!companySelector) {
      return company.enabled;
    }

    return company.id.toLowerCase() === companySelector ||
      company.name.toLowerCase() === companySelector;
  });

  if (companies.length === 0) {
    const suffix = companyArgument ? ` matching ${companyArgument}` : "";
    throw new Error(`No ${adapterName} companies${suffix} were found`);
  }

  const postedAfter = new Date(
    Date.now() - config.filters.freshness.lookbackHours * 60 * 60 * 1000,
  );
  const results: AdapterRunResult[] = [];

  console.log(
    `Running ${adapterName} independently for ${companies.length} compan${companies.length === 1 ? "y" : "ies"}...`,
  );

  for (const company of companies) {
    results.push(await runCompany(company, postedAfter));
  }

  console.table(results);

  if (results.some((result) => result.status === "FAIL")) {
    process.exitCode = 1;
  }
}

async function runCompany(
  company: CompanyConfig,
  postedAfter: Date,
): Promise<AdapterRunResult> {
  try {
    const summaries = await createAdapter(company).fetchJobSummaries(company, {
      postedAfter,
    });
    const newestPosting = summaries.reduce<Date | null>((newest, summary) => {
      if (!summary.postedAt || (newest && summary.postedAt <= newest)) {
        return newest;
      }

      return summary.postedAt;
    }, null);

    return {
      company: company.name,
      companyId: company.id,
      jobs: summaries.length,
      newestPosting: newestPosting?.toISOString() ?? "",
      sampleTitle: summaries[0]?.title ?? "",
      status: summaries.length > 0 ? "PASS" : "EMPTY",
      error: "",
    };
  } catch (error) {
    return {
      company: company.name,
      companyId: company.id,
      jobs: 0,
      newestPosting: "",
      sampleTitle: "",
      status: "FAIL",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function printUsage(): void {
  console.log("Usage: npm run adapter -- <adapter> [company-id-or-name]");
  console.log("Example: npm run adapter -- workday adobe");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
