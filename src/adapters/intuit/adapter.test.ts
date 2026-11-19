import { afterEach, describe, expect, it, vi } from "vitest";

import type { CompanyConfig } from "../../config/index.js";
import { IntuitAdapter } from "./adapter.js";

const company: CompanyConfig = {
  id: "intuit",
  name: "Intuit",
  enabled: true,
  adapter: "intuit",
};

afterEach(() => vi.unstubAllGlobals());

function listingHtml(page: number, path: string, location: string): string {
  return `<input class="pagination-current" max="2" value="${page}">
    <div id="search-results-list"><a href="${path}">
      <h2>Software Engineer</h2><span class="job-location">${location}</span>
    </a></div>`;
}

describe("IntuitAdapter", () => {
  it("paginates listings and verifies the posting date and US location on detail", async () => {
    const path = "/job/san-diego/software-engineer/27595/103261394672";
    const details = {
      "@type": "JobPosting",
      datePosted: "2026-11-13",
      description: "<p>Build software.</p>",
      jobLocation: [{ address: {
        addressLocality: "San Diego",
        addressRegion: "California",
        addressCountry: "United States",
      } }],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(listingHtml(1, path, "Multiple Locations")))
      .mockResolvedValueOnce(new Response(listingHtml(2, "/job/london/software-engineer/27595/999", "London")))
      .mockResolvedValueOnce(new Response(`<script type="application/ld+json">${JSON.stringify(details)}</script>`));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new IntuitAdapter();
    const summaries = await adapter.fetchJobSummaries(company);

    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toMatchObject({
      jobId: "103261394672",
      postedAt: null,
      location: "Multiple Locations",
      source: "intuit",
    });
    expect(fetchMock.mock.calls[1]?.[0]).toContain("p=2");

    const job = await adapter.fetchJobDetails(company, summaries[0]!);
    expect(job.postedAt?.toISOString()).toBe("2026-11-13T00:00:00.000Z");
    expect(job.location).toBe("San Diego, California, United States");
    expect(job.description).toBe("<p>Build software.</p>");
  });

  it("fails when a detail page has no verifiable posting date", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      '<script type="application/ld+json">{"@type":"JobPosting","description":"Job text"}</script>',
    )));

    await expect(new IntuitAdapter().fetchJobDetails(company, {
      companyId: "intuit", companyName: "Intuit", jobId: "1", title: "Software Engineer",
      location: "New York", url: "https://jobs.intuit.com/job/new-york/software-engineer/27595/1",
      postedAt: null, updatedAt: null, source: "intuit",
    })).rejects.toThrow("invalid job details");
  });
});
