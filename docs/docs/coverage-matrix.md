# Coverage matrix — employee use-cases vs `bbi-sst`

This is the decision table for “does SST satisfy what people do in **System** and **email**?”

**Legend**

| Code | Meaning |
|---|---|
| **Done** | SST produces the outcome in production (HTTP, Slack, `/sys`, or upload). Dashboard page may still point at Apollo. |
| **Partial** | Core data or a successor channel exists; old UI or Gmail parity missing. |
| **Planned** | Designed (status slots, indexes, docs) — no workflow yet. |
| **Gap** | Pulse-dependent; needed for mailing ops; not started. |
| **Athena** | Vocelli/non-Domino’s warehouse — not this repo. |
| **CRM** | Stays on `/new`. SST must not break the API it already calls (`pollingInfoRequest`, `nllProvider`). |
| **N/A** | Not a Pulse/mailing-intelligence use-case. |

“Satisfy” means the **employee outcome** (file, number, fail list, email), not a pixel-identical AdminLTE page.

---

## A. Dashboard — Pulse / mailing intelligence

| ID | Use-case | Today | SST | Notes |
|---|---|---|---|---|
| A1 | Home progress bar | `/new` cURL Apollo `pollingStatus` | **Partial** | `/sys` Workflow Runs. Re-point `main.inc` or send staff to `/sys`. |
| A2 | Per-store poll success/fail | `pollingStatus` + `pollingList` | **Partial** | `GET /api/runs/{id}/stores`. Same table can be rebuilt on `/new`. |
| A3 | Edit Pulse IP / user / pass / `rd_available` | `client` / `location` | **CRM** | SST FetchStores **depends** on this. |
| A4 | NLL flags, coupons, creative preview | `nllManager` | **CRM** + **Partial** generate | Settings stay nwk1. Generate/Slack is SST. JPEGs still Apollo. |
| A5 | Preview New/Late/Lapsed before print | Weak (wait for Sunday) | **Done** | Slack + `GET /api/stores/…/customers/{type}`. Stronger than legacy. |
| A6 | Weekly NLL press file | Gmail TXT+XLSX+test | **Partial** | TSV contract implemented; Slack/S3 not Gmail; integrity email body not ported. |
| A7 | Saturation XLSX | Client form → Apollo VPN | **Done** (API) | `GET /api/stores/{n}/saturation-report`. Wire the form. NFocus S3 ingest **Done**. |
| A8 | Simplified NLL PDF/Excel | Apollo download | **Gap** | Counts Excel from NLL generate is a cousin, not the simplified report. |
| A9 | On-demand NLL ROI XLSX | `dominos_direct_mail.php` email | **Planned** | |
| A10 | Mail-job ROI XLSX | `mailJob` Export email | **Planned** | |
| A11 | Marketing blacklist | `marketingBlacklist` | **Gap** | Must apply at NLL generate once ported. |
| A12 | Hotel list + address ROI | Client export | **CRM** + **Gap** | List = CRM; ROI columns need `singleAddressROI` equivalent. |
| A13 | NLL / social JPEGs | `nll_files/` | **CRM** | Static files, not ETL. |
| A14 | Start / stop / resume a run | SSH / wait for Sunday | **Done** | `/sys` jobs + `/api/jobs/{id}/start\|stop`, `/api/runs/{id}/resume`. |
| A15 | Push-store zip ingest | nwk1 upload dir + Apollo | **Done** | `POST /upload` + CF Worker. |
| A16 | Daily (not weekly) ingest | Not available | **Done** | 1:00 AM ET cron. Unlocks A5/A6 any day. |

---

## B. Dashboard — CRM (out of SST scope)

All **N/A** / **CRM**. SST success = these pages keep working and still seed polling.

Hotel calling, approvals, queue, importer, proofing, art tasks, print job manager, UPS/ShipStation, invoices, employees, file hosting, reorder calendar, portal invites, data-release PDF mail.

Shipping uses RocketShipIt **on the apollo host** (`:27015`). That is colocated infrastructure, not the Pulse warehouse. Do not delete apollo because SST ingested OR2.

---

## C. Dashboard — hybrid mail jobs

| ID | Use-case | Today | SST | Notes |
|---|---|---|---|---|
| C1 | Create mail job / drops metadata | `/new` MySQL | **CRM** | |
| C2 | Smart/saturation/EDDM **counts** | `dataSelector` | **Gap** | `/customers/…/count` is NLL cohorts, not ZIP/CRRT drop UI. |
| C3 | Database-mail TSV export | `databaseExporter` | **Gap** | |
| C4 | Drop logistics / presort | Athena `presortDetails` | **Athena** | |
| C5 | Download database file | `fileServer.php` | **Gap** (follows C3) | |
| C6 | Job ROI from drop checkboxes | A10 | **Planned** | |

**Mail jobs are not satisfied by NLL generate alone.** AMs still need drop counts to quote and build Smart/Saturation/EDDM.

---

## D. Email

