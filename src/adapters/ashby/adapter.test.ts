import { afterEach, describe, expect, it, vi } from "vitest";

import { AshbyAdapter } from "../ashby/adapter.js";
import type { CompanyConfig } from "../../config/index.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const ashbyCompany: CompanyConfig = {
  id: "replit",
  name: "Replit",
  enabled: true,
  adapter: "ashby",
  handle: "replit",
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
