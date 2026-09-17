export type JobSource =
  | "greenhouse"
  | "lever"
  | "smartrecruiters"
  | "ashby"
  | "oracle"
  | "workday";

export interface JobSummary {
  companyId: string;
  companyName: string;

  jobId: string;
  title: string;
  location: string | null;
  url: string;

  postedAt: Date | null;
  updatedAt: Date | null;

  source: JobSource;
}

export interface JobDetails extends JobSummary {
  description: string;
}
