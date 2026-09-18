import type {
  AppleCompanyConfig,
  CompanyConfig,
} from "../config/index.js";
import type { JobDetails, JobSummary } from "../types.js";
import { AdapterHttpError } from "./errors.js";
import type { JobAdapter, JobSummaryQuery } from "./types.js";

interface AppleLocation {
  name?: string | null;
  city?: string | null;
  stateProvince?: string | null;
  countryName?: string | null;
}

interface AppleSearchResult {
  positionId?: string | number;
  postingTitle?: string | null;
  transformedPostingTitle?: string | null;
  locations?: AppleLocation[] | null;
  postDateInGMT?: string | null;
}

interface AppleSearchResponse {
  res?: {
    searchResults?: AppleSearchResult[];
    totalRecords?: number;
  };
}

interface AppleJobDetailsResponse {
  res?: {
    jobNumber?: string | number;
    postingTitle?: string | null;
    transformedPostingTitle?: string | null;
    locations?: AppleLocation[] | null;
    postDateInGMT?: string | null;
    jobSummary?: string | null;
    description?: string | null;
    minimumQualifications?: string | null;
    preferredQualifications?: string | null;
  };
}

interface AppleSession {
  csrfToken: string;
  cookie: string;
}

const APPLE_BASE_URL = "https://jobs.apple.com";
const PAGE_SIZE = 20;
const MAX_PAGES = 200;

export class AppleAdapter implements JobAdapter {
  private sessionPromise: Promise<AppleSession> | null = null;

  async fetchJobSummaries(
    company: CompanyConfig,
    query?: JobSummaryQuery,
  ): Promise<JobSummary[]> {
    assertAppleCompany(company);

    const summaries = new Map<string, JobSummary>();

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const data = await this.search(company, page);
      const results = data.res?.searchResults;

      if (!Array.isArray(results)) {
        throw new Error(
          `Apple returned an invalid search response for ${company.name}`,
        );
      }

      for (const result of results) {
        const summary = normalizeSummary(company, result);

        if (!summary) {
          continue;
        }

        const existing = summaries.get(summary.jobId);

        if (existing) {
          existing.location = mergeLocations(
            existing.location,
            summary.location,
          );
        } else {
          summaries.set(summary.jobId, summary);
        }
      }

      const totalRecords = data.res?.totalRecords;

      if (
        results.length === 0 ||
        results.length < PAGE_SIZE ||
        (typeof totalRecords === "number" && page * PAGE_SIZE >= totalRecords) ||
        reachedPostingCutoff(results, query?.postedAfter)
      ) {
        break;
      }
    }

    return [...summaries.values()].filter(
      (summary) =>
        !query?.postedAfter ||
        !summary.postedAt ||
        summary.postedAt >= query.postedAfter,
    );
  }

  async fetchJobDetails(
    company: CompanyConfig,
    job: JobSummary,
  ): Promise<JobDetails> {
    assertAppleCompany(company);

    const session = await this.getSession();
    const url = new URL(
      `/api/v1/jobDetails/${encodeURIComponent(job.jobId)}`,
      APPLE_BASE_URL,
    );
    url.searchParams.set("locale", "en-us");
    const response = await fetch(url, {
      headers: requestHeaders(session),
    });

    if (!response.ok) {
      throw new AdapterHttpError(
        "Apple",
        company.name,
        response.status,
        response.statusText,
      );
    }

    const data = (await response.json()) as AppleJobDetailsResponse;
    const details = data.res;

    if (!details || typeof details.description !== "string") {
      throw new Error(
        `Apple returned no job description for ${company.name} job ${job.jobId}`,
      );
    }

    return {
      ...job,
      title: details.postingTitle?.trim() || job.title,
      location: formatLocations(details.locations) ?? job.location,
      url: appleJobUrl(job.jobId, details.transformedPostingTitle),
      postedAt: parseDate(details.postDateInGMT) ?? job.postedAt,
      description: joinDescriptionSections(details),
    };
  }

  private async search(
    company: AppleCompanyConfig,
    page: number,
  ): Promise<AppleSearchResponse> {
    const session = await this.getSession();
    const response = await fetch(`${APPLE_BASE_URL}/api/v1/search`, {
      method: "POST",
      headers: requestHeaders(session, true),
      body: JSON.stringify({
        query: "",
        filters: {
          homeOffice: [],
          minimumHours: "",
          maximumHours: "",
          jobLevel: [],
          languages: [],
          locations: ["postLocation-USA"],
          products: [],
          retailRoles: [],
          teams: [],
          hiringManagers: [],
        },
        page,
        locale: "en-us",
        sort: "newest",
        format: {
          longDate: "MMMM D, YYYY",
          mediumDate: "MMM D, YYYY",
        },
      }),
    });

    if (!response.ok) {
      throw new AdapterHttpError(
        "Apple",
        company.name,
        response.status,
        response.statusText,
      );
    }

    return (await response.json()) as AppleSearchResponse;
  }

  private getSession(): Promise<AppleSession> {
    this.sessionPromise ??= createSession();
    return this.sessionPromise;
  }
}

