import { load, type CheerioAPI } from "cheerio";

import type {
  AvatureCompanyConfig,
  CompanyConfig,
} from "../config/index.js";
import type { JobDetails, JobSummary } from "../types.js";
import { AdapterHttpError } from "./errors.js";
import type { JobAdapter, JobSummaryQuery } from "./types.js";

interface AvatureListing {
  jobId: string;
  title: string;
  location: string | null;
  url: string;
  postedAt: Date | null;
}

interface AvatureSearchPage {
  listings: AvatureListing[];
  hasNext: boolean;
  nextOffset: number | null;
}

const MAX_PAGES = 200;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/126.0.0.0 Safari/537.36";
const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

export class AvatureAdapter implements JobAdapter {
  private readonly detailHtmlByUrl = new Map<string, string>();

  async fetchJobSummaries(
    company: CompanyConfig,
    query?: JobSummaryQuery,
  ): Promise<JobSummary[]> {
    assertAvatureCompany(company);

    const now = new Date();
    const listings: AvatureListing[] = [];
    const seenJobIds = new Set<string>();
    const searchTerms = company.searchTerms ?? [undefined];

    for (const searchTerm of searchTerms) {
      const seenOffsets = new Set<number>();
      let offset = 0;

      for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
        if (seenOffsets.has(offset)) {
          break;
        }

        seenOffsets.add(offset);
        const url = searchUrl(company, offset, searchTerm);
        const html = await fetchHtml(company, url);
        const page = parseSearchPage(html, portalUrl(company), now);

        if (company.hydrateListingDates) {
          await Promise.all(
            page.listings.map(async (listing) => {
              if (listing.postedAt) {
                return;
              }

              const detailHtml = await fetchHtml(company, new URL(listing.url));
              this.detailHtmlByUrl.set(listing.url, detailHtml);
              listing.postedAt = detailPostingDate(
                extractDetailFields(load(detailHtml)),
                now,
              );
            }),
          );
        }
        const newListings = page.listings.filter((listing) => {
          if (seenJobIds.has(listing.jobId)) {
            return false;
          }

          seenJobIds.add(listing.jobId);
          return true;
        });

        listings.push(...newListings);

        if (page.listings.length > 0 && newListings.length === 0) {
          break;
        }

        if (reachedPostingCutoff(page.listings, query?.postedAfter)) {
          break;
        }

        if (!page.hasNext || page.listings.length === 0) {
          break;
        }

        const nextOffset = page.nextOffset ?? offset + page.listings.length;

        if (nextOffset <= offset) {
          break;
        }

        offset = nextOffset;
      }
    }

    return listings
      .filter(
        (listing) =>
          !query?.postedAfter ||
          !listing.postedAt ||
          listing.postedAt >= query.postedAfter,
      )
      .map((listing) => ({
        companyId: company.id,
        companyName: company.name,
        jobId: listing.jobId,
        title: listing.title,
        location: listing.location,
        url: listing.url,
        postedAt: listing.postedAt,
        updatedAt: null,
        source: "avature" as const,
      }));
  }

  async fetchJobDetails(
    company: CompanyConfig,
    job: JobSummary,
  ): Promise<JobDetails> {
    assertAvatureCompany(company);

    const html = this.detailHtmlByUrl.get(job.url) ??
      await fetchHtml(company, new URL(job.url));
    const $ = load(html);
    const fields = extractDetailFields($);
    const description = extractDescription($);

    if (!description) {
      throw new Error(
        `Avature returned an invalid detail response for ${company.name}`,
      );
    }

    return {
      ...job,
      title: detailTitle($, fields) ?? job.title,
      location: detailLocation(fields) ?? job.location,
      postedAt:
        detailPostingDate(fields, new Date()) ?? job.postedAt,
      description,
    };
  }
}

function assertAvatureCompany(
  company: CompanyConfig,
): asserts company is AvatureCompanyConfig {
  if (company.adapter !== "avature") {
    throw new Error(
      `AvatureAdapter cannot handle company ${company.name} with adapter ${company.adapter}`,
    );
  }
}

async function fetchHtml(
  company: AvatureCompanyConfig,
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
      "Avature",
      company.name,
      response.status,
      response.statusText,
    );
  }

  return response.text();
}

