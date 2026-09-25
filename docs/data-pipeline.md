# Data pipeline — old weekly chain vs SST daily chain

Related: [legacy-system.md](legacy-system.md), [bbi-sst.md](bbi-sst.md), [data-model.md](data-model.md).  
Live code details: `.cursor/rules/02-etl-state-machine.mdc`, `05-modernization-mapping.mdc`.

---

## 1. What both pipelines consume

| Input | Source |
|---|---|
| Store list + Pulse user/pass + IP | nwk1 `POST /new/api/` `type=pollingInfoRequest` |
| NLL campaign config | nwk1 `type=nllProvider` |
| MMC / OR2 tabs | PulseWeb `:59101` **or** push zip → synthesized tabs |
| CASS | AccuZIP VM watching NAS `postal_validate/` → `postal_data/` |
| NFocus CRRT (saturation) | Files (legacy cron vs SST S3 `nfocus/`) |

---

## 2. Legacy weekly chain

```
Sunday 16:00 ET polling.php
  → NTLM download (threads, password-grouped)
  → insertFiles          MassMail_RAW / OR2_Raw
  → extractFiles         3 CSVs (new / late / massmail)
  → [AccuZIP, polled every 6 min]
  → parseFiles           NewCustomers / LateCustomers / massmail parse
  → scan_lapsed
  → generate_nll.php     LapsedCustomers + email press
  → frequent stub
  → weeklyMailROI.php    email HTML notice
  → nllROIReporter.php   DB columns, end_time
```

**Report week for extract/parse:**

```php
$previous_week = strtotime("-1 week +1 day");
$beginning = strtotime("last sunday midnight", $previous_week);
$end = strtotime("next saturday 11:59:59 pm", $beginning);
```

**Coupling:** AccuZIP files are campaign-typed. NLL and ROI cannot start until all three `*_valid.txt` exist and parse flags are set. Classification is **written** into tables.

**Progress UI:** coarse percent from watchdog flags (`v2/index.php`).

---

## 3. SST daily chain

```
1:00 AM ET DailyDownloadCron (chainNext: true)
  window = last completed report-week Sunday → yesterday ET

DownloadFileWorkflow
  FetchStores (same BBI API)
  Map stores → list Pulse dir → download missing tabs → S3 + file_list
  skip pulse_version=4 (push already uploaded)

LegacyIngestWorkflow
  Map pending file_list → parse tabs
  INSERT IGNORE MassMail_RAW / OR2_Raw
  INSERT IGNORE mailing_addresses (MMC streets, is_valid=0)

AddressValidateWorkflow
  stores with unvalidated mailing_addresses
  export CSV → SQS WaitForTaskToken → AccuZIP → ApplyPostalData

LegacyNllGenerateWorkflow   (optional same night)
  window = last completed Sun 00:00 ET → Sat 23:59:59 ET
    (not the download window; e.g. Thu 09/17 or Sun 09/13 → 09/06–09/12)
  SQL get_new/late/lapsed_customers
  merge TSV → Excel → Slack
  stamp watchdog completed
```

Parallel ingress: **`POST /upload`** unzip → require `CUS_*` + `OR2_*` → write MMC (late if delivery > 30 minutes default) + OR2 → `file_list` not yet ingested. Next ingest Map picks them up.

NFocus: S3 event → truncate/reload saturation tables. Independent of Pulse.

---

## 4. Stage comparison

| Stage | Old | New |
|---|---|---|
| Cadence | Weekly mega-job | Daily download+ingest+validate; NLL anytime |
| Orchestration | `polling_processes` + 6-min PHP + `process_lock` | Step Functions Distributed Map + `chainNext` |
| Fan-out | Password-grouped PID ranges | Store / file / unvalidated-store JSONL |
| Raw tables | `*_Raw` | Same + required `MassMail_RAW.filename` UK |
| Postal identity | Buried in campaign tables | `mailing_addresses` |
| AccuZIP | 3 campaign files | 1 unvalidated-address file |
| New/Late/Lapsed | INSERT after parse | SELECT at report time |
| NLL | End of chain; Gmail | HTTP/Slack/optional chain |
| Mail ROI / NLL ROI | Always after NLL | Not ported; enums reserved |
| Idempotency | Skip known `file_list.filename` | Same + ingest flags + insert-ignore UKs |
| Push stores | Zip on nwk1 disk; Apollo still polled unless excluded | `/upload` synthesis; download excludes v4 |

