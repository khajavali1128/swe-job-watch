import { google, type sheets_v4 } from "googleapis";

import type { JobValidationResult } from "../ai/job-validator.js";
import type { JobDetails, JobSummary } from "../types.js";

export interface QualifiedJob {
  job: JobDetails;
  validation: JobValidationResult;
}

export interface ProcessedJob extends QualifiedJob {
  processedAt: Date;
}

export interface AppendQualifiedJobsResult {
  appended: number;
  duplicates: number;
}

export interface AppendProcessedJobsResult {
  appended: number;
  duplicates: number;
}

interface GoogleSheetsConfig {
  spreadsheetId: string;
  sheetGid: number;
  serviceAccountKeyFile?: string;
  serviceAccountEmail?: string;
  privateKey?: string;
}

const HEADERS = [
  "S.No",
  "Company",
  "Job URL",
  "Title",
];
const PROCESSED_JOBS_TAB = "Processed Jobs";
const PROCESSED_JOBS_HEADERS = [
  "Job Key",
  "Company",
  "Job ID",
  "Job URL",
  "Decision",
  "Processed At",
  "Updated At",
];

export class GoogleSheetsJobStore {
  private readonly sheets: sheets_v4.Sheets;
  private sheetTab: string | undefined;
  private processedJobsTab: string | undefined;

  constructor(private readonly config = loadGoogleSheetsConfig()) {
    const auth = config.serviceAccountKeyFile
      ? new google.auth.GoogleAuth({
          keyFile: config.serviceAccountKeyFile,
          scopes: ["https://www.googleapis.com/auth/spreadsheets"],
        })
      : new google.auth.JWT({
          email: config.serviceAccountEmail,
          key: config.privateKey,
          scopes: ["https://www.googleapis.com/auth/spreadsheets"],
        });

    this.sheets = google.sheets({ version: "v4", auth });
  }

  async verifyConnection(): Promise<void> {
    await this.sheets.spreadsheets.get({
      spreadsheetId: this.config.spreadsheetId,
      fields: "spreadsheetId",
    });
  }

