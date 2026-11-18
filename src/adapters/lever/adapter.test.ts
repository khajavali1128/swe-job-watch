import { afterEach, describe, expect, it, vi } from "vitest";

import { LeverAdapter } from "../lever/adapter.js";
import type { CompanyConfig } from "../../config/index.js";

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

describe("LeverAdapter", () => {
  it("normalizes summaries with the Lever creation timestamp", async () => {
    const createdAt = Date.UTC(2026, 8, 16, 18, 30);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: "lever-1",
            text: "Software Engineer",
            createdAt,
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
    );
    vi.stubGlobal("fetch", fetchMock);

    const jobs = await new LeverAdapter().fetchJobSummaries(leverCompany);

    expect(jobs[0]).toMatchObject({
      jobId: "lever-1",
      title: "Software Engineer",
      location: "New York, NY; US",
      updatedAt: null,
      source: "lever",
    });
    expect(jobs[0]?.postedAt?.toISOString()).toBe(
      "2026-09-16T18:30:00.000Z",
    );
    const listingUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(listingUrl.searchParams.get("limit")).toBe("100");
    expect(listingUrl.searchParams.get("skip")).toBe("0");
  });

  it("paginates listings and skips missing or invalid creation timestamps", async () => {
    const validPosting = (index: number) => ({
      id: `lever-${index}`,
      text: "Software Engineer",
      createdAt: Date.UTC(2026, 8, 16),
      hostedUrl: `https://jobs.lever.co/example/lever-${index}`,
    });
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      validPosting(index)
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(firstPage)))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([
          validPosting(100),
          {
            id: "missing-date",
            text: "Software Engineer",
            hostedUrl: "https://jobs.lever.co/example/missing-date",
          },
          {
            id: "future-date",
            text: "Software Engineer",
            createdAt: Date.now() + (48 * 60 * 60 * 1000),
            hostedUrl: "https://jobs.lever.co/example/future-date",
          },
        ])),
      );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", fetchMock);

    const jobs = await new LeverAdapter().fetchJobSummaries(leverCompany);

    expect(jobs).toHaveLength(101);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("skip=100");
    expect(warn).toHaveBeenCalledTimes(2);
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
