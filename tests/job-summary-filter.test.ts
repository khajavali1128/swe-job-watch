import { beforeAll, describe, expect, it } from "vitest";

import { loadConfig, type FiltersConfig } from "../src/config/index.js";
import { filterJobSummaries } from "../src/filters/job-summary-filter.js";
import type { JobSummary } from "../src/types.js";

const NOW = new Date("2026-09-13T12:00:00.000Z");
let filters: FiltersConfig;

beforeAll(async () => {
  const config = await loadConfig();
  filters = {
    ...config.filters,
    freshness: {
      ...config.filters.freshness,
      lookbackHours: 24,
    },
  };
});

function makeJob(overrides: Partial<JobSummary> = {}): JobSummary {
  return {
    companyId: "example",
    companyName: "Example",
    jobId: "job-1",
    title: "Software Engineer",
    location: "New York, NY",
    url: "https://example.com/jobs/job-1",
    postedAt: new Date("2026-09-13T10:00:00.000Z"),
    updatedAt: null,
    source: "greenhouse",
    ...overrides,
  };
}

describe("filterJobSummaries", () => {
  it("keeps a fresh matching U.S. software role", () => {
    expect(filterJobSummaries([makeJob()], filters, NOW)).toHaveLength(1);
  });

  it("normalizes punctuation in configured role titles", () => {
    const job = makeJob({ title: "Full-Stack Engineer" });

    expect(filterJobSummaries([job], filters, NOW)).toHaveLength(1);
  });

  it("allows developer titles through for AI validation", () => {
    const job = makeJob({ title: "Platform Developer" });

    expect(filterJobSummaries([job], filters, NOW)).toHaveLength(1);
  });

  it("rejects a listing outside the freshness window", () => {
    const job = makeJob({
      postedAt: new Date("2026-09-12T11:59:59.000Z"),
    });

    expect(filterJobSummaries([job], filters, NOW)).toHaveLength(0);
  });

  it("rejects an explicitly non-U.S. listing", () => {
    const job = makeJob({
      title: "Full Stack Software Engineer, Brazil",
      location: "Sao Paulo",
    });

    expect(filterJobSummaries([job], filters, NOW)).toHaveLength(0);
  });

  it("does not mistake Indianapolis for India", () => {
    const job = makeJob({ location: "Indianapolis, IN" });

    expect(filterJobSummaries([job], filters, NOW)).toHaveLength(1);
  });

  it("rejects non-U.S. ISO country codes", () => {
    const jobs = [
      makeJob({ jobId: "australia", location: "Melbourne, VIC, au" }),
      makeJob({ jobId: "singapore", location: "Singapore, sg" }),
      makeJob({ jobId: "britain", location: "London; Stockholm; GB" }),
    ];

    expect(filterJobSummaries(jobs, filters, NOW)).toHaveLength(0);
  });

  it("rejects excluded titles and seniority", () => {
    const jobs = [
      makeJob({ jobId: "manager", title: "Software Engineering Manager" }),
      makeJob({ jobId: "staff", title: "Staff Software Engineer" }),
      makeJob({ jobId: "test", title: "Software Test Engineer" }),
    ];

    expect(filterJobSummaries(jobs, filters, NOW)).toHaveLength(0);
  });

  it("rejects an excluded employment type stated in the title", () => {
    const job = makeJob({
      title: "Software Engineering Intern (Summer)",
    });

    expect(filterJobSummaries([job], filters, NOW)).toHaveLength(0);
  });

  it("rejects new-graduate software roles", () => {
    const jobs = [
      makeJob({
        jobId: "new-grad",
        title: "Software Engineer - New Grad",
      }),
      makeJob({
        jobId: "new-graduate",
        title: "Software Engineer, New Graduate",
      }),
    ];

    expect(filterJobSummaries(jobs, filters, NOW)).toHaveLength(0);
  });

  it("allows a missing posted date when first-seen fallback is enabled", () => {
    const job = makeJob({ postedAt: null });

    expect(filterJobSummaries([job], filters, NOW)).toHaveLength(1);
  });
});
