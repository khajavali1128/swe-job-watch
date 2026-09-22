import type { CompanyConfig } from "../config/index.js";
import type { JobDetails, JobSummary } from "../types.js";
import { AdapterHttpError } from "./errors.js";
import type { JobAdapter } from "./types.js";

type GreenhouseCompanyConfig = Extract<
  CompanyConfig,
  { adapter: "greenhouse" }
>;

interface GreenhouseLocation {
  name?: string | null;
}

interface GreenhouseJobSummary {
  id: number | string;
  title: string;
  location?: GreenhouseLocation | null;
  absolute_url: string;
  first_published?: string | null;
  updated_at?: string | null;
}

interface GreenhouseJobsResponse {
  jobs: GreenhouseJobSummary[];
}

interface GreenhouseJobDetailsResponse {
  content: string;
}

const GREENHOUSE_BASE_URL = "https://boards-api.greenhouse.io/v1/boards";

function parseDate(value?: string | null): Date | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export class GreenhouseAdapter implements JobAdapter {
  async fetchJobSummaries(company: CompanyConfig): Promise<JobSummary[]> {
    this.assertGreenhouseCompany(company);

    const url = `${GREENHOUSE_BASE_URL}/${encodeURIComponent(company.handle)}/jobs`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new AdapterHttpError(
        "Greenhouse",
        company.name,
        response.status,
        response.statusText,
      );
    }

    const data = (await response.json()) as GreenhouseJobsResponse;

    return data.jobs.map((greenhouseJob) => ({
      companyId: company.id,
      companyName: company.name,
      jobId: String(greenhouseJob.id),
      title: greenhouseJob.title,
      location: greenhouseJob.location?.name ?? null,
      url: greenhouseJob.absolute_url,
      postedAt: parseDate(greenhouseJob.first_published),
      updatedAt: parseDate(greenhouseJob.updated_at),
      source: "greenhouse",
    }));
  }

  async fetchJobDetails(
    company: CompanyConfig,
    job: JobSummary,
  ): Promise<JobDetails> {
    this.assertGreenhouseCompany(company);

    const url = `${GREENHOUSE_BASE_URL}/${encodeURIComponent(company.handle)}/jobs/${encodeURIComponent(job.jobId)}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new AdapterHttpError(
        "Greenhouse",
        company.name,
        response.status,
        response.statusText,
      );
    }

    const data = (await response.json()) as GreenhouseJobDetailsResponse;

    return {
      ...job,
      description: data.content,
    };
  }

  private assertGreenhouseCompany(
    company: CompanyConfig,
  ): asserts company is GreenhouseCompanyConfig {
    if (company.adapter !== "greenhouse") {
      throw new Error(
        `GreenhouseAdapter cannot handle company ${company.name} with adapter ${company.adapter}`,
      );
    }
  }
}
