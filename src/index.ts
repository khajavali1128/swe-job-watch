import { GreenhouseAdapter } from "./adapters/greenhouse.js";
import { AshbyAdapter } from "./adapters/ashby.js";
import { LeverAdapter } from "./adapters/lever.js";
import { SmartRecruitersAdapter } from "./adapters/smartrecruiters.js";
import type { JobAdapter } from "./adapters/types.js";
import { validateJob } from "./ai/job-validator.js";
import { loadConfig, type CompanyConfig } from "./config/index.js";
import { filterJobSummaries } from "./filters/job-summary-filter.js";
import { sendRunSummaryEmail } from "./email/run-summary.js";
import {
  GoogleSheetsJobStore,
  processedJobKey,
  type ProcessedJob,
  type QualifiedJob,
} from "./sheets/google-sheets.js";

interface RunTotals {
  companies: number;
  summaries: number;
  cheapFilterMatches: number;
  previouslyProcessed: number;
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
  const processedJobs: ProcessedJob[] = [];
  const processedJobKeys = await sheetStore.loadProcessedJobKeys(!dryRun);
  const totals: RunTotals = {
    companies: companies.length,
    summaries: 0,
    cheapFilterMatches: 0,
    previouslyProcessed: 0,
    qualified: 0,
    rejected: 0,
    failed: 0,
  };

  console.log(
    `Processing ${companies.length} enabled companies (${processedJobKeys.size} jobs already processed)...`,
  );

  for (const company of companies) {
    console.log(`\n[${company.name}] Fetching open jobs...`);

    try {
      const adapter = createAdapter(company);
      const summaries = await adapter.fetchJobSummaries(company);
      const candidates = filterJobSummaries(summaries, config.filters);
      const newCandidates = candidates.filter((candidate) => {
        const key = processedJobKey(candidate);

        if (processedJobKeys.has(key)) {
          return false;
        }

        processedJobKeys.add(key);
        return true;
      });
      totals.summaries += summaries.length;
      totals.cheapFilterMatches += candidates.length;
      totals.previouslyProcessed += candidates.length - newCandidates.length;

      console.log(
        `[${company.name}] ${candidates.length}/${summaries.length} jobs passed cheap filters; ${newCandidates.length} are new`,
      );

      for (const candidate of newCandidates) {
        try {
          const details = await adapter.fetchJobDetails(company, candidate);
          const validation = await validateJob(
            details,
            config.filters,
          );
          processedJobs.push({
            job: details,
            validation,
            processedAt: new Date(),
          });

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

  let appended = 0;
  let duplicates = 0;
  let processedRecorded = 0;

  if (dryRun) {
    console.log(
      `\nDry run: ${qualifiedJobs.length} qualified jobs were not written`,
    );
  } else {
    const result = await sheetStore.appendQualifiedJobs(qualifiedJobs);
    appended = result.appended;
    duplicates = result.duplicates;
    console.log(
      `\nGoogle Sheets: appended ${result.appended}, skipped ${result.duplicates} duplicates`,
    );
    const processedResult = await sheetStore.appendProcessedJobs(processedJobs);
    processedRecorded = processedResult.appended;
    console.log(
      `Processed Jobs: recorded ${processedResult.appended}, skipped ${processedResult.duplicates} duplicates`,
    );
  }

  console.log("\nRun summary:");
  console.table(totals);

  if (!dryRun) {
    const emailSent = await sendRunSummaryEmail({
      ...totals,
      appended,
      duplicates,
      processedRecorded,
    });

    if (emailSent) {
      console.log("Email summary sent");
    }
  }

  if (totals.failed > 0) {
    process.exitCode = 1;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

main().catch((error: unknown) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
