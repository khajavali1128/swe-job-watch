# SWE Job Watch

SWE Job Watch is a scheduled Node.js and TypeScript service that scans public ATS job boards, filters recently opened U.S. software-engineering roles, validates full job descriptions with AI, and appends qualified jobs to Google Sheets.

The production service currently checks 142 enabled companies across Ashby, Avature, Greenhouse, Lever, SmartRecruiters, Oracle Recruiting, and Workday.

## Workflow

```text
companies.yaml + filters.yaml
            |
            v
Ashby / Avature / Greenhouse / Lever / SmartRecruiters / Oracle / Workday sources
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
| Avature | Tenant listing `Posted` date | Public job-detail page | Enabled for Synopsys |
| Greenhouse | `first_published` | Individual job endpoint | Enabled |
| SmartRecruiters | `releasedDate` | Individual posting endpoint | Enabled |
| Oracle Recruiting | Listing `PostedDate`, confirmed by `ExternalPostedStartDate` | Individual requisition endpoint | Enabled |
| Workday | Relative `postedOn` label | Individual posting endpoint | Enabled |
| Lever | `createdAt` posting-record timestamp | Individual posting endpoint | Enabled |

Every adapter produces the shared `JobSummary` and `JobDetails` types. Ashby descriptions are cached from the board response to avoid per-job requests. Avature reads public server-rendered career pages, sorts dated listings newest-first, and stops pagination after crossing the freshness cutoff. Lever paginates the public postings API and uses its millisecond `createdAt` value as the freshness timestamp; listings with missing or implausible timestamps are skipped. SmartRecruiters pagination is handled automatically, and its applicant-facing URL is obtained from the detail response before a job reaches the sheet. Oracle requests only a buffered recent listing window, uses listing dates for cheap filtering, and confirms exact timestamps when fetching a surviving job's details. Workday exposes relative posting labels rather than exact timestamps, so the adapter interprets them conservatively to avoid missing recent jobs.

## Qualification Rules

All editable qualification rules live in [`config/filters.yaml`](config/filters.yaml). The current policy:

- Considers jobs posted within the last 3 days.
- Accepts U.S. locations, U.S.-remote roles, and multi-location roles containing a U.S. location.
- Requires a configured software-development title match.
- Normalizes punctuation and whitespace, so titles such as `Full-Stack Engineer` match configured phrases such as `full stack engineer`.
- Allows generic developer titles such as `Platform Developer` through the cheap stage for final AI validation.
- Rejects excluded titles, seniority levels, and employment types during cheap filtering.
- Uses AI to confirm role relevance, location eligibility, seniority, excluded technical domains, employment type, sponsorship eligibility, citizenship restrictions, and mandatory experience.
- Accepts at most four years of mandatory professional experience.
- Ignores preferred experience when configured to do so.
- Accepts jobs without an explicit numeric experience minimum when configured to do so.
- Rejects jobs whose descriptions explicitly state that visa sponsorship or immigration support is unavailable.
- Rejects jobs that require U.S. citizenship or mandatory U.S. government security-clearance eligibility.

Missing publication dates generally follow `freshness.allowFirstSeenFallback`. Lever is stricter: it skips a listing when `createdAt` is missing or invalid so an undated posting cannot bypass the rolling freshness window.

Companies and ATS handles live in [`config/companies.yaml`](config/companies.yaml). Set `enabled: false` to stop checking a company without removing it.

## Google Sheet

Only AI-qualified jobs are considered for insertion. Before appending, the service reads the existing Job URL column and skips URLs already present in the sheet.

Rows use this layout:

```text
Company | Job URL | Title | Posted Date
```

`Posted Date` is the normalized ATS publication, release, or posting-record date in `YYYY-MM-DD` format. The service retains the complete timestamp internally for rolling-window filtering.

Each run appends new qualified jobs directly after the existing rows. It does not add date-heading rows.

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

Optional run-scoping variables:

| Variable | Purpose |
| --- | --- |
| `JOB_ADAPTERS` | Comma-separated adapters to run; omitted means all enabled adapters |
| `JOB_WATCH_RUN_NAME` | Label included in logs and summary-email subjects |

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

Four staggered workflows run every three hours. GitHub schedules use UTC and may start a few minutes late.

| Workflow | Adapters | Schedule |
| --- | --- | --- |
| [`job-watch.yml`](.github/workflows/job-watch.yml) | Greenhouse, Lever, SmartRecruiters, Ashby | `:00` every third hour |
| [`job-watch-oracle.yml`](.github/workflows/job-watch-oracle.yml) | Oracle | `:15` every third hour |
| [`job-watch-workday.yml`](.github/workflows/job-watch-workday.yml) | Workday | `:30` every third hour |
| [`job-watch-avature.yml`](.github/workflows/job-watch-avature.yml) | Avature | `:45` every third hour |

All four workflows share a concurrency group so only one can access the Google Sheet at a time. Each workflow can also be run manually from its own Actions page, or with:

```bash
gh workflow run job-watch.yml
gh workflow run job-watch-oracle.yml
gh workflow run job-watch-workday.yml
gh workflow run job-watch-avature.yml
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
