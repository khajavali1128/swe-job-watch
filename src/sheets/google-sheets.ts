import { google, type sheets_v4 } from "googleapis";

import type { JobValidationResult } from "../ai/job-validator.js";
import type { JobDetails } from "../types.js";

export interface QualifiedJob {
  job: JobDetails;
  validation: JobValidationResult;
}

export interface AppendQualifiedJobsResult {
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

export class GoogleSheetsJobStore {
  private readonly sheets: sheets_v4.Sheets;
  private sheetTab: string | undefined;

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

    const rows = newRecords.map(({ job }, index) => [
      sheetState.highestSerialNumber + index + 1,
      job.companyName,
      job.url,
      job.title,
    ]);

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

  private async readSheetState(): Promise<{
    existingUrls: Set<string>;
    highestSerialNumber: number;
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
            typeof value === "string" && value.length > 0
          ),
      ),
      highestSerialNumber: rows.reduce((highest, row) => {
        const serialNumber = Number(row[0]);
        return Number.isInteger(serialNumber)
          ? Math.max(highest, serialNumber)
          : highest;
      }, 0),
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
