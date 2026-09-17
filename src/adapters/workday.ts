import type {
  CompanyConfig,
  WorkdayCompanyConfig,
} from "../config/index.js";
import type { JobDetails, JobSummary } from "../types.js";
import { AdapterHttpError } from "./errors.js";
import type { JobAdapter } from "./types.js";

interface WorkdayListing {
  title?: string | null;
  externalPath?: string | null;
  locationsText?: string | null;
  postedOn?: string | null;
  bulletFields?: Array<string | null> | null;
}

interface WorkdayListingResponse {
  total?: number | null;
  jobPostings?: WorkdayListing[] | null;
}

interface WorkdayJobPostingInfo {
  title?: string | null;
  jobReqId?: string | null;
  postedOn?: string | null;
  startDate?: string | null;
  location?: string | null;
  additionalLocations?: Array<string | null> | null;
  externalUrl?: string | null;
  jobDescription?: string | null;
}

interface WorkdayDetailResponse {
  jobPostingInfo?: WorkdayJobPostingInfo | null;
}

const PAGE_SIZE = 20;

export class WorkdayAdapter implements JobAdapter {
  private readonly pathCache = new Map<string, string>();

  async fetchJobSummaries(company: CompanyConfig): Promise<JobSummary[]> {
    assertWorkdayCompany(company);

    const listings = await this.fetchListings(company);

    return listings.map((listing) => {
      assertValidListing(company, listing);

      const externalPath = normalizePath(listing.externalPath);
      const jobId = listing.bulletFields?.find(
        (field): field is string =>
          typeof field === "string" && field.trim().length > 0,
      )?.trim() ?? externalPath;
      this.pathCache.set(cacheKey(company.id, jobId), externalPath);

      return {
        companyId: company.id,
        companyName: company.name,
        jobId,
        title: listing.title.trim(),
        location: normalizeOptionalString(listing.locationsText),
        url: publicJobUrl(company, externalPath),
        postedAt: parseRelativePostingDate(listing.postedOn),
        updatedAt: null,
        source: "workday",
      };
    });
  }

  async fetchJobDetails(
    company: CompanyConfig,
    job: JobSummary,
  ): Promise<JobDetails> {
    assertWorkdayCompany(company);

    const externalPath =
      this.pathCache.get(cacheKey(company.id, job.jobId)) ??
      externalPathFromJobUrl(company, job.url);
    const url = workdayApiUrl(company, externalPath);
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new AdapterHttpError(
        "Workday",
        company.name,
        response.status,
        response.statusText,
      );
    }

    const data = (await response.json()) as WorkdayDetailResponse;
    const details = data.jobPostingInfo;

    if (!details || typeof details.jobDescription !== "string") {
      throw new Error(
        `Workday returned an invalid detail response for ${company.name}`,
      );
    }

    return {
      ...job,
      location: formatDetailLocation(details) ?? job.location,
      url: normalizeOptionalString(details.externalUrl) ?? job.url,
      description: details.jobDescription,
    };
  }

  private async fetchListings(
    company: WorkdayCompanyConfig,
  ): Promise<WorkdayListing[]> {
    const listings: WorkdayListing[] = [];
    let total = Number.POSITIVE_INFINITY;
    let offset = 0;

    while (offset < total) {
      const response = await fetch(workdayApiUrl(company, "/jobs"), {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          appliedFacets: {},
          limit: PAGE_SIZE,
          offset,
          searchText: "",
        }),
      });

      if (!response.ok) {
        throw new AdapterHttpError(
          "Workday",
          company.name,
          response.status,
          response.statusText,
        );
      }

      const data = (await response.json()) as WorkdayListingResponse;

      if (!Array.isArray(data.jobPostings)) {
        throw new Error(
          `Workday returned an invalid listing response for ${company.name}`,
        );
      }

      const page = data.jobPostings;
      listings.push(...page);

      if (!Number.isFinite(total)) {
        total = validTotal(data.total, listings.length);
      }

      if (page.length === 0) {
        break;
      }

      offset += page.length;
    }

    return listings;
  }
}

function assertWorkdayCompany(
  company: CompanyConfig,
): asserts company is WorkdayCompanyConfig {
  if (company.adapter !== "workday") {
    throw new Error(
      `WorkdayAdapter cannot handle company ${company.name} with adapter ${company.adapter}`,
    );
  }
}

function assertValidListing(
  company: WorkdayCompanyConfig,
  listing: WorkdayListing,
): asserts listing is WorkdayListing & { title: string; externalPath: string } {
  if (
    typeof listing.title !== "string" ||
    listing.title.trim().length === 0 ||
    typeof listing.externalPath !== "string" ||
    listing.externalPath.trim().length === 0
  ) {
    throw new Error(`Workday returned a malformed job for ${company.name}`);
  }
}

function workdayApiUrl(
  company: WorkdayCompanyConfig,
  path: string,
): string {
  return `${trimTrailingSlash(company.apiBaseUrl)}/wday/cxs/${encodeURIComponent(company.tenant)}/${encodeURIComponent(company.handle)}${normalizePath(path)}`;
}

function publicJobUrl(
  company: WorkdayCompanyConfig,
  externalPath: string,
): string {
  return `${trimTrailingSlash(company.apiBaseUrl)}/${encodeURIComponent(company.handle)}${externalPath}`;
}

function externalPathFromJobUrl(
  company: WorkdayCompanyConfig,
  jobUrl: string,
): string {
  const pathname = new URL(jobUrl).pathname;
  const sitePrefix = `/${company.handle}`;

  if (!pathname.startsWith(`${sitePrefix}/`)) {
    throw new Error(
      `Could not determine Workday job path for ${company.name}: ${jobUrl}`,
    );
  }

  return normalizePath(pathname.slice(sitePrefix.length));
}

function formatDetailLocation(details: WorkdayJobPostingInfo): string | null {
  const values = [details.location, ...(details.additionalLocations ?? [])]
    .filter((value): value is string =>
      typeof value === "string" && value.trim().length > 0
    )
    .map((value) => value.trim());
  const seen = new Set<string>();
  const uniqueValues = values.filter((value) => {
    const normalized = value.toLowerCase();

    if (seen.has(normalized)) {
      return false;
    }

    seen.add(normalized);
    return true;
  });

  return uniqueValues.length > 0 ? uniqueValues.join("; ") : null;
}

function parseRelativePostingDate(value?: string | null): Date | null {
  const normalized = value?.trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  const now = Date.now();

  if (normalized === "posted today" || normalized === "today") {
    return new Date(now);
  }

  if (normalized === "posted yesterday" || normalized === "yesterday") {
    return new Date(now - 24 * 60 * 60 * 1000);
  }

  const relative = normalized.match(
    /(?:posted\s+)?(\d+)\+?\s+(hour|day|week|month)s?\s+ago/,
  );

  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2];
    const hoursPerUnit =
      unit === "hour" ? 1 : unit === "day" ? 24 : unit === "week" ? 168 : 720;

    return new Date(now - amount * hoursPerUnit * 60 * 60 * 1000);
  }

  const absolute = new Date(value!);
  return Number.isNaN(absolute.getTime()) ? null : absolute;
}

function normalizeOptionalString(value?: string | null): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function normalizePath(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function validTotal(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function cacheKey(companyId: string, jobId: string): string {
  return `${companyId}:${jobId}`;
}
