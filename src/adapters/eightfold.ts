import type {
  CompanyConfig,
  EightfoldCompanyConfig,
} from "../config/index.js";
import type { JobDetails, JobSummary } from "../types.js";
import { AdapterHttpError } from "./errors.js";
import type { JobAdapter, JobSummaryQuery } from "./types.js";

interface EightfoldLocationFields {
  location?: string | null;
  locations?: string[] | null;
  work_location_option?: string | null;
  workLocationOption?: string | null;
}

interface EightfoldClassicPosition extends EightfoldLocationFields {
  id?: string | number;
  name?: string | null;
  posting_name?: string | null;
  t_create?: string | number | null;
  t_update?: string | number | null;
  job_description?: string | null;
  canonicalPositionUrl?: string | null;
}

interface EightfoldClassicListResponse {
  count?: number;
  positions?: EightfoldClassicPosition[];
}

interface EightfoldPcsxPosition extends EightfoldLocationFields {
  id?: string | number;
  name?: string | null;
  postedTs?: string | number | null;
  creationTs?: string | number | null;
  updateTs?: string | number | null;
  jobDescription?: string | null;
  positionUrl?: string | null;
  publicUrl?: string | null;
}

interface EightfoldPcsxResponse {
  data?: {
    count?: number;
    positions?: EightfoldPcsxPosition[];
  };
}

type EightfoldApiVariant = "classic" | "pcsx";

const PAGE_SIZE = 10;
const MAX_PAGES = 200;

class PcsxUnavailableError extends Error {}

export class EightfoldAdapter implements JobAdapter {
  private readonly variants = new Map<string, EightfoldApiVariant>();

  async fetchJobSummaries(
    company: CompanyConfig,
    query?: JobSummaryQuery,
  ): Promise<JobSummary[]> {
    assertEightfoldCompany(company);

    const knownVariant = this.variants.get(companyKey(company));

    if (knownVariant === "classic") {
      return this.fetchClassicSummaries(company, query);
    }

    if (knownVariant === "pcsx") {
      return this.fetchPcsxSummaries(company, query);
    }

    try {
      const summaries = await this.fetchPcsxSummaries(company, query);
      this.variants.set(companyKey(company), "pcsx");
      return summaries;
    } catch (error) {
      if (!(error instanceof PcsxUnavailableError)) {
        throw error;
      }
    }

    this.variants.set(companyKey(company), "classic");
    return this.fetchClassicSummaries(company, query);
  }

  async fetchJobDetails(
    company: CompanyConfig,
    job: JobSummary,
  ): Promise<JobDetails> {
    assertEightfoldCompany(company);

    const knownVariant = this.variants.get(companyKey(company));

    if (knownVariant === "classic") {
      return this.fetchClassicDetails(company, job);
    }

    if (knownVariant === "pcsx") {
      return this.fetchPcsxDetails(company, job);
    }

    try {
      const details = await this.fetchPcsxDetails(company, job);
      this.variants.set(companyKey(company), "pcsx");
      return details;
    } catch (error) {
      if (!(error instanceof PcsxUnavailableError)) {
        throw error;
      }
    }

    this.variants.set(companyKey(company), "classic");
    return this.fetchClassicDetails(company, job);
  }

  private async fetchClassicSummaries(
    company: EightfoldCompanyConfig,
    query?: JobSummaryQuery,
  ): Promise<JobSummary[]> {
    const summaries: JobSummary[] = [];
    const seenJobIds = new Set<string>();
    let start = 0;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const url = classicJobsUrl(company);
      url.searchParams.set("location", "any");
      url.searchParams.set("sort_by", "new");
      url.searchParams.set("start", String(start));
      url.searchParams.set("num", String(PAGE_SIZE));

      const response = await fetchJson(url, company);
      const data = response as EightfoldClassicListResponse;

      if (!Array.isArray(data.positions)) {
        throw invalidResponse(company);
      }

      for (const position of data.positions) {
        const summary = normalizeClassicSummary(company, position);

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
        reachedPostingCutoff(
          data.positions.map((position) => position.t_create),
          query?.postedAfter,
        )
      ) {
        break;
      }

      start += data.positions.length;
    }

