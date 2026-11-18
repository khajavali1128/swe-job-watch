import { afterEach, describe, expect, it, vi } from "vitest";

import type { CompanyConfig } from "../../config/index.js";
import { CiscoAdapter } from "./adapter.js";

const company: CompanyConfig = {
  id: "cisco",
  name: "Cisco",
  enabled: true,
  adapter: "cisco",
};

function htmlWithData(data: object): Response {
  return new Response(
    `<html><script>var phApp = {}; phApp.ddo = ${JSON.stringify(data)}; phApp.ready = true;</script></html>`,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("CiscoAdapter", () => {
  it("pages through all results, retains US multi-location jobs, and fetches their details", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(htmlWithData({
        eagerLoadRefineSearch: {
          totalHits: 3,
          data: { jobs: [
            {
              jobId: "101",
              jobSeqNo: "CISCO101",
              title: "Software Engineer",
              location: "San Jose, California, United States of America",
              country: "United States of America",
              postedDate: "2026-11-17T00:00:00.000+0000",
            },
            {
              jobId: "102",
              jobSeqNo: "CISCO102",
              title: "Software Engineer",
              location: "London, United Kingdom",
              country: "United Kingdom",
            },
          ] },
        },
      }))
      .mockResolvedValueOnce(htmlWithData({
        eagerLoadRefineSearch: {
          totalHits: 3,
          data: { jobs: [{
            jobId: "103",
            jobSeqNo: "CISCO103",
            title: "Platform Developer",
            location: "Toronto, Canada",
            country: "Canada",
            multi_location: [
              "Toronto, Canada",
              "Austin, Texas, United States of America",
            ],
            postedDate: "2026-11-18T00:00:00.000+0000",
          }] },
        },
      }))
      .mockResolvedValueOnce(htmlWithData({
        jobDetail: { data: { job: {
          jobId: "103",
          description: "<p>Build developer tools.</p>",
          postedDate: "2026-11-18T00:00:00.000+0000",
          jobUpdatedDate: "2026-11-18T12:00:00.000+0000",
        } } },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new CiscoAdapter();
    const summaries = await adapter.fetchJobSummaries(company);

    expect(summaries).toHaveLength(2);
    expect(summaries.map((job) => job.jobId)).toEqual(["101", "103"]);
    expect(summaries[1]).toMatchObject({
      location: "Austin, Texas, United States of America",
      url: "https://careers.cisco.com/global/en/job/CISCO103",
      source: "cisco",
    });
    expect(summaries[1]?.postedAt?.toISOString()).toBe("2026-11-18T00:00:00.000Z");
    expect(fetchMock.mock.calls[1]?.[0]).toContain("?from=2");

    const details = await adapter.fetchJobDetails(company, summaries[1]!);
    expect(details.description).toBe("<p>Build developer tools.</p>");
    expect(details.updatedAt?.toISOString()).toBe("2026-11-18T12:00:00.000Z");
    expect(fetchMock.mock.calls[2]?.[0]).toBe(summaries[1]?.url);
  });

  it("reports a missing embedded listings payload", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html></html>")));

    await expect(new CiscoAdapter().fetchJobSummaries(company))
      .rejects.toThrow("Cisco did not expose job data");
  });
});
