import { afterEach, describe, expect, it, vi } from "vitest";

import { OracleAdapter } from "../oracle/adapter.js";
import type { CompanyConfig } from "../../config/index.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const oracleCompany: CompanyConfig = {
  id: "goldman-sachs",
  name: "Goldman Sachs",
  enabled: true,
  adapter: "oracle",
  handle: "LateralHiring",
  apiBaseUrl: "https://example.oraclecloud.com",
  siteNumber: "CX_3002",
  publicJobBaseUrl: "https://example.com/roles",
};

describe("OracleAdapter", () => {
  it("uses recent listing dates and fetches exact details only on demand", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              {
                TotalJobsCount: 2,
                requisitionList: [
                  {
                    Id: 179758,
                    Title: "Software Engineer",
                    PostedDate: "2026-09-16",
                    PostingEndDate: null,
                    PrimaryLocation: "New York, NY, United States",
                    secondaryLocations: [{ Name: "Dallas, TX, United States" }],
                  },
                  {
                    Id: 179759,
                    Title: "Platform Engineer",
                    PostedDate: "2026-09-15",
                    PostingEndDate: null,
                    PrimaryLocation: "San Francisco, CA, United States",
                  },
                ],
              },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              {
                Id: 179758,
                ExternalPostedStartDate: "2026-09-16T10:15:00+00:00",
                ExternalPostedEndDate: null,
                PrimaryLocation: "New York, NY, United States",
                secondaryLocations: [{ Name: "Dallas, TX, United States" }],
                ExternalDescriptionStr: "Build financial software.",
                ExternalResponsibilitiesStr: "Design reliable services.",
                ExternalQualificationsStr: "Four years required.",
              },
            ],
          }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new OracleAdapter();
    const jobs = await adapter.fetchJobSummaries(oracleCompany, {
      postedAfter: new Date("2026-09-16T12:00:00.000Z"),
    });

    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      jobId: "179758",
      title: "Software Engineer",
      location:
        "New York, NY, United States; Dallas, TX, United States",
      url: "https://example.com/roles/179758",
      updatedAt: null,
      source: "oracle",
    });
    expect(jobs[0]?.postedAt?.toISOString()).toBe(
      "2026-09-16T23:59:59.999Z",
    );

    const details = await adapter.fetchJobDetails(oracleCompany, jobs[0]!);

    expect(details).toMatchObject({
      description:
        "Build financial software.\n\nDesign reliable services.\n\nFour years required.",
    });
    expect(details.postedAt?.toISOString()).toBe(
      "2026-09-16T10:15:00.000Z",
    );

    const listingUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(listingUrl.searchParams.get("finder")).toContain(
      "postingStartDate=2026-09-15",
    );
    expect(listingUrl.searchParams.get("fields")).toContain(
      "requisitionList:Id,Title,PostedDate,PostingEndDate",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