function parseSearchPage(
  html: string,
  baseUrl: URL,
  now: Date,
): AvatureSearchPage {
  const $ = load(html);
  const listings: AvatureListing[] = [];

  $("article.article--result").each((_, element) => {
    const article = $(element);
    const anchor = findTitleAnchor($, article);

    if (!anchor) {
      return;
    }

    const href = anchor.attr("href");
    const title = normalizeText(anchor.text());

    if (!href || !title) {
      return;
    }

    const url = new URL(href, baseUrl);
    const jobId = jobIdFromUrl(url);

    if (!jobId) {
      return;
    }

    listings.push({
      jobId,
      title,
      location: listingLocation($, article),
      url: url.toString(),
      postedAt: parsePostedText(normalizeText(article.text()), now),
    });
  });

  const nextLink = $("a.paginationNextLink, .paginationNextLink a").first();
  const nextHref = nextLink.attr("href");

  return {
    listings,
    hasNext: nextLink.length > 0 && typeof nextHref === "string",
    nextOffset: nextHref
      ? parseOffset(new URL(nextHref, baseUrl))
      : null,
  };
}

function findTitleAnchor(
  $: CheerioAPI,
  article: ReturnType<CheerioAPI>,
): ReturnType<CheerioAPI> | null {
  const preferred = article
    .find(
      '.article__header__text__title a[href*="/JobDetail/"], ' +
        'h3 a[href*="/JobDetail/"], ' +
        'a.link[href*="/JobDetail/"]',
    )
    .filter((_, element) => normalizeText($(element).text()).length > 0)
    .first();

  if (preferred.length > 0) {
    return preferred;
  }

  const fallback = article
    .find('a[href*="/JobDetail/"]')
    .filter((_, element) => {
      const text = normalizeText($(element).text());
      return text.length > 0 && !/^(apply|save)$/i.test(text);
    })
    .first();

  return fallback.length > 0 ? fallback : null;
}

function listingLocation(
  $: CheerioAPI,
  article: ReturnType<CheerioAPI>,
): string | null {
  const direct = normalizeText(
    article.find(".list-item-location, .location").first().text(),
  );

  if (direct) {
    return direct;
  }

  let location = "";

  article.find(".article__content__field").each((_, element) => {
    const field = $(element);
    const label = normalizeText(
      field.find(".article__content__field__label").text(),
    );

    if (/location/i.test(label)) {
      location = normalizeText(
        field.find(".article__content__field__value").text(),
      );
    }
  });

  return location || null;
}

function extractDetailFields($: CheerioAPI): Map<string, string> {
  const fields = new Map<string, string>();

  $(".article__content__view__field").each((_, element) => {
    const field = $(element);
    const label = normalizeText(
      field.find(".article__content__view__field__label").first().text(),
    ).toLowerCase();
    const value = normalizeText(
      field.find(".article__content__view__field__value").first().text(),
    );

    if (label && value && !fields.has(label)) {
      fields.set(label, value);
    }
  });

  return fields;
}

function extractDescription($: CheerioAPI): string {
  const sections = $("article.article--details").toArray();
  const preferredSections = sections.filter((element) => {
    const heading = normalizeText(
      $(element).find(".article__header__text__title").first().text(),
    );
    return /description|requirement|qualification|responsibilit/i.test(
      heading,
    );
  });
  const selectedSections =
    preferredSections.length > 0
      ? preferredSections
      : sections.filter((element) => {
          const heading = normalizeText(
            $(element).find(".article__header__text__title").first().text(),
          );
          return !/general information/i.test(heading);
        });

  return selectedSections
    .map((element) => {
      const content = $(element).find(".article__content").first();
      const blocks = content
        .find("h1, h2, h3, h4, h5, h6, p, li")
        .toArray()
        .map((block) => normalizeText($(block).text()))
        .filter(Boolean);

      return blocks.length > 0
        ? blocks.join("\n")
        : normalizeText(content.text());
    })
    .filter(Boolean)
    .join("\n");
}

function detailTitle(
  $: CheerioAPI,
  fields: Map<string, string>,
): string | null {
  const fieldTitle = findField(fields, ["job title", "title", "name"]);

  if (fieldTitle) {
    return fieldTitle;
  }

  const openGraphTitle = normalizeText(
    $('meta[property="og:title"]').attr("content") ?? "",
  );
  return openGraphTitle || null;
}

