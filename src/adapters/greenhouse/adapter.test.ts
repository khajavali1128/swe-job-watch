import { afterEach, describe, expect, it, vi } from "vitest";

import { GreenhouseAdapter } from "./adapter.js";
import type { CompanyConfig } from "../../config/index.js";

const company: CompanyConfig = {
  id: "stripe",
  name: "Stripe",
  enabled: true,
  adapter: "greenhouse",
  handle: "stripe",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GreenhouseAdapter", () => {
  it("normalizes summaries and fetches details independently", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jobs: [{
          id: 123,
          title: "Software Engineer",
          location: { name: "Remote, US" },
          absolute_url: "https://boards.greenhouse.io/stripe/jobs/123",
          first_published: "2026-10-31T12:00:00.000Z",
          updated_at: "2026-11-01T12:00:00.000Z",
        }],
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        content: "Build payment infrastructure.",
      })));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new GreenhouseAdapter();
    const summaries = await adapter.fetchJobSummaries(company);

    expect(summaries[0]).toMatchObject({
      jobId: "123",
      title: "Software Engineer",
      location: "Remote, US",
      source: "greenhouse",
    });
    await expect(adapter.fetchJobDetails(company, summaries[0]!)).resolves
      .toMatchObject({ description: "Build payment infrastructure." });
  });
});
