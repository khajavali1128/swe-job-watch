import { GreenhouseAdapter } from "../src/adapters/greenhouse.js";
import { AshbyAdapter } from "../src/adapters/ashby.js";
import { LeverAdapter } from "../src/adapters/lever.js";
import { SmartRecruitersAdapter } from "../src/adapters/smartrecruiters.js";
import type { JobAdapter } from "../src/adapters/types.js";
import { validateJob } from "../src/ai/job-validator.js";
import {
  loadConfig,
  type CompanyConfig,
  type FiltersConfig,
} from "../src/config/index.js";
import { filterJobSummaries } from "../src/filters/job-summary-filter.js";

type TestStatus =
  | "qualified"
  | "rejected"
  | "no-match"
  | "failed";

interface TestTotals {
  qualified: number;
  rejected: number;
  "no-match": number;
  failed: number;
}

async function testCompany(
  company: CompanyConfig,
  filters: FiltersConfig,
  requestedJobId?: string,
): Promise<TestStatus> {
  console.log(`\n[${company.name}] Starting workflow test`);

  try {
    const adapter = createAdapter(company);
    const summaries = await adapter.fetchJobSummaries(company);
    console.log(`[${company.name}] Found ${summaries.length} open jobs`);

    const filteredSummaries = filterJobSummaries(summaries, filters);
    console.log(
      `[${company.name}] ${filteredSummaries.length} jobs survived cheap filters`,
    );

    const selectedJob = requestedJobId
      ? filteredSummaries.find((job) => job.jobId === requestedJobId)
      : filteredSummaries[0];

    if (!selectedJob) {
      const reason = requestedJobId
        ? `job ${requestedJobId} was not found or did not pass cheap filters`
        : "no jobs passed cheap filters";
      console.log(`[${company.name}] No Gemini call: ${reason}`);
      return "no-match";
    }

    console.log(`[${company.name}] Selected`, {
      jobId: selectedJob.jobId,
      title: selectedJob.title,
      location: selectedJob.location,
      postedAt: selectedJob.postedAt,
      url: selectedJob.url,
    });

    const details = await adapter.fetchJobDetails(company, selectedJob);
    console.log(`[${company.name}] Validating with AI...`);
    const validation = await validateJob(details, filters);

    console.log(
      JSON.stringify(
        {
          job: {
            company: details.companyName,
            jobId: details.jobId,
            title: details.title,
            location: details.location,
            url: details.url,
            descriptionLength: details.description.length,
          },
          validation,
        },
        null,
        2,
      ),
    );

    return validation.decision === "QUALIFIED" ? "qualified" : "rejected";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${company.name}] Failed: ${message}`);
    return "failed";
  }
}

function createAdapter(company: CompanyConfig): JobAdapter {
  switch (company.adapter) {
    case "ashby":
      return new AshbyAdapter();
    case "greenhouse":
      return new GreenhouseAdapter();
    case "lever":
      return new LeverAdapter();
    case "smartrecruiters":
      return new SmartRecruitersAdapter();
  }
}

async function main(): Promise<void> {
  const companyQuery = process.argv[2] ?? "all";
  const requestedJobId = process.argv[3];
  const config = await loadConfig();

  if (companyQuery.toLowerCase() !== "all") {
    const normalizedQuery = companyQuery.toLowerCase();
    const company = config.companies.find(
      (candidate) =>
        candidate.enabled &&
        (candidate.id.toLowerCase() === normalizedQuery ||
          candidate.name.toLowerCase() === normalizedQuery),
    );

    if (!company) {
      throw new Error(`No enabled company found for: ${companyQuery}`);
    }

    const status = await testCompany(
      company,
      config.filters,
      requestedJobId,
    );

    if (status === "failed") {
      process.exitCode = 1;
    }

    return;
  }

  if (requestedJobId) {
    throw new Error("A job ID can only be used with a single company");
  }

  const enabledCompanies = config.companies.filter(
    (company) => company.enabled,
  );
  const totals: TestTotals = {
    qualified: 0,
    rejected: 0,
    "no-match": 0,
    failed: 0,
  };

  console.log(`Testing ${enabledCompanies.length} enabled companies...`);

  for (const company of enabledCompanies) {
    const status = await testCompany(company, config.filters);
    totals[status] += 1;
  }

  console.log("\nWorkflow test summary:");
  console.table(totals);

  if (totals.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
