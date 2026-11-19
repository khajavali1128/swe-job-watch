import { load } from "cheerio";

import type { CompanyConfig } from "../../config/index.js";
import type { JobDetails, JobSummary } from "../../types.js";
import { AdapterHttpError } from "../errors.js";
import type { JobAdapter } from "../types.js";

const CAREERS_URL = "https://www.atlassian.com/company/careers";
const LIST_URL = `${CAREERS_URL}/all-jobs?team=Engineering&location=United%20States`;
const COMPOSITION_MARKER = "window._uniformPreloadedComposition=";

interface AtlassianListing {
  fields?: {
    id?: string;
    title?: string;
    category?: string;
    locations?: string[];
  };
}

export class AtlassianAdapter implements JobAdapter {
  async fetchJobSummaries(company: CompanyConfig): Promise<JobSummary[]> {
    assertAtlassianCompany(company);

    const $ = load(await fetchHtml(LIST_URL, company));
    const script = $("script")
      .toArray()
      .map((element) => $(element).html() ?? "")
      .find((content) => content.includes(COMPOSITION_MARKER));

    if (!script) {
      throw new Error(`Atlassian returned no listing data for ${company.name}`);
    }

    const composition = parseComposition(script, company);
    const gallery = findGallery(composition);
    const listings = gallery?.parameters?.data?.value;

    if (!Array.isArray(listings)) {
      throw new Error(`Atlassian returned invalid listings for ${company.name}`);
    }

    const summaries: JobSummary[] = [];
    const seen = new Set<string>();

    for (const listing of listings as AtlassianListing[]) {
      const fields = listing.fields;
      const jobId = fields?.id?.trim();
      const title = fields?.title?.trim();
      const usLocations = Array.isArray(fields?.locations)
        ? fields.locations.filter(
            (location) =>
              typeof location === "string" &&
              /\bUnited States\b/i.test(location),
          )
        : [];

      // The page's query parameters do not filter its embedded job data.
      if (
        fields?.category !== "Engineering" ||
        !jobId ||
        !title ||
        usLocations.length === 0 ||
        seen.has(jobId)
      ) {
        continue;
      }

      seen.add(jobId);
      summaries.push({
        companyId: company.id,
        companyName: company.name,
        jobId,
        title,
        location: [...new Set(usLocations)].join(" | "),
        url: `${CAREERS_URL}/details/${encodeURIComponent(jobId)}`,
        postedAt: null,
        updatedAt: null,
        source: "atlassian",
      });
    }

    return summaries;
  }

  async fetchJobDetails(
    company: CompanyConfig,
    job: JobSummary,
  ): Promise<JobDetails> {
    assertAtlassianCompany(company);

    const $ = load(await fetchHtml(job.url, company));
    const title = $("main h1").first().text().trim();
    const description = $("main").text().trim();

    if (!title || description.length < 100) {
      throw new Error(
        `Atlassian returned invalid job details for ${company.name} job ${job.jobId}`,
      );
    }

    return { ...job, description };
  }
}

async function fetchHtml(url: string, company: CompanyConfig): Promise<string> {
  const response = await fetch(url, { headers: { Accept: "text/html" } });

  if (!response.ok) {
    throw new AdapterHttpError(
      "Atlassian",
      company.name,
      response.status,
      response.statusText,
    );
  }

  return response.text();
}

function parseComposition(script: string, company: CompanyConfig): unknown {
  const start = script.indexOf(COMPOSITION_MARKER) + COMPOSITION_MARKER.length;
  let depth = 0;
  let quoted = false;
  let escaped = false;

  for (let index = start; index < script.length; index += 1) {
    const character = script[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') {
      quoted = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(script.slice(start, index + 1)) as unknown;
        } catch (error) {
          throw new Error(`Atlassian returned malformed listing data for ${company.name}`, {
            cause: error,
          });
        }
      }
    }
  }

  throw new Error(`Atlassian returned incomplete listing data for ${company.name}`);
}

function findGallery(value: unknown): {
  parameters?: { data?: { value?: AtlassianListing[] } };
} | null {
  if (!value || typeof value !== "object") return null;
  if ("type" in value && value.type === "careersGallery") {
    return value as { parameters?: { data?: { value?: AtlassianListing[] } } };
  }

  for (const child of Object.values(value)) {
    const found = findGallery(child);
    if (found) return found;
  }

  return null;
}

function assertAtlassianCompany(company: CompanyConfig): void {
  if (company.adapter !== "atlassian") {
    throw new Error(
      `AtlassianAdapter cannot handle company ${company.name} with adapter ${company.adapter}`,
    );
  }
}
