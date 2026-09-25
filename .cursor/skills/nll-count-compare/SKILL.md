---
name: nll-count-compare
description: Compare PHP or SST NLL count Excel/CSV/TSV files against bbi-sst GET /api/stores/{storeNumber}/customers/{type}/count (local sst dev or AWS). Use when the user provides NewLateLapsed_Report.xlsx, NLL_Counts_Report.xlsx/.tsv/.csv, or asks to compare NLL counts, check endpoints, PHP vs SST counts, or New/Late/Lapsed parity.
---

# Compare NLL counts

Diff a PHP (or SST) NLL counts workbook against the live **count** endpoints on a bbi-sst API (local `sst dev` or a deployed AWS stage).

The source of truth for this check is **not** the mail-file / generate-NLL Excel. It is:

```
GET /api/stores/{storeNumber}/customers/{type}/count
```

`type` is `new` | `late` | `lapsed`. Same SQL procedures as NLL generate (`get_*_customers`), without per-type limits, hard limits, or seed rows.

## Workflow

Copy this checklist:

```
Task Progress:
- [ ] Resolve the counts file
- [ ] Resolve API base URL (local vs AWS)
- [ ] Resolve ops API key (do not print it)
- [ ] Resolve report window (YYYY-MM-DD)
- [ ] Run scripts/compare-nll-counts.ts
- [ ] Report mismatches + likely causes
```

### 1. Counts file

Accept a path the user attached or named. Typical names:

| File | Origin |
| --- | --- |
| `NewLateLapsed_Report.xlsx` (or a CSV export of it) | PHP `generate_nll.php` |
| `NLL_Counts_Report.xlsx` / `.tsv` | SST merge + excel-report |

Parser rules (the script implements these):

- Find the header row that contains `Store #` and `New Count` (SST workbooks have a title row above it).
- Compare **per-store rows only**. Skip franchisee subtotals (blank `Store #`, name ending in ` Counts`), `Grand Total`, and empty stores.
- Keep store numbers as strings. Skip non-numeric stores by default (Athena / external lists; the count endpoint only runs local procedures).

### 2. API target

Need a base URL with no trailing slash, e.g. `https://xxxx.execute-api.us-east-2.amazonaws.com`.

**Local (`sst dev`)** — URL is in the sst dev console / terminal. Env fallbacks: `BBI_SST_API_URL`, `E2E_API_URL`. Ping `GET {base}/api/ping` (no auth) before comparing.

**AWS** — `cd projects/bbi-sst && bunx sst output --stage <stage>` and use the `url` output. Confirm stage with the user if they said only “prod” / “AWS”.

Auth: `x-api-key` (or `Authorization: Bearer`).

- Local / unset secret: read `BBI_OPS_API_KEY` from `projects/bbi-sst/src/http/lib/ops-api-key.ts` (do not echo the value).
- Deployed stage: `OPS_API_KEY` / `E2E_OPS_KEY` env, or the linked SST secret `OpsApiKey`. Never write keys into chat.

### 3. Report window

Count handlers require `windowStart`/`windowEnd` or `startDate`/`endDate`. Date-only values expand to `YYYY-MM-DD 00:00:00` / `23:59:59`. Procedures treat those strings as **America/New_York** wall clock.

Precedence:

1. User-supplied dates
2. SST title `NLL Counts Report — {start} to {end}` (US or ISO dates)
3. Last completed Eastern Sunday–Saturday week (PHP `generate_nll.php` default)

Always print the window used. If the PHP file has no dates and the user did not specify a week, say you defaulted and ask if that week is wrong before treating mismatches as bugs.

### 4. Run the script

From `projects/bbi-sst` so `exceljs` resolves:

```bash
bun ../../.cursor/skills/nll-count-compare/scripts/compare-nll-counts.ts \
  --file "/path/to/NewLateLapsed_Report.xlsx" \
  --base-url "$BBI_SST_API_URL" \
  --start 2026-09-06 \
  --end 2026-09-12
```

`--help` lists `--stores`, `--types`, `--concurrency`, `--include-external`, `--dry-run`, `--json-out`. Use `--dry-run` to confirm the file parsed before hitting the API.

Do not reimplement the HTTP loop in ad-hoc curl unless the script cannot run. One-store debug:

```bash
curl -sS -H "x-api-key: $OPS_API_KEY" \
  "$BBI_SST_API_URL/api/stores/1550/customers/new/count?startDate=2026-09-06&endDate=2026-09-12"
```

Expected JSON: `{ storeNumber, type, windowStart, windowEnd, count }`.

### 5. Report results

Lead with match rate, then a table of **mismatches only**:

```
| Store | Type | File | API | Δ | Note |
```

Then totals (file vs API sums) and skip/error counts.

A store **matches** when all requested types are equal. Do not claim PHP/SST parity from this check alone.

## What the file counts include that the endpoint does not

| Effect | File (PHP report / SST generate Excel) | Count endpoint |
| --- | --- | --- |
| Seed row | PHP **includes** +1 new (and sometimes extra `Seed_Addresses`) | Never |
| Per-type limit | PHP/SST generate cap `newCustomerLimit` / late / lapsed | Uncapped procedure count |
| Hard customer limit | Caps mail rows across types | Ignored |
| Campaign off (`newProcessing=0` etc.) | File count is 0 | Still counts eligible households |
| Blacklist | PHP skips blacklisted streets in the mail file; report COUNT is **before** that skip | Procedures do not apply blacklist |
| External / non-numeric store | Athena `nllRequest` | Local `get_*_customers` only — skip |

Likely notes when annotating Δ:

- File new = API new + 1 → PHP seed
- File < API on one type, processing enabled → customer or hard limit
- File = 0, API > 0 → campaign flag off in the generator
- Only lapsed differs → `mail_events` cadence / first vs remail, not the count HTTP layer

SST `NLL_Counts_Report` is **mail rows emitted** (seed excluded, limits applied). It can also disagree with the count endpoint for the limit reasons above. That is expected.

## Do not

- Hit `/customers/{type}` (full row payloads) for every store
- Compare against `NewCustomers` / `LateCustomers` / `LapsedCustomers` MySQL tables
- Treat franchisee subtotal or Grand Total rows as stores
- Print API keys
- Default a PHP file to “today” — NLL weeks are last completed Sun–Sat Eastern
