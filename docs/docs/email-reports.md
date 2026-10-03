# Email reports

Transport for almost all internal reports: **Gmail API** (`sendEmailViaGmailAPI` in `new/config/mailClient.inc` on nwk1 and `v2/mailClient.inc` on apollo). From: `donotreply@bbimarketing.com`. Typical Reply-To: `info@bbimarketing.com`.

`bbi-sst` **does not send email**. NLL artifacts go to **Slack** (and S3). Porting a report means either SES/Gmail from Lambda **or** keeping nwk1 as the mailer that pulls SST data.

This catalog is what employees expect in their inbox today, and how SST will (or will not) replace each one.

---

## How to read status

| Status | Meaning |
|---|---|
| **Replace** | SST (or `/sys` + SST) should produce the same artifact. |
| **Partial** | Same data, different channel or missing attachment. |
| **Planned** | Explicit future ROI workflow. |
| **Keep on nwk1** | CRM/ops mail; not Pulse ETL. |
| **Dormant** | Code exists; ETL no longer runs it. |

---

## 1. Weekly pipeline (automatic)

Triggered by Apollo `pollingProcessing.php` after AccuZIP — not by a dashboard click.

### 1.1 NLL press package

| | |
|---|---|
| **Script** | `services/dominos/generate_nll.php` |
| **Subject** | `{job_number} - New Late Lapsed` |
| **To** | arielle, john, sandy, scott, tyler, david, jwalker `@bbimarketing.com`; `downtownbonniebrown@gmail.com` |
| **Body** | Automated NLL service; **integrity check** (missing art, missing EXP); note that ROI refresh is in progress |
| **Attachments** | `(Mail).txt` press file, `(Report).xlsx` counts/invoice, `(Test File).txt` |
| **Data** | Campaign tables + `nllProvider` |
| **Employee use** | IT prints/mails; AMs/production check counts and art gaps |
| **SST** | **Partial.** Same TSV+Excel generated; posted to Slack + `GET /api/runs/{id}/reports`. No Gmail, no integrity-check email body yet. |

### 1.2 Weekly mail ROI refreshed (notice only)

| | |
|---|---|
| **Script** | `v2/customProjects/weeklyMailROI.php` |
| **Subject** | `BBI Marketing - Weekly ROI Reports Refreshed` |
| **To** | arielle, john, sandy, scott, sydney, sky, david, jwalker, nicole `@bbimarketing.com`; Bonnie Gmail |
| **Attachments** | **None.** HTML list of `client_name_match` whose `external_jobs` ROI fields were updated |
| **Data** | `external_jobs` / `external_lists` matched to `OR2_Raw`, `MassMail_RAW`, `NewCustomers` (approx. last 6 weeks of in-home dates) |
| **Employee use** | Signal that **client ROI panel numbers moved**. Spreadsheet is a separate click (mail job Export). |
| **SST** | **Planned.** DB indexes exist; no workflow; no email. |

### 1.3 NLL ROI column refresh (not an email)

| | |
|---|---|
| **Script** | `v2/customProjects/nllROIReporter.php` |
| **To** | Nobody |
| **Does** | Writes `net_orders` / `net_sales` / `order_details` on New/Late/Lapsed rows from OR2 + MassMail |
| **SST** | **Planned** (same ROI workstream). Do not confuse with `nllROIReport.php` (XLSX email). |

### 1.4 Frequency mailing (dormant)

| | |
|---|---|
| **Scripts** | `generateFrequency.php`, `generate_frequent.php` |
| **ETL** | Commented out; processor stubs `frequent_generated = 1` |
| **Subject (if run)** | `BBI Marketing - Weekly Frequency Mailing` |
| **SST** | **Out of scope** until product asks for frequency mail again. |

---

## 2. On-demand ROI and lists (dashboard or LAN)

Spawned from `v2/cli/process.php` `formType`. Requester email is usually the logged-in `users.email` stored in `temp_store`.

### 2.1 Direct-mail job ROI (XLSX)

| | |
|---|---|
| **Scripts** | `mailROIReports.php`; Vocelli `externalMailROIReports.php`; EDDM `eddmCRRTROI.php` / `externalEDDMCRRTROI.php` |
| **formType** | `mailROIReport` or `sysMailROIReport` |
| **Request UI** | `/new/?p=mailJob&id=` → check drops → **Export ROI Report** (`ajax` `pt=33`). Also LAN `v2/mailProcessing/` |
| **Subject** | `Direct Mail ROI Report - {job description}` |
| **To** | Requester; fallback `info@bbimarketing.com` |
| **Attachment** | XLSX — per-job sheets: pieces, new/rejuvenated, net orders/sales, profit; address-level response rows |
| **SST** | **Planned.** This is the spreadsheet AMs send franchisees. |

### 2.2 Domino’s NLL ROI (XLSX)

| | |
|---|---|
| **Script** | `nllROIReport.php` |
| **formType** | `nllROIReport` / `nllROIReportV2` |
| **Request UI** | Client → NLL ROI window → `queries/dominos_direct_mail.php` (VPN POST to `192.168.4.26`) |
| **Subject** | `New Late Lapsed ROI Report - {franchisee}` |
| **To** | Requester / `info@` |
| **Attachment** | XLSX sheets New / Late / Lapsed (summary + detail) |
| **Note** | NLL Manager `newNLLROIReport` **queues** `temp_store` but **does not exec** the reporter (incomplete). |
| **SST** | **Planned.** |

