import { afterEach, describe, expect, it, vi } from "vitest";

import { AshbyAdapter } from "../src/adapters/ashby.js";
import { LeverAdapter } from "../src/adapters/lever.js";
import { OracleAdapter } from "../src/adapters/oracle.js";
import { SmartRecruitersAdapter } from "../src/adapters/smartrecruiters.js";
import { WorkdayAdapter } from "../src/adapters/workday.js";
import type { CompanyConfig } from "../src/config/index.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const leverCompany: CompanyConfig = {
  id: "palantir",
  name: "Palantir",
  enabled: true,
  adapter: "lever",
  handle: "palantir",
};

const smartRecruitersCompany: CompanyConfig = {
  id: "servicenow",
  name: "ServiceNow",
  enabled: true,
  adapter: "smartrecruiters",
  handle: "ServiceNow",
};

const ashbyCompany: CompanyConfig = {
  id: "replit",
  name: "Replit",
  enabled: true,
  adapter: "ashby",
  handle: "replit",
};

const oracleCompany: CompanyConfig = {
  id: "goldman-sachs",
  name: "Goldman Sachs",
  enabled: true,
  adapter: "oracle",
  handle: "LateralHiring",
  apiBaseUrl: "https://example.oraclecloud.com",
  siteNumber: "CX_3002",
  publicJobBaseUrl: "https://example.com/roles",
};

const workdayCompany: CompanyConfig = {
  id: "adobe",
  name: "Adobe",
  enabled: true,
  adapter: "workday",
  handle: "external_experienced",
  apiBaseUrl: "https://adobe.example.com",
  tenant: "adobe",
};

describe("AshbyAdapter", () => {
  it("normalizes listed jobs and reuses cached descriptions", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          jobs: [
            {
              id: "ashby-1",
              title: "Full-Stack Engineer",
              location: "San Francisco, CA",
              secondaryLocations: [
                { location: "New York, NY" },
                { location: "San Francisco, CA" },
              ],
              publishedAt: "2026-09-14T10:00:00.000Z",
              isListed: true,
              isRemote: true,
              workplaceType: "Hybrid",
              jobUrl: "https://jobs.ashbyhq.com/replit/ashby-1",
              descriptionPlain: "Build software products.",
            },
            {
              id: "ashby-hidden",
              title: "Hidden Engineer",
              isListed: false,
              jobUrl: "https://jobs.ashbyhq.com/replit/ashby-hidden",
            },
          ],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new AshbyAdapter();
    const jobs = await adapter.fetchJobSummaries(ashbyCompany);

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      jobId: "ashby-1",
      title: "Full-Stack Engineer",
      location:
        "San Francisco, CA | New York, NY | Remote (Hybrid)",
      url: "https://jobs.ashbyhq.com/replit/ashby-1",
      updatedAt: null,
      source: "ashby",
    });
    expect(jobs[0]?.postedAt?.toISOString()).toBe(
      "2026-09-14T10:00:00.000Z",
    );

    await expect(
      adapter.fetchJobDetails(ashbyCompany, jobs[0]!),
    ).resolves.toMatchObject({
      description: "Build software products.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails clearly when the jobs array is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({}))),
    );

    await expect(
      new AshbyAdapter().fetchJobSummaries(ashbyCompany),
    ).rejects.toThrow("jobs must be an array");
  });

  it("refetches once on a cache miss and falls back to HTML", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          jobs: [
            {
              id: "ashby-1",
              title: "Software Engineer",
              jobUrl: "https://jobs.ashbyhq.com/replit/ashby-1",
              descriptionHtml: "<p>Build software products.</p>",
            },
          ],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const summary = {
      companyId: "replit",
      companyName: "Replit",
      jobId: "ashby-1",
      title: "Software Engineer",
      location: null,
      url: "https://jobs.ashbyhq.com/replit/ashby-1",
      postedAt: null,
      updatedAt: null,
      source: "ashby" as const,
    };

    await expect(
      new AshbyAdapter().fetchJobDetails(ashbyCompany, summary),
    ).resolves.toMatchObject({
      description: "<p>Build software products.</p>",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("LeverAdapter", () => {
  it("normalizes summaries without inventing publication dates", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([
            {
              id: "lever-1",
              text: "Software Engineer",
              categories: {
                location: "New York, NY",
                allLocations: ["New York, NY"],
                commitment: "Full-time",
              },
              country: "US",
              hostedUrl: "https://jobs.lever.co/example/lever-1",
              workplaceType: "hybrid",
            },
          ]),
        ),
      ),
    );

    const jobs = await new LeverAdapter().fetchJobSummaries(leverCompany);

    expect(jobs[0]).toMatchObject({
      jobId: "lever-1",
      title: "Software Engineer",
      location: "New York, NY; US",
      postedAt: null,
      updatedAt: null,
      source: "lever",
    });
  });

  it("uses the individual posting's plain-text description", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ descriptionPlain: "Full job text" })),
      ),
    );

    const adapter = new LeverAdapter();
    const summary = {
      companyId: "palantir",
      companyName: "Palantir",
      jobId: "lever-1",
      title: "Software Engineer",
      location: "New York, NY",
      url: "https://jobs.lever.co/example/lever-1",
      postedAt: null,
      updatedAt: null,
      source: "lever" as const,
    };

    await expect(adapter.fetchJobDetails(leverCompany, summary)).resolves
      .toMatchObject({ description: "Full job text" });
  });
});

