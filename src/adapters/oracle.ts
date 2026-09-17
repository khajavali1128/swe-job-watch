import type {
  CompanyConfig,
  OracleCompanyConfig,
} from "../config/index.js";
import type { JobDetails, JobSummary } from "../types.js";
import { AdapterHttpError } from "./errors.js";
import type { JobAdapter } from "./types.js";

interface OracleSecondaryLocation {
  Name?: string | null;
}

interface OracleListing {
  Id?: string | number | null;
  Title?: string | null;
  PrimaryLocation?: string | null;
  secondaryLocations?: OracleSecondaryLocation[] | null;
}

interface OracleListingContainer {
  TotalJobsCount?: number | null;
  requisitionList?: OracleListing[] | null;
}

interface OracleListingResponse {
  items?: OracleListingContainer[] | null;
}

interface OracleJobDetail extends OracleListing {
  ExternalPostedStartDate?: string | null;
  ExternalPostedEndDate?: string | null;
  ExternalDescriptionStr?: string | null;
  ExternalResponsibilitiesStr?: string | null;
  ExternalQualificationsStr?: string | null;
}

interface OracleDetailResponse {
  items?: OracleJobDetail[] | null;
}

const PAGE_SIZE = 200;
const DETAIL_BATCH_SIZE = 100;
const LISTING_PATH =
  "/hcmRestApi/resources/latest/recruitingCEJobRequisitions";
const DETAIL_PATH =
  "/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails";

export class OracleAdapter implements JobAdapter {
  async fetchJobSummaries(company: CompanyConfig): Promise<JobSummary[]> {
    assertOracleCompany(company);

    const listings = await this.fetchListings(company);
    const detailMetadata = await this.fetchDetailMetadata(
      company,
      listings.map((listing) => String(listing.Id)),
    );
    const now = Date.now();

    return listings.flatMap((listing) => {
      assertValidListing(company, listing);

      const jobId = String(listing.Id);
      const metadata = detailMetadata.get(jobId);
      const closesAt = parseDate(metadata?.ExternalPostedEndDate);

      if (closesAt && closesAt.getTime() <= now) {
        return [];
      }

      return [
        {
          companyId: company.id,
          companyName: company.name,
          jobId,
          title: listing.Title!.trim(),
          location: formatLocation(listing),
          url: `${trimTrailingSlash(company.publicJobBaseUrl)}/${encodeURIComponent(jobId)}`,
          postedAt: parseDate(metadata?.ExternalPostedStartDate),
          updatedAt: null,
          source: "oracle" as const,
        },
      ];
    });
  }

  async fetchJobDetails(
    company: CompanyConfig,
    job: JobSummary,
  ): Promise<JobDetails> {
    assertOracleCompany(company);

    const details = await this.fetchDetails(company, [job.jobId], true);
    const detail = details.find(
      (candidate) => String(candidate.Id) === job.jobId,
    );

    if (!detail) {
      throw new Error(
        `Oracle job ${job.jobId} was not found for ${company.name}`,
      );
    }

    return {
      ...job,
      location: formatLocation(detail) ?? job.location,
      description: joinUniqueSections([
        detail.ExternalDescriptionStr,
        detail.ExternalResponsibilitiesStr,
        detail.ExternalQualificationsStr,
      ]),
    };
  }

  private async fetchListings(
    company: OracleCompanyConfig,
  ): Promise<OracleListing[]> {
    const listings: OracleListing[] = [];
    let total = Number.POSITIVE_INFINITY;
    let offset = 0;

    while (offset < total) {
      const url = createApiUrl(company, LISTING_PATH);
      url.searchParams.set("onlyData", "true");
      url.searchParams.set("expand", "requisitionList.secondaryLocations");
      url.searchParams.set(
        "finder",
        `findReqs;siteNumber=${company.siteNumber},limit=${PAGE_SIZE},offset=${offset},sortBy=POSTING_DATES_DESC`,
      );

      const data = await fetchJson<OracleListingResponse>(company, url);
      const container = data.items?.[0];

      if (!container || !Array.isArray(container.requisitionList)) {
        throw new Error(
          `Oracle returned an invalid listing response for ${company.name}`,
        );
      }

      const page = container.requisitionList;
      listings.push(...page);
      total = validTotal(container.TotalJobsCount, listings.length);

      if (page.length === 0) {
        break;
      }

      offset += page.length;
    }

    return listings;
  }

