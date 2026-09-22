import type {
  ByteDanceCompanyConfig,
  CompanyConfig,
} from "../config/index.js";
import type { JobDetails, JobSummary } from "../types.js";
import { AdapterHttpError } from "./errors.js";
import type { JobAdapter } from "./types.js";

interface ByteDanceLocation {
  code?: string | null;
  name?: string | null;
  en_name?: string | null;
  i18n_name?: string | null;
  parent?: ByteDanceLocation | null;
}

interface ByteDanceJob {
  id?: string | number | null;
  title?: string | null;
  description?: string | null;
  requirement?: string | null;
  city_info?: ByteDanceLocation | null;
}

interface ByteDanceSearchData {
  job_post_list?: ByteDanceJob[];
  count?: number;
}

interface ByteDanceSearchResponse {
  code?: number;
  message?: string;
  data?: ByteDanceSearchData;
}

const PAGE_SIZE = 100;
const MAX_PAGES = 100;

export class ByteDanceAdapter implements JobAdapter {
  private readonly jobCache = new Map<string, ByteDanceJob>();

  async fetchJobSummaries(company: CompanyConfig): Promise<JobSummary[]> {
    assertByteDanceCompany(company);

    const summaries: JobSummary[] = [];
    const seenJobIds = new Set<string>();
    let offset = 0;
    let expectedCount: number | null = null;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const data = await this.fetchPage(company, offset);
      const jobs = data.job_post_list;

      if (!Array.isArray(jobs)) {
        throw new Error(
          `ByteDance returned an invalid job list for ${company.name}`,
        );
      }

      expectedCount =
        typeof data.count === "number" && Number.isFinite(data.count)
          ? data.count
          : expectedCount;

      for (const rawJob of jobs) {
        const summary = normalizeSummary(company, rawJob);

        if (!summary || seenJobIds.has(summary.jobId)) {
          continue;
        }

        seenJobIds.add(summary.jobId);
        summaries.push(summary);
        this.jobCache.set(cacheKey(company.id, summary.jobId), rawJob);
      }

      offset += jobs.length;

      if (
        jobs.length === 0 ||
        jobs.length < PAGE_SIZE ||
        (expectedCount !== null && offset >= expectedCount)
      ) {
        return summaries;
      }
    }

    throw new Error(
      `ByteDance pagination exceeded ${MAX_PAGES} pages for ${company.name}`,
    );
  }

  async fetchJobDetails(
    company: CompanyConfig,
    job: JobSummary,
  ): Promise<JobDetails> {
    assertByteDanceCompany(company);

    let rawJob = this.jobCache.get(cacheKey(company.id, job.jobId));

    if (!rawJob) {
      await this.fetchJobSummaries(company);
      rawJob = this.jobCache.get(cacheKey(company.id, job.jobId));
    }

    if (!rawJob) {
      throw new Error(
        `ByteDance job ${job.jobId} was not found for ${company.name}`,
      );
    }

    return {
      ...job,
      description: formatDescription(rawJob),
    };
  }

  private async fetchPage(
    company: ByteDanceCompanyConfig,
    offset: number,
  ): Promise<ByteDanceSearchData> {
    const endpoint = new URL(
      "search/job/posts",
      withTrailingSlash(company.apiBaseUrl),
    );
    const careerUrl = new URL(company.careerBaseUrl);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en",
        "Content-Type": "application/json",
        Origin: careerUrl.origin,
        Referer: company.careerBaseUrl,
        "website-path": company.websitePath,
      },
      body: JSON.stringify({
        keyword: "",
        limit: PAGE_SIZE,
        offset,
      }),
    });

    if (!response.ok) {
      throw new AdapterHttpError(
        "ByteDance",
        company.name,
        response.status,
        response.statusText,
      );
    }

    const payload = (await response.json()) as ByteDanceSearchResponse;

    if (payload.code !== 0 || !payload.data) {
      throw new Error(
        `ByteDance request failed for ${company.name}: ${payload.message ?? `API code ${payload.code ?? "unknown"}`}`,
      );
    }

    return payload.data;
  }
}

function assertByteDanceCompany(
  company: CompanyConfig,
): asserts company is ByteDanceCompanyConfig {
  if (company.adapter !== "bytedance") {
    throw new Error(
      `ByteDanceAdapter cannot handle company ${company.name} with adapter ${company.adapter}`,
    );
  }
}

function normalizeSummary(
  company: ByteDanceCompanyConfig,
  rawJob: ByteDanceJob,
): JobSummary | null {
  const jobId =
    typeof rawJob.id === "string" || typeof rawJob.id === "number"
      ? String(rawJob.id).trim()
      : "";
  const title = rawJob.title?.trim() ?? "";

  if (!jobId || !title) {
    console.warn(`[${company.name}] Skipping malformed ByteDance job`);
    return null;
  }

  return {
    companyId: company.id,
    companyName: company.name,
    jobId,
    title,
    location: formatLocation(rawJob.city_info),
    url: `${company.careerBaseUrl.replace(/\/$/, "")}/${encodeURIComponent(jobId)}`,
    postedAt: null,
    updatedAt: null,
    source: "bytedance",
  };
}

function formatLocation(location?: ByteDanceLocation | null): string | null {
  const parts: string[] = [];
  let current = location;

  while (current) {
    const name = current.en_name ?? current.i18n_name ?? current.name;

    if (typeof name === "string" && name.trim()) {
      parts.push(name.trim());
    }

    current = current.parent;
  }

  const uniqueParts = parts.filter(
    (part, index) =>
      parts.findIndex(
        (candidate) => candidate.toLowerCase() === part.toLowerCase(),
      ) === index,
  );

  return uniqueParts.length > 0 ? uniqueParts.join(", ") : null;
}

function formatDescription(job: ByteDanceJob): string {
  return [job.description?.trim(), job.requirement?.trim()]
    .filter((section): section is string => Boolean(section))
    .join("\n\nQualifications\n");
}

function cacheKey(companyId: string, jobId: string): string {
  return `${companyId}:${jobId}`;
}

function withTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
