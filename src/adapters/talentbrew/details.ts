import { load } from "cheerio";

import type { CompanyConfig } from "../../config/index.js";
import type { JobDetails, JobSummary } from "../../types.js";

interface JobPlace {
  address?: {
    addressLocality?: string;
    addressRegion?: string;
    addressCountry?: string;
  };
}

interface JobPosting {
  "@type"?: string;
  datePosted?: string;
  description?: string;
  jobLocation?: JobPlace | JobPlace[];
}

export function parseTalentBrewDetails(
  html: string,
  company: CompanyConfig,
  job: JobSummary,
): JobDetails {
  const $ = load(html);
  let posting: JobPosting | undefined;

  $("script[type='application/ld+json']").each((_, element) => {
    try {
      const value = JSON.parse($(element).html() ?? "") as JobPosting;
      if (value["@type"] === "JobPosting") posting = value;
    } catch {
      // Other scripts may contain unrelated or malformed structured data.
    }
  });

  const date = posting?.datePosted;
  const description = posting?.description?.trim();
  const postedAt = date ? new Date(date) : null;

  if (!description || !postedAt || Number.isNaN(postedAt.getTime())) {
    throw new Error(
      `${company.name} returned invalid job details for job ${job.jobId}`,
    );
  }

  const places = posting?.jobLocation;
  const locations = (Array.isArray(places) ? places : places ? [places] : [])
    .map((place) => place.address)
    .filter((address): address is NonNullable<typeof address> => !!address)
    .map((address) => [address.addressLocality, address.addressRegion, address.addressCountry]
      .filter(Boolean).join(", "))
    .filter(Boolean);

  return {
    ...job,
    location: locations.length ? [...new Set(locations)].join(" | ") : job.location,
    postedAt,
    description,
  };
}