function assertAppleCompany(
  company: CompanyConfig,
): asserts company is AppleCompanyConfig {
  if (company.adapter !== "apple") {
    throw new Error(
      `AppleAdapter cannot handle company ${company.name} with adapter ${company.adapter}`,
    );
  }
}

async function createSession(): Promise<AppleSession> {
  const response = await fetch(`${APPLE_BASE_URL}/api/v1/CSRFToken`, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new AdapterHttpError(
      "Apple",
      "Apple",
      response.status,
      response.statusText,
    );
  }

  const csrfToken = response.headers.get("x-apple-csrf-token")?.trim();
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .filter(Boolean)
    .join("; ");

  if (!csrfToken || !cookie) {
    throw new Error("Apple did not return the required CSRF session headers");
  }

  return { csrfToken, cookie };
}

function requestHeaders(
  session: AppleSession,
  includeContentType = false,
): Record<string, string> {
  return {
    Accept: "application/json",
    ...(includeContentType ? { "Content-Type": "application/json" } : {}),
    "X-Apple-CSRF-Token": session.csrfToken,
    Cookie: session.cookie,
    locale: "en_US",
    browserLocale: "en_US",
  };
}

function normalizeSummary(
  company: AppleCompanyConfig,
  result: AppleSearchResult,
): JobSummary | null {
  const jobId =
    typeof result.positionId === "string" ||
    typeof result.positionId === "number"
      ? String(result.positionId)
      : "";
  const title = result.postingTitle?.trim() ?? "";

  if (!jobId || !title) {
    console.warn(`[${company.name}] Skipping malformed Apple listing`);
    return null;
  }

  return {
    companyId: company.id,
    companyName: company.name,
    jobId,
    title,
    location: formatLocations(result.locations),
    url: appleJobUrl(jobId, result.transformedPostingTitle),
    postedAt: parseDate(result.postDateInGMT),
    updatedAt: null,
    source: "apple",
  };
}

function appleJobUrl(
  jobId: string,
  transformedTitle?: string | null,
): string {
  const slug = transformedTitle?.trim();
  const base = `${APPLE_BASE_URL}/en-us/details/${encodeURIComponent(jobId)}`;
  return slug ? `${base}/${encodeURIComponent(slug)}` : base;
}

function formatLocations(
  locations: AppleLocation[] | null | undefined,
): string | null {
  const values = (locations ?? [])
    .map((location) => {
      const place = location.city?.trim() || location.name?.trim();
      return uniqueStrings(
        [
          place,
          location.stateProvince?.trim(),
          location.countryName?.trim(),
        ].filter((value): value is string => Boolean(value)),
      ).join(", ");
    })
    .filter(Boolean);

  return uniqueStrings(values).join(" | ") || null;
}

function mergeLocations(
  first: string | null,
  second: string | null,
): string | null {
  return (
    uniqueStrings(
      [first, second]
        .filter((value): value is string => Boolean(value))
        .flatMap((value) => value.split(" | ")),
    ).join(" | ") || null
  );
}

function joinDescriptionSections(
  details: NonNullable<AppleJobDetailsResponse["res"]>,
): string {
  const sections = [
    ["Summary", details.jobSummary],
    ["Description", details.description],
    ["Minimum Qualifications", details.minimumQualifications],
    ["Preferred Qualifications", details.preferredQualifications],
  ] as const;

  return sections
    .flatMap(([heading, value]) =>
      typeof value === "string" && value.trim().length > 0
        ? [`${heading}:\n${value.trim()}`]
        : [],
    )
    .join("\n\n");
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function reachedPostingCutoff(
  results: AppleSearchResult[],
  postedAfter?: Date,
): boolean {
  if (!postedAfter) {
    return false;
  }

  const dates = results
    .map((result) => parseDate(result.postDateInGMT))
    .filter((date): date is Date => date !== null);

  return dates.length > 0 && dates.every((date) => date < postedAfter);
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();

  return values.filter((value) => {
    const key = value.toLowerCase();

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}
