# Legacy system — Apollo PHP Pulse engine

This document describes **what the old project did** and **how BBI employees used it**. The live implementation is PHP 5.6 on host **apollo** (`192.168.4.26`, public name `vpn.bbimarketing.com`). Git mirrors: `projects/apollo` (rsync) and `projects/bbi-cron-php` (Pulse scripts).

Employees never SSH to apollo for the happy path. They use **`system.bbimarketing.com/new`** and **email**. Apollo is the warehouse and batch engine behind those surfaces.

Live crontab (user crontab, Eastern, captured 2026-09-19; full table in [projects/apollo.md](projects/apollo.md)):

```
0 16 * * 0 /usr/bin/php5 /var/www/services/pulse_fetch/core/polling.php > /dev/null
*/6 * * * * /usr/bin/php5 /var/www/services/pulse_fetch/core/pollingProcessing.php > /dev/null
45 15 * * 1-5 /usr/bin/php5 /var/www/services/dominos/key_index.php > /dev/null
0 11 * * * /usr/bin/php5 /var/www/v2/customProjects/mediaMixModelCron.php > /dev/null
```

---

## 1. Role in the company

Apollo is the **Domino’s data engine**:

1. Pull weekly (intended) POS dumps from every enrolled store over the GLS VPN.
2. Load them into MySQL (`dominos`).
3. CASS-certify addresses via AccuZIP file drop on the office NAS.
4. Build the weekly **NLL press file** and email it to production / AMs.
5. Refresh **ROI numbers** on mail jobs and NLL campaign rows.
6. Answer HTTP from the dashboard: poll progress, drop counts, blacklist, saturation reports, on-demand ROI.

Athena (`192.168.4.24`) plays the same warehouse role for **Vocelli** (and related) when `company.rd_available = 3`. Apollo often **proxies** those calls.

nwk1 holds **CRM and credentials**. Apollo holds **facts from Pulse**.

---

## 2. How a normal week felt to employees

### Sunday / early week — “is polling done?”

1. Sunday **16:00 ET** cron starts `polling.php`.
2. Home (`?p=main`) showed a **progress bar** and a state string (“System is Polling Stores” → insert → AccuZIP → parse → NLL → mail ROI → NLL ROI → Completed).
3. **Polling Status** (`?p=pollingStatus`) listed every store: success, time, fail reason (“Bad credentials…”, “Unable to connect…”). Incomplete IP/credentials were called out from local CRM.
4. Account managers received **Disconnected Polling Stores** email if their stores failed.
5. Ops fixed Pulse user/pass or VPN IPs on `?p=client` / `?p=location` and waited for the next cycle (or a manual re-run).

There is no auto-refresh. Reloading the page re-cURLs Apollo (`timeout` 3s status / 10s list). If Apollo is unreachable the UI synthesizes a fake “completed” error state.

### After AccuZIP — “NLL went out”

When the chain reached `generate_nll.php`, Gmail sent:

- Subject: `{job_number} - New Late Lapsed`
- Attachments: mail TXT (IT), Report XLSX (invoice/counts), Test File TXT
- Body: integrity check (missing art, missing expiration dates) and a note that ROI refresh was in progress

Production used the TXT as the press file. AMs used the XLSX for counts. Creative still lived in NLL Manager (`nll_files/{id}.jpg` on Apollo).

### After ROI refresh — “numbers are in the panel”

`weeklyMailROI.php` updated `external_jobs` / `external_lists` from OR2 + MassMail, then emailed **HTML only** (list of clients refreshed), not the spreadsheet.

`nllROIReporter.php` wrote `net_orders` / `net_sales` on campaign tables and **did not email**.

AMs who needed a spreadsheet clicked **Export ROI Report** on a mail job or opened the **NLL ROI** window on a client — those spawn separate PHP jobs that email XLSX to **the requester**.

### Rest of the week — selling and building mail

- **NLL Manager** — toggle New/Late/Lapsed per store, coupons, preview art, pick ROI weeks.
- **Mail jobs / drops** — Smart / Saturation / Database / EDDM. Drop UIs call Apollo `dataSelector` for ZIP/CRRT counts; database drops call `databaseExporter` for a TSV.
- **Client Data Reports** — saturation XLSX and simplified NLL PDF/XLS **download** from Apollo (VPN/office). NLL ROI **emails**.
- **Blacklist** — add suppressions; Apollo stores them.
- **Hotel list export** — optional warehouse ROI via `singleAddressROI`.

