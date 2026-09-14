# SWE Job Watch

SWE Job Watch checks public applicant tracking system boards once per day, finds postings from the last 25 hours, and appends them to a Google Sheet.

The first version supports:

- Greenhouse
- Lever
- SmartRecruiters

## How It Works

1. You list target companies in `config/companies.yaml`.
2. You define qualification rules in `config/filters.yaml`.
3. The service fetches each public jobs API.
4. It normalizes every posting into one common shape.
5. It filters by freshness, title keywords, location, seniority, and employment type.
6. Gemini validates the full descriptions of jobs that survive those filters.
7. It appends qualified, non-duplicate jobs to Google Sheets.

## Quick Start

Requires Node.js 20 or newer.

```sh
cp .env.example .env
npm run check
npm run dry-run
```

Then edit:

- `.env` for Google Sheets credentials
- `config/companies.yaml` for companies to watch
- `config/filters.yaml` for matching rules

Build and run for real:

```sh
npm run build
npm start
```

## Company Config

Each company entry needs:

- `name`: company display name
- `enabled`: whether to include it in runs
- `adapter`: `greenhouse`, `lever`, or `smartrecruiters`
- `handle`: public ATS slug

Example:

```yaml
companies:
  - id: airbnb
    name: Airbnb
    enabled: true
    adapter: greenhouse
    handle: airbnb
```

## Google Sheets Setup

1. Create a Google Cloud project.
2. Enable the Google Sheets API.
3. Create a service account.
4. Create and download a JSON key.
5. Share the target spreadsheet with the service account email.
6. Set `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` to the downloaded JSON file path.

Required environment variables:

- `GOOGLE_SHEET_ID`
- `GOOGLE_SHEET_GID`
- `GOOGLE_SERVICE_ACCOUNT_KEY_FILE`
- `GEMINI_API_KEY`

## Sheet Columns

The service appends rows in this order:

`S.No`, `Company`, `Job URL`, `Title`

## Daily Schedule

The GitHub Actions workflow in `.github/workflows/job-watch.yml` runs daily at 01:00 UTC (5:00 PM PST). Add these repository secrets before enabling it:

- `GEMINI_API_KEY`: your Gemini API key
- `GOOGLE_SERVICE_ACCOUNT_JSON`: the complete contents of the downloaded service-account JSON file
- `EMAIL_USER`: Gmail address used to send run summaries
- `EMAIL_APP_PASSWORD`: Google app password for that Gmail account
- `EMAIL_TO`: address that receives run summaries

You can also run it anywhere that supports scheduled commands, such as cron, Render, Railway, Fly.io, or a small VPS.
