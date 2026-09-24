import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ProcessedJob,
  QualifiedJob,
} from "../src/sheets/google-sheets.js";

const {
  spreadsheetsBatchUpdate,
  spreadsheetsGet,
  valuesAppend,
  valuesGet,
  valuesUpdate,
} = vi.hoisted(
  () => ({
    spreadsheetsBatchUpdate: vi.fn(),
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
        batchUpdate: spreadsheetsBatchUpdate,
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

import {
  GoogleSheetsJobStore,
  processedJobKey,
} from "../src/sheets/google-sheets.js";

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
    sponsorshipEligible: true,
    citizenshipRequired: false,
    requiredYears: null,
    experienceStatus: "NOT_SPECIFIED",
    decision: "QUALIFIED",
    reasons: ["Qualified."],
  },
};
const processedJob: ProcessedJob = {
  ...qualifiedJob,
  processedAt: new Date("2026-09-14T03:00:00.000Z"),
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
  spreadsheetsBatchUpdate.mockReset().mockResolvedValue({ data: {} });
  valuesAppend.mockReset().mockResolvedValue({ data: {} });
  valuesGet.mockReset();
  valuesUpdate.mockReset().mockResolvedValue({ data: {} });
});

describe("GoogleSheetsJobStore", () => {
  it("appends jobs directly after the existing rows", async () => {
    valuesAppend.mockResolvedValue({
      data: { updates: { updatedRange: "'Jobs'!A3:F3" } },
    });
    valuesGet
      .mockResolvedValueOnce({
        data: {
          values: [[
            "Company",
            "Job URL",
            "Title",
            "Posted Date",
            "H1B Rank",
            "Tag",
          ]],
        },
      })
      .mockResolvedValueOnce({
        data: {
          values: [["Existing", "https://example.com/jobs/job-1", "Role"]],
        },
      })
      .mockResolvedValueOnce({
        data: { values: [["example", "Example", 23]] },
      });

    const result = await new GoogleSheetsJobStore().appendQualifiedJobs([
      qualifiedJob,
    ]);

    expect(result).toEqual({ appended: 1, duplicates: 0 });
    expect(valuesAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        range: "'Jobs'!A:F",
        requestBody: {
          values: [
            [
              "Example",
              "https://example.com/jobs/job-2",
              "Platform Developer",
              "2026-09-13",
              23,
              "",
            ],
          ],
        },
      }),
    );
    expect(spreadsheetsBatchUpdate).toHaveBeenCalledWith({
      spreadsheetId: "sheet-id",
      requestBody: {
        requests: [
          {
            repeatCell: {
              range: {
                sheetId: 0,
                startRowIndex: 2,
                endRowIndex: 3,
                startColumnIndex: 0,
                endColumnIndex: 6,
              },
              cell: {
                userEnteredFormat: {
                  backgroundColorStyle: {
                    rgbColor: {
                      red: 1,
                      green: 1,
                      blue: 1,
                    },
                  },
                },
              },
              fields: "userEnteredFormat.backgroundColorStyle",
            },
          },
        ],
      },
    });
  });

  it("does not append a duplicate URL", async () => {
    valuesGet
      .mockResolvedValueOnce({
        data: {
          values: [[
            "Company",
            "Job URL",
            "Title",
            "Posted Date",
            "H1B Rank",
            "Tag",
          ]],
        },
      })
      .mockResolvedValueOnce({
        data: {
          values: [
            ["", "SEPT 14 2026", "", ""],
            [
              "Example",
              "https://example.com/jobs/job-2",
              "Platform Developer",
              "2026-09-13T18:00:00.000Z",
            ],
          ],
        },
      });

    const result = await new GoogleSheetsJobStore().appendQualifiedJobs([
      qualifiedJob,
    ]);

    expect(result).toEqual({ appended: 0, duplicates: 1 });
    expect(valuesAppend).not.toHaveBeenCalled();
  });

  it("appends a blank rank when the ranking lookup is unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    valuesAppend.mockResolvedValue({
      data: { updates: { updatedRange: "'Jobs'!A2:F2" } },
    });
    valuesGet
      .mockResolvedValueOnce({
        data: {
          values: [[
            "Company",
            "Job URL",
            "Title",
            "Posted Date",
            "H1B Rank",
            "Tag",
          ]],
        },
      })
      .mockResolvedValueOnce({ data: { values: [] } })
      .mockRejectedValueOnce(new Error("ranking tab unavailable"));

    const result = await new GoogleSheetsJobStore().appendQualifiedJobs([
      qualifiedJob,
    ]);

    expect(result).toEqual({ appended: 1, duplicates: 0 });
    expect(valuesAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: {
          values: [[
            "Example",
            "https://example.com/jobs/job-2",
            "Platform Developer",
            "2026-09-13",
            "",
            "",
          ]],
        },
      }),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("H1B ranking lookup unavailable"),
    );
    warn.mockRestore();
  });

  it("upgrades an existing three-column header", async () => {
    valuesGet
      .mockResolvedValueOnce({
        data: { values: [["Company", "Job URL", "Title"]] },
      })
      .mockResolvedValueOnce({ data: { values: [] } });

    await new GoogleSheetsJobStore().appendQualifiedJobs([]);

    expect(valuesUpdate).toHaveBeenCalledWith({
      spreadsheetId: "sheet-id",
      range: "'Jobs'!A1:F1",
      valueInputOption: "RAW",
      requestBody: {
        values: [[
          "Company",
          "Job URL",
          "Title",
          "Posted Date",
          "H1B Rank",
          "Tag",
        ]],
      },
    });
  });

  it("loads stable keys from an existing processed jobs tab", async () => {
    spreadsheetsGet.mockResolvedValue({
      data: {
        sheets: [
          { properties: { sheetId: 0, title: "Jobs" } },
          { properties: { sheetId: 1, title: "Processed Jobs" } },
        ],
      },
    });
    valuesGet
      .mockResolvedValueOnce({ data: { values: [["Job Key"]] } })
      .mockResolvedValueOnce({
        data: {
          values: [
            ["greenhouse:example:job-1"],
            ["greenhouse:example:job-2"],
          ],
        },
      });

    const keys = await new GoogleSheetsJobStore().loadProcessedJobKeys();

    expect(keys).toEqual(
      new Set([
        "greenhouse:example:job-1",
        "greenhouse:example:job-2",
      ]),
    );
    expect(spreadsheetsBatchUpdate).not.toHaveBeenCalled();
  });

  it("creates the processed jobs tab as hidden when it is missing", async () => {
    valuesGet
      .mockResolvedValueOnce({ data: { values: [] } })
      .mockResolvedValueOnce({ data: { values: [] } });

    await new GoogleSheetsJobStore().loadProcessedJobKeys();

    expect(spreadsheetsBatchUpdate).toHaveBeenCalledWith({
      spreadsheetId: "sheet-id",
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: "Processed Jobs",
                hidden: true,
              },
            },
          },
        ],
      },
    });
    expect(valuesUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        range: "'Processed Jobs'!A1:G1",
      }),
    );
  });

  it("does not create a missing processed jobs tab for a dry run", async () => {
    const keys = await new GoogleSheetsJobStore().loadProcessedJobKeys(false);

    expect(keys).toEqual(new Set());
    expect(spreadsheetsBatchUpdate).not.toHaveBeenCalled();
    expect(valuesGet).not.toHaveBeenCalled();
    expect(valuesUpdate).not.toHaveBeenCalled();
  });

  it("appends only new processed decisions", async () => {
    spreadsheetsGet.mockResolvedValue({
      data: {
        sheets: [
          { properties: { sheetId: 0, title: "Jobs" } },
          { properties: { sheetId: 1, title: "Processed Jobs" } },
        ],
      },
    });
    valuesGet
      .mockResolvedValueOnce({ data: { values: [["Job Key"]] } })
      .mockResolvedValueOnce({
        data: { values: [["greenhouse:example:job-1"]] },
      });

    const result = await new GoogleSheetsJobStore().appendProcessedJobs([
      processedJob,
      processedJob,
    ]);

    expect(result).toEqual({ appended: 1, duplicates: 1 });
    expect(valuesAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        range: "'Processed Jobs'!A:G",
        requestBody: {
          values: [
            [
              "greenhouse:example:job-2",
              "Example",
              "job-2",
              "https://example.com/jobs/job-2",
              "QUALIFIED",
              "2026-09-14T03:00:00.000Z",
              "",
            ],
          ],
        },
      }),
    );
  });

  it("builds processed keys from provider, company, and job IDs", () => {
    expect(processedJobKey(qualifiedJob.job)).toBe(
      "greenhouse:example:job-2",
    );
  });
});
