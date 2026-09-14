import type {
  JobDetails,
  JobSummary,
} from "../types.js";

import type {
  CompanyConfig,
} from "../config/index.js";

export interface JobAdapter {
  fetchJobSummaries(
    company: CompanyConfig,
  ): Promise<JobSummary[]>;

  fetchJobDetails(
    company: CompanyConfig,
    job: JobSummary,
  ): Promise<JobDetails>;
}
