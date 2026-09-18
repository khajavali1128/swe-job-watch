import { AppleAdapter } from "./adapters/apple.js";
import { GreenhouseAdapter } from "./adapters/greenhouse.js";
import { AshbyAdapter } from "./adapters/ashby.js";
import { AvatureAdapter } from "./adapters/avature.js";
import { EightfoldAdapter } from "./adapters/eightfold.js";
import { LeverAdapter } from "./adapters/lever.js";
import { OracleAdapter } from "./adapters/oracle.js";
import { SmartRecruitersAdapter } from "./adapters/smartrecruiters.js";
import { WorkdayAdapter } from "./adapters/workday.js";
import { isUnavailableSourceError } from "./adapters/errors.js";
import type { JobAdapter } from "./adapters/types.js";
import { validateJob } from "./ai/job-validator.js";
import { loadConfig, type CompanyConfig } from "./config/index.js";
import { filterJobSummaries } from "./filters/job-summary-filter.js";
import { sendRunSummaryEmail } from "./email/run-summary.js";
import { selectEnabledCompanies } from "./run-scope.js";
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
  unavailableSources: number;
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
  const companies = selectEnabledCompanies(config.companies);
  const runName = process.env.JOB_WATCH_RUN_NAME?.trim() || "all adapters";
  const qualifiedJobs: QualifiedJob[] = [];
  const processedJobs: ProcessedJob[] = [];
  const alerts: string[] = [];
  const processedJobKeys = await sheetStore.loadProcessedJobKeys(!dryRun);
  const totals: RunTotals = {
    companies: companies.length,
    summaries: 0,
    cheapFilterMatches: 0,
    previouslyProcessed: 0,
    qualified: 0,
    rejected: 0,
    unavailableSources: 0,
    failed: 0,
  };

  console.log(
    `Processing ${companies.length} enabled companies for ${runName} (${processedJobKeys.size} jobs already processed)...`,
  );

  const runStartedAt = new Date();
  const postedAfter = new Date(
    runStartedAt.getTime() -
      config.filters.freshness.lookbackHours * 60 * 60 * 1000,
  );

  for (const company of companies) {
    console.log(`\n[${company.name}] Fetching open jobs...`);

    try {
      const adapter = createAdapter(company);
      const summaries = await adapter.fetchJobSummaries(company, {
        postedAfter,
      });
      const candidates = filterJobSummaries(
        summaries,
        config.filters,
        runStartedAt,
      );
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
          const isStillEligible = filterJobSummaries(
            [details],
            config.filters,
            runStartedAt,
          ).length > 0;

          if (!isStillEligible) {
            console.log(
              `[${company.name}] SKIPPED after detail verification: ${details.title}`,
            );
            continue;
          }

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
          alerts.push(
            `${company.name} job ${candidate.jobId} failed: ${errorMessage(error)}`,
          );
          console.error(
            `[${company.name}] Job ${candidate.jobId} failed: ${errorMessage(error)}`,
          );
        }
      }
    } catch (error) {
      if (isUnavailableSourceError(error)) {
        totals.unavailableSources += 1;
        alerts.push(
          `${company.name} source unavailable (${error.status}): ${error.message}`,
        );
        console.warn(
          `[${company.name}] Source unavailable (${error.status}); skipping: ${error.message}`,
        );
      } else {
        totals.failed += 1;
        alerts.push(`${company.name} source failed: ${errorMessage(error)}`);
        console.error(`[${company.name}] Failed: ${errorMessage(error)}`);
      }
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
      alerts,
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
    case "apple":
      return new AppleAdapter();
    case "ashby":
      return new AshbyAdapter();
    case "avature":
      return new AvatureAdapter();
    case "eightfold":
      return new EightfoldAdapter();
    case "greenhouse":
      return new GreenhouseAdapter();
    case "lever":
      return new LeverAdapter();
    case "oracle":
      return new OracleAdapter();
    case "smartrecruiters":
      return new SmartRecruitersAdapter();
    case "workday":
      return new WorkdayAdapter();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

main().catch((error: unknown) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
