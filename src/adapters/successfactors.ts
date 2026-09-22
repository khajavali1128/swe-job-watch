import { load, type CheerioAPI } from "cheerio";

import type {
  CompanyConfig,
  SuccessFactorsCompanyConfig,
} from "../config/index.js";
import type { JobDetails, JobSummary } from "../types.js";
import { AdapterHttpError } from "./errors.js";
import type { JobAdapter, JobSummaryQuery } from "./types.js";

interface SuccessFactorsListing {
  jobId: string;
  title: string;
  location: string | null;
  url: string;
}

interface SuccessFactorsSearchPage {
  listings: SuccessFactorsListing[];
  nextUrl: URL | null;
}

interface SuccessFactorsDetailPage {
  postedAt: Date | null;
  requisitionId: string | null;
  location: string | null;
  description: string;
}

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/126.0.0.0 Safari/537.36";

export class SuccessFactorsAdapter implements JobAdapter {
  async fetchJobSummaries(
    company: CompanyConfig,
    _query?: JobSummaryQuery,
  ): Promise<JobSummary[]> {
    assertSuccessFactorsCompany(company);

    const listings: SuccessFactorsListing[] = [];
    const seenJobIds = new Set<string>();
    const visitedPages = new Set<string>();
    let pageUrl: URL | null = new URL(
      company.searchPath,
      ensureTrailingSlash(company.apiBaseUrl),
    );

    while (pageUrl && !visitedPages.has(pageUrl.toString())) {
      visitedPages.add(pageUrl.toString());
      const html = await fetchHtml(company, pageUrl);
      const page = parseSearchPage(html, pageUrl);

      for (const listing of page.listings) {
        if (seenJobIds.has(listing.jobId)) {
          continue;
        }

        seenJobIds.add(listing.jobId);
        listings.push(listing);
      }

      pageUrl = page.nextUrl;
    }

    return listings.map((listing) => ({
      companyId: company.id,
      companyName: company.name,
      jobId: listing.jobId,
      title: listing.title,
      location: listing.location,
      url: listing.url,
      postedAt: null,
      updatedAt: null,
      source: "successfactors",
    }));
  }

  async fetchJobDetails(
    company: CompanyConfig,
    job: JobSummary,
  ): Promise<JobDetails> {
    assertSuccessFactorsCompany(company);

    const html = await fetchHtml(company, new URL(job.url));
    const details = parseDetailPage(html);

    if (!details.description) {
      const requisition = details.requisitionId
        ? ` requisition ${details.requisitionId}`
        : "";
      throw new Error(
        `SuccessFactors returned no description for ${company.name}${requisition}`,
      );
    }

    return {
      ...job,
      location: job.location ?? details.location,
      postedAt: details.postedAt ?? job.postedAt,
      description: details.description,
    };
  }
}

function assertSuccessFactorsCompany(
  company: CompanyConfig,
): asserts company is SuccessFactorsCompanyConfig {
  if (company.adapter !== "successfactors") {
    throw new Error(
      `SuccessFactorsAdapter cannot handle company ${company.name} with adapter ${company.adapter}`,
    );
  }
}

async function fetchHtml(
  company: SuccessFactorsCompanyConfig,
  url: URL,
): Promise<string> {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new AdapterHttpError(
      "SuccessFactors",
      company.name,
      response.status,
      response.statusText,
    );
  }

  return response.text();
}

function parseSearchPage(
  html: string,
  pageUrl: URL,
): SuccessFactorsSearchPage {
  const $ = load(html);
  const listings: SuccessFactorsListing[] = [];
  const pageJobIds = new Set<string>();
  const preferredAnchors = $("a.jobTitle-link[href]");
  const anchors = preferredAnchors.length > 0
    ? preferredAnchors
    : $('a[href*="/job/"]');

  anchors.each((_, element) => {
    const anchor = $(element);
    const href = anchor.attr("href");
    const title = normalizeText(anchor.text());

    if (!href || !title) {
      return;
    }

    const url = new URL(href, pageUrl);
    const jobId = jobIdFromUrl(url);

    if (!jobId || pageJobIds.has(jobId)) {
      return;
    }

    pageJobIds.add(jobId);
    const container = anchor.closest(
      "tr.data-row, tr, article, li, [class*='job-tile']",
    );
    const locationText = normalizeText(
      container
        .find(
          ".jobLocation, [data-careersite-propertyid='location'], " +
            "[data-careersite-propertyid='city'], [class*='job-location']",
        )
        .first()
        .text(),
    );

    listings.push({
      jobId,
      title,
      location: locationText || null,
      url: url.toString(),
    });
  });

  return {
    listings,
    nextUrl: findNextPageUrl($, pageUrl),
  };
}