  private async fetchDetailMetadata(
    company: OracleCompanyConfig,
    jobIds: string[],
  ): Promise<Map<string, OracleJobDetail>> {
    const detailsById = new Map<string, OracleJobDetail>();

    for (let index = 0; index < jobIds.length; index += DETAIL_BATCH_SIZE) {
      const batch = jobIds.slice(index, index + DETAIL_BATCH_SIZE);
      const details = await this.fetchDetails(company, batch, false);

      for (const detail of details) {
        if (detail.Id !== undefined && detail.Id !== null) {
          detailsById.set(String(detail.Id), detail);
        }
      }
    }

    return detailsById;
  }

  private async fetchDetails(
    company: OracleCompanyConfig,
    jobIds: string[],
    includeDescription: boolean,
  ): Promise<OracleJobDetail[]> {
    if (jobIds.length === 0) {
      return [];
    }

    const url = createApiUrl(company, DETAIL_PATH);
    url.searchParams.set("onlyData", "true");
    url.searchParams.set(
      "finder",
      `ById;Id=${jobIds.join(" or ")},siteNumber=${company.siteNumber}`,
    );
    url.searchParams.set("limit", String(Math.max(jobIds.length, 1)));

    if (includeDescription) {
      url.searchParams.set("expand", "secondaryLocations");
    } else {
      url.searchParams.set(
        "fields",
        "Id,ExternalPostedStartDate,ExternalPostedEndDate",
      );
    }

    const data = await fetchJson<OracleDetailResponse>(company, url);

    if (!Array.isArray(data.items)) {
      throw new Error(
        `Oracle returned an invalid detail response for ${company.name}`,
      );
    }

    return data.items;
  }
}

async function fetchJson<T>(
  company: OracleCompanyConfig,
  url: URL,
): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new AdapterHttpError(
      "Oracle",
      company.name,
      response.status,
      response.statusText,
    );
  }

  return (await response.json()) as T;
}

function assertOracleCompany(
  company: CompanyConfig,
): asserts company is OracleCompanyConfig {
  if (company.adapter !== "oracle") {
    throw new Error(
      `OracleAdapter cannot handle company ${company.name} with adapter ${company.adapter}`,
    );
  }
}

function assertValidListing(
  company: OracleCompanyConfig,
  listing: OracleListing,
): asserts listing is OracleListing & { Id: string | number; Title: string } {
  if (
    (typeof listing.Id !== "string" && typeof listing.Id !== "number") ||
    typeof listing.Title !== "string" ||
    listing.Title.trim().length === 0
  ) {
    throw new Error(`Oracle returned a malformed job for ${company.name}`);
  }
}

function createApiUrl(company: OracleCompanyConfig, path: string): URL {
  return new URL(path, `${trimTrailingSlash(company.apiBaseUrl)}/`);
}

function formatLocation(job: OracleListing): string | null {
  const locations = [
    job.PrimaryLocation,
    ...(job.secondaryLocations ?? []).map((location) => location.Name),
  ];

  return joinUniqueSections(locations, "; ") || null;
}

function joinUniqueSections(
  values: Array<string | null | undefined>,
  separator = "\n\n",
): string {
  const seen = new Set<string>();

  return values
    .filter((value): value is string =>
      typeof value === "string" && value.trim().length > 0
    )
    .map((value) => value.trim())
    .filter((value) => {
      const normalized = value.toLowerCase();

      if (seen.has(normalized)) {
        return false;
      }

      seen.add(normalized);
      return true;
    })
    .join(separator);
}

function validTotal(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function parseDate(value?: string | null): Date | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
