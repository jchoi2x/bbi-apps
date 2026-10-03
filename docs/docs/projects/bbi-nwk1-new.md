# `system.bbimarketing.com/new` — architectural analysis

Read-only analysis of the live app at nwk1 `/var/www/system.bbimarketing.com/new/` (28 Aug 2026), cross-checked against the local git submodule `projects/bbi-dashboard`.

**This is not a React/Vite/Next SPA.** `/new` is a PHP 8.2 server-rendered AdminLTE 2 application. There is no `package.json`, `src/`, TanStack Query, Zustand, or Step Functions UI. The `/new` prefix is a filesystem directory under the `system.bbimarketing.com` nginx document root, not a frontend `base` config.

| Location | Notes |
| --- | --- |
| Live | nwk1 (`198.74.60.204`) `/var/www/system.bbimarketing.com/new/` |
| Git remote (live) | Bitbucket `bbimarketing/new-system.git` |
| Local submodule | `projects/bbi-dashboard` → GitHub `BBIMarketing/bbi-dashboard` |
| Workspace FUSE | `projects/bbi-nwk1` was **Device not configured**; this document uses SSH to nwk1 + the dashboard submodule |

Treat the two git remotes as related checkouts, not proven identical HEAD.

---

## 1. Stack, runtime & build setup

### Frameworks and libraries