function detailLocation(fields: Map<string, string>): string | null {
  for (const [label, value] of fields) {
    if (/location/.test(label)) {
      return value;
    }
  }

  const parts = [
    findField(fields, ["city"]),
    findField(fields, ["state/province", "state", "province"]),
    findField(fields, ["country"]),
  ].filter((value): value is string => Boolean(value));

  return unique(parts).join(", ") || null;
}

function detailPostingDate(
  fields: Map<string, string>,
  now: Date,
): Date | null {
  const value = findField(fields, [
    "date posted",
    "posted date",
    "posting date",
    "posted since",
  ]);
  return value ? parseDateOnly(value, now) : null;
}

function findField(
  fields: Map<string, string>,
  labels: string[],
): string | null {
  for (const label of labels) {
    const value = fields.get(label);

    if (value) {
      return value;
    }
  }

  return null;
}

function parsePostedText(value: string, now: Date): Date | null {
  const match = value.match(
    /(?:date\s+posted|posted\s+date|posted)\s*:?\s*((?:\d{1,2}-[A-Za-z]{3}-\d{4})|(?:\d{1,2}\/\d{1,2}\/\d{4})|(?:\d{4}-\d{2}-\d{2}))/i,
  );
  return match?.[1] ? parseDateOnly(match[1], now) : null;
}

function parseDateOnly(value: string, now: Date): Date | null {
  const normalized = value.trim();
  let year: number;
  let month: number;
  let day: number;
  let match = normalized.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);

  if (match) {
    const parsedMonth = MONTHS[match[2]!.toLowerCase()];

    if (parsedMonth === undefined) {
      return null;
    }

    day = Number(match[1]);
    month = parsedMonth;
    year = Number(match[3]);
  } else {
    match = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

    if (match) {
      month = Number(match[1]) - 1;
      day = Number(match[2]);
      year = Number(match[3]);
    } else {
      match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);

      if (!match) {
        return null;
      }

      year = Number(match[1]);
      month = Number(match[2]) - 1;
      day = Number(match[3]);
    }
  }

  const endOfDay = Date.UTC(year, month, day, 23, 59, 59, 999);
  const check = new Date(endOfDay);

  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month ||
    check.getUTCDate() !== day
  ) {
    return null;
  }

  return new Date(Math.min(endOfDay, now.getTime()));
}

function reachedPostingCutoff(
  listings: AvatureListing[],
  postedAfter?: Date,
): boolean {
  if (!postedAfter || listings.length === 0) {
    return false;
  }

  const dates = listings.map((listing) => listing.postedAt);

  return (
    dates.every((date): date is Date => date !== null) &&
    dates.some((date) => date < postedAfter)
  );
}

function jobIdFromUrl(url: URL): string | null {
  return /\/JobDetail\/(?:[^/?#]+\/)?(\d+)(?:[/?#]|$)/i.exec(
    url.pathname,
  )?.[1] ?? null;
}

function parseOffset(url: URL): number | null {
  const value = url.searchParams.get("jobOffset") ??
    url.searchParams.get("folderOffset") ??
    url.searchParams.get("offset");
  const parsed = value === null ? Number.NaN : Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function searchUrl(
  company: AvatureCompanyConfig,
  offset: number,
  searchTerm?: string,
): URL {
  const searchPath = searchTerm
    ? `/SearchJobs/${encodeURIComponent(searchTerm)}`
    : "/SearchJobs";
  const url = new URL(`${portalUrl(company).toString()}${searchPath}`);

  if (searchTerm) {
    url.searchParams.set("listFilterMode", "1");
    url.searchParams.set("folderSort", "postedDate");
    url.searchParams.set("folderSortDirection", "DESC");
    url.searchParams.set("folderRecordsPerPage", "6");
    url.searchParams.set("folderOffset", String(offset));
    return url;
  }

  url.searchParams.set("jobSort", "postedDate");
  url.searchParams.set("jobSortDirection", "DESC");
  url.searchParams.set("jobOffset", String(offset));
  return url;
}

function portalUrl(company: AvatureCompanyConfig): URL {
  const base = company.apiBaseUrl.replace(/\/+$/, "");
  const path = company.handle.replace(/^\/+|\/+$/g, "");
  return new URL(`${base}/${path}`);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();

  return values.filter((value) => {
    const normalized = value.toLowerCase();

    if (seen.has(normalized)) {
      return false;
    }

    seen.add(normalized);
    return true;
  });
}
