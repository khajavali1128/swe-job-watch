import type { CompanyConfig } from "../config/index.js";
import type { JobDetails, JobSummary } from "../types.js";
import type { JobAdapter } from "./types.js";

interface LeverCategories {
  location?: string | null;
  allLocations?: string[];
  commitment?: string | null;
}

interface LeverPosting {
  id: string;
  text: string;
  categories?: LeverCategories;
  country?: string | null;
  description?: string;
  descriptionPlain?: string;
  hostedUrl?: string;
  applyUrl?: string;
  workplaceType?: string;
}

const LEVER_BASE_URL = "https://api.lever.co/v0/postings";

export class LeverAdapter implements JobAdapter {
  async fetchJobSummaries(company: CompanyConfig): Promise<JobSummary[]> {
    this.assertLeverCompany(company);

    const url = `${LEVER_BASE_URL}/${encodeURIComponent(company.handle)}?mode=json`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(
        `Lever request failed for ${company.name}: ${response.status} ${response.statusText}`,
      );
    }

    const postings = (await response.json()) as LeverPosting[];

    return postings.map((posting) => ({
      companyId: company.id,
      companyName: company.name,
      jobId: String(posting.id),
      title: posting.text,
      location: formatLocation(posting),
      url: posting.hostedUrl ?? posting.applyUrl ?? "",
      postedAt: null,
      updatedAt: null,
      source: "lever",
    }));
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
      throw new Error(
        `Lever request failed for ${company.name}: ${response.status} ${response.statusText}`,
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
