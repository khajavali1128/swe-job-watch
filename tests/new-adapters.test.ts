import { afterEach, describe, expect, it, vi } from "vitest";

import { IcimsAdapter } from "../src/adapters/icims.js";
import type { CompanyConfig } from "../src/config/index.js";
import { CompanySchema } from "../src/config/schema.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const icimsCompany: CompanyConfig = {
  id: "amd",
  name: "AMD",
  enabled: true,
  adapter: "icims",
  apiBaseUrl: "https://careers.amd.com",
  handle: "careers-home",
};

describe("IcimsAdapter", () => {
  it("normalizes iCIMS Jibe jobs and reuses their full descriptions", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      count: 1,
      jobs: [{
        data: {
          slug: "92811",
          req_id: "92811",
          title: "Platform System Architect",
          full_location: "Austin, Texas",
          posted_date: "2026-09-28T20:36:00+0000",
          description: "Design distributed software platforms.",
        },
      }],
    }))));

    const adapter = new IcimsAdapter();
    const jobs = await adapter.fetchJobSummaries(icimsCompany);

    expect(jobs[0]).toMatchObject({
      jobId: "92811",
      title: "Platform System Architect",
      location: "Austin, Texas",
      url: "https://careers.amd.com/careers-home/jobs/92811",
      source: "icims",
    });
    expect(jobs[0]?.postedAt?.toISOString()).toBe(
      "2026-09-28T20:36:00.000Z",
    );
    await expect(
      adapter.fetchJobDetails(icimsCompany, jobs[0]!),
    ).resolves.toMatchObject({
      description: "Design distributed software platforms.",
    });
  });

  it("accepts strict iCIMS company configuration", () => {
    expect(CompanySchema.parse(icimsCompany)).toMatchObject({
      adapter: "icims",
      handle: "careers-home",
    });
  });
});
