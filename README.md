# SWE Job Watch

SWE Job Watch is a scheduled Node.js and TypeScript service that scans public ATS job boards, filters recently opened U.S. software-engineering roles, validates full job descriptions with AI, and appends qualified jobs to Google Sheets.

The production service currently checks 112 enabled companies across Ashby, Greenhouse, SmartRecruiters, Oracle Recruiting, and Workday. Lever is implemented, but its companies are disabled because Lever's public postings API does not provide a reliable publication timestamp.

## Workflow

```text
companies.yaml + filters.yaml
            |
            v
Ashby / Greenhouse / Lever / SmartRecruiters / Oracle / Workday APIs
            |
            v
Normalized JobSummary[]
            |
            v
Cheap deterministic filters
  freshness, U.S. location, role title,
  seniority, and employment type
            |
            v
Skip keys already stored in the Processed Jobs ledger
            |
            v
Fetch full descriptions only for survivors
            |
            v
OpenAI validation (gpt-5-nano)
            |
       failure only
            v
Gemini fallback (gemini-3.5-flash-lite)
            |
            v
Zod validation + logical consistency checks
            |
            +----> all successful decisions -> Processed Jobs
            |
            v
Qualified and non-duplicate jobs -> main jobs tab
            |
            v
Gmail run-summary notification
```

Provider failures are isolated by company, and AI failures are isolated by job. The service continues processing, sends the final summary when email is configured, and exits unsuccessfully if any failures occurred so GitHub Actions records the run accurately.

## ATS Support

| Provider | Listing date | Full description | Status |
| --- | --- | --- | --- |
| Ashby | `publishedAt` | Included in board response and cached | Enabled |
| Greenhouse | `first_published` | Individual job endpoint | Enabled |
| SmartRecruiters | `releasedDate` | Individual posting endpoint | Enabled |
| Oracle Recruiting | `ExternalPostedStartDate` | Individual requisition endpoint | Enabled |
| Workday | Relative `postedOn` label | Individual posting endpoint | Enabled |
| Lever | Not exposed | Individual posting endpoint | Implemented; companies disabled |

Every adapter produces the shared `JobSummary` and `JobDetails` types. Ashby descriptions are cached from the board response to avoid per-job requests. SmartRecruiters pagination is handled automatically, and its applicant-facing URL is obtained from the detail response before a job reaches the sheet. Oracle publication timestamps are loaded in batches before freshness filtering. Workday exposes relative posting labels rather than exact timestamps, so the adapter interprets them conservatively to avoid missing recent jobs.

## Qualification Rules

All editable qualification rules live in [`config/filters.yaml`](config/filters.yaml). The current policy:

- Considers jobs posted within the last 72 hours.
- Accepts U.S. locations, U.S.-remote roles, and multi-location roles containing a U.S. location.
- Requires a configured software-development title match.
- Normalizes punctuation and whitespace, so titles such as `Full-Stack Engineer` match configured phrases such as `full stack engineer`.
- Allows generic developer titles such as `Platform Developer` through the cheap stage for final AI validation.
- Rejects excluded titles, seniority levels, and employment types during cheap filtering.
- Uses AI to confirm role relevance, location eligibility, seniority, excluded technical domains, employment type, sponsorship eligibility, and mandatory experience.
- Accepts at most four years of mandatory professional experience.
- Ignores preferred experience when configured to do so.
- Accepts jobs without an explicit numeric experience minimum when configured to do so.
- Rejects jobs whose descriptions explicitly state that visa sponsorship or immigration support is unavailable.

Missing publication dates follow `freshness.allowFirstSeenFallback`. With the current `true` setting, enabling a Lever company would allow all of its otherwise matching listings through the freshness stage, so Lever remains disabled.

Companies and ATS handles live in [`config/companies.yaml`](config/companies.yaml). Set `enabled: false` to stop checking a company without removing it.

## Google Sheet

Only AI-qualified jobs are considered for insertion. Before appending, the service reads the existing Job URL column and skips URLs already present in the sheet.

Rows use this layout:

```text
Company | Job URL | Title | Posted At
```

`Posted At` is the normalized ATS publication or release timestamp in ISO UTC format. It is blank when the provider does not expose a reliable timestamp.

Each run groups new rows beneath the next Pacific calendar day's heading. For example, a run on September 13 uses `SEPT 14 2026`. The service reuses that heading when it already exists; otherwise, it appends the heading once before the new jobs.