    return summaries;
  }

  private async fetchPcsxSummaries(
    company: EightfoldCompanyConfig,
    query?: JobSummaryQuery,
  ): Promise<JobSummary[]> {
    const summaries: JobSummary[] = [];
    const seenJobIds = new Set<string>();
    let start = 0;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const url = pcsxUrl(company, "/api/pcsx/search");
      url.searchParams.set("sort_by", "timestamp");
      url.searchParams.set("start", String(start));

      const response = await fetchPcsxJson(url, company);
      const data = (response as EightfoldPcsxResponse).data;

      if (!data || !Array.isArray(data.positions)) {
        throw invalidResponse(company);
      }

      for (const position of data.positions) {
        const summary = normalizePcsxSummary(company, position);

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
        reachedPostingCutoff(
          data.positions.map(
            (position) => position.postedTs ?? position.creationTs,
          ),
          query?.postedAfter,
        )
      ) {
        break;
      }

      start += data.positions.length;
    }

    return summaries;
  }

  private async fetchClassicDetails(
    company: EightfoldCompanyConfig,
    job: JobSummary,
  ): Promise<JobDetails> {
    const response = await fetchJson(
      classicJobsUrl(company, job.jobId),
      company,
    );
    const position = response as EightfoldClassicPosition;

    if (typeof position.job_description !== "string") {
      throw missingDescription(company, job);
    }

    return {
      ...job,
      location: formatLocation(position) ?? job.location,
      url: classicPublicJobUrl(company, position, job.jobId),
      postedAt: parsePostingDate(position.t_create) ?? job.postedAt,
      updatedAt: parseUnixSeconds(position.t_update) ?? job.updatedAt,
      description: position.job_description,
    };
  }

  private async fetchPcsxDetails(
    company: EightfoldCompanyConfig,
    job: JobSummary,
  ): Promise<JobDetails> {
    const url = pcsxUrl(company, "/api/pcsx/position_details");
    url.searchParams.set("position_id", job.jobId);
    const response = await fetchPcsxJson(url, company);
    const position = (response as { data?: EightfoldPcsxPosition }).data;

    if (!position || typeof position.jobDescription !== "string") {
      throw missingDescription(company, job);
    }

    return {
      ...job,
      location: formatLocation(position) ?? job.location,
      url: pcsxPublicJobUrl(company, position, job.jobId),
      postedAt:
        parsePostingDate(position.postedTs ?? position.creationTs) ??
        job.postedAt,
      updatedAt: parseUnixSeconds(position.updateTs) ?? job.updatedAt,
      description: position.jobDescription,
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

function companyKey(company: EightfoldCompanyConfig): string {
  return `${company.apiBaseUrl}|${company.handle}`;
}

function classicJobsUrl(
  company: EightfoldCompanyConfig,
  jobId?: string,
): URL {
  const baseUrl = company.apiBaseUrl.replace(/\/+$/, "");
  const path = jobId
    ? `/api/apply/v2/jobs/${encodeURIComponent(jobId)}`
    : "/api/apply/v2/jobs";
  const url = new URL(`${baseUrl}${path}`);
  url.searchParams.set("domain", company.handle);
  return url;
}

function pcsxUrl(company: EightfoldCompanyConfig, path: string): URL {
  const baseUrl = company.apiBaseUrl.replace(/\/+$/, "");
  const url = new URL(`${baseUrl}${path}`);
  url.searchParams.set("domain", company.handle);
  return url;
}

async function fetchJson(
  url: URL,
  company: EightfoldCompanyConfig,
): Promise<unknown> {
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

  return response.json();
}

async function fetchPcsxJson(
  url: URL,
  company: EightfoldCompanyConfig,
): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    const body = await response.text();

    if (
      response.status === 404 ||
      (response.status === 403 && /PCSX is not enabled/i.test(body))
    ) {
      throw new PcsxUnavailableError();
    }

    throw new AdapterHttpError(
      "Eightfold",
      company.name,
      response.status,
      response.statusText,
    );
  }

  return response.json();
}

function normalizeClassicSummary(
  company: EightfoldCompanyConfig,
  position: EightfoldClassicPosition,
): JobSummary | null {
  const identity = normalizedIdentity(company, position);

  if (!identity) {
    return null;
  }

  return {
    companyId: company.id,
    companyName: company.name,
    ...identity,
    location: formatLocation(position),
    url: classicPublicJobUrl(company, position, identity.jobId),
    postedAt: parsePostingDate(position.t_create),
    updatedAt: parseUnixSeconds(position.t_update),
    source: "eightfold",
  };
}

function normalizePcsxSummary(
  company: EightfoldCompanyConfig,
  position: EightfoldPcsxPosition,
): JobSummary | null {
  const identity = normalizedIdentity(company, position);

  if (!identity) {
    return null;
  }

  return {
    companyId: company.id,
    companyName: company.name,
    ...identity,
    location: formatLocation(position),
    url: pcsxPublicJobUrl(company, position, identity.jobId),
    postedAt: parsePostingDate(position.postedTs ?? position.creationTs),
    updatedAt: parseUnixSeconds(position.updateTs),
    source: "eightfold",
  };
}

function normalizedIdentity(
  company: EightfoldCompanyConfig,
  position: {
    id?: string | number;
    name?: string | null;
    posting_name?: string | null;
  },
): { jobId: string; title: string } | null {
  const jobId =
    typeof position.id === "string" || typeof position.id === "number"
      ? String(position.id)
      : "";
  const title = (position.posting_name ?? position.name)?.trim() ?? "";

  if (!jobId || !title) {
    console.warn(`[${company.name}] Skipping malformed Eightfold listing`);
    return null;
  }

  return { jobId, title };
}

function classicPublicJobUrl(
  company: EightfoldCompanyConfig,
  position: EightfoldClassicPosition,
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

function pcsxPublicJobUrl(
  company: EightfoldCompanyConfig,
  position: EightfoldPcsxPosition,
  jobId: string,
): string {
  const path = position.publicUrl?.trim() || position.positionUrl?.trim();
  const url = new URL(
    path || `/careers/job/${encodeURIComponent(jobId)}`,
    company.apiBaseUrl,
  );

  if (!url.searchParams.has("domain")) {
    url.searchParams.set("domain", company.handle);
  }

  return url.toString();
}

function formatLocation(position: EightfoldLocationFields): string | null {
  const locations = [...(position.locations ?? []), position.location]
    .filter((location): location is string =>
      typeof location === "string" && location.trim().length > 0
    )
    .map((location) => location.trim());
  const workLocation =
    position.workLocationOption ?? position.work_location_option;

  if (
    workLocation?.toLowerCase() === "remote" &&
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
  values: Array<string | number | null | undefined>,
  postedAfter?: Date,
): boolean {
  if (!postedAfter) {
    return false;
  }

  const dates = values
    .map((value) => parsePostingDate(value))
    .filter((date): date is Date => date !== null);

  return dates.length > 0 && dates.every((date) => date < postedAfter);
}

function invalidResponse(company: EightfoldCompanyConfig): Error {
  return new Error(
    `Eightfold returned an invalid jobs response for ${company.name}`,
  );
}

function missingDescription(
  company: EightfoldCompanyConfig,
  job: JobSummary,
): Error {
  return new Error(
    `Eightfold returned no job description for ${company.name} job ${job.jobId}`,
  );
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
