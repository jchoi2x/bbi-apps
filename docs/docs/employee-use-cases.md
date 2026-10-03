# Employee use-cases — `system.bbimarketing.com`

This catalog is what BBI staff actually do in the product. It is split so `bbi-sst` scope stays honest:

- **A — Pulse / mailing intelligence** — SST’s job (now or planned).
- **B — Operations CRM** — stays on `/new`; SST will not replace it.
- **C — Hybrid mail jobs** — CRM shell + warehouse counts/lists.

URL prefix unless noted: `https://system.bbimarketing.com/new/index.php?p=`  
SST overlay: `https://system.bbimarketing.com/sys/`

Deep UI/architecture notes: [projects/bbi-nwk1-new.md](projects/bbi-nwk1-new.md).  
Coverage vs SST: [coverage-matrix.md](coverage-matrix.md).  
Emails: [email-reports.md](email-reports.md).

---

## Roles (informal)

There is no fine-grained RBAC — only `users.admin` vs not, plus caller ownership on hotel calls. In practice:

| Role | Typical screens | Typical email |
|---|---|---|
| **Account manager** | Client, location, NLL Manager, mail jobs, polling status, ROI exports | Disconnected stores, NLL package (cc), job/NLL ROI XLSX they requested |
| **IT / data** | Polling status, credentials on client/location, `/sys` runs, Slack NLL | NLL press TXT, integrity failures |
| **Production / mail** | NLL email attachments, drop logistics, job flags (IT/production ready) | `{job} - New Late Lapsed` |
| **Hotel caller** | Call panel, hotel process, approvals | Needs-approval, call-list complete (ops mail, not Pulse) |
| **Art** | Art tasks, proofing, NLL creative preview | — |
| **Admin** | Users, hotel-management, settings | — |

---

## A. Pulse and mailing intelligence

### A1. See whether this week’s poll is running

| | |
|---|---|
| **Where** | `?p=main` (home). Compact progress bar + state string + link “View Full Status”. |
| **Who** | Everyone who opens the system in the morning. |
| **Needs** | `{ start_time, end_time, state, status }` from Apollo `GET /v2/?pollingStatus`. |
| **Behavior** | Page-load cURL, SSL verify off, 3s timeout. Empty body → synthetic `contactError` with bar at 100%. No SSE, no auto-refresh. |
| **SST equivalent** | `/sys/?p=main` Workflow Runs (`GET /api/jobs`, `/api/runs`). `/new` home is **not** re-pointed yet. |

### A2. Diagnose which stores failed

| | |
|---|---|
| **Where** | `?p=pollingStatus` |
| **Who** | AMs and IT after a poll, or when a drop UI says a store has no data. |
| **Needs** | `GET /v2/?pollingList` → `{ store_number, client_name, success, success_time, fail_reason }`. Local MySQL table of stores missing IP/credentials. |
| **UI** | DataTable: store, client, IP class (10.x “Old” vs else “New”), success, time, reason. Links into `client` / `location`. |
| **SST equivalent** | `GET /api/runs/{id}/stores` + `daily_polling.message`. Resume: `POST /api/runs/{id}/resume` or job start/stop. |

### A3. Fix Pulse credentials and data-release

| | |
|---|---|
| **Where** | `?p=client&id=`, `?p=location` |
| **Who** | AM / admin when poll fails “Bad credentials” or store is missing from the run. |
| **Needs** | CRM fields: `vpn_ip_address`, `vpn_custom_*`, company `poll_username` / `poll_password`, `rd_available`. |
| **Downstream** | Next Apollo or SST `pollingInfoRequest` seed. **SST still reads this API.** This screen is not replaced. |

### A4. Configure NLL campaign (who gets mailed, coupons, art)

| | |
|---|---|
| **Where** | `?p=nllManager` |
| **Who** | AM + production. |
| **Does** | Select client → load settings; New/Late/Lapsed flags per location; coupon / EXP slots; preview JPEG; save; optional ROI week export. |
| **Warehouse calls** | `ajax` `pt=29` → `POST /v2/?newNLLAvailableDates`; `pt=36` → `process.php` `newNLLROIReport` (queues only; exec commented out). Images `GET …/v2/nll_files/{id}.jpg`. |
| **SST** | Generate uses `nllProvider` (same CRM). `/sys/?p=stores` + `GET /api/nll/providers`. Creative CMS and NLL ROI **not** in SST. Settings stay on `/new`. |