describe("OracleAdapter", () => {
  it("uses recent listing dates and fetches exact details only on demand", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              {
                TotalJobsCount: 2,
                requisitionList: [
                  {
                    Id: 179758,
                    Title: "Software Engineer",
                    PostedDate: "2026-09-16",
                    PostingEndDate: null,
                    PrimaryLocation: "New York, NY, United States",
                    secondaryLocations: [{ Name: "Dallas, TX, United States" }],
                  },
                  {
                    Id: 179759,
                    Title: "Platform Engineer",
                    PostedDate: "2026-09-15",
                    PostingEndDate: null,
                    PrimaryLocation: "San Francisco, CA, United States",
                  },
                ],
              },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              {
                Id: 179758,
                ExternalPostedStartDate: "2026-09-16T10:15:00+00:00",
                ExternalPostedEndDate: null,
                PrimaryLocation: "New York, NY, United States",
                secondaryLocations: [{ Name: "Dallas, TX, United States" }],
                ExternalDescriptionStr: "Build financial software.",
                ExternalResponsibilitiesStr: "Design reliable services.",
                ExternalQualificationsStr: "Four years required.",
              },
            ],
          }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new OracleAdapter();
    const jobs = await adapter.fetchJobSummaries(oracleCompany, {
      postedAfter: new Date("2026-09-16T12:00:00.000Z"),
    });

    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      jobId: "179758",
      title: "Software Engineer",
      location:
        "New York, NY, United States; Dallas, TX, United States",
      url: "https://example.com/roles/179758",
      updatedAt: null,
      source: "oracle",
    });
    expect(jobs[0]?.postedAt?.toISOString()).toBe(
      "2026-09-16T23:59:59.999Z",
    );

    const details = await adapter.fetchJobDetails(oracleCompany, jobs[0]!);

    expect(details).toMatchObject({
      description:
        "Build financial software.\n\nDesign reliable services.\n\nFour years required.",
    });
    expect(details.postedAt?.toISOString()).toBe(
      "2026-09-16T10:15:00.000Z",
    );

    const listingUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(listingUrl.searchParams.get("finder")).toContain(
      "postingStartDate=2026-09-15",
    );
    expect(listingUrl.searchParams.get("fields")).toContain(
      "requisitionList:Id,Title,PostedDate,PostingEndDate",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("WorkdayAdapter", () => {
  it("normalizes relative posting dates and fetches the full description", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-16T18:00:00.000Z"));

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            total: 2,
            jobPostings: [
              {
                title: "Software Development Engineer",
                externalPath: "/job/San-Jose/Software-Engineer_R162345",
                locationsText: "San Jose, California, United States",
                postedOn: "Posted Today",
                bulletFields: ["R162345"],
              },
              {
                title: "Platform Engineer",
                externalPath: "/job/Seattle/Platform-Engineer_R162346",
                locationsText: "Seattle, Washington, United States",
                postedOn: "Posted Yesterday",
                bulletFields: ["R162346"],
              },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jobPostingInfo: {
              title: "Software Development Engineer",
              jobReqId: "R162345",
              location: "San Jose, California, United States",
              additionalLocations: ["New York, New York, United States"],
              externalUrl:
                "https://adobe.example.com/external_experienced/job/San-Jose/Software-Engineer_R162345",
              jobDescription: "Build Adobe software products.",
            },
          }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new WorkdayAdapter();
    const jobs = await adapter.fetchJobSummaries(workdayCompany);

    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      jobId: "R162345",
      location: "San Jose, California, United States",
      url: "https://adobe.example.com/external_experienced/job/San-Jose/Software-Engineer_R162345",
      source: "workday",
    });
    expect(jobs[0]?.postedAt?.toISOString()).toBe(
      "2026-09-16T18:00:00.000Z",
    );
    expect(jobs[1]?.postedAt?.toISOString()).toBe(
      "2026-09-15T18:00:00.000Z",
    );

    await expect(
      adapter.fetchJobDetails(workdayCompany, jobs[0]!),
    ).resolves.toMatchObject({
      location:
        "San Jose, California, United States; New York, New York, United States",
      description: "Build Adobe software products.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps paginating when later pages reset the reported total", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            total: 2,
            jobPostings: [
              {
                title: "Software Engineer",
                externalPath: "/job/One/Software-Engineer_R1",
                bulletFields: ["R1"],
              },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            total: 0,
            jobPostings: [
              {
                title: "Platform Engineer",
                externalPath: "/job/Two/Platform-Engineer_R2",
                bulletFields: ["R2"],
              },
            ],
          }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const jobs = await new WorkdayAdapter().fetchJobSummaries(workdayCompany);

    expect(jobs.map((job) => job.jobId)).toEqual(["R1", "R2"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("SmartRecruitersAdapter", () => {
  it("paginates and normalizes released postings", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            totalFound: 2,
            content: [
              {
                id: "smart-1",
                name: "Backend Engineer",
                releasedDate: "2026-09-13T10:00:00.000Z",
                postingUrl: "https://jobs.smartrecruiters.com/example/smart-1",
                location: {
                  city: "Boston",
                  region: "MA",
                  country: "US",
                  remote: true,
                },
              },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            totalFound: 2,
            content: [
              {
                id: "smart-2",
                name: "Frontend Engineer",
                releasedDate: null,
                ref: "https://api.smartrecruiters.com/example/smart-2",
              },
            ],
          }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const jobs = await new SmartRecruitersAdapter().fetchJobSummaries(
      smartRecruitersCompany,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      jobId: "smart-1",
      location: "Remote, Boston, MA, US",
      url: "https://jobs.smartrecruiters.com/example/smart-1",
      source: "smartrecruiters",
    });
    expect(jobs[0]?.postedAt?.toISOString()).toBe(
      "2026-09-13T10:00:00.000Z",
    );
    expect(jobs[1]?.postedAt).toBeNull();
  });

  it("combines job-ad sections into the full description", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            postingUrl: "https://jobs.smartrecruiters.com/example/smart-1",
            jobAd: {
              sections: {
                jobDescription: { text: "Build services." },
                qualifications: { text: "Two years required." },
              },
            },
          }),
        ),
      ),
    );

    const summary = {
      companyId: "servicenow",
      companyName: "ServiceNow",
      jobId: "smart-1",
      title: "Backend Engineer",
      location: "Remote, US",
      url: "https://jobs.smartrecruiters.com/example/smart-1",
      postedAt: new Date(),
      updatedAt: null,
      source: "smartrecruiters" as const,
    };

    await expect(
      new SmartRecruitersAdapter().fetchJobDetails(
        smartRecruitersCompany,
        summary,
      ),
    ).resolves.toMatchObject({
      url: "https://jobs.smartrecruiters.com/example/smart-1",
      description: "Build services.\n\nTwo years required.",
    });
  });
});
