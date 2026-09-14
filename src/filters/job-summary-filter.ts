import type { FiltersConfig } from "../config/index.js";
import type { JobSummary } from "../types.js";

const US_STATE_NAMES = [
  "alabama",
  "alaska",
  "arizona",
  "arkansas",
  "california",
  "colorado",
  "connecticut",
  "delaware",
  "florida",
  "georgia",
  "hawaii",
  "idaho",
  "illinois",
  "indiana",
  "iowa",
  "kansas",
  "kentucky",
  "louisiana",
  "maine",
  "maryland",
  "massachusetts",
  "michigan",
  "minnesota",
  "mississippi",
  "missouri",
  "montana",
  "nebraska",
  "nevada",
  "new hampshire",
  "new jersey",
  "new mexico",
  "new york",
  "north carolina",
  "north dakota",
  "ohio",
  "oklahoma",
  "oregon",
  "pennsylvania",
  "rhode island",
  "south carolina",
  "south dakota",
  "tennessee",
  "texas",
  "utah",
  "vermont",
  "virginia",
  "washington",
  "west virginia",
  "wisconsin",
  "wyoming",
  "district of columbia",
];

const US_STATE_CODE_PATTERN =
  /(?:^|,|\s)(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)(?=\s|,|\d|$)/;

const NON_US_MARKERS = [
  "argentina",
  "australia",
  "brazil",
  "canada",
  "china",
  "colombia",
  "france",
  "germany",
  "india",
  "ireland",
  "italy",
  "japan",
  "mexico",
  "netherlands",
  "poland",
  "romania",
  "singapore",
  "south korea",
  "spain",
  "united kingdom",
  "uk",
];

export function filterJobSummaries(
  jobs: JobSummary[],
  filters: FiltersConfig,
  now = new Date(),
): JobSummary[] {
  return jobs.filter(
    (job) =>
      matchesFreshness(job, filters, now) &&
      matchesLocation(job, filters) &&
      matchesRole(job.title, filters) &&
      matchesSeniority(job.title, filters) &&
      matchesEmploymentType(job.title, filters),
  );
}

function matchesFreshness(
  job: JobSummary,
  filters: FiltersConfig,
  now: Date,
): boolean {
  const timestamp =
    job.postedAt ??
    (filters.freshness.useUpdatedAtAsPostedAt ? job.updatedAt : null);

  if (!timestamp) {
    return filters.freshness.allowFirstSeenFallback;
  }

  const postedAt = timestamp.getTime();
  const cutoff =
    now.getTime() - filters.freshness.lookbackHours * 60 * 60 * 1000;

  return postedAt >= cutoff && postedAt <= now.getTime();
}

function matchesLocation(
  job: JobSummary,
  filters: FiltersConfig,
): boolean {
  if (!job.location) {
    return true;
  }

  const locationText = `${job.title} ${job.location}`;
  const normalizedLocation = locationText.toLowerCase();
  const hasUsCountry =
    /\b(united states|usa|u\.s\.|us)\b/i.test(locationText);
  const hasUsState =
    US_STATE_NAMES.some((state) => normalizedLocation.includes(state)) ||
    US_STATE_CODE_PATTERN.test(locationText);
  const hasUsLocation = hasUsCountry || hasUsState;
  const isRemote = /\bremote\b/i.test(job.location);
  const isMultiLocation = /[;|/\n]|\band\b/i.test(job.location);

  if (hasUsLocation) {
    if (isRemote && !filters.location.allowRemoteUS) {
      return false;
    }

    return !isMultiLocation || filters.location.allowMultiLocationWithUS;
  }

  const isExplicitlyNonUs = NON_US_MARKERS.some((marker) =>
    containsWholeTerm(normalizedLocation, marker),
  );
  const countryCode = /(?:^|[,;])\s*([a-z]{2})\s*$/i.exec(
    job.location,
  )?.[1];
  const hasNonUsCountryCode =
    countryCode !== undefined && countryCode.toUpperCase() !== "US";

  if (
    (isExplicitlyNonUs || hasNonUsCountryCode) &&
    filters.location.rejectNonUSOnly
  ) {
    return false;
  }

  return true;
}

function matchesRole(title: string, filters: FiltersConfig): boolean {
  const normalizedTitle = normalizeForMatch(
    title,
    filters.roles.caseSensitive,
  );
  const normalizeTerm = (term: string): string =>
    normalizeForMatch(term, filters.roles.caseSensitive);

  const includesRole = filters.roles.include.some((term) =>
    normalizedTitle.includes(normalizeTerm(term)),
  );
  const hasExcludedTitle = filters.roles.excludeTitles.some((term) =>
    normalizedTitle.includes(normalizeTerm(term)),
  );

  return includesRole && !hasExcludedTitle;
}

function matchesSeniority(title: string, filters: FiltersConfig): boolean {
  return !filters.seniority.exclude.some((term) => {
    const flags = filters.roles.caseSensitive ? "" : "i";
    return new RegExp(`\\b${escapeRegExp(term)}\\b`, flags).test(title);
  });
}

function matchesEmploymentType(
  title: string,
  filters: FiltersConfig,
): boolean {
  const normalizedTitle = normalizeForMatch(
    title,
    filters.roles.caseSensitive,
  );

  return !filters.employmentType.exclude.some((term) => {
    const normalizedTerm = normalizeForMatch(
      term,
      filters.roles.caseSensitive,
    );
    const variants = [normalizedTerm];

    if (normalizedTerm.endsWith("ship")) {
      variants.push(normalizedTerm.slice(0, -4));
    }

    return variants.some((variant) =>
      containsWholeTerm(normalizedTitle, variant),
    );
  });
}

function normalize(value: string, caseSensitive: boolean): string {
  return caseSensitive ? value : value.toLowerCase();
}

function normalizeForMatch(value: string, caseSensitive: boolean): string {
  return normalize(value, caseSensitive)
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsWholeTerm(value: string, term: string): boolean {
  return new RegExp(
    `(?:^|[^a-z])${escapeRegExp(term)}(?=$|[^a-z])`,
    "i",
  ).test(value);
}