None of that is “the ETL.” It is **CRM + warehouse HTTP**. The ETL’s job is to keep the warehouse current so those screens are not lying.

---

## 3. Kickoff and store list

```
polling.php (Sunday ~16:00 ET, intended)
  TRUNCATE polling_processes, daily_polling
  POST https://system.bbimarketing.com/new/api/
       type=pollingInfoRequest
  INSERT daily_polling (store_number, client_name, vpn_ip, username, password)
  GROUP BY password; split id ranges ≥ 50; spawn pollingThread.php
  INSERT polling_watchdog (start_time)
```

nwk1 returns companies with `rd_available = 1` and locations with a VPN IP. Credentials are location-level override or company `poll_username` / `poll_password`. If a matching zip exists under `upload.bbimarketing.com/dominos-uploaded`, nwk1 marks `pulse_version = 4` (push store). Apollo’s insert historically **did not persist** `pulse_version`.

Chunking is **by franchisee password**, not a fixed “50 stores” batch.

---

## 4. Download (`pollingThread.php`)

For each pending `daily_polling` row in the id range:

1. NTLM GET `http://{vpn_ip}:59101/PulseWeb/EOutbox/` (then `EArchive` if many OR2s missing).
2. Keep `OR2_*.tab` → `OrderData/`, `mmc_*.tab` → `MailData/`.
3. Skip filenames already in `file_list`.
4. Heartbeat `polling_processes.last_activity`.
5. HTTP 401 → `success = 2`, fail reason credentials; curl failure → store offline / GLS.
6. Success → `success = 1`, `success_time = UNIX_TIMESTAMP`.

Stale threads (`last_activity` older than 30 minutes while `polling == 0`) are killed and respawned by the 6-minute processor.

---

## 5. State machine (`pollingProcessing.php`, every 6 minutes)

Timezone: `America/New_York`. Mutex: `polling_watchdog.process_lock`.

```
end_time set OR process_lock = 1     → exit
polling == 0
  no thread PIDs → lock, polling=1, insertFiles, unlock
  PIDs exist     → revive stale threads
polling == 1 AND all insert_* == 1 AND all extract_* == 0
  → extractFiles.inc          (three AccuZIP CSVs)
all extract_* == 1
  → parse ladder:
     1 newcustomer_valid.txt
     2 latecustomer_valid.txt
     3 massmail_valid.txt
     4 scan_lapsed
     5 generate_nll.php
     6 frequent_generated stub (no generate_frequent.php)
     7 weeklyMailROI.php
     8 nllROIReporter.php      → end_time (terminal)
```

Dashboard percents (`/v2/?pollingStatus`) map flags to 5–100. Labels are slightly out of sync with real work (e.g. insert can still show “Validating Addresses”).

AccuZIP wait is **`file_exists` on the 6-minute tick**, not a sleep inside AccuZIP.

---

## 6. AccuZIP handshake (legacy)

`extractFiles.inc` writes to `mail_data/postal_validate/` (symlink → AccuZIP NAS):

| Export | Validated output |
|---|---|
| `NewCustomer_Export.csv` | `newcustomer_valid.txt` |
| `LateCustomer_Export.csv` | `latecustomer_valid.txt` |
| `MassMail_Export.csv` | `massmail_valid.txt` |

CSV header: `Address,City,State,Zip,Store,Last Order,Customer Code`.

**Classification happened before validation.** You already had to know who was New/Late/MassMail to build the three files, then you stored those buckets again after CASS. A delay on any one file blocked NLL and both ROI stages.

`parseFiles.inc` materialized `NewCustomers` / `LateCustomers` and mass-mail parse; lapsed rows were inserted in `generate_nll.php`.

---

## 7. NLL generation (`generate_nll.php`)

1. POST nwk1 `type=nllProvider` `request=1` for NLL-enabled stores + settings (coupons, flags, limits).
2. Numeric stores: local campaign tables. Non-numeric: Athena `?nllRequest`.
3. Apply hard limits, blacklist, seed/test rows, coupon slots.
4. Write occupancy rows (`first = Postal Customer`).
5. Email TXT + XLSX + test file to a fixed production/AM list.
6. Integrity: missing art files, missing EXP dates.