| Layer | What is used |
| --- | --- |
| Server | PHP 8.2.30 CLI on nwk1. Host also has PHP 5.6 FPM pools; `/new` PHP is served via nginx `fastcgi-php.conf` (8.2 for this vhost in practice). |
| App shell | [AdminLTE 2](https://adminlte.io/) (`css/lte.min.css`, `js/app.min.js`), Bootstrap 3, jQuery 2.2.3 |
| UI plugins (via Minify groups) | DataTables, Select2, Morris/Raphael, Chart.js, FullCalendar, Moment, daterangepicker, bootstrap-datepicker/datetimepicker, Dropzone, iCheck, Pace, jVectorMap, Knob, wysihtml5, jQuery Validate, jQuery Payment, Stripe.js (`js/stripe.config.js`) |
| Composer (`composer.json`) | `stripe/stripe-php` ^10, `mandrill/mandrill` 1.0, `phpoffice/phpexcel` ^1.8, `mpdf/mpdf` ^6.1, `phpmailer/phpmailer` ^5.2, `hps/heartland-php`, `gliterd/backblaze-b2` ^1.1 |
| Vendored (not Composer-only) | `libraries/mpdf60`, `libraries/PHPExcel`, `libraries/stripe-php`, `libraries/mail`, RocketShipIt PHP stub |
| Language | PHP + a small amount of inline jQuery. No TypeScript. No npm/pnpm/yarn. |
| Package manager | Composer only. No frontend bundler. |

Footer reports **Version 2.0.1b**.

### Base path / “build output”

There is no build step and no `base`/`homepage`/`VITE_BASE` setting.

- nginx `root` is `/var/www/system.bbimarketing.com`.
- The app lives in the subdirectory **`/new/`**, so public URLs are `https://system.bbimarketing.com/new/...`.
- Asset minify is rewritten:

```nginx
location /new/min/ {
    rewrite ^/new/min/([bfg]=.+) /new/min/index.php?$1;
}
```

Header loads `/new/min/g=css`; footer loads the `js` minify group. That is [mrclay/minify](https://github.com/mrclay/minify), not Vite.

- REST v2 is explicitly rooted at `/new/api/v2/`:

```nginx
location /new/api/v2/ {
    try_files $uri $uri/ /new/api/v2/index.php?$query_string;
    fastcgi_param HTTP_AUTHORIZATION $http_authorization;
}
```

HTTP → HTTPS 301 for the whole host. `.inc` / `.json` / keys are denied (`return 444`).

Login default redirect is hardcoded: `https://system.bbimarketing.com/new/`. Logout returns to `https://{HTTP_HOST}/new/`.

---

## 2. Architecture & directory map

### Mental map

```
/new/
  index.php              Front controller: session, login, include {p}.inc
  header.inc / footer.inc  AdminLTE chrome, sidebar nav
  *.inc                  One file per UI “page” (routed by ?p=)
  login.inc              Unauthenticated login form
  config/                DB, session helpers, ajax.php, shipping, mail, uploads
  api/index.php          Shared-secret JSON API used by Apollo polling
  api/nllProvider.inc    NLL list provider for Apollo
  api/v2/index.php       HMAC Bearer REST over bbi_system tables
  api/shipStation.php    ShipStation webhook inbound
  mailConfig/            Drop-type partials included by newMailDrop.inc
  queries/               Direct-mail export helpers (Dominos / Vocelli)
  cron/                  disconnectedPollingReport.php (nwk1; also in submodule)
  cli/                   CLI/cron PHP (ROI, UPS, Airtable/Make, WPA sheet)
  min/                   Minify
  css/ js/ img/ fonts/   Static AdminLTE assets
  vendor/                Composer install (live)
  scraper/               scrape.py (nwk1 extra)
  get_stores.php         nwk1 extra (not in older dashboard listing)
```

There is **no** `/src`, `/components`, `/hooks`, `/routes`, or `/services` layer in the SPA sense. “Services” are `config/ajax.php` (monster POST switch on `pt`) and `config/updater.php` (form posts from pages).

### State management

| Mechanism | Role |
| --- | --- |
| PHP `$_SESSION` (`sysData`) | Logged-in user |
| MySQL `bbi_system` (PDO) | All durable state: users, company, locations, hotels, jobs, art tasks, polling credentials |
| jQuery + DataTables / Select2 | Client-side table/filter state only |
| No Redux / Zustand / Context / TanStack Query | — |

### Routing

**Query-string file router**, not React Router / file-based app routes.

```php
// index.php
if ((!isset($_GET['p'])) || ($_GET['p'] == 'index')) $_GET['p'] = 'main';
$fileprefix = $_GET['p'];
if (file_exists($fileprefix . '.inc')) { include $fileprefix . '.inc'; }
else { include 'errors/404.inc'; }
```

URL shape: `https://system.bbimarketing.com/new/index.php?p=pollingStatus`  
(and extra query args, e.g. `?p=proofing&t=keyProofing`, `?p=mailJob&id=`).

Standalone PHP (not via `index.php`): `maps.php`, `api/*`, `config/ajax.php`, `config/updater.php`, `config/shipping.php`, `queries/*.php`, `cli/*.php`.

### Styling

Bootstrap 3 + AdminLTE 2 + `css/cstm-styles.css` + per-user skin (`css/skins/%USKIN%.css`, default `skin-blue`). Google Fonts Source Sans Pro, Font Awesome 4.7, Ionicons (CDN).

---

## 3. Features & page catalog

Sidebar is `header.inc`. Each row is a real `.inc` unless noted.

### Main navigation

| `?p=` | File | Workflow |
| --- | --- | --- |
| `main` (default) | `main.inc` | Home: hotel approval counts, art/job queues, proofing, **weekly Pulse polling progress bar** |
| `hotel_calling` | `hotel_calling.inc` | Call panel — hotel call list for the logged-in caller |
| `marketingBlacklist` | `marketingBlacklist.inc` | Direct mail suppression list; syncs with Apollo `/v2/?blacklist` |
| `nllManager` | `nllManager.inc` | New / Late / Lapsed creative + list management; NLL art images from Apollo `/v2/nll_files/` |
| `pollingStatus` | `pollingStatus.inc` | Full Pulse ETL status + per-store success table |
| `hotelApproval` | `hotelApproval.inc` | Hotel reorder “needs approval” queue |
| `hotelQueue` | `hotelQueue.inc` | Hotel order (kobuilder) queue |
| `proofing` | `proofing.inc` | Tabs via `&t=`: `keyProofing`, `cgProofing`, `schoolProofing`, `otherProofing` |
| `create-shipment` | `create-shipment.inc` | UPS labels via RocketShipIt |
| `pmodQuotingTool` | `pmodQuotingTool.inc` | PMOD quoting |
| `track-shipments` | `track-shipments.inc` | Shipment tracking |
| `artTasks` / `artTask` / `newArtTask` | matching `.inc` | Art task list / detail / create |
| `mailJobs` / `mailJob` / `newMailJob` | matching `.inc` | Direct mail jobs |
| `newMailDrop` / `existingMailDrop` / `viewDrop` / `viewDropNew` / `viewDropLogistics` | matching `.inc` | Mail drop setup (smart / saturation / database / EDDM via `mailConfig/`) |
| `jobManager` / `newJob` | matching `.inc` | Print/job manager |
| `deprecatedTasks` / `deprecatedTask` | matching `.inc` | Legacy task manager |
| `clientList` / `client` / `new-client` | matching `.inc` | Franchisee CRM; store IPs/Pulse creds live on `client` |
| `location` / `hotel` / `city` | matching `.inc` | Store / hotel / city records + Google Maps |
| `reorderSchedule` | `reorderSchedule.inc` | Client reorder calendar (FullCalendar) |
| `hotelImporter` | `hotelImporter.inc` | Hotel list import |
| `help` | `help.inc` | Help / Domino’s Online |
| `employeeList` | `employeeList.inc` | Employees |
| `fileHosting` | `fileHosting.inc` | File hosting (Backblaze B2 uploads) |
| `settings` | `settings.inc` | User profile / skin |
| `admin` | `admin.inc` | Admin menu (requires `users.admin = 1`) |
| `hotel-management` | `hotel-management.inc` | Assign hotel call lists |
| `system-users` / `user` | matching `.inc` | System user admin |
| `invoice` | `invoice.inc` | Invoices |
| `bulkAdd` | `bulkAdd.inc` | Bulk add |
| `socialMediaManagement` | `socialMediaManagement.inc` | Social creatives (NLL JPEGs from vpn host) |
| `specific_calls` | `specific_calls.inc` | Admin hotel-call tooling |
| `hotel_calls` / `hotel_process` | matching `.inc` | Individual hotel call / order process |
| `createDirectMail` | `createDirectMail.inc` | Older mail-create flow |

Admin menu also links to `nll-management`, `school-management`, `fundraising-management`, `product-management`, `system-management`. **Those `.inc` files are not in the tree** (404).

External sidebar links (not this app): Trello board, Payroll Servers time clock, `/vacation/` on the **legacy** site root.

### Supporting UI / AJAX

| Path | Role |
| --- | --- |
| `config/ajax.php` | `POST pt=1…36` — locations, contacts, NLL dates, dataSelector, ROI, blacklist, USPS EDDM GIS |
| `config/updater.php` | Page form saves; Make.com webhooks for some CRM events |
| `config/search.php` | Sidebar typeahead search |
| `config/shipping.php` | `?request=rate` / print label |
| `config/listExport.php` | List export + Apollo `singleAddressROI` |
| `maps.php` | Store/hotel map (standalone) |
| `queries/dominos_direct_mail.php` | NLL week picker → POST to Apollo `v2/cli/process.php` |
| `queries/vocelli_direct_mail.php` | Same pattern for Vocelli |

---

## 4. ETL monitoring & pipeline visualization

### What `/new` visualizes

`/new` does **not** talk to AWS Step Functions, SST, EventBridge, or CloudWatch. It visualizes the **legacy Apollo Pulse pipeline** (`polling_watchdog` on Apollo MySQL), exposed as HTTP JSON on `https://vpn.bbimarketing.com/v2/`.

Two screens:

1. **Home** (`main.inc`) — compact progress bar + current state string + link to full status.
2. **Polling Status** (`pollingStatus.inc`) — same bar, plus a DataTables list of every store’s last poll (success, time, fail reason) and a “incomplete credentials/IP” table from **local** `bbi_system`.

A related **email report** (not a live dashboard) is `cron/disconnectedPollingReport.php`: pulls the same `pollingList` JSON and emails account managers; includes an Airtable ticket link.

### Mechanics (no SSE / WebSockets / timers)

| Mechanism | Used? |
| --- | --- |
| Server-Sent Events | No |
| WebSockets | No |
| `setInterval` / auto-refetch | No on polling pages |
| Page-load cURL | **Yes** — every GET of `main` or `pollingStatus` |
| Manual refresh | User reloads the page |

cURL options: SSL verify **off**, timeout **3s** for status / **10s** for list. Empty body → synthetic `contactError`.

There is no Step Function execution ARN, no CloudWatch log tail, no job ID browser. Progress is a **coarse percent mapped from watchdog flags** on Apollo (`v2/index.php` `pollingStatus` handler).

### Status payload (`GET /v2/?pollingStatus`)

Decoded as an associative array:

```json
{
  "start_time": 1690000000,
  "end_time": 0,
  "state": "System is Polling Stores",
  "status": "5"
}
```

| Field | Meaning in UI |
| --- | --- |
| `start_time` | Unix; “Process Started” |
| `end_time` | `0` → Incomplete (red); else “Process Completed” timestamp |
| `state` | Human string (polling → insert → AccuZIP extract → parse → NLL → mail ROI → NLL ROI → Completed) |
| `status` | 5–100, width of Bootstrap progress bar |

On contact failure the PHP page synthesizes:

```php
[
  'contactError' => true,
  'start_time' => 0,
  'end_time' => 0,
  'status' => 100,
  'state' => 'An Error Occured - Could not contact Data Warehouse server',
]
```

Apollo maps watchdog columns to `state`/`status` (excerpt): `polling==0` → “System is Polling Stores” / 5; later flags through “Building NLL ROI” / 95; `update_nll_roi==1 && end_time` → “Completed” / 100.

### Per-store payload (`GET /v2/?pollingList`)

Array of:

```json
{
  "store_number": "1234",
  "client_name": "Franchisee Name",
  "success": "1",
  "success_time": 1690000000,
  "fail_reason": null
}
```

UI joins `client_name` to local `company.id` and `store_number` to `locations.vpn_ip_address` (10.x = “Old” subnet, else “New”).

### Reverse direction (Apollo → `/new`)

Apollo `polling.php` **POSTs** to `https://system.bbimarketing.com/new/api/` with shared-secret `auth` and `type=pollingInfoRequest`. That is how ETL **starts** (store list + Pulse credentials). `/new` is the credential source, not the Step Function orchestrator.

`parseFiles` / `generate_nll.php` similarly POST `type=nllProvider` to the same `/new/api/`.

---

## 5. API dependency inventory

Secrets are **not** copied here (query `auth` keys, Stripe, UPS, ShipStation, Make, Google Maps keys are hardcoded in PHP). Callers use those literals, not env vars.

### Outbound from `/new` (this app as client)

| Endpoint / route | Method | Calling component | Backend | Request | Response shape |
| --- | --- | --- | --- | --- | --- |
| `https://vpn.bbimarketing.com/v2/?pollingStatus` | GET | `main.inc`, `pollingStatus.inc` | Apollo PHP (`bbi-cron-php` `v2/index.php`) | Query `auth=` shared secret | `{start_time,end_time,state,status}` JSON |
| `https://vpn.bbimarketing.com/v2/?pollingList` | GET | `pollingStatus.inc`, `cron/disconnectedPollingReport.php` | Apollo `/v2` | Query `auth=`; optional `store`, `client`, `success` | Array of `{store_number,client_name,success,success_time,fail_reason}` |
| `https://vpn.bbimarketing.com/v2/?newNLLAvailableDates` | POST | `config/ajax.php` (`pt=29`), `queries/dominos_direct_mail.php`, `queries/vocelli_direct_mail.php` | Apollo `/v2` | `auth`, store list | JSON weeks/months for NLL ROI |
| `https://vpn.bbimarketing.com/v2/?dataSelector` | POST | `mailConfig/*-saturation-mail.inc`, `*-eddm-mail.inc`, `ajax.php` (`pt=33`/`35` area), `projects/updateDropCounts.php`, `cli/externalParse.php` | Apollo `/v2` | Counts/routes for a drop | JSON counts / routes |
| `https://vpn.bbimarketing.com/v2/?databaseExporter` | POST | `config/updater.php` | Apollo `/v2` | Export job fields | File/JSON export |
| `https://vpn.bbimarketing.com/v2/?blacklist` | POST | `marketingBlacklist.inc`, `hotelImporter.inc`, `ajax.php` (`pt=34`) | Apollo `/v2` | `type=fetch` (and update variants) | JSON blacklist |
| `https://vpn.bbimarketing.com/v2/?singleAddressROI` | POST | `config/ajax.php` (`pt=11`), `config/listExport.php`, `cli/hotelGiftCertificates.php`, `cli/dominosHotelCertificates.php`, `cli/clientHotelROI.php` | Apollo `/v2` (also called as `https://192.168.4.26/v2/` in several CLI files) | Address / hotel ROI params | JSON ROI |
| `https://vpn.bbimarketing.com/v2/cli/process.php` | POST | `ajax.php` (`pt=29`/`33`/`36`), `queries/*_direct_mail.php` (browser form also posts to `192.168.4.26`) | Apollo CLI processor | `formType` e.g. `newNLLROIReport`, locations, dates | HTML/JSON ack |
| `https://vpn.bbimarketing.com/v2/reports/saturationReports.php` | POST | `projects/exportAllVocelli.php` | Apollo reports UI | Saturation export fields | Report download |
| `https://vpn.bbimarketing.com/v2/nll_files/{id}.jpg` | GET | `nllManager.inc` (uses `192.168.4.26`), `socialMediaManagement.inc` (uses vpn hostname) | Apollo static files | Path | JPEG |
| `https://192.168.4.24/v2/?presortDetails` | POST | `viewDropLogistics.inc` | **Athena** (data warehouse), not Apollo | Drop/presort fields | JSON logistics |
| `https://vpn.bbimarketing.com:27015/api/v1/` | POST | `config/classes.inc` RocketShipIt | RocketShipIt HTTP service on Apollo | JSON `{carrier,action,params}` + `x-api-key` | JSON rates/labels |
| `http://vpn.bbimarketing.com:27016/` | POST | `config/shipping.php` print path | Label printer/ZPL listener (often down) | ZPL body | Printer ack |
| `https://ssapi.shipstation.com/orders` | GET | `api/shipStation.php` | ShipStation | Basic auth; webhook `resource_url` | Order JSON |
| `https://wwwcie.ups.com/security/v1/oauth/token` | POST | `cli/shipStationTracking.php` | UPS CIE OAuth | Client credentials | Token |
| `https://oauth2.googleapis.com/token` | POST | `config/mailClient.inc` | Google | JWT bearer (service account impersonation) | `{access_token,expires_at}` |
| `https://gmail.googleapis.com/gmail/v1/users/me/messages/send` | POST | `config/mailClient.inc` | Gmail API | Raw RFC822 | Message id |
| `https://maps.googleapis.com/maps/api/geocode/json` | GET | `config/functions.inc`, `api/nllProvider.inc` | Google Maps | `address`, `key` | Geocode JSON |
| `https://maps.googleapis.com/maps/api/js` | GET | `maps.php`, `location.inc` | Google Maps JS | `key`, `callback` | Script |
| `https://maps.googleapis.com/maps/api/streetview` | GET | `hotel.inc` | Google | lat/lng | Image |
| `https://gis.usps.com/arcgis/rest/services/EDDM/selectZIP/GPServer/routes/execute` | GET | `ajax.php` | USPS EDDM GIS | ZIP, `Rte_Box` | ArcGIS JSON routes |
| `https://api.backblazeb2.com/b2api/v2/b2_authorize_account` | GET | `config/fileUpload.php` | Backblaze B2 | Basic keyId:appKey | Auth + apiUrl |
| `{apiUrl}/b2api/v2/b2_get_upload_url` | POST | `config/fileUpload.php` | B2 | `bucketId` | uploadUrl + token |
| B2 upload URL | POST | `config/fileUpload.php` | B2 | File bytes | File id |
| `https://hook.us1.make.com/{id}` | POST | `config/updater.php`, `ajax.php` (location create/move), `cli/fillDataReleaseInAirtable.php` | Make.com | JSON franchisee/location events | 2xx |
| `https://docs.google.com/spreadsheets/d/.../pub?...output=csv` | GET | `cli/wpa_cron.php` | Google Sheets publish | — | CSV |
| Stripe API | POST | Stripe PHP SDK (`ajax.php`, `api/v2`) | Stripe | Charges / checkout (test key in code) | Stripe objects |
| `http://closure-compiler.appspot.com/compile` | POST | Minify builder only | Google Closure | JS source | Minified JS |

### Inbound APIs (this app as server)

| Endpoint / route | Method | Caller | Implemented in | Params | Response |
| --- | --- | --- | --- | --- | --- |
| `/new/api/?k=&t=1…7` | GET | External tools (shared query key) | `api/index.php` | `t` hotel/location/client/order; `c`, `a`, `s`, etc. | JSON lists / `{status,results}` |
| `/new/api/` `type=pollingInfoRequest` | POST | Apollo `polling.php` | `api/index.php` | Shared POST `auth`; optional `cid`, `store_numbers`, `orderBy` | `{status:'ok', results:[{store_number,client_name,vpn_ip_address,username,password}]}` |
| `/new/api/` `type=nllProvider` | POST | Apollo `generate_nll.php` / parse | `api/nllProvider.inc` | `request` + NLL fields | JSON list metadata |
| `/new/api/` `type=frequencyProvider` | POST | Apollo | `api/index.php` | Shared `auth` | Active frequency-program stores or fail |
| `/new/api/` `type=eddmProvider` | POST | Apollo | `api/index.php` | `mail_date_*` or `inhome_date_*` | EDDM jobs in window |
| `/new/api/` `type=locationProvider` | POST | Apollo | `api/index.php` | Location query | Location rows |
| `/new/api/v2/auth` | POST | REST clients | `api/v2/index.php` | JSON username/password or HTTP Basic | `{token}` HMAC Bearer, 1h |
| `/new/api/v2/meta` | GET | REST clients | `api/v2/index.php` | Bearer | OpenAPI-ish table description |
| `/new/api/v2/{company\|locations\|hotels\|users\|company_contacts}` | GET/POST/PUT/DELETE | REST clients | `api/v2/index.php` | Bearer; JSON body for writes | CRUD JSON (hidden fields stripped) |
| `/new/api/shipStation.php?psk=` | POST | ShipStation webhooks | `api/shipStation.php` | `resource_type`, `resource_url` | 2xx after pulling order |
| `/new/config/ajax.php` | POST | Browser jQuery from `.inc` pages | `config/ajax.php` | Session cookie + `pt` | HTML fragments or JSON |
| `/new/config/shipping.php?request=` | POST | Create-shipment UI | `config/shipping.php` | Session; rate/label fields | JSON rates / label |

Linkasoarus Stripe webhook / checkout routes exist in `api/v2/index.php` but are **commented out**.

**SST API:** none. No `execute-api.amazonaws.com` or `bbi-sst` URLs in this tree.

---

## 6. Authentication & session handling

### Browser UI (`index.php` and `config/secureDB.inc`)

Not JWT for pages. Custom PHP sessions:

- Cookie name **`sysData`** (`session_name`).
- Domain **`.bbimarketing.com`**, `Secure`, `HttpOnly`, `session.use_only_cookies`.
- `session_regenerate_id(true)` on every `sec_session_start()` (there is a commented alternative that regenerates once per session to avoid AJAX races).
- Login: `users.username` + `password_verify` on `users.new_password` (bcrypt). Disabled users rejected.
- Session binding: `$_SESSION['user_id']` + `$_SESSION['login_string']` = SHA-512(`new_password` + `User-Agent`).
- **Remember me:** cookie **`sysRem`** = `selector:token` on `.bbimarketing.com`; token stored hashed with User-Agent in `user_auth`; 14-day expiry; rotated on use.
- Forced password reset: `users.password_reset == 1` or a hardcoded default hash → `passwordReset.inc` instead of the app.
- Logout: destroys session, deletes `user_auth` row, clears `sysRem`.

`config/ajax.php`, `updater.php`, `shipping.php` include `secureDB.inc`, which re-runs `sec_session_start()` + `loginCheck()` and 401-redirects to `https://system.bbimarketing.com/` if unauthenticated.

This is **not** inheriting the legacy site’s `bbi_database_un` cookies. It is a **separate** session (`sysData`) that happens to be scoped to the parent domain so it is valid on `system.bbimarketing.com`.

### Route / role guards

| Guard | Where |
| --- | --- |
| Must be logged in | All `index.php` pages after login |
| `users.admin == 1` | `admin.inc`, `new-client.inc`, `system-users.inc`, `hotel-management.inc`, `specific_calls.inc`, parts of `hotel_process.inc` / `client.inc` field enablement |
| Caller ownership | `hotel_calls.inc` — non-admins only if `cid` matches |
| Shared query key `k=` | `api/index.php` GET (not a user session) |
| Shared POST `auth=` | `api/index.php` POST (Apollo) |
| HMAC Bearer | `api/v2` except `auth` and `meta` |
| Query `psk=` | ShipStation webhook |

There is no RBAC matrix beyond **`admin` vs not**. Call-panel counts are filtered by `users.id`.

### API v2 tokens

Custom HMAC: `base64(json{user_id,exp}) + '.' + HMAC-SHA256`. Header `Authorization: Bearer …`. Expiry 3600s. `SECRET_KEY` is a PHP `define`, not an env var. CORS `Access-Control-Allow-Origin: *`.

---

## 7. Environment & configuration keys

**No `VITE_*`, `NEXT_PUBLIC_*`, or `.env` files.** `getenv` / `$_ENV` do not appear in application PHP (only Minify’s temp-dir fallbacks).

Configuration is **hardcoded PHP**:

| Key / file | Purpose |
| --- | --- |
| `config/db.inc`, `config/secureDB.inc`, `api/v2` `DB_*` defines | MySQL `localhost` / database `bbi_system` / user `bbi_system` |
| `api/index.php` `$randomStringConstructor` | POST `auth` for Apollo |
| `api/index.php` GET `k=` | GET API key |
| `pollingStatus.inc` / `main.inc` query `auth=` | Apollo `pollingStatus` / `pollingList` |
| `api/v2` `SECRET_KEY`, `TOKEN_EXPIRY` | REST HMAC |
| `api/v2` `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe (test keys currently selected) |
| `api/v2` `LINKASOARUS_BEARER_TOKEN` | Linkasoarus (webhook code commented) |
| `js/stripe.config.js` `pk_test_…` | Stripe.js publishable key |
| `config/shipping.php` UPS account/key/user + RocketShipIt `apiKey` | UPS + RS |
| `api/shipStation.php` `API_KEY` / `API_SECRET` / `psk` | ShipStation |
| `config/mailClient.inc` PEM path, token cache path, service-account email, impersonated user, Gmail scope | Outbound mail |
| `config/fileUpload.php` B2 key id / app key / bucket (plus cache `temp/b2-auth.inc`) | File hosting |
| `config/functions.inc` / `nllProvider.inc` Maps `key=` | Geocoding |
| `maps.php` / `location.inc` / `hotel.inc` Maps JS/Street View `key=` | Maps UI |
| `config/updater.php` / `ajax.php` Make.com hook URLs | Automation |
| `cron/disconnectedPollingReport.php` `$accountManagers` emails | Polling failure mail |

Nginx-related (host, not PHP): Let’s Encrypt certs for `system.bbimarketing.com`; `fastcgi_param HTTP_AUTHORIZATION` for `/new/api/v2/`.

---

## Gaps vs a modern SPA / SST world

- No React, Vue, Next, Vite, TanStack Query, or file-based frontend routes.
- No Step Functions / SST progress UI; ETL view is Apollo `polling_watchdog` over HTTPS cURL on page load.
- `projects/bbi-nwk1` FUSE mount was unavailable; live tree extra vs submodule includes `scraper/`, `get_stores.php`, and a populated `vendor/`.
- Several admin `?p=` targets have no `.inc`.
- Apollo is reached both as `vpn.bbimarketing.com` and as raw `192.168.4.26` / Athena `192.168.4.24` depending on the file — inconsistent host choice.
- Port 27016 (ZPL) has been observed not listening; 27015 (RocketShipIt) has.

Related docs: [infrastructure.md](../infrastructure.md), [applications.md](../applications.md), [employee-use-cases.md](../employee-use-cases.md), [coverage-matrix.md](../coverage-matrix.md).
