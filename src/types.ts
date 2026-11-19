export type JobSource =
  | "atlassian"
  | "apple"
  | "avature"
  | "bytedance"
  | "cisco"
  | "eightfold"
  | "greenhouse"
  | "icims"
  | "intuit"
  | "netapp"
  | "lever"
  | "smartrecruiters"
  | "ashby"
  | "oracle"
  | "successfactors"
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
