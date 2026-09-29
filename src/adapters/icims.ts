import type {
  CompanyConfig,
  IcimsCompanyConfig,
} from "../config/index.js";
import type { JobDetails, JobSummary } from "../types.js";
import { AdapterHttpError } from "./errors.js";
import type { JobAdapter, JobSummaryQuery } from "./types.js";

interface IcimsJobData {
  slug?: string | null;
  req_id?: string | number | null;
  title?: string | null;
  full_location?: string | null;
  posted_date?: string | null;
  description?: string | null;
}

interface IcimsJobRecord {
  data?: IcimsJobData | null;
}

interface IcimsJobsResponse {
  count?: number | null;
  jobs?: IcimsJobRecord[] | null;
}

const PAGE_SIZE = 100;

export class IcimsAdapter implements JobAdapter {
  private readonly descriptionCache = new Map<string, string>();

  async fetchJobSummaries(
    company: CompanyConfig,
    query?: JobSummaryQuery,
  ): Promise<JobSummary[]> {
    assertIcimsCompany(company);

    const summaries: JobSummary[] = [];
    let pageNumber = 1;
    let total = Number.POSITIVE_INFINITY;
    let inspected = 0;

    while (inspected < total) {
      const response = await fetch(listingUrl(company, pageNumber), {
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        throw new AdapterHttpError(
          "iCIMS",
          company.name,
          response.status,
          response.statusText,
        );
      }

      const data = (await response.json()) as IcimsJobsResponse;

      if (!Array.isArray(data.jobs)) {
        throw new Error(
          `iCIMS returned an invalid listing response for ${company.name}`,
        );
      }

      const page = data.jobs;
      total = validTotal(data.count, inspected + page.length);

      for (const record of page) {
        const summary = normalizeJob(company, record.data);

        if (!summary) {
          continue;
        }

        const description = normalizeOptionalString(record.data?.description);

        if (description) {
          this.descriptionCache.set(
            cacheKey(company.id, summary.jobId),
            description,
          );
        }

        if (!query?.postedAfter ||
          !summary.postedAt ||
          summary.postedAt >= query.postedAfter) {
          summaries.push(summary);
        }
      }

      inspected += page.length;

      if (page.length === 0 || reachedCutoff(page, query?.postedAfter)) {
        break;
      }

      pageNumber += 1;
    }

    return summaries;
  }

  async fetchJobDetails(
    company: CompanyConfig,
    job: JobSummary,
  ): Promise<JobDetails> {
    assertIcimsCompany(company);

    let description = this.descriptionCache.get(
      cacheKey(company.id, job.jobId),
    );

    if (!description) {
      await this.fetchJobSummaries(company);
      description = this.descriptionCache.get(
        cacheKey(company.id, job.jobId),
      );
    }

    if (!description) {
      throw new Error(
        `iCIMS returned no description for ${company.name} job ${job.jobId}`,
      );
    }

    return {
      ...job,
      description,
    };
  }
}

function assertIcimsCompany(
  company: CompanyConfig,
): asserts company is IcimsCompanyConfig {
  if (company.adapter !== "icims") {
    throw new Error(
      `IcimsAdapter cannot handle company ${company.name} with adapter ${company.adapter}`,
    );
  }
}

function listingUrl(company: IcimsCompanyConfig, pageNumber: number): URL {
  const url = new URL("/api/jobs", company.apiBaseUrl);
  url.searchParams.set("limit", String(PAGE_SIZE));
  url.searchParams.set("page", String(pageNumber));
  return url;
}

function normalizeJob(
  company: IcimsCompanyConfig,
  data: IcimsJobData | null | undefined,
): JobSummary | null {
  const slug = normalizeOptionalString(data?.slug);
  const title = normalizeOptionalString(data?.title);
  const jobId = data?.req_id === undefined || data.req_id === null
    ? slug
    : String(data.req_id).trim();

  if (!slug || !title || !jobId) {
    return null;
  }

  return {
    companyId: company.id,
    companyName: company.name,
    jobId,
    title,
    location: normalizeOptionalString(data?.full_location),
    url: publicJobUrl(company, slug),
    postedAt: parseDate(data?.posted_date),
    updatedAt: null,
    source: "icims",
  };
}

function publicJobUrl(company: IcimsCompanyConfig, slug: string): string {
  const path = `${trimSlashes(company.handle)}/jobs/${encodeURIComponent(slug)}`;
  return new URL(path, ensureTrailingSlash(company.apiBaseUrl)).toString();
}

function reachedCutoff(
  records: IcimsJobRecord[],
  postedAfter: Date | undefined,
): boolean {
  if (!postedAfter || records.length === 0) {
    return false;
  }

  const dates = records.map((record) => parseDate(record.data?.posted_date));
  return dates.every((date) => date !== null && date < postedAfter);
}

function parseDate(value: string | null | undefined): Date | null {
  const normalized = normalizeOptionalString(value);

  if (!normalized) {
    return null;
  }

  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeOptionalString(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

function validTotal(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

function cacheKey(companyId: string, jobId: string): string {
  return `${companyId}:${jobId}`;
}