| ID | Report | Today | SST | What “done” looks like |
|---|---|---|---|---|
| E1 | `{job} - New Late Lapsed` + 3 attachments | Auto Sunday | **Partial** | Slack files **or** Gmail with same attachments + integrity body |
| E2 | Weekly ROI refreshed (HTML names) | Auto after NLL | **Planned** | After job-ROI workflow updates `external_jobs` |
| E3 | NLL ROI DB columns | Auto, no mail | **Planned** | |
| E4 | Job ROI XLSX to requester | Click | **Planned** | Same subject/To as `mailROIReports.php` |
| E5 | NLL ROI XLSX to requester | Click | **Planned** | Same as `nllROIReport.php` |
| E6 | Vocelli NLL ROI | Click | **Athena** | |
| E7 | Disconnected stores HTML | nwk1 cron | **Partial** | Point cron at `/api/runs/…/stores` or new SES job |
| E8 | FB / lunch / online segments | LAN tools | **Gap** | Data-team; OR2 exists in SST so port is feasible |
| E9 | Frequency mailing | Dormant | **N/A** | |
| E10 | Reorder schedule, hotel GC, WPA, holds, approvals | nwk1 | **CRM** | |
| E11 | Hotel GC / list ROI columns | nwk1 + `singleAddressROI` | **Gap** on ROI cols | |

---

## E. Slack (new surface)

| Command | Satisfies | vs email |
|---|---|---|
| `/nll_report` | A6 / E1 generate | Replaces wait-for-Sunday; does not yet replace Gmail distribution list |
| `/newcustomers` etc. | A5 | No legacy equivalent |

---

## F. Capability map (engineering)

| Legacy capability | SST mechanism | Status |
|---|---|---|
| `polling.php` + threads | `DownloadFileWorkflow` Distributed Map | **Done** |
| `insertFiles.inc` | `LegacyIngestWorkflow` | **Done** |
| Three AccuZIP campaign CSVs | One `mailing_addresses` export + SQS token | **Done** (shape change) |
| `parseFiles` → campaign tables | SQL procedures at report time | **Done** (shape change) |
| `generate_nll.php` | `LegacyNllGenerateWorkflow` | **Partial** (Slack vs Gmail) |
| `weeklyMailROI.php` | — | **Planned** |
| `nllROIReporter.php` / `nllROIReport.php` | — | **Planned** |
| `pollingStatus` / `pollingList` | `/api/runs*` `/api/jobs*` | **Done** (different URL) |
| `dataSelector` | — | **Gap** |
| `databaseExporter` | — | **Gap** |
| `blacklist` | — | **Gap** |
| `singleAddressROI` | — | **Gap** |
| `saturationReports.php` | `/api/stores/{n}/saturation-report` + NFocus ingest | **Done** |
| `simplifiedReport.php` | — | **Gap** |
| `nll_files` JPEGs | — | **CRM** |
| Push zip directory | `POST /upload` | **Done** |
| `polling_processes` / 6-min lock | Step Functions + 15-min failed-SFN sync cron | **Done** |

---

## G. What must be true before Apollo PHP can be retired

Minimum viable cutover for **Domino’s Pulse employees**:

1. **Download + ingest + AccuZIP** daily, observable on `/sys` (or `/new` re-pointed) — **available**.
2. **NLL TSV column-identical** to PHP, accepted by the mail vendor — **available**; confirm with one parallel week.
3. **NLL distribution** to the current Gmail list **or** an accepted Slack/S3 process — **process change still needed**.
4. **Disconnected-store AM email** from SST store fails — **small follow-on**.
5. **Saturation report** from `/new` without VPN to `192.168.4.26` — **API done; form not wired**.
6. **Job ROI + NLL ROI XLSX email** — **blocker for AM franchisee reporting**.
7. **Drop `dataSelector` + `databaseExporter`** — **blocker for building non-NLL mail**.
8. **Blacklist** honored on NLL generate — **blocker for suppression**.
9. **Vocelli / Athena** — **separate cutover**; SST does not replace Athena.

Items 6–8 are why SST can run **beside** Apollo for ingest/NLL while `/new` mail jobs and ROI buttons still hit `vpn.bbimarketing.com`.

---

## H. Recommended sequencing (product)

1. Dual-run ingest; staff use `/sys` for failures (A2/A14). Keep Apollo NLL email until Slack is accepted.
2. Wire `/new` saturation form to SST (A7).
3. Port Gmail for NLL package (E1) using existing S3 artifacts.
4. Port disconnected-store cron to SST list (E7).
5. ROI workflows (A9, A10, E2–E5) — highest AM visibility.
6. `dataSelector` / `databaseExporter` / blacklist (C2, C3, A11).
7. Re-point `pollingStatus` / home bar; decommission Sunday PHP.

---

## I. One-page summary

```
Employees need                          SST today
─────────────────────────────────────   ──────────────────────────
Know if stores polled                   /sys runs  ( /new still Apollo )
Fix credentials                         /new client  (CRM, required)
Get NLL press file                      Slack/S3 TSV+XLSX
Preview cohorts                         Slack + HTTP  (better than old)
Saturation spreadsheet                  HTTP XLSX  (form still Apollo)
NLL / job ROI spreadsheet               NOT YET
Drop counts / database lists            NOT YET
Blacklist                               NOT YET
Hotels, art, shipping, invoices         NEVER (CRM)
Vocelli reports                         NEVER (Athena)
```
