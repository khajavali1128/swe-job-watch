import { afterEach, describe, expect, it, vi } from "vitest";

import { AppleAdapter } from "../src/adapters/apple.js";
import type { AppleCompanyConfig } from "../src/config/index.js";

const company: AppleCompanyConfig = {
  id: "apple",
  name: "Apple",
  enabled: true,
  adapter: "apple",
  handle: "apple",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AppleAdapter", () => {
  it("deduplicates multi-location listings and fetches complete details", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("", {
          headers: {
            "set-cookie": "jobs=session; Path=/; Secure",
            "x-apple-csrf-token": "csrf-token",
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          res: {
            totalRecords: 2,
            searchResults: [
              {
                positionId: "200684577",
                postingTitle: "Software Engineer, Data Platform",
                transformedPostingTitle: "software-engineer-data-platform",
                postDateInGMT: "2026-09-18T17:57:30.132Z",
                locations: [
                  {
                    name: "Austin",
                    countryName: "United States of America",
                  },
                ],
              },
              {
                positionId: "200684577",
                postingTitle: "Software Engineer, Data Platform",
                transformedPostingTitle: "software-engineer-data-platform",
                postDateInGMT: "2026-09-18T17:57:30.132Z",
                locations: [
                  {
                    name: "Sunnyvale",
                    countryName: "United States of America",
                  },
                ],
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          res: {
            jobNumber: "200684577",
            postingTitle: "Software Engineer, Data Platform",
            transformedPostingTitle: "software-engineer-data-platform",
            postDateInGMT: "2026-09-18T17:57:30.132Z",
            locations: [
              {
                city: "Austin",
                stateProvince: "Texas",
                countryName: "United States",
              },
              {
                city: "Sunnyvale",
                stateProvince: "California",
                countryName: "United States",
              },
            ],
            jobSummary: "Build large-scale data systems.",
            description: "Design distributed software services.",
            minimumQualifications: "Two years of professional experience.",
            preferredQualifications: "Cloud experience preferred.",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new AppleAdapter();
    const summaries = await adapter.fetchJobSummaries(company, {
      postedAfter: new Date("2026-09-18T00:00:00.000Z"),
    });

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      jobId: "200684577",
      title: "Software Engineer, Data Platform",
      location:
        "Austin, United States of America | Sunnyvale, United States of America",
      source: "apple",
      url: "https://jobs.apple.com/en-us/details/200684577/software-engineer-data-platform",
    });
    expect(summaries[0]?.postedAt?.toISOString()).toBe(
      "2026-09-18T17:57:30.132Z",
    );

    const searchRequest = fetchMock.mock.calls[1];
    const searchOptions = searchRequest?.[1] as RequestInit;
    expect(searchRequest?.[0]).toBe("https://jobs.apple.com/api/v1/search");
    expect(JSON.parse(String(searchOptions.body))).toMatchObject({
      filters: { locations: ["postLocation-USA"] },
      page: 1,
      sort: "newest",
    });

    const details = await adapter.fetchJobDetails(company, summaries[0]!);

    expect(details.location).toBe(
      "Austin, Texas, United States | Sunnyvale, California, United States",
    );
    expect(details.description).toContain(
      "Minimum Qualifications:\nTwo years of professional experience.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