  async appendQualifiedJobs(
    records: QualifiedJob[],
    runAt = new Date(),
  ): Promise<AppendQualifiedJobsResult> {
    const sheetTab = await this.resolveSheetTab();
    await this.ensureHeaders();

    const qualifiedRecords = records.filter(
      ({ validation }) => validation.decision === "QUALIFIED",
    );
    const sheetState = await this.readSheetState();
    const seenKeys = new Set(sheetState.existingUrls);
    const newRecords = qualifiedRecords.filter(({ job }) => {
      const key = jobKey(job);

      if (seenKeys.has(key)) {
        return false;
      }

      seenKeys.add(key);
      return true;
    });

    if (newRecords.length === 0) {
      return {
        appended: 0,
        duplicates: qualifiedRecords.length,
      };
    }

    const targetDateHeading = formatNextDayHeading(runAt);
    const jobRows = newRecords.map(({ job }, index) => [
      sheetState.highestSerialNumber + index + 1,
      job.companyName,
      job.url,
      job.title,
    ]);
    const rows = sheetState.dateHeadings.has(targetDateHeading)
      ? jobRows
      : [["", "", targetDateHeading, ""], ...jobRows];

    await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.config.spreadsheetId,
      range: `${sheetName(sheetTab)}!A:D`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: rows },
    });

    return {
      appended: newRecords.length,
      duplicates: qualifiedRecords.length - newRecords.length,
    };
  }

  async loadProcessedJobKeys(createIfMissing = true): Promise<Set<string>> {
    const sheetTab = await this.resolveProcessedJobsTab(createIfMissing);

    if (!sheetTab) {
      return new Set();
    }

    await this.ensureProcessedJobsHeaders();
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.config.spreadsheetId,
      range: `${sheetName(sheetTab)}!A2:A`,
    });

    return new Set(
      (response.data.values ?? [])
        .map((row) => row[0])
        .filter((value): value is string =>
          typeof value === "string" && value.trim().length > 0
        ),
    );
  }

  async appendProcessedJobs(
    records: ProcessedJob[],
  ): Promise<AppendProcessedJobsResult> {
    if (records.length === 0) {
      return { appended: 0, duplicates: 0 };
    }

    const sheetTab = await this.resolveProcessedJobsTab();

    if (!sheetTab) {
      throw new Error("Processed Jobs tab could not be created");
    }

    const existingKeys = await this.loadProcessedJobKeys();
    const newRecords = records.filter(({ job }) => {
      const key = processedJobKey(job);

      if (existingKeys.has(key)) {
        return false;
      }

      existingKeys.add(key);
      return true;
    });

    if (newRecords.length === 0) {
      return { appended: 0, duplicates: records.length };
    }

    await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.config.spreadsheetId,
      range: `${sheetName(sheetTab)}!A:G`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: newRecords.map(({ job, validation, processedAt }) => [
          processedJobKey(job),
          job.companyName,
          job.jobId,
          job.url,
          validation.decision,
          processedAt.toISOString(),
          job.updatedAt?.toISOString() ?? "",
        ]),
      },
    });

    return {
      appended: newRecords.length,
      duplicates: records.length - newRecords.length,
    };
  }

  private async ensureHeaders(): Promise<void> {
    const range = `${sheetName(await this.resolveSheetTab())}!A1:D1`;
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.config.spreadsheetId,
      range,
    });

    if ((response.data.values?.[0]?.length ?? 0) > 0) {
      return;
    }

    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.config.spreadsheetId,
      range,
      valueInputOption: "RAW",
      requestBody: { values: [HEADERS] },
    });
  }

  private async ensureProcessedJobsHeaders(): Promise<void> {
    const sheetTab = await this.resolveProcessedJobsTab();

    if (!sheetTab) {
      throw new Error("Processed Jobs tab could not be created");
    }

    const range = `${sheetName(sheetTab)}!A1:G1`;
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.config.spreadsheetId,
      range,
    });

    if ((response.data.values?.[0]?.length ?? 0) > 0) {
      return;
    }

    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.config.spreadsheetId,
      range,
      valueInputOption: "RAW",
      requestBody: { values: [PROCESSED_JOBS_HEADERS] },
    });
  }

  private async readSheetState(): Promise<{
    existingUrls: Set<string>;
    highestSerialNumber: number;
    dateHeadings: Set<string>;
  }> {
    const sheetTab = await this.resolveSheetTab();
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.config.spreadsheetId,
      range: `${sheetName(sheetTab)}!A2:C`,
    });
    const rows = response.data.values ?? [];

    return {
      existingUrls: new Set(
        rows
          .map((row) => row[2])
          .filter((value): value is string =>
            typeof value === "string" && /^https?:\/\//i.test(value)
          ),
      ),
      highestSerialNumber: rows.reduce((highest, row) => {
        const serialNumber = Number(row[0]);
        return Number.isInteger(serialNumber)
          ? Math.max(highest, serialNumber)
          : highest;
      }, 0),
      dateHeadings: new Set(
        rows
          .flatMap((row) => row)
          .filter((value): value is string =>
            typeof value === "string" && DATE_HEADING_PATTERN.test(value)
          )
          .map(normalizeDateHeading),
      ),
    };
  }

  private async resolveSheetTab(): Promise<string> {
    if (this.sheetTab) {
      return this.sheetTab;
    }

    const response = await this.sheets.spreadsheets.get({
      spreadsheetId: this.config.spreadsheetId,
      fields: "sheets.properties(sheetId,title)",
    });
    const sheet = response.data.sheets?.find(
      ({ properties }) => properties?.sheetId === this.config.sheetGid,
    );
    const title = sheet?.properties?.title;

    if (!title) {
      throw new Error(
        `Google Sheet tab with gid ${this.config.sheetGid} was not found`,
      );
    }

    this.sheetTab = title;
    return title;
  }

  private async resolveProcessedJobsTab(
    createIfMissing = true,
  ): Promise<string | undefined> {
    if (this.processedJobsTab) {
      return this.processedJobsTab;
    }

    const response = await this.sheets.spreadsheets.get({
      spreadsheetId: this.config.spreadsheetId,
      fields: "sheets.properties(sheetId,title)",
    });
    const existingTab = response.data.sheets?.find(
      ({ properties }) => properties?.title === PROCESSED_JOBS_TAB,
    );

    if (!existingTab && !createIfMissing) {
      return undefined;
    }

    if (!existingTab) {
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.config.spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: PROCESSED_JOBS_TAB,
                  hidden: true,
                },
              },
            },
          ],
        },
      });
    }

    this.processedJobsTab = PROCESSED_JOBS_TAB;
    return this.processedJobsTab;
  }
}

