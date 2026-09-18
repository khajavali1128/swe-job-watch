import { afterEach, describe, expect, it, vi } from "vitest";

import { EightfoldAdapter } from "../src/adapters/eightfold.js";
import type { EightfoldCompanyConfig } from "../src/config/index.js";

const company: EightfoldCompanyConfig = {
  id: "netflix",
  name: "Netflix",
  enabled: true,
  adapter: "eightfold",
  handle: "netflix.com",
  apiBaseUrl: "https://explore.jobs.netflix.net",
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("EightfoldAdapter", () => {
  it("uses creation timestamps for freshness and fetches job details", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-18T12:00:00.000Z"));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          count: 2,
          positions: [
            {
              id: 790318539683,
              name: "Distributed Systems Engineer",
              location: "Los Gatos, California",
              locations: ["Los Gatos, California"],
              t_create: 1789689600,
              t_update: 1789754075,
              canonicalPositionUrl:
                "https://explore.jobs.netflix.net/careers/job/790318539683",
              work_location_option: "onsite",
            },
            {
              id: 790318500000,
              name: "Older Software Engineer",
              location: "New York, New York",
              locations: ["New York, New York"],
              t_create: 1789000000,
              t_update: 1789000100,
              canonicalPositionUrl:
                "https://explore.jobs.netflix.net/careers/job/790318500000",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: 790318539683,
          name: "Distributed Systems Engineer",
          location: "Los Gatos, California",
          locations: ["Los Gatos, California"],
          t_create: 1789689600,
          t_update: 1789754075,
          canonicalPositionUrl:
            "https://explore.jobs.netflix.net/careers/job/790318539683?microsite=netflix.com",
          job_description: "Build and operate distributed software systems.",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new EightfoldAdapter();
    const summaries = await adapter.fetchJobSummaries(company, {
      postedAfter: new Date("2026-09-17T00:00:00.000Z"),
    });

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      jobId: "790318539683",
      title: "Distributed Systems Engineer",
      location: "Los Gatos, California",
      source: "eightfold",
    });
    expect(summaries[0]?.postedAt?.toISOString()).toBe(
      "2026-09-18T00:00:00.000Z",
    );

    const listingUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(listingUrl.searchParams.get("domain")).toBe("netflix.com");
    expect(listingUrl.searchParams.get("sort_by")).toBe("new");

    await expect(
      adapter.fetchJobDetails(company, summaries[0]!),
    ).resolves.toMatchObject({
      url: "https://explore.jobs.netflix.net/careers/job/790318539683?microsite=netflix.com",
      description: "Build and operate distributed software systems.",
    });
  });

  it("keeps date-only postings through the following day", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-19T12:00:00.000Z"));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          count: 1,
          positions: [
            {
              id: 790318539683,
              name: "Software Engineer",
              location: "Los Gatos, California",
              t_create: 1789689600,
              canonicalPositionUrl:
                "https://explore.jobs.netflix.net/careers/job/790318539683",
            },
          ],
        }),
      ),
    );

    const summaries = await new EightfoldAdapter().fetchJobSummaries(company, {
      postedAfter: new Date("2026-09-18T11:00:00.000Z"),
    });

    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.postedAt?.toISOString()).toBe(
      "2026-09-18T23:59:59.999Z",
    );
  });
});
