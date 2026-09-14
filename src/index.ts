import { GreenhouseAdapter } from "./adapters/greenhouse.js";
import { LeverAdapter } from "./adapters/lever.js";
import { SmartRecruitersAdapter } from "./adapters/smartrecruiters.js";
import type { JobAdapter } from "./adapters/types.js";
import { validateJobWithGemini } from "./ai/job-validator.js";
import { loadConfig, type CompanyConfig } from "./config/index.js";
import { filterJobSummaries } from "./filters/job-summary-filter.js";
import {
  GoogleSheetsJobStore,
  type QualifiedJob,
} from "./sheets/google-sheets.js";

interface RunTotals {
  companies: number;
  summaries: number;
  cheapFilterMatches: number;
  qualified: number;
  rejected: number;
  failed: number;
}

async function main(): Promise<void> {
  const config = await loadConfig();
  const sheetStore = new GoogleSheetsJobStore();

  if (process.argv.includes("--check")) {
    await sheetStore.verifyConnection();
    console.log("Configuration and Google Sheets connection are valid");
    return;
  }

  const dryRun = process.env.DRY_RUN === "true";
  const companies = config.companies.filter((company) => company.enabled);
  const qualifiedJobs: QualifiedJob[] = [];
  const totals: RunTotals = {
    companies: companies.length,
    summaries: 0,
    cheapFilterMatches: 0,
    qualified: 0,
    rejected: 0,
    failed: 0,
  };

  console.log(`Processing ${companies.length} enabled companies...`);

  for (const company of companies) {
    console.log(`\n[${company.name}] Fetching open jobs...`);

    try {
      const adapter = createAdapter(company);
      const summaries = await adapter.fetchJobSummaries(company);
      const candidates = filterJobSummaries(summaries, config.filters);
      totals.summaries += summaries.length;
      totals.cheapFilterMatches += candidates.length;

      console.log(
        `[${company.name}] ${candidates.length}/${summaries.length} jobs passed cheap filters`,
      );

      for (const candidate of candidates) {
        try {
          const details = await adapter.fetchJobDetails(company, candidate);
          const validation = await validateJobWithGemini(
            details,
            config.filters,
          );

          if (validation.decision === "QUALIFIED") {
            qualifiedJobs.push({ job: details, validation });
            totals.qualified += 1;
            console.log(`[${company.name}] QUALIFIED: ${details.title}`);
          } else {
            totals.rejected += 1;
            console.log(`[${company.name}] REJECTED: ${details.title}`);
          }
        } catch (error) {
          totals.failed += 1;
          console.error(
            `[${company.name}] Job ${candidate.jobId} failed: ${errorMessage(error)}`,
          );
        }
      }
    } catch (error) {
      totals.failed += 1;
      console.error(`[${company.name}] Failed: ${errorMessage(error)}`);
    }
  }

  if (dryRun) {
    console.log(
      `\nDry run: ${qualifiedJobs.length} qualified jobs were not written`,
    );
  } else {
    const result = await sheetStore.appendQualifiedJobs(qualifiedJobs);
    console.log(
      `\nGoogle Sheets: appended ${result.appended}, skipped ${result.duplicates} duplicates`,
    );
  }

  console.log("\nRun summary:");
  console.table(totals);

  if (totals.failed > 0) {
    process.exitCode = 1;
  }
}

function createAdapter(company: CompanyConfig): JobAdapter {
  switch (company.adapter) {
    case "greenhouse":
      return new GreenhouseAdapter();
    case "lever":
      return new LeverAdapter();
    case "smartrecruiters":
      return new SmartRecruitersAdapter();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

main().catch((error: unknown) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
