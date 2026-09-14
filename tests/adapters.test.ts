import { afterEach, describe, expect, it, vi } from "vitest";

import { LeverAdapter } from "../src/adapters/lever.js";
import { SmartRecruitersAdapter } from "../src/adapters/smartrecruiters.js";
import type { CompanyConfig } from "../src/config/index.js";

afterEach(() => {
  vi.unstubAllGlobals();
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
