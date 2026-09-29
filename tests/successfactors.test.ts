import { afterEach, describe, expect, it, vi } from "vitest";

import { SuccessFactorsAdapter } from "../src/adapters/successfactors.js";
import type { SuccessFactorsCompanyConfig } from "../src/config/index.js";
import { CompanySchema } from "../src/config/schema.js";

const company: SuccessFactorsCompanyConfig = {
  id: "example",
  name: "Example Company",
  enabled: true,
  adapter: "successfactors",
  apiBaseUrl: "https://careers.example.com",
  searchPath: "/jobs/search/?q=software",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SuccessFactorsAdapter", () => {
  it("paginates listings and normalizes stable IDs from detail URLs", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(searchPage([
        listing("Software Engineer", "Seattle, WA, US", "12345"),
      ], 25)))
      .mockResolvedValueOnce(new Response(searchPage([
        listing("Platform Developer", "Remote, US", "67890"),
      ])));
    vi.stubGlobal("fetch", fetchMock);

    const jobs = await new SuccessFactorsAdapter().fetchJobSummaries(company);

    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      jobId: "12345",
      title: "Software Engineer",
      location: "Seattle, WA, US",
      postedAt: null,
      source: "successfactors",
    });
    expect(jobs[1]).toMatchObject({
      jobId: "67890",
      title: "Platform Developer",
      location: "Remote, US",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("startrow=25");
  });

  it("extracts semantic detail fields and the full description", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(`
      <html><body>
        ${detailToken("Location:", "city", "New York, NY")}
        ${detailToken("Date:", "date", "Sep 22, 2026")}
        ${detailToken("Requisition ID:", "customfield5", "REQ-456")}
        <span itemprop="description" data-careersite-propertyid="description">
          <span class="jobdescription">
            <p>Build reliable distributed services.</p>
            <ul><li>Own production systems.</li></ul>
          </span>
        </span>
      </body></html>
    `)));

    const details = await new SuccessFactorsAdapter().fetchJobDetails(
      company,
      {
        companyId: company.id,
        companyName: company.name,
        jobId: "12345",
        title: "Software Engineer",
        location: null,
        url: "https://careers.example.com/jobs/job/New-York-Software-Engineer/12345/",
        postedAt: null,
        updatedAt: null,
        source: "successfactors",
      },
    );

    expect(details.location).toBe("New York, NY");
    expect(details.postedAt?.toISOString()).toBe(
      "2026-09-22T23:59:59.999Z",
    );
    expect(details.description).toContain(
      "Build reliable distributed services.",
    );
    expect(details.description).toContain("Own production systems.");
  });

  it("normalizes dated jobs from official SuccessFactors RSS feeds", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(`
      <?xml version="1.0" encoding="UTF-8" ?>
      <rss version="2.0"><channel><item>
        <title><![CDATA[Platform Developer (Austin, USA-TX, US, 78701)]]></title>
        <description><![CDATA[<p>Build distributed software.</p>]]></description>
        <pubDate>Mon, 28 Sep 2026 2:00:00 GMT</pubDate>
        <link>https://careers.example.com/job/Austin-Platform-Developer/12345/?utm_source=rss</link>
      </item></channel></rss>
    `)));

    const adapter = new SuccessFactorsAdapter();
    const jobs = await adapter.fetchJobSummaries(company);

    expect(jobs[0]).toMatchObject({
      jobId: "12345",
      title: "Platform Developer",
      location: "Austin, USA-TX, US, 78701",
      url: "https://careers.example.com/job/Austin-Platform-Developer/12345/",
      source: "successfactors",
    });
    expect(jobs[0]?.postedAt?.toISOString()).toBe(
      "2026-09-28T02:00:00.000Z",
    );
    await expect(
      adapter.fetchJobDetails(company, jobs[0]!),
    ).resolves.toMatchObject({
      description: "<p>Build distributed software.</p>",
    });
  });

  it("extracts requisition IDs for clear invalid-detail errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(`
      <html><body>
        ${detailToken("Requisition ID:", "customfield5", "REQ-456")}
      </body></html>
    `)));

    await expect(
      new SuccessFactorsAdapter().fetchJobDetails(company, {
        companyId: company.id,
        companyName: company.name,
        jobId: "12345",
        title: "Software Engineer",
        location: null,
        url: "https://careers.example.com/jobs/job/Software-Engineer/12345/",
        postedAt: null,
        updatedAt: null,
        source: "successfactors",
      }),
    ).rejects.toThrow(
      "SuccessFactors returned no description for Example Company requisition REQ-456",
    );
  });

  it("accepts strict SuccessFactors company configuration", () => {
    expect(CompanySchema.parse({
      id: "ey",
      name: "Ernst & Young LLP",
      enabled: true,
      adapter: "successfactors",
      apiBaseUrl: "https://careers.ey.com",
      searchPath: "/ey/search/",
    })).toMatchObject({
      adapter: "successfactors",
      searchPath: "/ey/search/",
    });

    expect(() => CompanySchema.parse({
      id: "ey",
      name: "Ernst & Young LLP",
      enabled: true,
      adapter: "successfactors",
      apiBaseUrl: "https://careers.ey.com",
      searchPath: "/ey/search/",
      unexpected: true,
    })).toThrow();
  });
});

function listing(title: string, location: string, jobId: string): string {
  return `
    <tr class="data-row">
      <td class="colTitle">
        <a class="jobTitle-link" href="/jobs/job/City-${title.replaceAll(" ", "-")}/${jobId}/">${title}</a>
      </td>
      <td class="colLocation"><span class="jobLocation">${location}</span></td>
    </tr>
  `;
}

function searchPage(listings: string[], nextOffset?: number): string {
  const next = nextOffset === undefined
    ? ""
    : `<div class="paginationShell"><a href="?q=software&startrow=${nextOffset}" title="Page 2">2</a></div>`;
  return `<html><body><table>${listings.join("\n")}</table>${next}</body></html>`;
}

function detailToken(label: string, property: string, value: string): string {
  return `
    <div class="joblayouttoken">
      <span class="joblayouttoken-label">${label}</span>
      <span data-careersite-propertyid="${property}">${value}</span>
    </div>
  `;
}
