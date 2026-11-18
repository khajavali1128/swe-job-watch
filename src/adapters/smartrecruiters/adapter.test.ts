import { afterEach, describe, expect, it, vi } from "vitest";

import { SmartRecruitersAdapter } from "../smartrecruiters/adapter.js";
import type { CompanyConfig } from "../../config/index.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const smartRecruitersCompany: CompanyConfig = {
  id: "servicenow",
  name: "ServiceNow",
  enabled: true,
  adapter: "smartrecruiters",
  handle: "ServiceNow",
};

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
