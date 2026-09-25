# Data model

No in-repo `CREATE TABLE` for nwk1 CRM — columns reconstructed from PHP. Apollo types from SST Knex port: `projects/bbi-sst/migrations/20260709120000_001_legacy_apollo_tables.ts`. NLL domain: `…_003_nll_domain_tables.ts` and later (e.g. `is_invalid` migration 012).

**Do not copy database passwords** from `db.inc` / `config.inc` into application docs or new files.

| Engine | Host | Database |
|---|---|---|
| MariaDB | nwk1 `127.0.0.1:3306` | `bbi_system` |
| MySQL | apollo `127.0.0.1:3306` (`:13306` on LAN) | `dominos` |
| Postgres | AWS RDS (SST) | Port of apollo + `mailing_addresses` + jobs dashboard columns |

---

## Correlations

```
bbi_system.company.id  ←  locations.loc_comp_id
locations.location_number  ↔  daily_polling.store_number
                           ↔  MassMail_RAW.store_number
                           ↔  OR2_Raw.Location_Code
polling_processes.(fid,lid)  =  daily_polling.id range     [legacy only]
MassMail_RAW.(store_number, CustomerProfileID, Street)
        ↔  mailing_addresses.(store_number, pulse_profile_id, old_address)
NewCustomers.late_matched  ↔  LateCustomers.new_matched   [legacy materialization]
```

**`company.rd_available`:** `0` pending data-release; `1` Domino’s Pulse; `2` alternate; `3` Vocelli.

Polling seed: `rd_available = '1'` AND location `vpn_ip_address IS NOT NULL`.

---

## nwk1 `bbi_system` (CRM — SST reads, does not own)

### `company`

PK `id`. Franchisee name, contacts, `sr_id` / `ac_id` (sales/AM), `rd_available`, `company_active`, `poll_username` / `poll_password`, `access_hash`, `fcode`, notes/shipping/Coke fields.

### `locations`

Natural key `location_number`. `real_location_number` (POS vs mail id). `loc_comp_id` → company. Pulse: `vpn_ip_address`, `vpn_custom_user`, `vpn_custom_password`. NLL flags: `location_new` / `location_late` / `location_lapsed`. Freq window: `location_freq_start` / `stop`. Geo: lat/lng.

### `nll_settings`

Joined by `store_number` in `nllProvider.inc`. Coupons, EXP, limits — **generate-time** input to SST NLL.

### `users` / `user_auth`

Dashboard login (`sysData`, remember-me `sysRem`). Admin flag only.

Mail jobs / drops / hotels / art / invoices live here too; see [projects/bbi-nwk1-new.md](projects/bbi-nwk1-new.md). They are not SST tables.

---

## Apollo / SST warehouse

### `daily_polling`

One store on one run. Apollo: `success` 0 pending / 1 ok / 2 fail, `fail_reason`, unix `success_time`. TRUNCATE each Sunday on Apollo.

SST adds: `status`, `polling_watchdog_id`, unique `(watchdog_id, store_number)`, `message`, `data_source`. Does not use `polling_processes`.

### `polling_watchdog`

One run. Apollo: unix `start_time` / `end_time`, `process_lock`, boolean stage flags (`polling`, `insert_*`, `extract_*`, `parse_*`, `scan_lapsed`, `nll_generated`, `frequent_generated`, `update_mail_roi`, `update_nll_roi`).

SST adds: `status`, `sfn_execution_arn`, report window, store counters, jobs-dashboard columns (migration 047).

### `polling_processes`

`fid`, `lid`, `last_activity`, `completed`. **SST does not orchestrate with this table.**

### `file_list`

UK `(store_number, filename)`. `status` 1 downloaded / 2 fail. SST: `s3_path`, `ingested`, `legacy_ingested`.

### `MassMail_RAW`

Pulse MMC facts. Skip empty Street. Dates via `strtotime` of tab fields — **ET wall-clock epochs**.

Key fields: `store_number`, `phone`, `CustomerName`, `Street`/`City`/`State`/`Zip`, `FirstOrderDate`, `LastOrderDate`, `LastLateOrderDate`, `LastDeliveryTime`, `CustomerProfileID`, offer/lifetime, `Version`.

SST UK: `(store_number, CustomerProfileID, LastOrderDate, filename)` — `filename` required.

### `OR2_Raw`

PK `(Location_Code, Order_Number, Actual_Order_Date)`. Keep `Order_Status_Code == 4` only. `filename` still nullable in SST.

### Campaign tables (legacy materialization)

Written **after** AccuZIP parse, not at ingest:

- **`NewCustomers`** — postal + `old_*`, `last_order`, `customer_code`, later `mailed`, `late_matched`, ROI fields
- **`LateCustomers`** — `new_matched`
- **`LapsedCustomers`** — inserted in `generate_nll.php`

SST NLL **does not** use these as the ingest path. Procedures may still consult mailed history for new-customer grace.

### `mailing_addresses` (SST)

UK `(store_number, pulse_profile_id, old_address, old_city, old_state, old_zip)`.

| Column | Role |
|---|---|
| `old_*` | MMC identity (`Street` / `City` / `State` / `Zip`) |
| `pulse_profile_id` | `CustomerProfileID` as text |
| `address`, `city`, `state`, `zip5`, `zip4`, `crrt` | post-AccuZIP |
| `is_valid` | 1 after successful apply |
| `is_invalid` | AccuZIP hard-fail; never downgrade a valid row |

Ingest insert-ignore. AccuZIP apply owns updates.

### Saturation

`saturation_counts` / `saturation_counts_adv` — NFocus CRRT residential/business counts. SST reloads from S3. Used by saturation XLSX.

### External lists (ROI groundwork)

`external_jobs` / `external_lists` — smart/saturation/database mail pieces + addresses. Legacy `weeklyMailROI` updates ROI fields here. SST has indexes and `get_external_list_addresses`; no ROI writer yet.

---

## Seed path (legacy)

1. nwk1 `company` + `locations` → `pollingInfoRequest`
2. `daily_polling` → NTLM → `file_list` + tab dirs
3. `insertFiles` → `OR2_Raw` / `MassMail_RAW`
4. AccuZIP → `NewCustomers` / `LateCustomers` / massmail parse → lapsed → NLL → ROI

## Seed path (SST)

1. Same API seed
2. Download or `/upload` → S3 + `file_list`
3. Ingest → RAW + `mailing_addresses`
4. AccuZIP apply on `mailing_addresses`
5. NLL SELECT → TSV (campaign tables not required)
