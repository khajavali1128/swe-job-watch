import { afterEach, describe, expect, it, vi } from "vitest";

import type { CompanyConfig } from "../../config/index.js";
import { NetAppAdapter } from "./adapter.js";

const company: CompanyConfig = {
  id: "netapp",
  name: "NetApp",
  enabled: true,
  adapter: "netapp",
};

afterEach(() => vi.unstubAllGlobals());

describe("NetAppAdapter", () => {
  it("paginates US search results and reads posting date and description", async () => {
    const path = "/job/san-jose/software-engineer/27600/101895070496";
    const listing = (page: number, jobPath: string) =>
      `<input class="pagination-current" max="2" value="${page}">
       <div id="search-results-list"><a href="${jobPath}">
       <h3>Software Engineer</h3><span class="job-location">San Jose, California, United States</span>
       </a></div>`;
    const detail = {
      "@type": "JobPosting",
      datePosted: "2026-11-17",
      description: "<p>Build storage systems.</p>",
      jobLocation: [{ address: {
        addressLocality: "San Jose",
        addressRegion: "CA",
        addressCountry: "US",
      } }],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(listing(1, path)))
      .mockResolvedValueOnce(new Response(listing(2, "/job/remote/software-engineer/27600/99")))
      .mockResolvedValueOnce(new Response(`<script type="application/ld+json">${JSON.stringify(detail)}</script>`));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new NetAppAdapter();
    const summaries = await adapter.fetchJobSummaries(company);
    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toMatchObject({ jobId: "101895070496", postedAt: null, source: "netapp" });
    expect(fetchMock.mock.calls[1]?.[0]).toContain("p=2");

    const details = await adapter.fetchJobDetails(company, summaries[0]!);
    expect(details.postedAt?.toISOString()).toBe("2026-11-17T00:00:00.000Z");
    expect(details.location).toBe("San Jose, CA, US");
    expect(details.description).toContain("Build storage systems.");
  });
});
