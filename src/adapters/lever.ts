import type { CompanyConfig } from "../config/index.js";
import type { JobDetails, JobSummary } from "../types.js";
import { AdapterHttpError } from "./errors.js";
import type { JobAdapter } from "./types.js";

interface LeverCategories {
  location?: string | null;
  allLocations?: string[];
  commitment?: string | null;
}

interface LeverPosting {
  id: string;
  text: string;
  createdAt?: number | string | null;
  categories?: LeverCategories;
  country?: string | null;
  description?: string;
  descriptionPlain?: string;
  hostedUrl?: string;
  applyUrl?: string;
  workplaceType?: string;
}

const LEVER_BASE_URL = "https://api.lever.co/v0/postings";
const LEVER_PAGE_SIZE = 100;
const EARLIEST_PLAUSIBLE_POSTING = Date.UTC(2000, 0, 1);
const MAX_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;

export class LeverAdapter implements JobAdapter {
  async fetchJobSummaries(company: CompanyConfig): Promise<JobSummary[]> {
    this.assertLeverCompany(company);

    const postings = await this.fetchAllPostings(company);

    return postings.flatMap((posting) => {
      const postedAt = parseLeverCreatedAt(posting.createdAt);

      if (!postedAt) {
        console.warn(
          `[${company.name}] Skipping Lever job ${posting.id}: missing or invalid createdAt`,
        );
        return [];
      }

      return [{
        companyId: company.id,
        companyName: company.name,
        jobId: String(posting.id),
        title: posting.text,
        location: formatLocation(posting),
        url: posting.hostedUrl ?? posting.applyUrl ?? "",
        postedAt,
        updatedAt: null,
        source: "lever" as const,
      }];
    });
  }

  async fetchJobDetails(
    company: CompanyConfig,
    job: JobSummary,
  ): Promise<JobDetails> {
    this.assertLeverCompany(company);

    const url = `${LEVER_BASE_URL}/${encodeURIComponent(company.handle)}/${encodeURIComponent(job.jobId)}?mode=json`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new AdapterHttpError(
        "Lever",
        company.name,
        response.status,
        response.statusText,
      );
    }

    const posting = (await response.json()) as LeverPosting;

    return {
      ...job,
      description: posting.descriptionPlain ?? posting.description ?? "",
    };
  }

  private assertLeverCompany(company: CompanyConfig): void {
    if (company.adapter !== "lever") {
      throw new Error(
        `LeverAdapter cannot handle company ${company.name} with adapter ${company.adapter}`,
      );
    }
  }

  private async fetchAllPostings(
    company: CompanyConfig,
  ): Promise<LeverPosting[]> {
    const postings: LeverPosting[] = [];
    let skip = 0;

    while (true) {
      const url = new URL(
        `${LEVER_BASE_URL}/${encodeURIComponent(company.handle)}`,
      );
      url.searchParams.set("mode", "json");
      url.searchParams.set("limit", String(LEVER_PAGE_SIZE));
      url.searchParams.set("skip", String(skip));

      const response = await fetch(url, {
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        throw new AdapterHttpError(
          "Lever",
          company.name,
          response.status,
          response.statusText,
        );
      }

      const page = await response.json();

      if (!Array.isArray(page)) {
        throw new Error(
          `Lever returned an invalid postings response for ${company.name}`,
        );
      }

      postings.push(...(page as LeverPosting[]));

      if (page.length < LEVER_PAGE_SIZE) {
        return postings;
      }

      skip += page.length;
    }
  }
}

function parseLeverCreatedAt(
  value: number | string | null | undefined,
): Date | null {
  const timestamp = typeof value === "number" ? value : Number(value);

  if (
    !Number.isFinite(timestamp) ||
    timestamp < EARLIEST_PLAUSIBLE_POSTING ||
    timestamp > Date.now() + MAX_FUTURE_SKEW_MS
  ) {
    return null;
  }

  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatLocation(posting: LeverPosting): string | null {
  const locations =
    posting.categories?.allLocations?.filter(Boolean) ?? [];

  if (locations.length === 0 && posting.categories?.location) {
    locations.push(posting.categories.location);
  }

  if (posting.country && !locations.includes(posting.country)) {
    locations.push(posting.country);
  }

  if (posting.workplaceType === "remote") {
    locations.unshift("Remote");
  }

  return locations.length > 0 ? [...new Set(locations)].join("; ") : null;
}
