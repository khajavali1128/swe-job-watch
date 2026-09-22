import type { CompanyConfig } from "../config/index.js";
import type { JobDetails, JobSummary } from "../types.js";
import { AdapterHttpError } from "./errors.js";
import type { JobAdapter } from "./types.js";

type AshbyCompanyConfig = Extract<CompanyConfig, { adapter: "ashby" }>;

interface AshbySecondaryLocation {
  location?: string | null;
}

interface AshbyJob {
  id: string | number;
  title: string;
  location?: string | null;
  secondaryLocations?: Array<AshbySecondaryLocation | string> | null;
  publishedAt?: string | null;
  isListed?: boolean;
  isRemote?: boolean;
  workplaceType?: string | null;
  jobUrl: string;
  descriptionPlain?: string | null;
  descriptionHtml?: string | null;
}

interface AshbyJobBoardResponse {
  jobs: AshbyJob[];
}

const ASHBY_BASE_URL = "https://api.ashbyhq.com/posting-api/job-board";

export class AshbyAdapter implements JobAdapter {
  private readonly jobCache = new Map<string, AshbyJob>();

  async fetchJobSummaries(company: CompanyConfig): Promise<JobSummary[]> {
    this.assertAshbyCompany(company);

    const jobs = await this.fetchBoard(company);

    return jobs
      .filter((job) => job.isListed !== false)
      .map((job) => this.normalizeSummary(company, job));
  }

  async fetchJobDetails(
    company: CompanyConfig,
    job: JobSummary,
  ): Promise<JobDetails> {
    this.assertAshbyCompany(company);

    let ashbyJob = this.jobCache.get(cacheKey(company.id, job.jobId));

    if (!ashbyJob) {
      const jobs = await this.fetchBoard(company);
      ashbyJob = jobs.find((candidate) => String(candidate.id) === job.jobId);
    }

    if (!ashbyJob) {
      throw new Error(
        `Ashby job ${job.jobId} was not found for ${company.name}`,
      );
    }

    return {
      ...job,
      description:
        ashbyJob.descriptionPlain ?? ashbyJob.descriptionHtml ?? "",
    };
  }

  private async fetchBoard(company: AshbyCompanyConfig): Promise<AshbyJob[]> {
    const url = `${ASHBY_BASE_URL}/${encodeURIComponent(company.handle)}`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new AdapterHttpError(
        "Ashby",
        company.name,
        response.status,
        response.statusText,
      );
    }

    const data = (await response.json()) as Partial<AshbyJobBoardResponse>;

    if (!Array.isArray(data.jobs)) {
      throw new Error(
        `Ashby returned an invalid job board response for ${company.name}: jobs must be an array`,
      );
    }

    for (const job of data.jobs) {
      assertValidJob(company, job);
      this.jobCache.set(cacheKey(company.id, String(job.id)), job);
    }

    return data.jobs;
  }

  private normalizeSummary(
    company: AshbyCompanyConfig,
    job: AshbyJob,
  ): JobSummary {
    return {
      companyId: company.id,
      companyName: company.name,
      jobId: String(job.id),
      title: job.title.trim(),
      location: formatLocation(job),
      url: job.jobUrl.trim(),
      postedAt: parseDate(job.publishedAt),
      updatedAt: null,
      source: "ashby",
    };
  }

  private assertAshbyCompany(
    company: CompanyConfig,
  ): asserts company is AshbyCompanyConfig {
    if (company.adapter !== "ashby") {
      throw new Error(
        `AshbyAdapter cannot handle company ${company.name} with adapter ${company.adapter}`,
      );
    }
  }
}

function assertValidJob(company: CompanyConfig, job: AshbyJob): void {
  if (
    (typeof job.id !== "string" && typeof job.id !== "number") ||
    typeof job.title !== "string" ||
    job.title.trim().length === 0 ||
    typeof job.jobUrl !== "string" ||
    job.jobUrl.trim().length === 0
  ) {
    throw new Error(`Ashby returned a malformed job for ${company.name}`);
  }
}

function formatLocation(job: AshbyJob): string | null {
  const locations = [
    job.location,
    ...(job.secondaryLocations ?? []).map((secondaryLocation) =>
      typeof secondaryLocation === "string"
        ? secondaryLocation
        : secondaryLocation.location,
    ),
  ]
    .filter((location): location is string =>
      typeof location === "string" && location.trim().length > 0
    )
    .map((location) => location.trim());

  if (
    job.isRemote &&
    !locations.some((location) => /\bremote\b/i.test(location))
  ) {
    const workplaceType = job.workplaceType?.trim();
    locations.push(
      workplaceType && workplaceType.toLowerCase() !== "remote"
        ? `Remote (${workplaceType})`
        : "Remote",
    );
  }

  const seen = new Set<string>();
  const uniqueLocations = locations.filter((location) => {
    const normalized = location.trim().toLowerCase();

    if (seen.has(normalized)) {
      return false;
    }

    seen.add(normalized);
    return true;
  });

  return uniqueLocations.length > 0 ? uniqueLocations.join(" | ") : null;
}

function parseDate(value?: string | null): Date | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function cacheKey(companyId: string, jobId: string): string {
  return `${companyId}:${jobId}`;
}
