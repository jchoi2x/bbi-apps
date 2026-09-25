# Overview

## What BBI Marketing does

BBI Marketing is an authorized Domino’s vendor. Its clients are **franchisees** who own one or more brick-and-mortar pizza stores. BBI sells and produces **direct-mail marketing** (and related print, hotel, and school programs) using **point-of-sale data** from those stores.

The commercially important loop is:

```
Store Pulse POS
    → BBI pulls customer + order dumps every week (historically) / every night (SST)
    → Addresses are CASS-certified (AccuZIP)
    → Campaign lists are built (New / Late / Lapsed, saturation, EDDM, database, smart mail)
    → Mail is printed and dropped
    → Later, POS orders at those addresses are measured as ROI
    → Account managers show franchisees the numbers and sell the next drop
```

Without current Pulse data, NLL press files are stale, drop counts are wrong, and ROI spreadsheets cannot be generated. That is why the ETL exists, and why moving it off a single office VM is the cloud-migration priority.

---

## The three layers employees actually use

Employees do not talk to Step Functions. They talk to three surfaces:

| Surface | URL / channel | What it is |
|---|---|---|
| **System dashboard** | `https://system.bbimarketing.com/new/` | PHP AdminLTE CRM: clients, stores, Pulse credentials, NLL settings, mail jobs, hotels, art, shipping. Home page shows weekly poll progress. |
| **SST overlay** | `https://system.bbimarketing.com/sys/` | Same login cookie. Workflow Runs + Stores UI talking to the SST HTTP API. Other sidebar links bounce back to `/new`. |
| **Email** | Gmail API from `donotreply@bbimarketing.com` | Weekly NLL press package, ROI refresh notice, disconnected-store AM report, on-demand XLSX ROI when someone clicks Export. |

A fourth surface is **Slack** (SST only): `/nll_report`, `/newcustomers`, `/latecustomers`, `/lapsedcustomers`. That is the current delivery path for NLL artifacts until email is ported.

---

## The old project (Apollo PHP)

Canonical code: `projects/apollo` (live rsync of `/var/www` on host **apollo**, `192.168.4.26`) and `projects/bbi-cron-php` (git history of the same Pulse scripts).

Every Sunday a PHP script (`polling.php`) asked nwk1 for every Domino’s store that had Pulse credentials, spawned worker processes over the GLS VPN, downloaded `mmc_*.tab` (Mass Mail customer info) and `OR2_*.tab` (completed orders), stuffed them into MySQL, waited on AccuZIP, materialized New/Late/Lapsed tables, emailed the NLL press file, refreshed mail-job ROI in the database, and updated NLL ROI columns.

A 6-minute cron (`pollingProcessing.php`) advanced that chain. Account managers watched a progress bar on `/new`. When it finished they received emails; when they needed a custom ROI they clicked a button and another PHP script emailed an XLSX.

That design worked for years. It is also a single weekly mega-job on PHP 5.6, on one office VM, with file-drop handshakes to a Windows AccuZIP VM. Failures in AccuZIP blocked every report after them. Regenerating NLL meant trusting stale campaign tables or re-running the whole Sunday job.

Full narrative: [Legacy system](legacy-system.md).

---

## The new project (`bbi-sst`)

Canonical code: `projects/bbi-sst`. Stack: **Bun**, **TypeScript**, **SST Ion**, **Lambda**, **Step Functions**, **API Gateway**, **S3**, **RDS Postgres**, VPC + SOCKS for Pulse.

Purpose, in one sentence:

> Pull Pulse (and Pulse 4.0 push zips) into a durable warehouse every night, CASS-validate addresses once, and let New / Late / Lapsed (and later ROI) be **queries** that can run any time — not a Sunday-only side effect of a PHP state machine.

What it does today:

1. **Download** Pulse tabs (or accept push zips at `POST /upload`) → S3 + `file_list`.
2. **Ingest** MMC / OR2 into `MassMail_RAW` / `OR2_Raw` and seed `mailing_addresses`.
3. **Address-validate** unvalidated streets via AccuZIP (SQS `WaitForTaskToken` + EC2 daemon in `bbi-accuzip-api`).
4. **Generate NLL** from SQL procedures (`get_new_customers` / `get_late_customers` / `get_lapsed_customers`), write TSV + Excel, post to Slack.
5. **Saturation** — NFocus CRRT files land in S3 and reload count tables; HTTP serves an XLSX.
6. **Observability** — `/api/runs`, `/api/jobs`, `/sys` Workflow Runs.

What it does **not** do yet (explicit):

- Email the NLL press package (Slack instead).
- Weekly mail-job ROI refresh (`weeklyMailROI.php`) and NLL ROI XLSX (`nllROIReport.php`).
- Drop-builder APIs (`dataSelector`, `databaseExporter`).
- Marketing blacklist, single-address hotel ROI, Athena presort.
- Anything in the hotel / art / shipping / invoice CRM.

Full narrative: [bbi-sst](bbi-sst.md). Mapping to employee work: [Coverage matrix](coverage-matrix.md).

---

## How the two systems share work during dual-run

Until Apollo is retired:

```
nwk1 bbi_system (CRM)
    company / locations / nll_settings / Pulse user+pass
         │
         │  POST type=pollingInfoRequest
         ▼
   Apollo PHP  ──────── still the live Sunday job
         │
         └── nwk1 /new  reads pollingStatus + pollingList

nwk1 bbi_system (same CRM)
         │
         │  same pollingInfoRequest (SST FetchStores)
         ▼
   SST Step Functions  ──── daily 1:00 AM ET
         │
         └── nwk1 /sys  reads /api/runs + /api/jobs
```

Store list and NLL campaign config **always** come from the dashboard database. SST does not replace `client` / `location` / `nllManager` screens. It consumes them.

Push stores (`pulse_version = 4`) skip the GLS VPN. Corporate or franchisee software uploads a zip to `upload.bbimarketing.com`; a Cloudflare Worker forwards it to SST `POST /upload`. nwk1 still inspects `/var/www/upload.bbimarketing.com/dominos-uploaded` when answering Apollo’s polling request so dual-run stays consistent.

---

## Success criteria for the migration

The migration is done for an employee use-case when **all** of the following are true:

1. The data that use-case needs is in SST Postgres (or S3), produced without Apollo PHP.
2. The employee can obtain the same *artifact* they use today (press file, XLSX, progress view, email) from SST, `/sys`, Slack, or a dashboard page re-pointed at SST.
3. Failure modes are visible (per-store `daily_polling.message`, run status, AccuZIP timeout) without SSHing to apollo.
4. Re-running the report does not require re-downloading every store.

Until ROI workflows exist, NLL can already be regenerated from validated `mailing_addresses` without a Sunday job. That is the architectural win; email/ROI parity is the remaining product work.

---

## Related infrastructure

Current vs Phase 1 cloud diagrams: [infrastructure.md](infrastructure.md).  
Hosts, VPNs, nginx, MySQL: [system-topology.md](system-topology.md).
