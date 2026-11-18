import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkdayAdapter } from "../workday/adapter.js";
import type { CompanyConfig } from "../../config/index.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const workdayCompany: CompanyConfig = {
  id: "adobe",
  name: "Adobe",
  enabled: true,
  adapter: "workday",
  handle: "external_experienced",
  apiBaseUrl: "https://adobe.example.com",
  tenant: "adobe",
};

describe("WorkdayAdapter", () => {
  it("normalizes relative posting dates and fetches the full description", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-16T18:00:00.000Z"));

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            total: 2,
            jobPostings: [
              {
                title: "Software Development Engineer",
                externalPath: "/job/San-Jose/Software-Engineer_R162345",
                locationsText: "San Jose, California, United States",
                postedOn: "Posted Today",
                bulletFields: ["Spotlight Job", "R162345"],
              },
              {
                title: "Platform Engineer",
                externalPath: "/job/Seattle/Platform-Engineer_R162346",
                locationsText: "Seattle, Washington, United States",
                postedOn: "Posted Yesterday",
                bulletFields: ["R162346"],
              },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jobPostingInfo: {
              title: "Software Development Engineer",
              jobReqId: "R162345",
              location: "San Jose, California, United States",
              additionalLocations: ["New York, New York, United States"],
              externalUrl:
                "https://adobe.example.com/external_experienced/job/San-Jose/Software-Engineer_R162345",
              jobDescription: "Build Adobe software products.",
            },
          }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new WorkdayAdapter();
    const jobs = await adapter.fetchJobSummaries(workdayCompany);

    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      jobId: "R162345",
      location: "San Jose, California, United States",
      url: "https://adobe.example.com/external_experienced/job/San-Jose/Software-Engineer_R162345",
      source: "workday",
    });
    expect(jobs[0]?.postedAt?.toISOString()).toBe(
      "2026-09-16T18:00:00.000Z",
    );
    expect(jobs[1]?.postedAt?.toISOString()).toBe(
      "2026-09-15T18:00:00.000Z",
    );

    await expect(
      adapter.fetchJobDetails(workdayCompany, jobs[0]!),
    ).resolves.toMatchObject({
      location:
        "San Jose, California, United States; New York, New York, United States",
      description: "Build Adobe software products.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps paginating when later pages reset the reported total", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            total: 2,
            jobPostings: [
              {
                title: "Software Engineer",
                externalPath: "/job/One/Software-Engineer_R1",
                bulletFields: ["R1"],
              },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            total: 0,
            jobPostings: [
              {
                title: "Platform Engineer",
                externalPath: "/job/Two/Platform-Engineer_R2",
                bulletFields: ["R2"],
              },
            ],
          }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const jobs = await new WorkdayAdapter().fetchJobSummaries(workdayCompany);

    expect(jobs.map((job) => job.jobId)).toEqual(["R1", "R2"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("skips malformed listings while preserving valid jobs", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            total: 2,
            jobPostings: [
              { bulletFields: ["JR2024291"] },
              {
                title: "Software Engineer",
                externalPath: "/job/One/Software-Engineer_R1",
                bulletFields: ["R1"],
              },
            ],
          }),
        ),
      ),
    );

    const jobs = await new WorkdayAdapter().fetchJobSummaries(workdayCompany);

    expect(jobs.map((job) => job.jobId)).toEqual(["R1"]);
    expect(warn).toHaveBeenCalledWith(
      "[Adobe] Skipped 1 malformed Workday listing(s) missing a title or externalPath: JR2024291",
    );
  });

  it("fails when a nonempty listing response has no usable jobs", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            total: 1,
            jobPostings: [{ bulletFields: ["broken-job"] }],
          }),
        ),
      ),
    );

    await expect(
      new WorkdayAdapter().fetchJobSummaries(workdayCompany),
    ).rejects.toThrow("Workday returned no usable jobs for Adobe");
  });
});
