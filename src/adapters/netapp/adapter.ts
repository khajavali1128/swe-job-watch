import { load } from "cheerio";

import type { CompanyConfig } from "../../config/index.js";
import type { JobDetails, JobSummary } from "../../types.js";
import { AdapterHttpError } from "../errors.js";
import { parseTalentBrewDetails } from "../talentbrew/details.js";
import type { JobAdapter } from "../types.js";

const BASE_URL = "https://careers.netapp.com";
const SEARCH_URL = `${BASE_URL}/search-jobs/Software%20Engineer/United%20States?orgIds=27600&kt=1&alp=6252001&alt=2`;

export class NetAppAdapter implements JobAdapter {
  async fetchJobSummaries(company: CompanyConfig): Promise<JobSummary[]> {
    assertNetAppCompany(company);

    const summaries: JobSummary[] = [];
    const seen = new Set<string>();
    let totalPages = 1;

    for (let page = 1; page <= totalPages; page += 1) {
      const url = new URL(SEARCH_URL);
      url.searchParams.set("p", String(page));
      const $ = load(await fetchHtml(url.toString(), company));
      const links = $("#search-results-list a[href^='/job/']");

      if (page === 1) {
        totalPages = Number($(".pagination-current").first().attr("max") ?? 1);
        if (!Number.isInteger(totalPages) || totalPages < 1) {
          throw new Error(`NetApp returned invalid pagination for ${company.name}`);
        }
      }

      if (links.length === 0) {
        throw new Error(`NetApp returned no job listings on page ${page} for ${company.name}`);
      }

      links.each((_, element) => {
        const link = $(element);
        const path = link.attr("href");
        const jobId = path?.match(/\/job\/[^?#]+\/(\d+)\/?(?:[?#]|$)/)?.[1];
        const title = link.find("h3").first().text().trim();
        const location = link.find(".job-location").text().replace(/\s+/g, " ").trim();

        if (!path || !jobId || !title || seen.has(jobId)) return;

        seen.add(jobId);
        summaries.push({
          companyId: company.id,
          companyName: company.name,
          jobId,
          title,
          location: location || null,
          url: new URL(path, BASE_URL).toString(),
          postedAt: null,
          updatedAt: null,
          source: "netapp",
        });
      });
    }

    return summaries;
  }

  async fetchJobDetails(company: CompanyConfig, job: JobSummary): Promise<JobDetails> {
    assertNetAppCompany(company);
    return parseTalentBrewDetails(await fetchHtml(job.url, company), company, job);
  }
}

async function fetchHtml(url: string, company: CompanyConfig): Promise<string> {
  const response = await fetch(url, { headers: { Accept: "text/html" } });
  if (!response.ok) {
    throw new AdapterHttpError("NetApp", company.name, response.status, response.statusText);
  }
  return response.text();
}

function assertNetAppCompany(company: CompanyConfig): void {
  if (company.adapter !== "netapp") {
    throw new Error(
      `NetAppAdapter cannot handle company ${company.name} with adapter ${company.adapter}`,
    );
  }
}
