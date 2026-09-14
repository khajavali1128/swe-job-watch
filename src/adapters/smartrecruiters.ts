import type { CompanyConfig } from "../config/index.js";
import type { JobDetails, JobSummary } from "../types.js";
import type { JobAdapter } from "./types.js";

interface SmartRecruitersLocation {
  city?: string | null;
  region?: string | null;
  country?: string | null;
  remote?: boolean;
}

interface SmartRecruitersPosting {
  id: string;
  name: string;
  location?: SmartRecruitersLocation | null;
  postingUrl?: string;
  ref?: string;
  releasedDate?: string | null;
}

interface SmartRecruitersListResponse {
  totalFound: number;
  content: SmartRecruitersPosting[];
}

interface SmartRecruitersSection {
  text?: string;
}

interface SmartRecruitersPostingDetails extends SmartRecruitersPosting {
  jobAd?: {
    sections?: {
      companyDescription?: SmartRecruitersSection;
      jobDescription?: SmartRecruitersSection;
      qualifications?: SmartRecruitersSection;
      additionalInformation?: SmartRecruitersSection;
    };
  };
}

const SMARTRECRUITERS_BASE_URL =
  "https://api.smartrecruiters.com/v1/companies";
const PAGE_SIZE = 100;

export class SmartRecruitersAdapter implements JobAdapter {
  async fetchJobSummaries(company: CompanyConfig): Promise<JobSummary[]> {
    this.assertSmartRecruitersCompany(company);

    const postings: SmartRecruitersPosting[] = [];
    let offset = 0;
    let totalFound: number;

    do {
      const url = new URL(
        `${SMARTRECRUITERS_BASE_URL}/${encodeURIComponent(company.handle)}/postings`,
      );
      url.searchParams.set("limit", String(PAGE_SIZE));
      url.searchParams.set("offset", String(offset));

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(
          `SmartRecruiters request failed for ${company.name}: ${response.status} ${response.statusText}`,
        );
      }

      const page = (await response.json()) as SmartRecruitersListResponse;
      postings.push(...page.content);
      totalFound = page.totalFound;
      offset += page.content.length;

      if (page.content.length === 0) {
        break;
      }
    } while (offset < totalFound);

    return postings.map((posting) => ({
      companyId: company.id,
      companyName: company.name,
      jobId: String(posting.id),
      title: posting.name,
      location: formatLocation(posting.location),
      url: posting.postingUrl ?? posting.ref ?? "",
      postedAt: parseDate(posting.releasedDate),
      updatedAt: null,
      source: "smartrecruiters",
    }));
  }

  async fetchJobDetails(
    company: CompanyConfig,
    job: JobSummary,
  ): Promise<JobDetails> {
    this.assertSmartRecruitersCompany(company);

    const url = `${SMARTRECRUITERS_BASE_URL}/${encodeURIComponent(company.handle)}/postings/${encodeURIComponent(job.jobId)}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        `SmartRecruiters request failed for ${company.name}: ${response.status} ${response.statusText}`,
      );
    }

    const posting =
      (await response.json()) as SmartRecruitersPostingDetails;
    const sections = posting.jobAd?.sections;
    const description = [
      sections?.companyDescription?.text,
      sections?.jobDescription?.text,
      sections?.qualifications?.text,
      sections?.additionalInformation?.text,
    ]
      .filter((text): text is string => Boolean(text))
      .join("\n\n");

    return {
      ...job,
      url: posting.postingUrl ?? job.url,
      description,
    };
  }

  private assertSmartRecruitersCompany(company: CompanyConfig): void {
    if (company.adapter !== "smartrecruiters") {
      throw new Error(
        `SmartRecruitersAdapter cannot handle company ${company.name} with adapter ${company.adapter}`,
      );
    }
  }
}

function formatLocation(
  location?: SmartRecruitersLocation | null,
): string | null {
  if (!location) {
    return null;
  }

  const parts = [location.city, location.region, location.country].filter(
    (part): part is string => Boolean(part),
  );

  if (location.remote) {
    parts.unshift("Remote");
  }

  return parts.length > 0 ? parts.join(", ") : null;
}

function parseDate(value?: string | null): Date | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