---

## 5. New / Late / Lapsed rules (SST = PHP parity)

Canonical SQL: `projects/bbi-sst/docs/queries/report_procedures.sql`.

Join:

```
MassMail_RAW
  ⨝ mailing_addresses
      ON store_number
     AND old_address = Street
     AND pulse_profile_id = CustomerProfileID::text
     AND is_invalid = false
WHERE is_valid = 1
```

Windows: `p_start_date` / `p_end_date` converted with `AT TIME ZONE 'America/New_York'` because RAW epochs are ET wall-clock.

Join still requires `pulse_profile_id` so AccuZIP rows attach. After the join, cohort identity is the household `(store_number, address, zip5)`, not Pulse `CustomerProfileID`.

| Function | Rule |
|---|---|
| `get_new_customers` | New if `FirstOrderDate` is in the window and no `MassMail_RAW` at that address has `FirstOrderDate` in `[this FirstOrderDate − grace, this FirstOrderDate)`. Address match is PHP `LIKE`; K does not require the same Pulse profile. Grace default **180** days / `custom_stores.new_customer_grace` |
| `get_late_customers` | `LastLateOrderDate` in window, one row per household; `new_keys` exclusion uses the household New rule |
| `get_lapsed_customers` | PHP first-mail scan: last two `LastOrderDate`s on the certified household, calendar gap **28–180** days, `last + gap` inside the report window; skip New/Late this week. No `MassMail.lapsed` column. |

Used by NLL workflow, HTTP customer APIs, Slack commands. **Do not** write campaign tables during AccuZIP apply.

---

## 6. AccuZIP filenames

| World | Input | Output |
|---|---|---|
| Legacy weekly | `NewCustomer_Export.csv`, `LateCustomer_Export.csv`, `MassMail_Export.csv` | `newcustomer_valid.txt`, `latecustomer_valid.txt`, `massmail_valid.txt` |
| SST / EC2 | `accuzip/postal_validate/API_MassMail_Export.csv` | NAS `api_massmail_valid.txt` → S3 `api_massmail_valid_<unix>.txt` |

Live suffix is `_valid.txt`, not `_validated.txt`.

EC2 copies NAS → local watch dir every 5 minutes (`bbi-accuzip-api` README).

---

## 7. Pulse file names

| Kind | Example |
|---|---|
| MMC poll | `mmc_00042_20260802_MassMailCustInfo.tab` |
| MMC push synth | `mmc_01262_20250302_da_20250303_100502_MassMailCustInfo.tab` |
| OR2 | `OR2_00042_20260802_OrdersDump.tab` |
| Push zip (incoming) | `[{uniqid}-]{store}_{YYYYMMDD}_{YYYYMMDD}_{HHMMSS}.zip` — **no** `_da_` |

S3 keys: `MailData/{filename}`, `OrderData/{filename}` (`pulseTabS3Key`).

---

## 8. Failure and resume

| Old | New |
|---|---|
| Stale thread > 30 min → pkill + respawn | Store `success=2`; later Maps skip failed stores |
| `process_lock` stuck → whole processor exits | SFN Catch + `SyncFailedSfnExecutionsCron` every 15 min |
| Re-run Sunday | `watchdogId` + `pendingOnly` resume; `POST /api/files/reingest` |
| AccuZIP hang = 6-min no-op forever | WaitForTaskToken 7d; daemon 3h job timeout → `SendTaskFailure` |

---

## 9. Cross-host calls during a run

**Legacy**

1. Apollo → nwk1 `pollingInfoRequest`
2. Extract/parse/NLL → nwk1 `nllProvider`
3. Non-numeric NLL → Athena `nllRequest`
4. Dashboard → Apollo `pollingStatus` / `pollingList`

**SST**

1. Lambda → nwk1 `pollingInfoRequest` / `nllProvider` (SSM URL + auth)
2. Lambda → Pulse via SOCKS/NTLM (VPC)
3. Step Functions → SQS → EC2 AccuZIP → S3 → `SendTaskSuccess`
4. Dashboard `/sys` → API Gateway `/api/runs` `/api/jobs`
5. Slack → API Gateway `/slack/*`
