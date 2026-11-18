import { load } from "cheerio";

import type { CompanyConfig } from "../../config/index.js";
import type { JobDetails, JobSummary } from "../../types.js";
import { AdapterHttpError } from "../errors.js";
import type { JobAdapter } from "../types.js";

const CAREERS_URL = "https://careers.cisco.com/global/en";
const LIST_URL = `${CAREERS_URL}/c/product-and-engineering-jobs`;

interface CiscoJob {
  jobId?: string | number;
  jobSeqNo?: string;
  title?: string;
  location?: string | null;
  country?: string | null;
  multi_location?: string[] | null;
  postedDate?: string | null;
  jobUpdatedDate?: string | null;
  description?: string | null;
}

interface CiscoPageData {
  eagerLoadRefineSearch?: {
    totalHits?: number;
    data?: { jobs?: CiscoJob[] };
  };
  jobDetail?: {
    data?: { job?: CiscoJob };
  };
}

export class CiscoAdapter implements JobAdapter {
  async fetchJobSummaries(company: CompanyConfig): Promise<JobSummary[]> {
    assertCiscoCompany(company);

    const summaries: JobSummary[] = [];
    const seenIds = new Set<string>();
    let offset = 0;

    while (true) {
      const url = new URL(LIST_URL);
      if (offset > 0) {
        url.searchParams.set("from", String(offset));
      }

      const page = await fetchPage(url.toString(), company);
      const listings = page.eagerLoadRefineSearch;
      const jobs = listings?.data?.jobs;
      const totalHits = listings?.totalHits;

      if (!Array.isArray(jobs) || typeof totalHits !== "number" ||
        !Number.isInteger(totalHits) || totalHits < 0) {
        throw new Error(
          `Cisco returned an invalid listing page for ${company.name}`,
        );
      }

      if (jobs.length === 0) {
        if (offset < totalHits) {
          throw new Error(
            `Cisco listing pagination stopped early for ${company.name} at offset ${offset}`,
          );
        }
        break;
      }

      for (const listing of jobs) {
        const summary = normalizeSummary(company, listing);
        if (summary && !seenIds.has(summary.jobId)) {
          seenIds.add(summary.jobId);
          summaries.push(summary);
        }
      }

      offset += jobs.length;
      if (offset >= totalHits) {
        break;
      }
    }

    return summaries;
  }

  async fetchJobDetails(
    company: CompanyConfig,
    job: JobSummary,
  ): Promise<JobDetails> {
    assertCiscoCompany(company);

    const page = await fetchPage(job.url, company);
    const detail = page.jobDetail?.data?.job;
    if (
      !detail ||
      String(detail.jobId) !== job.jobId ||
      typeof detail.description !== "string" ||
      !detail.description.trim()
    ) {
      throw new Error(
        `Cisco returned invalid job details for ${company.name} job ${job.jobId}`,
      );
    }

    return {
      ...job,
      postedAt: parseDate(detail.postedDate) ?? job.postedAt,
      updatedAt: parseDate(detail.jobUpdatedDate),
      description: detail.description,
    };
  }
}

async function fetchPage(
  url: string,
  company: CompanyConfig,
): Promise<CiscoPageData> {
  const response = await fetch(url, {
    headers: { Accept: "text/html" },
  });

  if (!response.ok) {
    throw new AdapterHttpError(
      "Cisco",
      company.name,
      response.status,
      response.statusText,
    );
  }

  const $ = load(await response.text());
  const script = $("script")
    .toArray()
    .map((element) => $(element).html() ?? "")
    .find((content) => content.includes("phApp.ddo = "));
  const marker = "phApp.ddo = ";
  const start = script?.indexOf(marker) ?? -1;
  const end = script?.indexOf("; phApp", start + marker.length) ?? -1;

  if (!script || start < 0 || end < 0) {
    throw new Error(`Cisco did not expose job data for ${company.name}: ${url}`);
  }

  try {
    return JSON.parse(script.slice(start + marker.length, end)) as CiscoPageData;
  } catch (error) {
    throw new Error(
      `Cisco returned invalid embedded job data for ${company.name}: ${url}`,
      { cause: error },
    );
  }
}

function normalizeSummary(
  company: CompanyConfig,
  listing: CiscoJob,
): JobSummary | null {
  const jobId = String(listing.jobId ?? "").trim();
  const title = listing.title?.trim();
  const jobSeqNo = listing.jobSeqNo?.trim();

  if (!jobId || !title || !jobSeqNo) {
    return null;
  }

  const locations = [
    listing.location,
    ...(Array.isArray(listing.multi_location) ? listing.multi_location : []),
  ].filter(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0,
  );
  const usLocations = [
    ...new Set(locations.filter((value) => isUsLocation(value))),
  ];
  const usCountry = isUsLocation(listing.country ?? "");

  // Cisco returns every country for this category. Retain US options in
  // multi-location postings even when their primary location is elsewhere.
  if (!usCountry && usLocations.length === 0) {
    return null;
  }

  const location = usLocations.length > 0
    ? usLocations.join(" | ")
    : [listing.location, listing.country].filter(Boolean).join(", ");

  return {
    companyId: company.id,
    companyName: company.name,
    jobId,
    title,
    location,
    url: `${CAREERS_URL}/job/${encodeURIComponent(jobSeqNo)}`,
    postedAt: parseDate(listing.postedDate),
    updatedAt: null,
    source: "cisco",
  };
}

function isUsLocation(value: string): boolean {
  return /\b(?:united states(?: of america)?|usa)\b/i.test(value);
}

function parseDate(value?: string | null): Date | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function assertCiscoCompany(company: CompanyConfig): void {
  if (company.adapter !== "cisco") {
    throw new Error(
      `CiscoAdapter cannot handle company ${company.name} with adapter ${company.adapter}`,
    );
  }
}
