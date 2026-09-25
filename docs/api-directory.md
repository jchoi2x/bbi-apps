# API directory

Tokens are **hardcoded in PHP** or SST **SSM / secrets**. This page documents **routes and shapes**, not secret values. Prefer changing a shared secret in **both** caller and callee together.

SSL: most nwk1 → apollo curls set `CURLOPT_SSL_VERIFYHOST/PEER = 0`. Apollo → nwk1 polling uses verify on. SST uses AWS-native TLS to API Gateway; Pulse NTLM is HTTP on GLS.

Host aliases: apollo = `https://vpn.bbimarketing.com` **or** `https://192.168.4.26`. Athena = `https://192.168.4.24`. Prefer hostname from nwk1; LAN IP on office network.

---

## 1. SST (`bbi-sst` API Gateway)

Auth: `OpsApiKey` as `x-api-key` or `Authorization: Bearer`, except `/api/ping`, `/api/healthz`, `/upload` (Basic), Slack (signing secret).

CORS: `DashboardCorsOrigin` (comma-separated); unset / `sst dev` → `*`.

Full table: [bbi-sst.md](bbi-sst.md) §6.

Employee-relevant:

| Call | Replaces |
|---|---|
| `GET /api/jobs*`, `GET /api/runs*` | Apollo `pollingStatus` / `pollingList` |
| `GET /api/runs/{id}/reports` | NLL email attachments (download) |
| `GET /api/stores/{n}/customers/{type}` | Campaign-table peeks |
| `GET /api/stores/{n}/saturation-report` | `saturationReports.php` |
| `POST /upload` | nwk1 `dominos-uploaded/` drop |
| `POST /slack/nll-report` | Sunday `generate_nll.php` trigger |

---

## 2. nwk1 → apollo (dashboard as client)

### Status

| Call | Source | Response |
|---|---|---|
| `GET /v2/?pollingStatus` | `main.inc`, `pollingStatus.inc` | `{ start_time, end_time, state, status }` |
| `GET /v2/?pollingList` | `pollingStatus.inc`, `disconnectedPollingReport.php` | `[{ store_number, client_name, success, success_time, fail_reason }]` |

Empty body → nwk1 synthesizes `contactError`.

### NLL dates / CLI

| Call | Source | Notes |
|---|---|---|
| `POST /v2/?newNLLAvailableDates` | `dominos_direct_mail.php`, `vocelli_direct_mail.php`, `ajax.php` | If `rd_available==3`, apollo **forwards** to Athena |
| `POST /v2/cli/process.php` | ajax `sysNLLROIReport`, `sysMailROIReport`, `newNLLROIReport`; browser forms to LAN IP | Success `ok` or **redirect** to nwk1 query pages |

### Data / lists / ROI

| Call | Source | Response |
|---|---|---|
| `POST /v2/?dataSelector` | mailConfig saturation/EDDM, ajax, `updateDropCounts.php` | JSON counts/routes |
| `POST /v2/?databaseExporter` | `updater.php` | TSV/JSON export |
| `POST /v2/?blacklist` | `marketingBlacklist.inc`, ajax `pt=34` | `{ status: 'ok' }` |
| `POST /v2/?singleAddressROI` | ajax `pt=11`, hotel ROI CLIs, `listExport.php` | `{ net_orders, net_sales, average }` |

### Reports (browser POST, often VPN)

| Call | UI |
|---|---|
| `POST /v2/reports/saturationReports.php` | Client Data Reports |
| `POST /v2/reports/simplifiedReport.php` | Client Data Reports |
| `GET /v2/nll_files/{id}.jpg` | NLL Manager, social |

### Shipping on apollo host (not Pulse)

| Call | Source |
|---|---|
| `POST https://vpn.bbimarketing.com:27015/api/v1/` | RocketShipIt (`classes.inc`) |
| `POST http://vpn.bbimarketing.com:27016/` | ZPL print (often down) |

Legacy: `GET /services/{dominos\|rpm_data/roi}/return_roi.php` pipe-delimited ROI.

---

## 3. apollo → nwk1

`POST https://system.bbimarketing.com/new/api/` with `type` + shared `auth`. 401 on mismatch. 400 unknown type.

### `type=pollingInfoRequest`

Caller: `polling.php` (and SST FetchStores).

```json
{
  "status": "ok",
  "results": [
    {
      "store_number": "1234",
      "client_name": "…",
      "vpn_ip_address": "10.x or 100.x",
      "username": "…",
      "password": "…",
      "pulse_version": 4
    }
  ]
}
```

`pulse_version=4` when a zip matching `^[^-]+-(\d{5})_` exists under `/var/www/upload.bbimarketing.com/dominos-uploaded`.

### `type=nllProvider`

| `request` | Returns |
|---|---|
| `1` | NLL-enabled stores + `nll_settings` |
| `2` | Test-file seed rows |
| `3` | Variable CC/EXP |
| `4` | One settings tuple |
| `5` | Coupon-stock alerts (SST may dispatch) |
| `6` | lat/lng (may geocode) |

### Other POST types

`frequencyProvider`, `eddmProvider` (jobs in mail/inhome window + `drops[].drop_data`), `locationProvider`.

### GET `?k=…&t=1…7`

Hotel/location/client/order helpers. Apollo ROI/mail scripts use `t=5` (location) and `t=3`/`t=7` (hotel).

---

## 4. apollo ⇄ Athena

SSL verify off. Used when store_number is non-numeric or `rd_available==3`.

| Apollo | Athena | When |
|---|---|---|
| `generate_nll.php` | `?nllRequest` | Vocelli NLL addresses |
| `v2/index.php` | `?externalNLLROIReport&getDates` | Vocelli date proxy |
| saturation / exporter / `dataExists` | matching `?` | non-numeric stores |
| `externalMailROIReports.php` | `?externalROIReport` | |
| `vocelliROIReport.php` | `?externalNLLROIReport&getROIData` | |
| `externalEDDMCRRTROI.php` | `?externalEDDMROIReport` | |
| `fbCustomerReport.php` | `?externalFbExporter` | |
| `mail_list.php` | `?smartMailRequest` | |

---

## 5. nwk1 → Athena

`POST https://192.168.4.24/v2/?presortDetails` — `viewDropLogistics.inc`. Body: `job_number`, `drop_code`. JSON DDU logistics. **Not** AccuZIP file I/O.

---

## 6. nwk1 inbound (not Pulse)

| Route | Caller |
|---|---|
| `/new/api/v2/*` | HMAC Bearer REST over CRM tables |
| `/new/api/shipStation.php` | ShipStation webhooks |
| `/new/config/ajax.php` | Browser `pt=` switch |
| `/upload` vhost | Legacy Dominos drop; CF Worker now proxies most to SST |

---

## 7. Cloudflare

`projects/bbi-tf/workers/upload-proxy.js` — `upload.bbimarketing.com` → SST `POST /upload`. **Must forward body + Basic Auth. Do not 308.**

---

## Error / redirect patterns

- nwk1 dashboard: empty apollo body → fake completed error (progress 100).
- apollo `process.php`: `Location:` back to `…/queries/*_direct_mail.php?id=&status=success|error`.
- SST workflow start: **202** + `executionArn`.
- Jobs API errors: `{ "message": "…" }`. Internal runs API: `{ error }`.