The service also maintains a hidden `Processed Jobs` tab. It creates the tab automatically, reads its stable `source:companyId:jobId` keys once at startup, and skips known jobs before fetching descriptions or calling AI. Both qualified and rejected decisions are recorded in a batch after the main-sheet write succeeds. Jobs that fail description fetching or AI validation are not recorded, so a later run can retry them.

## Local Setup

Requirements:

- Node.js 20 or newer
- An OpenAI API key
- A Gemini API key for fallback
- A Google Cloud service account with the Google Sheets API enabled
- Editor access for the service-account email on the target spreadsheet
- Optional Gmail account with 2-Step Verification and an App Password

Install dependencies and create local configuration:

```bash
npm install
cp .env.example .env
```

Required local environment variables:

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Primary AI validation |
| `OPENAI_MODEL` | Primary model; defaults to `gpt-5-nano` |
| `GEMINI_API_KEY` | Fallback AI validation |
| `GEMINI_MODEL` | Fallback model; defaults to `gemini-3.5-flash-lite` |
| `GOOGLE_SHEET_ID` | Spreadsheet ID from its URL |
| `GOOGLE_SHEET_GID` | Numeric target-tab ID; defaults to `0` |
| `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` | Absolute path to the downloaded service-account JSON |

Instead of a JSON file, Google authentication also accepts both `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_PRIVATE_KEY`.

Optional email variables:

| Variable | Purpose |
| --- | --- |
| `EMAIL_USER` | Gmail sender account |
| `EMAIL_APP_PASSWORD` | App Password generated by the sender account |
| `EMAIL_TO` | Summary recipient |

The sender and recipient may be the same Gmail account. Never use a normal Gmail password.

## Commands

```bash
# Validate YAML configuration and Google Sheets access
npm run check

# Run the complete service without Sheet writes or email
# ATS and AI requests are still live
npm run dry-run

# Run the real service from TypeScript; writes qualified jobs and sends email
npm run dev

# Compile and run the real production build
npm run build
npm start

# Unit tests and static type checking
npm test
npm run typecheck
```

Audit every configured company's public ATS listing API without running filters, AI validation, Sheets writes, or email:

```bash
npm run test:companies
```

The audit includes disabled companies and marks each result as `PASS`, `EMPTY`, or `FAIL`.

The focused end-to-end harness fetches live ATS data and validates at most one surviving job per company. It does not write to Sheets or send email:

```bash
# All enabled companies
npm run test:workflow

# One enabled company
npm run test:workflow -- doordash

# One specific job, if it survives cheap filtering
npm run test:workflow -- doordash JOB_ID
```

## GitHub Actions

[`job-watch.yml`](.github/workflows/job-watch.yml) runs the production service every three hours. GitHub may start scheduled workflows a few minutes late.

The workflow can also be run manually from **Actions -> SWE Job Watch -> Run workflow**, or with:

```bash
gh workflow run job-watch.yml
gh run watch
```

The repository requires these GitHub Actions secrets:

- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `GOOGLE_SERVICE_ACCOUNT_JSON`: complete contents of the downloaded JSON key
- `EMAIL_USER`
- `EMAIL_APP_PASSWORD`
- `EMAIL_TO`

Each cloud run installs dependencies, type-checks, runs unit tests, builds TypeScript, executes the real job watcher, updates the sheet, and sends the summary email.

## Project Structure

```text
config/                            Companies and qualification policy
scripts/test-workflow.ts           Focused live end-to-end harness
scripts/test-company-apis.ts       Public ATS listing API audit
src/adapters/                      ATS integrations and shared contract
src/ai/job-validator.ts            OpenAI primary and Gemini fallback
src/config/                        YAML loading and Zod validation
src/email/run-summary.ts           Gmail run summary
src/filters/job-summary-filter.ts  Cheap deterministic filtering
src/sheets/google-sheets.ts        Main-sheet output and processed-job ledger
src/index.ts                       Production orchestration
src/types.ts                       Normalized job domain types
tests/                             Unit tests
```

## Security

- `.env`, `node_modules`, and `dist` are ignored by Git.
- Never commit API keys, Gmail App Passwords, or service-account JSON files.
- Keep deployment credentials in GitHub Actions secrets.
- API job descriptions are sent to OpenAI first and to Gemini only if OpenAI validation fails.