function loadGoogleSheetsConfig(): GoogleSheetsConfig {
  const serviceAccountKeyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!serviceAccountKeyFile && (!serviceAccountEmail || !privateKey)) {
    throw new Error(
      "Set GOOGLE_SERVICE_ACCOUNT_KEY_FILE or both GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY for Google Sheets",
    );
  }

  return {
    spreadsheetId: requiredEnvironmentVariable("GOOGLE_SHEET_ID"),
    sheetGid: parseSheetGid(process.env.GOOGLE_SHEET_GID),
    serviceAccountKeyFile,
    serviceAccountEmail,
    privateKey,
  };
}

function parseSheetGid(value: string | undefined): number {
  const gid = Number(value ?? "0");

  if (!Number.isInteger(gid) || gid < 0) {
    throw new Error("GOOGLE_SHEET_GID must be a non-negative integer");
  }

  return gid;
}

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required for Google Sheets`);
  }

  return value;
}

function sheetName(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function jobKey(job: JobDetails): string {
  return job.url;
}

export function processedJobKey(
  job: Pick<JobSummary, "source" | "companyId" | "jobId">,
): string {
  return `${job.source}:${job.companyId}:${job.jobId}`;
}

const PACIFIC_TIME_ZONE = "America/Los_Angeles";
const DATE_HEADING_PATTERN =
  /^(?:JAN|FEB|MAR(?:CH)?|APR(?:IL)?|MAY|JUN(?:E)?|JUL(?:Y)?|AUG|SEP(?:T)?|OCT|NOV|DEC)\s+\d{1,2}\s+\d{4}$/i;
const MONTH_HEADINGS = [
  "JAN",
  "FEB",
  "MARCH",
  "APRIL",
  "MAY",
  "JUNE",
  "JULY",
  "AUG",
  "SEPT",
  "OCT",
  "NOV",
  "DEC",
];

function formatNextDayHeading(runAt: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(runAt);
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  const nextDay = new Date(
    Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day) + 1,
    ),
  );

  return `${MONTH_HEADINGS[nextDay.getUTCMonth()]} ${nextDay.getUTCDate()} ${nextDay.getUTCFullYear()}`;
}

function normalizeDateHeading(value: string): string {
  const [month, day, year] = value.trim().toUpperCase().split(/\s+/);
  const monthAliases: Record<string, string> = {
    JAN: "JAN",
    FEB: "FEB",
    MAR: "MARCH",
    MARCH: "MARCH",
    APR: "APRIL",
    APRIL: "APRIL",
    MAY: "MAY",
    JUN: "JUNE",
    JUNE: "JUNE",
    JUL: "JULY",
    JULY: "JULY",
    AUG: "AUG",
    SEP: "SEPT",
    SEPT: "SEPT",
    OCT: "OCT",
    NOV: "NOV",
    DEC: "DEC",
  };

  return `${monthAliases[month ?? ""] ?? month} ${Number(day)} ${year}`;
}
