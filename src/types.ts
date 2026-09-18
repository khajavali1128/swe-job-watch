export type JobSource =
  | "apple"
  | "avature"
  | "eightfold"
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
