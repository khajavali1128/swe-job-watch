import type {
  CompanyConfig,
  EightfoldCompanyConfig,
} from "../config/index.js";
import type { JobDetails, JobSummary } from "../types.js";
import { AdapterHttpError } from "./errors.js";
import type { JobAdapter, JobSummaryQuery } from "./types.js";

interface EightfoldPosition {
  id?: string | number;
  name?: string | null;
  posting_name?: string | null;
  location?: string | null;
  locations?: string[] | null;
  t_create?: string | number | null;
  t_update?: string | number | null;
  job_description?: string | null;
  canonicalPositionUrl?: string | null;
  work_location_option?: string | null;
}

interface EightfoldListResponse {
  count?: number;
  positions?: EightfoldPosition[];
}

const PAGE_SIZE = 10;
const MAX_PAGES = 200;

export class EightfoldAdapter implements JobAdapter {
  async fetchJobSummaries(
    company: CompanyConfig,
    query?: JobSummaryQuery,
  ): Promise<JobSummary[]> {
    assertEightfoldCompany(company);

    const summaries: JobSummary[] = [];
    const seenJobIds = new Set<string>();
    let start = 0;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const url = jobsUrl(company);
      url.searchParams.set("location", "any");
      url.searchParams.set("sort_by", "new");
      url.searchParams.set("start", String(start));
      url.searchParams.set("num", String(PAGE_SIZE));

      const response = await fetch(url, {
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        throw new AdapterHttpError(
          "Eightfold",
          company.name,
          response.status,
          response.statusText,
        );
      }

      const data = (await response.json()) as EightfoldListResponse;

      if (!Array.isArray(data.positions)) {
        throw new Error(
          `Eightfold returned an invalid jobs response for ${company.name}`,
        );
      }

      for (const position of data.positions) {
        const summary = normalizeSummary(company, position);

        if (!summary || seenJobIds.has(summary.jobId)) {
          continue;
        }

        seenJobIds.add(summary.jobId);

        if (
          !query?.postedAfter ||
          !summary.postedAt ||
          summary.postedAt >= query.postedAfter
        ) {
          summaries.push(summary);
        }
      }

      if (
        data.positions.length === 0 ||
        start + data.positions.length >=
          (data.count ?? Number.POSITIVE_INFINITY) ||
        reachedPostingCutoff(data.positions, query?.postedAfter)
      ) {
        break;
      }

      start += data.positions.length;
    }

    return summaries;
  }

  async fetchJobDetails(
    company: CompanyConfig,
    job: JobSummary,
  ): Promise<JobDetails> {
    assertEightfoldCompany(company);

    const url = jobsUrl(company, job.jobId);
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new AdapterHttpError(
        "Eightfold",
        company.name,
        response.status,
        response.statusText,
      );
    }

    const position = (await response.json()) as EightfoldPosition;

    if (typeof position.job_description !== "string") {
      throw new Error(
        `Eightfold returned no job description for ${company.name} job ${job.jobId}`,
      );
    }

    return {
      ...job,
      location: formatLocation(position) ?? job.location,
      url: publicJobUrl(company, position, job.jobId),
      postedAt: parsePostingDate(position.t_create) ?? job.postedAt,
      updatedAt: parseUnixSeconds(position.t_update) ?? job.updatedAt,
      description: position.job_description,
    };
  }
}

function assertEightfoldCompany(
  company: CompanyConfig,
): asserts company is EightfoldCompanyConfig {
  if (company.adapter !== "eightfold") {
    throw new Error(
      `EightfoldAdapter cannot handle company ${company.name} with adapter ${company.adapter}`,
    );
  }
}

function jobsUrl(company: EightfoldCompanyConfig, jobId?: string): URL {
  const baseUrl = company.apiBaseUrl.replace(/\/+$/, "");
  const path = jobId
    ? `/api/apply/v2/jobs/${encodeURIComponent(jobId)}`
    : "/api/apply/v2/jobs";
  const url = new URL(`${baseUrl}${path}`);
  url.searchParams.set("domain", company.handle);
  return url;
}

function normalizeSummary(
  company: EightfoldCompanyConfig,
  position: EightfoldPosition,
): JobSummary | null {
  const jobId =
    typeof position.id === "string" || typeof position.id === "number"
      ? String(position.id)
      : "";
  const title = (position.posting_name ?? position.name)?.trim() ?? "";

  if (!jobId || !title) {
    console.warn(`[${company.name}] Skipping malformed Eightfold listing`);
    return null;
  }

  return {
    companyId: company.id,
    companyName: company.name,
    jobId,
    title,
    location: formatLocation(position),
    url: publicJobUrl(company, position, jobId),
    postedAt: parsePostingDate(position.t_create),
    updatedAt: parseUnixSeconds(position.t_update),
    source: "eightfold",
  };
}

function publicJobUrl(
  company: EightfoldCompanyConfig,
  position: EightfoldPosition,
  jobId: string,
): string {
  if (position.canonicalPositionUrl?.trim()) {
    return new URL(
      position.canonicalPositionUrl,
      company.apiBaseUrl,
    ).toString();
  }

  const baseUrl = company.apiBaseUrl.replace(/\/+$/, "");
  return `${baseUrl}/careers/job/${encodeURIComponent(jobId)}?microsite=${encodeURIComponent(company.handle)}`;
}

function formatLocation(position: EightfoldPosition): string | null {
  const locations = [...(position.locations ?? []), position.location]
    .filter((location): location is string =>
      typeof location === "string" && location.trim().length > 0
    )
    .map((location) => location.trim());

  if (
    position.work_location_option?.toLowerCase() === "remote" &&
    !locations.some((location) => /\bremote\b/i.test(location))
  ) {
    locations.unshift("Remote");
  }

  return uniqueStrings(locations).join("; ") || null;
}

function parseUnixSeconds(
  value: string | number | null | undefined,
): Date | null {
  const seconds = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parsePostingDate(
  value: string | number | null | undefined,
): Date | null {
  const date = parseUnixSeconds(value);

  if (
    !date ||
    date.getUTCHours() !== 0 ||
    date.getUTCMinutes() !== 0 ||
    date.getUTCSeconds() !== 0 ||
    date.getUTCMilliseconds() !== 0
  ) {
    return date;
  }

  const now = new Date();
  const todayUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );

  if (date.getTime() < todayUtc) {
    date.setUTCHours(23, 59, 59, 999);
  }

  return date;
}

function reachedPostingCutoff(
  positions: EightfoldPosition[],
  postedAfter?: Date,
): boolean {
  if (!postedAfter) {
    return false;
  }

  const dates = positions
    .map((position) => parsePostingDate(position.t_create))
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