This is the **press package**. It is not ROI.

---

## 8. Warehouse HTTP the dashboard used all week

Implemented mainly in `v2/index.php` and `v2/cli/process.php`. Auth is shared secrets in PHP (not documented here).

| Employee action | Apollo endpoint |
|---|---|
| Watch poll | `GET /v2/?pollingStatus`, `GET /v2/?pollingList` |
| NLL ROI week picker | `POST /v2/?newNLLAvailableDates` |
| Drop ZIP/CRRT counts | `POST /v2/?dataSelector` |
| Database-mail TSV | `POST /v2/?databaseExporter` |
| Blacklist fetch/add | `POST /v2/?blacklist` |
| Hotel/address ROI | `POST /v2/?singleAddressROI` |
| Spawn ROI email jobs | `POST /v2/cli/process.php` (`sysMailROIReport`, `nllROIReportV2`, …) |
| Saturation XLSX | `POST /v2/reports/saturationReports.php` |
| Simplified NLL | `POST /v2/reports/simplifiedReport.php` |
| NLL art | `GET /v2/nll_files/{id}.jpg` |

Athena: `presortDetails` (drop logistics), Vocelli NLL/ROI/saturation proxies.

LAN tools: `https://192.168.4.26/v2/mailProcessing/` (Facebook export, lunch/carryout segments, list ROI).

---

## 9. What employees could not do

- Run NLL for an arbitrary historical week without fighting campaign-table snapshots.
- Ingest daily and report later — the job was weekly and reports were chained at the end.
- See Step Functions / CloudWatch — there was only the watchdog percent.
- Distinguish “Pulse download failed” vs “AccuZIP stuck” without reading flags or SSH.
- Use the dashboard from the public internet for **downloads** that POST to `192.168.4.26` (those need VPN or office LAN).

---

## 10. Why this is being replaced

| Pain | Effect on employees |
|---|---|
| One weekly mega-job | A Monday AccuZIP hang means no NLL email and no ROI refresh |
| Campaign tables as source of truth | Regenerating a list ≠ re-querying Pulse |
| PHP 5.6 + one VM | Capacity, patching, and bus-factor |
| File-drop AccuZIP + 6-minute poll | Opaque waits |
| Mixed `vpn.bbimarketing.com` vs `192.168.4.26` | Reports that only work on VPN |
| No idempotent daily ingest | Missed Sunday = missed week |

SST’s redesign (daily ingest, one AccuZIP pass, SQL cohorts, on-demand NLL) is documented in [bbi-sst](bbi-sst.md) and [data-pipeline.md](data-pipeline.md).

---

## 11. Code map (legacy)

| Path (apollo / bbi-cron-php) | Role |
|---|---|
| `services/pulse_fetch/core/polling.php` | Sunday 16:00 ET kickoff |
| `pollingThread.php`, `functions.inc` | Per-range NTLM download |
| `pollingProcessing.php` | 6-minute state machine |
| `services/dominos/key_index.php` | Mon–Fri 15:45 hotel-key PDF index |
| `v2/customProjects/mediaMixModelCron.php` | Daily 11:00 media-mix CSV → Domino’s SFTP |
| `insertFiles.inc` / `extractFiles.inc` / `parseFiles.inc` | Load, AccuZIP out, AccuZIP in |
| `services/dominos/generate_nll.php` | NLL press + email |
| `v2/customProjects/weeklyMailROI.php` | Mail-job ROI DB + HTML email |
| `v2/customProjects/nllROIReporter.php` | NLL ROI columns, no email |
| `v2/customProjects/nllROIReport.php` | On-demand NLL ROI XLSX email |
| `v2/customProjects/mailROIReports.php` | On-demand job ROI XLSX email |
| `v2/index.php` | Dashboard JSON APIs |
| `v2/cli/process.php` | formType dispatcher |
| `v2/reports/saturationReports.php` | Saturation XLSX download |

Related: [Email reports](email-reports.md), [Employee use-cases](employee-use-cases.md), [projects/apollo.md](projects/apollo.md).
