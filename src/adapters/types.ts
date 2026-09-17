import type {
  JobDetails,
  JobSummary,
} from "../types.js";

import type {
  CompanyConfig,
} from "../config/index.js";

export interface JobSummaryQuery {
  postedAfter?: Date;
}

export interface JobAdapter {
  fetchJobSummaries(
    company: CompanyConfig,
    query?: JobSummaryQuery,
  ): Promise<JobSummary[]>;

  fetchJobDetails(
    company: CompanyConfig,
    job: JobSummary,
  ): Promise<JobDetails>;
}