function findNextPageUrl($: CheerioAPI, pageUrl: URL): URL | null {
  const explicitNext = $(
    "a[rel='next'][href], a[title='Next Page'][href], " +
      "a[aria-label='Next Page'][href]",
  ).first();
  const explicitHref = explicitNext.attr("href");

  if (explicitHref) {
    return new URL(explicitHref, pageUrl);
  }

  const currentOffset = parseStartRow(pageUrl) ?? 0;
  const candidates: Array<{ offset: number; url: URL }> = [];

  $(".pagination a[href], .paginationShell a[href]").each((_, element) => {
    const href = $(element).attr("href");

    if (!href) {
      return;
    }

    const url = new URL(href, pageUrl);
    const offset = parseStartRow(url);

    if (offset !== null && offset > currentOffset) {
      candidates.push({ offset, url });
    }
  });

  candidates.sort((left, right) => left.offset - right.offset);
  return candidates[0]?.url ?? null;
}

function parseDetailPage(html: string): SuccessFactorsDetailPage {
  const $ = load(html);
  const descriptionElement = $(
    "[data-careersite-propertyid='description'] .jobdescription, " +
      "[itemprop='description'] .jobdescription, .jobdescription, " +
      "[data-careersite-propertyid='description'], [itemprop='description']",
  ).first();
  const description = descriptionElement.html()?.trim() ?? "";

  return {
    postedAt: parseDateOnly(
      propertyText($, "date") ??
        semanticField($, ["Date", "Posted Date", "Date Posted"]),
    ),
    requisitionId: semanticField($, ["Requisition ID", "Job Requisition ID"]),
    location:
      propertyText($, "location") ??
      propertyText($, "city") ??
      semanticField($, ["Location"]),
    description,
  };
}

function propertyText($: CheerioAPI, propertyId: string): string | null {
  const value = normalizeText(
    $(`[data-careersite-propertyid='${propertyId}']`).first().text(),
  );
  return value || null;
}

function semanticField(
  $: CheerioAPI,
  labels: string[],
): string | null {
  const normalizedLabels = new Set(labels.map(normalizeLabel));
  let result: string | null = null;

  $(".joblayouttoken").each((_, element) => {
    if (result) {
      return;
    }

    const token = $(element);
    const label = normalizeLabel(
      token.find(".joblayouttoken-label").first().text(),
    );

    if (!normalizedLabels.has(label)) {
      return;
    }

    const valueElement = token
      .find("[data-careersite-propertyid], [itemprop]")
      .filter((_, candidate) => !$(candidate).hasClass("joblayouttoken-label"))
      .first();
    const value = normalizeText(valueElement.text());

    if (value) {
      result = value;
    }
  });

  if (result) {
    return result;
  }

  const text = normalizeText($("main").text() || $("body").text());

  for (const label of labels) {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = text.match(
      new RegExp(`${escapedLabel}\\s*:\\s*([^|]{1,160}?)(?=\\s{2,}|$)`, "i"),
    );

    if (match?.[1]) {
      return normalizeText(match[1]);
    }
  }

  return null;
}

function jobIdFromUrl(url: URL): string | null {
  const parts = url.pathname.split("/").filter(Boolean);
  const jobIndex = parts.findIndex((part) => part.toLowerCase() === "job");

  if (jobIndex < 0 || jobIndex === parts.length - 1) {
    return null;
  }

  const trailingParts = parts.slice(jobIndex + 1);
  const numericId = [...trailingParts]
    .reverse()
    .find((part) => /^\d+$/.test(part));

  return numericId ?? trailingParts.at(-1) ?? null;
}

function parseStartRow(url: URL): number | null {
  const value = url.searchParams.get("startrow");

  if (value === null) {
    return null;
  }

  const offset = Number(value);
  return Number.isInteger(offset) && offset >= 0 ? offset : null;
}

function parseDateOnly(value: string | null): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(`${value} 23:59:59.999 UTC`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeLabel(value: string): string {
  return normalizeText(value).replace(/:\s*$/, "").toLowerCase();
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
