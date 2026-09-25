# bbi-sst — purpose and architecture

**Repo:** `projects/bbi-sst` ([BBIMarketing/bbi-sst](https://github.com/BBIMarketing/bbi-sst))  
**Runtime:** AWS us-east-2 — SST Ion, Lambda, Step Functions, API Gateway, S3, RDS Postgres (Knex), VPC.  
**Language:** TypeScript on **Bun**.  
**Related:** `projects/bbi-accuzip-api` (EC2 AccuZIP daemon), `projects/bbi-tf` (Cloudflare upload proxy), nwk1 `/sys` (ops UI).

Operator runbook in-repo: `projects/bbi-sst/README.md`. Design narrative: `projects/bbi-sst/docs/how-it-works.md`. This file is the **workspace** document: why the project exists, what it implements, and how it serves employees.

---

## 1. Purpose

`bbi-sst` is the **cloud replacement for Apollo’s Pulse ETL and mailing-intelligence engine**.

It exists to:

1. **Collect** Domino’s Pulse customer and order dumps (VPN poll **or** Pulse 4.0 push zip) into S3 and Postgres **every night**, not only on Sunday.
2. **Certify** addresses once (AccuZIP CASS) into `mailing_addresses`, independent of campaign type.
3. **Classify** New / Late / Lapsed **at query time** so NLL (and later ROI) can run any day, for any window, without rewriting campaign tables.
4. **Expose** the same facts employees already use — run progress, per-store failures, NLL files, saturation XLSX, customer counts — over HTTP, Slack, and `/sys`, so `system.bbimarketing.com` can be re-pointed off Apollo.

It is **not** a replacement for the BBI CRM. Franchisees, Pulse passwords, NLL coupon settings, mail-job logistics, hotels, art, and shipping stay on nwk1 `/new`.

---

## 2. Design principles (do not unlearn)

These are the discoveries that justified the rewrite. Implementation details live in `docs/how-it-works.md` inside the submodule.

1. **Campaign tables were derived.** Durable facts are `MassMail_RAW` / `OR2_Raw` plus validated `mailing_addresses`. New/Late/Lapsed is a `SELECT`.
2. **AccuZIP should see streets, not campaigns.** One export of `is_valid = 0 AND is_invalid = false`. Campaign rules run later, joining only valid rows.
3. **Fan-out matches the unit of work.** Download = store → files. Ingest = pending `file_list` rows. Validate = stores that still need CASS. NLL = NLL providers.
4. **`MassMail_RAW` timestamps are ET wall-clock epochs**, not UTC. Procedures use `AT TIME ZONE 'America/New_York'`. Getting this wrong silently drops a day’s customers.
5. **New-customer grace (default 180 days)** is part of parity with `parseNewCustomers`.
6. **NLL mails the address**, not the person (`first = Postal Customer`).
7. **ROI is downstream.** Status slots exist (`generating_roi`); no workflow yet. NLL success currently stamps the run `completed` so it leaves the open-run filter.
8. **Provenance:** `MassMail_RAW.filename` is part of the unique key so reingest and “why is this row here?” are tractable.

---

## 3. Daily pipeline

Cron: **`DailyDownloadCron`** — `cron(0 1 * * ? *)` **America/New_York**, `chainNext: true`.

Date window: Sunday of the **last completed report week** through **yesterday** (ET). Example: if today is Monday 13 Jul 2026, start = 05 Jul, end = 12 Jul. `checkS3: true` skips tabs already in the bucket.

```
1:00 AM ET
  DownloadFileWorkflow
    → LegacyIngestWorkflow
      → AddressValidateWorkflow
        → LegacyNllGenerateWorkflow   (optional; same chainNext)
```

Ops can start any stage alone via HTTP (`chainNext: false`) or Slack `/nll_report` after addresses are valid.

```
Pulse shares ──► Download ──► S3 tabs + file_list
Push zip    ──► POST /upload ──► same
                    │
                    ▼
              Legacy ingest ──► MassMail_RAW / OR2_Raw
                            ──► mailing_addresses (unvalidated)
                    │
                    ▼
              Address validate ──► SQS FIFO ──► AccuZIP NAS
                    │                 SendTaskSuccess
                    ▼
              ApplyPostalData (is_valid / is_invalid)
                    │
                    ▼
              NLL generate ──► TSV + Excel ──► Slack + S3
```

MMC skip: empty `Street`. OR2 skip: keep `Order_Status_Code === 4` only.

---

## 4. Workflows

### 4.1 DownloadFileWorkflow

`src/workflow/download-file/download.workflow.ts`

```
FetchStores → ValidateManifest → FanoutStores
  → ListStoreFileDirectory → HasFilesToDownload?
       (0) SkipStoreDownloads
       else FanoutFiles → Download
  → MarkStorePollingComplete
→ MarkWatchdogComplete → ChainNext → Done
```

- **FetchStores** — POST nwk1 `type=pollingInfoRequest` → `daily_polling` + S3 `stores.jsonl`. Push stores (`pulse_version = 4`) are excluded from VPN download.
- **Download** — NTLM (SOCKS in VPC) stream tab → S3 `MailData/` or `OrderData/`; `file_list.status = 1`.
- Shared run id: `polling_watchdog` + per-store `daily_polling`.

### 4.2 LegacyIngestWorkflow

```
ListPendingFiles → HasFiles?
     (0) SkipFanout
     else FanoutFiles → IngestFile
→ MarkWatchdogPolling → ChainNext → Done
```

Pending = `legacy_ingested = false` and `status = 1`, scoped to the run’s stores. Optional report window filters by Pulse date in the filename. Ingest insert-ignores raw tables; MMC also insert-ignores `mailing_addresses` (never overwrites an existing postal identity).

### 4.3 AddressValidateWorkflow

```
ListStoresNeedingValidation → FanoutStores
  → ExportUnvalidatedAddresses
→ MergeAccuzipExport → NotifyAccuzip (presign GET)
→ WaitForAddressValidation (SQS FIFO + WaitForTaskToken, timeout 7 days)
→ ApplyPostalData → ChainNext → Done
```

Daemon (`bbi-accuzip-api`): long-poll `{ downloadUrl, taskToken }`, write `API_MassMail_Export.csv` on NAS, wait for `api_massmail_valid.txt`, upload S3, `SendTaskSuccess({ validatedCsvUrl })`. One `processing` job at a time; 3h default failure.

Apply: match UK `(pulse_profile_id, store_number, old_*)`; set standardized fields and `is_valid = 1`. Blank CRRT or AccuZIP errno `4.1` / `12.2` / `12.3` → `is_invalid` only if still unvalidated. Never downgrade a valid row.

### 4.4 LegacyNllGenerateWorkflow

```
FetchNllProviders → FanoutStores → GenerateNll
→ MergeNll → ExcelReport → NotifySlack → Done
```

- Numeric stores: SQL procedures over RAW ⨝ validated addresses.
- External (non-numeric): BBI API / `external_jobs` + `external_lists`.
- TSV column order is a **vendor contract** (`NLL_TSV_COLUMNS`): `first, address, city, state, zip5, store_number, last_order, type, client_name, … coupon slots`.
- `type`: 1 New, 2 Late, 3 Lapsed. Do not renumber.
- Side effects at generate time (limits, blacklist if wired, coupons, mailed flags) — not at ingest.

Delivery today: **Slack file attachments** + presigned S3 via `GET /api/runs/{id}/reports`. Not Gmail.

### 4.5 NfocusIngestWorkflow

Triggered by S3 `nfocus/*.txt` (`ObjectCreated`). Truncate+reload `saturation_counts` / `saturation_counts_adv` (PHP `Saturation_Cron.php` column offsets). **Not** on the Pulse→NLL chain. Feeds saturation XLSX.

---

## 5. S3 layout

Bucket: SST `S3Storage` (prod often `bbi-marketing-data-pipeline-storage`).

| Prefix | Contents |
|---|---|
| `dominos-uploaded/` | Raw push POSTs including NGP zips |
| `MailData/mmc_*.tab` | MMC |
| `OrderData/OR2_*.tab` | OR2 |
| `accuzip/postal_validate/API_MassMail_Export.csv` | AccuZIP input (overwrite) |
| `accuzip/postal_data/api_massmail_valid_<unix>.txt` | Validated archive |
| `nfocus/*.txt` | NFocus CRRT dumps |
| `executions/{watchdogId}/…` | JSONL Map manifests + NLL artifacts |

---

## 6. HTTP API (employee-facing and ops)

API is VPC-linked. Ops routes (except ping/healthz, `/upload`, Slack) require `x-api-key` or `Authorization: Bearer` (`OpsApiKey`).

### Health / ingest ingress

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/ping` | Liveness |
| GET | `/api/healthz` | Health |
| GET | `/api/s3-check` | Bucket sanity |
| POST | `/upload` | Pulse 4.0 zip; Basic Auth (`dominosUploadPassword`). Cloudflare Worker on `upload.bbimarketing.com` must **forward body + auth, no 308**. |

### Workflow control

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/workflows/download-file/start` | Start download (optional `chainNext`) |
| POST | `/api/workflows/legacy-ingest/start` | Start ingest |
| POST | `/api/workflows/address-validate/start` | Start AccuZIP |
| POST | `/api/workflows/legacy-nll-generate/start` | Start NLL |
| POST | `/api/workflows/address-validate/callback` | Ops `SendTaskSuccess` (not the production AccuZIP path) |

Start bodies accept `startDate`/`endDate` or `reportDate`, plus `watchdogId`, `pendingOnly`, `storeNumbers`, `forceDownload`, etc. Response **202** `{ executionArn, watchdogId? }`.

### Runs (maps to Polling Status)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/runs` | List watchdog runs (`open` filter) |
| GET | `/api/runs/{watchdogId}` | Run detail |
| GET | `/api/runs/{watchdogId}/stores` | Per-store `daily_polling` |
| GET | `/api/runs/{watchdogId}/events` | Event log |
| GET | `/api/runs/{watchdogId}/events/replay` | Replay (no DB write) |
| POST | `/api/runs/{watchdogId}/resume` | Resume download |
| GET | `/api/runs/{watchdogId}/reports` | Presigned NLL artifacts |
| POST | `/api/runs/{watchdogId}/counts/regenerate` | Rebuild count reports |

### Jobs dashboard (camelCase DTOs; `/sys` Workflow Runs)

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/api/jobs` | List / create+start |
| GET | `/api/jobs/summary` | Totals |
| GET | `/api/jobs/{jobId}` | Detail |
| GET | `/api/jobs/{jobId}/stores` | Stores |
| GET | `/api/jobs/{jobId}/stores/{storeId}/files` | Files |
| POST | `/api/jobs/{jobId}/start` | Restart |
| POST | `/api/jobs/{jobId}/stop` | Stop SFN |

### Store intelligence (maps to NLL / saturation / list preview)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/stores/{n}/customers/{type}` | `new` / `late` / `lapsed` rows |
| GET | `/api/stores/{n}/customers/{type}/count` | Counts |
| GET | `/api/stores/{n}/files` | `file_list` |
| GET | `/api/stores/{n}/saturation-report` | XLSX (ZIP+CRRT buckets, optional market penetration) |
| GET | `/api/nll/providers` | NLL config from BBI API |
| POST | `/api/files/reingest` | Re-run ingest for files |

### Slack

| Route | Command |
|---|---|
| POST `/slack/events` | Aggregator |
| POST `/slack/nll-report` | `/nll_report` → NLL workflow |
| POST `/slack/newcustomers` | `/newcustomers` |
| POST `/slack/latecustomers` | `/latecustomers` |
| POST `/slack/lapsedcustomers` | `/lapsedcustomers` |

**No SES / Gmail in this app.** Optional NLL coupon-stock alerts still go through nwk1 `nllProvider` request `5` unless `NLL_EMAIL_DISABLED=1`.

---

## 7. Status model

`polling_watchdog.status`:

`pending` → `downloading` → `downloaded` → `ingesting` → `ingested` → `address_validating` → `address_validated` → `generating_nll` → `nll_generated` → `generating_roi` → `completed` | `failed` | `stopped`

`daily_polling` adds `fetching_directory`, `roi_generated`, `skipped`.

Terminal for the open-run filter: `completed`, `failed`, `stopped`.

A store with `success = 2` / `status = failed` is not advanced by later phases. `daily_polling.message` is the operator-facing note.

Legacy boolean columns (`update_mail_roi`, `update_nll_roi`, `frequent_generated`) are created and left **0** until ROI exists.

---

## 8. How employees reach SST today

| Surface | What they see |
|---|---|
| `https://system.bbimarketing.com/sys/?p=main` | Workflow Runs (AG Grid) against `/api/jobs` / `/api/runs` |
| `https://system.bbimarketing.com/sys/?p=stores` | NLL providers / store grid |
| Slack | NLL files, cohort previews |
| HTTP + API key | Saturation XLSX, customer lists, resume/stop |
| `/new/?p=pollingStatus` | **Still Apollo** until that page is re-pointed |

`/sys` shares `sysData` login with `/new`. Unknown `?p=` values 302 to `/new/index.php`.

---

## 9. What is intentionally not in the daily path

- **weeklyMailROI** and **NLL ROI** — indexes and `get_external_list_addresses` exist; no workflow, no email.
- **Modern `customers` / `orders` upsert ingest** — explored and abandoned. Live path is legacy-raw + `mailing_addresses`.
- **Writing `NewCustomers` on AccuZIP apply** — the coupling that was removed.
- **CRM, hotels, shipping, invoices, art** — nwk1 forever.

---

## 10. Repo layout

```
http / cron / workflow
        ↓
      core          domain types, tab parse, mailing_addresses mappers, push-zip MMC
        ↓
      lib           Pulse/NTLM, BBI API, Knex, S3, dates, SFN JSONL
```

| Path | Role |
|---|---|
| `sst.config.ts` | Routes, crons, workflow wiring |
| `src/workflow/*` | Step Functions + Lambdas |
| `src/http/*` | API Gateway handlers |
| `src/cron/download-file/` | 1 AM trigger |
| `migrations/` | Knex (Apollo port + NLL domain) |
| `docs/queries/report_procedures.sql` | Canonical New/Late/Lapsed SQL |

---

## 11. Dual-run contract with nwk1

- SST FetchStores uses the **same** `pollingInfoRequest` as Apollo.
- Push zips must remain visible under nwk1 `dominos-uploaded/` if Apollo still classifies `pulse_version = 4` from disk.
- `/new` polling UI will keep showing Apollo flags until it is switched to `/api/runs` (or employees use `/sys` only).
- Changing ingest unique keys or NLL TSV columns breaks press vendors and any dashboard still reading Apollo tables — coordinate with [Employee use-cases](employee-use-cases.md).
