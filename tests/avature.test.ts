import { afterEach, describe, expect, it, vi } from "vitest";

import { AvatureAdapter } from "../src/adapters/avature.js";
import type { CompanyConfig } from "../src/config/index.js";

const company: CompanyConfig = {
  id: "synopsys",
  name: "Synopsys",
  enabled: true,
  adapter: "avature",
  handle: "careers",
  apiBaseUrl: "https://synopsys.avature.net",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("AvatureAdapter", () => {
  it("paginates newest-first and stops after crossing the posting cutoff", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-17T18:00:00.000Z"));

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(searchPage([
          listing("18870", "Software Engineer", "17-Sep-2026"),
          listing("18869", "Backend Engineer", "16-Sep-2026"),
        ], 2)),
      )
      .mockResolvedValueOnce(
        new Response(searchPage([
          listing("18860", "Platform Engineer", "15-Sep-2026"),
        ], 3)),
      );
    vi.stubGlobal("fetch", fetchMock);

    const jobs = await new AvatureAdapter().fetchJobSummaries(company, {
      postedAfter: new Date("2026-09-16T18:00:00.000Z"),
    });

    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      jobId: "18870",
      title: "Software Engineer",
      location: "Sunnyvale, California",
      source: "avature",
    });
    expect(jobs[0]?.postedAt?.toISOString()).toBe(
      "2026-09-17T18:00:00.000Z",
    );
    expect(jobs[1]?.postedAt?.toISOString()).toBe(
      "2026-09-16T23:59:59.999Z",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(firstUrl.searchParams.get("jobSort")).toBe("postedDate");
    expect(firstUrl.searchParams.get("jobSortDirection")).toBe("DESC");
    expect(firstUrl.searchParams.get("jobOffset")).toBe("0");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("jobOffset=2");
  });

  it("extracts authoritative detail fields and the full description", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-17T18:00:00.000Z"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(`
      <html><head>
        <meta property="og:title" content="Software Engineer - 18870">
      </head><body>
        <article class="article article--details">
          <h3 class="article__header__text__title">General Information</h3>
          ${detailField("Job Title", "Software Engineer")}
          ${detailField("City", "Sunnyvale")}
          ${detailField("State/Province", "California")}
          ${detailField("Date Posted", "17-Sep-2026")}
        </article>
        <article class="article article--details">
          <h3 class="article__header__text__title">Descriptions &amp; Requirements</h3>
          <div class="article__content">
            ${detailField(
              "Job Description and Requirements",
              "<p>Build reliable software services.</p>",
            )}
          </div>
        </article>
      </body></html>
    `)));

    const summary = {
      companyId: "synopsys",
      companyName: "Synopsys",
      jobId: "18870",
      title: "Software Engineering Role",
      location: null,
      url: "https://synopsys.avature.net/careers/JobDetail/Software-Engineer/18870",
      postedAt: null,
      updatedAt: null,
      source: "avature" as const,
    };
    const details = await new AvatureAdapter().fetchJobDetails(
      company,
      summary,
    );

    expect(details).toMatchObject({
      title: "Software Engineer",
      location: "Sunnyvale, California",
    });
    expect(details.postedAt?.toISOString()).toBe(
      "2026-09-17T18:00:00.000Z",
    );
    expect(details.description).toContain(
      "Build reliable software services.",
    );
    expect(details.description).not.toContain("General Information");
  });
});

function listing(jobId: string, title: string, date: string): string {
  return `
    <article class="article article--result">
      <h3 class="article__header__text__title">
        <a class="link" href="/careers/JobDetail/${title.replaceAll(" ", "-")}/${jobId}">${title}</a>
      </h3>
      <span class="list-item-location">Sunnyvale, California</span>
      <span class="list-item-posted">Posted ${date}</span>
    </article>
  `;
}

function searchPage(listings: string[], nextOffset: number): string {
  return `
    <html><body>
      ${listings.join("\n")}
      <a class="paginationNextLink" href="/careers/SearchJobs?jobOffset=${nextOffset}">Next</a>
    </body></html>
  `;
}

function detailField(label: string, value: string): string {
  return `
    <div class="article__content__view__field">
      <div class="article__content__view__field__label">${label}</div>
      <div class="article__content__view__field__value">${value}</div>
    </div>
  `;
}