### 2.3 Vocelli NLL ROI (XLSX)

| | |
|---|---|
| **Script** | `vocelliROIReport.php` |
| **UI** | `queries/vocelli_direct_mail.php` |
| **Data** | Athena `?externalNLLROIReport&getROIData` — not Apollo MassMail |
| **SST** | **Athena / Vocelli path is outside SST’s Domino’s pipeline** unless a later project ports Athena. Treat as **not SST** today. |

### 2.4 Data-team segment exports

| Script | formType | To | Subject |
|---|---|---|---|
| `fbCustomerReport.php` | `fbCustomerReport` | `data@bbimarketing.com` | `Facebook Marketing Data - Polling Export Job` |
| `noWebOrders.php` | `convertOnlineList` | `data@` | `Push Week - Online Conversion Data Segment Results` |
| `lunchCarryoutCustomers.php` | `lunchCarryoutCustomers` | `data@` | `Push Week - Lunch/Carryout Data Segment Results` |

**UI:** LAN `v2/mailProcessing/` only. **SST:** not ported.

---

## 3. Polling operations

### 3.1 Disconnected polling stores

| | |
|---|---|
| **Script** | `new/cron/disconnectedPollingReport.php` (nwk1) |
| **Trigger** | Cron after Sunday poll (schedule not in git) |
| **Subject** | `Domino's Disconnected Polling Stores - {mm/dd/YYYY}` |
| **To** | Account managers who have failed stores (mapped user ids → john, danielle, arielle, scott, sydney, sky) |
| **CC** | nicole, david, bonnie `@bbimarketing.com` |
| **Body** | HTML tables by AM / franchisee (Pulse vs GLS). **No attachment.** |
| **Data** | Apollo `pollingList` + nwk1 `company` / `locations` |
| **Live UI** | `?p=pollingStatus` |
| **SST** | **Partial.** Per-store fail is on `/api/runs/{id}/stores`. Same AM email **not** implemented. Easy follow-on: nwk1 cron reads SST instead of Apollo, or Lambda+SES with the same mapping. |

---

## 4. Client / hotel exports (warehouse optional)

### 4.1 Hotel marketing list ± ROI

| | |
|---|---|
| **Script** | `new/cli/clientHotelROI.php` |
| **UI** | Client → Export Client Data (`pt=35`) |
| **Subject** | `{franchisee} - {Full\|Active\|… Hotel List}` |
| **To** | Requesting user |
| **Attachment** | XLSX; optional ROI via `singleAddressROI` |
| **SST** | Hotel list = **Keep on nwk1**. ROI columns = **Gap** until address ROI exists. |

### 4.2 Full market / simplified call sheets

| | |
|---|---|
| **Script** | `cli/clientCallExcel.php` |
| **Subject** | `{franchisee} - Full Market and Simplified Spreadsheets` |
| **SST** | **Keep on nwk1** (hotel CRM). |

---

## 5. CRM / ops mail (not Pulse reports)

These will keep working regardless of SST. Listed so they are not mistaken for pipeline deliverables.

| Script / path | Subject gist | To |
|---|---|---|
| `cli/weeklyClientRenewEmail.php` | `BBI Marketing Client Reorder Schedule` | `info@`, `scott@` |
| `cli/hotelGiftCertificates.php` | `{Month} {Year} Gift Certificate Press File and Report` | `tyler@` |
| `cli/dominosHotelCertificates.php` | same pattern | nicole, Bonnie, sydney, david, danielle, arielle, jwalker |
| `cli/wpa_cron.php` | `Your Wealth Profit Alliance Order Has Shipped!` | customer |
| `cli/hotelReOrderEmail.php` | hotel reorder | hotel contacts |
| `config/updater.php` | Mail job on/off hold | david@ |
| `ajax.php` hotel approval | `Needs Approval (AM): …` | info@ |
| `ajax.php` call complete | `Hotel Calling: … Complete` | info@ |
| `ajax.php` portal invite | Create Your Customer Portal Account | client |
| `forms/complete.php` | `{franchisee} - Signed Data Release Form` | data@ |
| Apollo `selector_send.php` | `Domino's Database Data Enclosed` | tyler@, josh@ |
| Apollo Label King | New Label King order | tyler@ |

Hotel gift-certificate CLIs **do** call `singleAddressROI` — Pulse-dependent columns on an otherwise CRM job.

---

## 6. Browser downloads that feel like reports (not email)

| Report | UI | SST |
|---|---|---|
| Saturation XLSX | Client Data Reports → Apollo (VPN) | `GET /api/stores/{n}/saturation-report` |
| Simplified NLL PDF/XLS | Client Data Reports | Not ported |
| Database drop TSV | Mail job download | Not ported (`databaseExporter`) |

---

## 7. Target email architecture (when ROI lands)

Recommended shape so employees do not lose the inbox workflow:

```
SST workflow completes
    → artifacts on S3 (TSV, XLSX)
    → notify channel:
         Slack (already)  AND/OR
         nwk1 mailer (Gmail API, existing templates)  AND/OR
         SES from Lambda (new)
```

Parity checklist per report:

1. Same **To/CC lists** (or documented change).
2. Same **subject** pattern (searchable in Gmail).
3. Same **attachments** (press TXT column order is a vendor contract).
4. Same **integrity / “no results”** bodies.
5. Requester-driven reports still go to **the user who clicked**, not a global list.

Until then, document Slack `/nll_report` as the NLL inbox substitute, and keep Apollo emailers running in dual-run.