### A5. Preview New / Late / Lapsed counts before mailing

| | |
|---|---|
| **Where (legacy)** | Implicit in NLL Manager / simplified report / waiting for Sunday email. |
| **Where (SST)** | Slack `/newcustomers` `/latecustomers` `/lapsedcustomers`; `GET /api/stores/{n}/customers/{type}` and `/count`. |
| **Why it matters** | Catch a bad AccuZIP apply or a grace-window surprise **before** the press file. Legacy could not do this without campaign tables from the last parse. |

### A6. Produce the weekly NLL press file

| | |
|---|---|
| **Where (legacy)** | Automatic after Sunday AccuZIP. Employees **receive email**; they do not click Generate. |
| **Artifact** | `{job} - NewLateLapsed (Mail).txt` + Report.xlsx + Test File.txt. |
| **SST** | `LegacyNllGenerateWorkflow` (cron chain, HTTP start, or Slack `/nll_report`). Same TSV contract. Delivery = Slack + S3, not Gmail (yet). Integrity (missing art / EXP) still conceptually required for production. |

### A7. Saturation mail report (ZIP + CRRT)

| | |
|---|---|
| **Where** | `?p=client` → Client Data Reports → store select → **Export Report**. Browser POST to `192.168.4.26/v2/reports/saturationReports.php` (**VPN**). |
| **Needs** | Warehouse `MassMail` + NFocus saturation count tables. Optional 365-day market penetration. |
| **SST** | `GET /api/stores/{n}/saturation-report` → XLSX. NFocus ingest from S3 `nfocus/*.txt`. Dashboard form not re-pointed yet. |

### A8. Simplified NLL (PDF / Excel download)

| | |
|---|---|
| **Where** | Client → NLL Simplified → week offset → PDF or Excel. POST `simplifiedReport.php` on Apollo. |
| **SST** | **Not ported.** Closest: NLL Excel counts from generate + HTTP customer lists. |

### A9. NLL ROI spreadsheet (on demand)

| | |
|---|---|
| **Where** | Client → **Open NLL ROI Report Window** → `queries/dominos_direct_mail.php` (Pulse) or `vocelli_direct_mail.php` (`rd_available=3`). Multi-select weeks → submit. |
| **Result** | Redirect success/error; XLSX **emailed to logged-in user**. |
| **SST** | **Planned.** Status enum `generating_roi` reserved. No workflow. |

### A10. Mail-job drop ROI spreadsheet

| | |
|---|---|
| **Where** | `?p=mailJob&id=` → check past in-home drops → **Export ROI Report**. AJAX `pt=33` → `sysMailROIReport`. |
| **Result** | “Email dispatched shortly” to requester (fallback `info@`). XLSX: pieces, new/rejuvenated, net orders/sales, address-level rows. EDDM and Vocelli have sibling scripts. |
| **SST** | **Planned** (`weeklyMailROI` / job ROI). Groundwork: `external_jobs` / `external_lists` indexes. |

### A11. Marketing blacklist

| | |
|---|---|
| **Where** | `?p=marketingBlacklist` (also on hotel importer). |
| **Does** | Add address + related stores; review processed table. |
| **API** | Apollo `POST /v2/?blacklist`. |
| **SST** | **Gap.** NLL generate must keep honoring suppressions once ported. |

### A12. Hotel / school list with warehouse ROI columns

| | |
|---|---|
| **Where** | Client **Export Client Data** (`pt=35` email) or location `listExport.php` (download). |
| **API** | `POST /v2/?singleAddressROI` → `{ net_orders, net_sales, average }`. |
| **SST** | **Gap** (address-level OR2 match). Hotel CRM itself is out of scope. |

### A13. Social / NLL creative JPEGs

| | |
|---|---|
| **Where** | `?p=socialMediaManagement`, NLL Manager preview. |
| **API** | `GET /v2/nll_files/{id}.jpg`. |
| **SST** | **Out of pipeline scope** (static files / CMS). |

### A14. Watch SST runs instead of Apollo bar

