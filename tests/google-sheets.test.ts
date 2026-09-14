import { beforeEach, describe, expect, it, vi } from "vitest";

import type { QualifiedJob } from "../src/sheets/google-sheets.js";

const { spreadsheetsGet, valuesAppend, valuesGet, valuesUpdate } = vi.hoisted(
  () => ({
    spreadsheetsGet: vi.fn(),
    valuesAppend: vi.fn(),
    valuesGet: vi.fn(),
    valuesUpdate: vi.fn(),
  }),
);

vi.mock("googleapis", () => ({
  google: {
    auth: {
      GoogleAuth: class {},
      JWT: class {},
    },
    sheets: () => ({
      spreadsheets: {
        get: spreadsheetsGet,
        values: {
          append: valuesAppend,
          get: valuesGet,
          update: valuesUpdate,
        },
      },
    }),
  },
}));

import { GoogleSheetsJobStore } from "../src/sheets/google-sheets.js";

const qualifiedJob: QualifiedJob = {
  job: {
    companyId: "example",
    companyName: "Example",
    jobId: "job-2",
    title: "Platform Developer",
    location: "Remote, United States",
    url: "https://example.com/jobs/job-2",
    postedAt: new Date("2026-09-13T18:00:00.000Z"),
    updatedAt: null,
    source: "greenhouse",
    description: "Build software platforms.",
  },
  validation: {
    roleMatch: true,
    usEligible: true,
    excludedSeniority: false,
    excludedDomain: false,
    excludedEmploymentType: false,
    requiredYears: null,
    experienceStatus: "NOT_SPECIFIED",
    decision: "QUALIFIED",
    reasons: ["Qualified."],
  },
};

beforeEach(() => {
  process.env.GOOGLE_SHEET_ID = "sheet-id";
  process.env.GOOGLE_SHEET_GID = "0";
  process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE = "/tmp/key.json";
  spreadsheetsGet.mockReset().mockResolvedValue({
    data: {
      sheets: [{ properties: { sheetId: 0, title: "Jobs" } }],
    },
  });
  valuesAppend.mockReset().mockResolvedValue({ data: {} });
  valuesGet.mockReset();
  valuesUpdate.mockReset().mockResolvedValue({ data: {} });
});

describe("GoogleSheetsJobStore", () => {
  it("adds a next-day heading before jobs when the heading is missing", async () => {
    valuesGet
      .mockResolvedValueOnce({
        data: { values: [["S.No", "Company", "Job URL", "Title"]] },
      })
      .mockResolvedValueOnce({
        data: {
          values: [["1", "Existing", "https://example.com/jobs/job-1"]],
        },
      });

    const result = await new GoogleSheetsJobStore().appendQualifiedJobs(
      [qualifiedJob],
      new Date("2026-09-13T20:00:00-07:00"),
    );

    expect(result).toEqual({ appended: 1, duplicates: 0 });
    expect(valuesAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: {
          values: [
            ["", "", "SEPT 14 2026", ""],
            [
              2,
              "Example",
              "https://example.com/jobs/job-2",
              "Platform Developer",
            ],
          ],
        },
      }),
    );
  });

  it("reuses an existing next-day heading", async () => {
    valuesGet
      .mockResolvedValueOnce({
        data: { values: [["S.No", "Company", "Job URL", "Title"]] },
      })
      .mockResolvedValueOnce({
        data: {
          values: [
            ["", "", "SEPT 14 2026"],
            ["7", "Existing", "https://example.com/jobs/job-1"],
          ],
        },
      });

    await new GoogleSheetsJobStore().appendQualifiedJobs(
      [qualifiedJob],
      new Date("2026-09-13T20:00:00-07:00"),
    );

    expect(valuesAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: {
          values: [
            [
              8,
              "Example",
              "https://example.com/jobs/job-2",
              "Platform Developer",
            ],
          ],
        },
      }),
    );
  });

  it("does not append a duplicate URL or another date heading", async () => {
    valuesGet
      .mockResolvedValueOnce({
        data: { values: [["S.No", "Company", "Job URL", "Title"]] },
      })
      .mockResolvedValueOnce({
        data: {
          values: [
            ["", "", "SEPT 14 2026"],
            ["7", "Example", "https://example.com/jobs/job-2"],
          ],
        },
      });

    const result = await new GoogleSheetsJobStore().appendQualifiedJobs(
      [qualifiedJob],
      new Date("2026-09-13T20:00:00-07:00"),
    );

    expect(result).toEqual({ appended: 0, duplicates: 1 });
    expect(valuesAppend).not.toHaveBeenCalled();
  });
});
