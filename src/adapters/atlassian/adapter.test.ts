import { afterEach, describe, expect, it, vi } from "vitest";

import type { CompanyConfig } from "../../config/index.js";
import { AtlassianAdapter } from "./adapter.js";

const company: CompanyConfig = {
  id: "atlassian",
  name: "Atlassian",
  enabled: true,
  adapter: "atlassian",
};

afterEach(() => vi.unstubAllGlobals());

describe("AtlassianAdapter", () => {
  it("keeps only US Engineering listings and retrieves the description", async () => {
    const composition = {
      slots: {
        content: [{
          type: "careersGallery",
          parameters: { data: { value: [
            { fields: { id: "1", title: "Software Engineer", category: "Engineering", locations: ["New York - United States", "Remote - Remote"] } },
            { fields: { id: "2", title: "Software Engineer", category: "Engineering", locations: ["London - United Kingdom"] } },
            { fields: { id: "3", title: "Sales Engineer", category: "Sales", locations: ["New York - United States"] } },
          ] } },
        }],
      },
    };
    const listingHtml = `<script>window._uniformPreloadedComposition=${JSON.stringify(composition)}\nwindow.other={};</script>`;
    const detailHtml = `<main><h1>Software Engineer</h1><div>${"Build software systems. ".repeat(10)}</div></main>`;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(listingHtml))
      .mockResolvedValueOnce(new Response(detailHtml));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new AtlassianAdapter();
    const summaries = await adapter.fetchJobSummaries(company);

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      jobId: "1",
      location: "New York - United States",
      postedAt: null,
      source: "atlassian",
      url: "https://www.atlassian.com/company/careers/details/1",
    });
    const details = await adapter.fetchJobDetails(company, summaries[0]!);
    expect(details.description).toContain("Build software systems.");
    expect(fetchMock.mock.calls[1]?.[0]).toBe(summaries[0]?.url);
  });

  it("fails clearly when the embedded listings are absent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html></html>")));

    await expect(new AtlassianAdapter().fetchJobSummaries(company))
      .rejects.toThrow("Atlassian returned no listing data");
  });
});
