# Glossary

Terms used across the dashboard, Apollo PHP, and `bbi-sst`. Prefer these spellings in docs and code comments.

---

## Business campaigns

| Term | Meaning |
|---|---|
| **NLL** | **New / Late / Lapsed**. Occupancy-based direct mail to addresses that are new customers, late (slow) deliveries, or lapsed (haven’t ordered in 28–180 days). The mail piece says `Postal Customer`, not a person’s name. |
| **New** | Address whose **first** Pulse order falls in the report window, excluding people already mailed as New within a **grace** period (default 180 days, overridable per store). |
| **Late** | Address with a **late delivery** (`LastLateOrderDate`) in the window. Optional filter on delivery time vs store threshold. |
| **Lapsed** | Address whose gap between consecutive last-order dates is 28–180 days, and whose current last order is in the window. |
| **Saturation** | Every-door / high-coverage mail by ZIP + **CRRT** (carrier route), using NFocus counts, not NLL cohorts. |
| **EDDM** | USPS Every Door Direct Mail. Routes come from USPS GIS + warehouse counts. |
| **Smart mail** | Targeted list (categories / routes) built in the drop UI, stored on the job, not the weekly NLL press file. |
| **Database mail** | Recency-bucketed export of warehouse addresses (`databaseExporter`) attached to a drop. |
| **NFocus** | Third-party CRRT count files (`NFocus_CRRT_*.txt`) loaded into `saturation_counts` / `saturation_counts_adv`. |
| **ROI** | Return on investment: Pulse **orders and sales** that landed at mailed addresses after in-home date. Not the same as generating the mail file. |
| **In-home date** | Date the piece is expected in the mailbox. ROI windows start here. |
| **Drop** | One mailing event under a **mail job** (dates, counts, cost, production flags). |
| **Mail job** | CRM record (`mailing_jobs`) a client sees on their “ROI control panel.” Types: 1 Smart, 2 Saturation, 3 Database, 4 NFocus (stub), 5 EDDM. |
| **Blacklist** | Suppression list of addresses that must not be mailed. Stored/served on Apollo today. |
| **Piece** | One physical mailer. Counts × piece cost = drop cost. |

---

## Pulse / files

| Term | Meaning |
|---|---|
| **Pulse** | Domino’s in-store POS / back-office suite. BBI pulls files from PulseWeb over **NTLM HTTP :59101** on the GLS network. |
| **PulseWeb** | HTTP interface: `EOutbox` (recent exports) and `EArchive` (older). |
| **GLS** | Domino’s vendor network (`10.x` / `100.x`). Apollo reaches it via OpenConnect `tun0`. |
| **MMC** | Mass Mail Customer dump. Files `mmc_*.tab` (`MassMailCustInfo`). One row per customer profile: street, first/last/late order dates, `CustomerProfileID`. |
| **OR2** | Orders dump. Files `OR2_*.tab` (`OrdersDump`). Completed orders only (`Order_Status_Code == 4`) are ingested. |
| **Tab / `.tab`** | Pulse export: tab-delimited text. |
| **Push zip / Pulse 4.0** | Store (or corporate) **uploads** a zip instead of BBI polling VPN. Filename `[{uniqid}-]{store}_{YYYYMMDD}_{YYYYMMDD}_{HHMMSS}.zip`. SST synthesizes MMC + OR2 tabs. |
| **`_da_`** | Marker on **synthesized output tabs**, not on the incoming zip. |
| **Report week** | Sunday 00:00:00 through Saturday 23:59:59 **America/New_York**. Daily **download** uses last completed week’s Sunday → yesterday ET. Daily **NLL** (`chainNext`) uses that full Sunday–Saturday week, including on Sunday (the week that ended Saturday night). |

---

## Postal / AccuZIP

| Term | Meaning |
|---|---|
| **AccuZIP** | Windows CASS certification software on **accuzip-vm** (`192.168.4.30`). Watches a NAS folder, writes `*_valid.txt`. |
| **CASS** | USPS Coding Accuracy Support System. Produces ZIP+4, **CRRT**, standardized street. |
| **CRRT** | Carrier route. Required for saturation / EDDM and for mailable NLL rows. |
| **`mailing_addresses`** | SST table: Pulse street (`old_*`) plus validated `address` / `city` / `state` / `zip5` / `crrt`, plus `is_valid` / `is_invalid`. |
| **`postal_validate/`** | AccuZIP **input** CSVs. |
| **`postal_data/`** | AccuZIP **output** `*_valid.txt`. |
| **Task token** | Step Functions pause. AccuZIP daemon calls `SendTaskSuccess` with a presigned validated CSV URL. |

---

## Pipeline / ops

| Term | Meaning |
|---|---|
| **Watchdog / `polling_watchdog`** | One **pipeline run**. Legacy: boolean flags (`insert_or2`, `parse_massmail`, …). SST: `status` string + `sfn_execution_arn`. |
| **`daily_polling`** | One **store on one run**: success, fail reason, SST phase status. |
| **`file_list`** | Inventory of downloaded tabs (store, filename, S3 key, ingest flags). |
| **`polling_processes`** | Legacy PID-range heartbeats. **SST does not use this.** |
| **`process_lock`** | Legacy mutex so two 6-minute ticks don’t overlap. Replaced by Step Functions. |
| **Distributed Map** | Step Functions fan-out over S3 JSONL (stores, files, or unvalidated stores). |
| **`chainNext`** | When true: Download → Ingest → Address-validate → NLL, async `StartExecution` hops. |
| **nwk1** | Linode VPS `system.bbimarketing.com` (CRM + `/new` + `/sys` + upload vhost). |
| **Apollo** | Tampa VM `vpn.bbimarketing.com` — PHP Pulse engine. |
| **Athena** | Tampa VM for Vocelli / Marco’s / Flyers warehouse APIs. |
| **Artemis** | Hypervisor / NAS (`bbi-files`, `mail-exchange`). |
| **`rd_available`** | Company data-release flag: `0` pending, `1` Domino’s Pulse, `2` alternate, `3` Vocelli (Athena). |
| **`bbi_system`** | nwk1 MariaDB: users, company, locations, jobs, hotels. |
| **`dominos`** | Apollo MySQL warehouse (ported to SST Postgres). |

---

## Dashboard surfaces

| Term | Meaning |
|---|---|
| **`/new`** | AdminLTE PHP app. Query `?p=` includes `{p}.inc`. |
| **`/sys`** | Overlay: Workflow Runs + Stores against SST API; other pages redirect to `/new`. |
| **`sysData`** | PHP session cookie (`.bbimarketing.com`). Shared by `/new` and `/sys`. |
| **Polling Status** | `/new/?p=pollingStatus` — Apollo `pollingStatus` + `pollingList`. |
| **NLL Manager** | `/new/?p=nllManager` — per-client NLL flags, creatives, ROI week picker. |
| **Client Data Reports** | Section on `?p=client` — saturation XLSX, simplified NLL, NLL ROI popup. |

---

## Cohorts vs campaign tables

Legacy PHP **wrote** `NewCustomers`, `LateCustomers`, `LapsedCustomers` after AccuZIP. SST **selects** the same rules at report time from `MassMail_RAW ⨝ mailing_addresses`. Those three tables may still exist for mailed-history / grace; they are not the ingest destination anymore.