| | |
|---|---|
| **Where** | `/sys/?p=main` Workflow Runs; `/sys/?p=stores`. |
| **Who** | Ops dual-running SST. |
| **Does** | Browse jobs, per-store files, start/stop/resume, open report links. |

---

## B. Operations CRM (SST does not replace)

These pages are real employee work. They read `bbi_system` (and sometimes RocketShipIt on apollo **as a shipping host**, not as Pulse). Migrating them is a different project.

| `?p=` | Work |
|---|---|
| `hotel_calling`, `hotel_calls`, `hotel_process` | Call lists, take hotel orders |
| `hotelApproval`, `hotelQueue` | Approval + kobuilder queue |
| `hotel`, `hotelImporter`, `hotel-management`, `specific_calls` | Hotel CRM / import / assign lists |
| `proofing` (`t=keyProofing` etc.) | Proof queues |
| `create-shipment`, `track-shipments`, `pmodQuotingTool` | UPS labels, tracking, quotes |
| `artTasks`, `artTask`, `newArtTask` | Art lifecycle |
| `jobManager`, `newJob` | Print jobs (not direct-mail jobs) |
| `deprecatedTasks` | Legacy tasks |
| `clientList`, `new-client` | Franchisee CRM (minus Pulse-report widgets) |
| `city` | City records |
| `reorderSchedule` | Reorder calendar |
| `invoice`, `bulkAdd` | Billing |
| `employeeList`, `settings`, `admin`, `system-users`, `user` | Admin |
| `fileHosting` | Backblaze B2 |
| `help` | Help / Domino’s Online |

External: Trello, payroll clock, `/vacation/` on the site root.

---

## C. Hybrid — mail jobs (CRM + warehouse)

Mail **metadata** lives in nwk1. **Counts and list files** come from the warehouse.

### C1. Create and manage direct-mail jobs

`?p=mailJobs`, `newMailJob`, `mailJob&id=`

Employee sets job name (client-visible on ROI panel), mailing type 1–5, adds drops, marks IT / invoice / production / logistics ready.

ROI checkboxes on completed in-home drops → **A10**.

### C2. Build a drop

`newMailDrop` / `existingMailDrop` + `mailConfig/*`.

| Type | Warehouse dependency | Employee UI |
|---|---|---|
| **Smart (1)** | `dataSelector` (zip/route search) | Dates, categories, route checkboxes, manual pieces |
| **Saturation (2)** | `dataSelector` on page load | ZIP/CRRT + res/biz counts, market penetration, select routes |
| **Database (3)** | counts + save-time `databaseExporter` | Recency buckets 0–30 … 180–365; TSV stored `upload/{hash}.txt` |
| **EDDM (5)** | `dataSelector` + USPS GIS (ajax) | Res/biz route picks |
| **NFocus (4)** | stub | — |

Errors often link to **Polling Status** if the store has no data.

**SST today:** cohort **counts** via `/customers/{type}/count` — **not** a drop-builder `dataSelector` / `databaseExporter`. Until those exist, drop UI stays on Apollo.

### C3. View drop / logistics

`viewDrop`, `viewDropNew`, `viewDropLogistics`

Logistics: Athena `POST /v2/?presortDetails` (DDU weight/postage). ShipStation tracking from CRM. **SST: none.**

### C4. Download database file

`mailJob` → `config/fileServer.php?databaseFD` — file produced in **C2**.

---

## D. LAN-only warehouse tools (not `/new` nav)

`https://192.168.4.26/v2/mailProcessing/` (office / VPN):

- Existing list ROI
- Facebook marketing export (`data@`)
- Push-week online conversion / lunch-carryout segments (`data@`)

These are employee (data team) use-cases on Apollo. SST has no equivalent yet.

---

## E. What “satisfy through the dashboard” means for SST

For an **A** use-case, satisfaction is one of:

1. **Same page, new backend** — `/new` cURL target becomes SST (polling, saturation form, ROI form).
2. **Successor page** — `/sys` Workflow Runs instead of Apollo progress bar.
3. **Successor channel** — Slack NLL instead of Gmail, until email is wired.

For **B**, satisfaction is **unchanged CRM** plus a warehouse that still answers **A3** (credentials) and **C** (when drop APIs exist).

For **C**, SST is not done until drop counts and database export can be served with Apollo-compatible JSON/TSV **or** `/new` drop UIs are rewritten against the new APIs.
