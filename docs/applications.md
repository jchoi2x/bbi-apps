# Applications inventory

Umbrella repo: `bbi-apps` (git submodules under `projects/`). Live PHP is **not** containerized.

---

## Employee-facing

| App | Where | Stack | Role |
|---|---|---|---|
| **System `/new`** | nwk1 `https://system.bbimarketing.com/new/` | PHP 8.2 + AdminLTE 2 | CRM + Pulse UI + mail jobs. Git: Bitbucket `new-system`; submodule `projects/bbi-dashboard`. |
| **System `/sys`** | nwk1 `https://system.bbimarketing.com/sys/` | PHP shell + React/AG Grid via esm.sh | SST Workflow Runs + Stores. Same `sysData` cookie. |
| **Legacy site root** | nwk1 `/` (vacation, older builders) | PHP 5.6 FPM | Older hotel/reorder flows; still referenced from sidebar. |
| **Upload** | `https://upload.bbimarketing.com` | nwk1 vhost **and** CF Worker | Pulse 4.0 zip drop → SST `/upload`. |
| **Slack bot** | SST API Gateway `/slack/*` | Bolt on Lambda | `/nll_report`, cohort queries. |

---

## Data engines

| App | Where | Role |
|---|---|---|
| **Apollo Pulse ETL** | `192.168.4.26` `/var/www` | Weekly PHP poller (Sun 16:00 ET), 6-min processor, warehouse HTTP, NLL email. Also hotel-key index (weekday 15:45) and media-mix SFTP (daily 11:00). Mirrors: `projects/apollo`, `projects/bbi-cron-php`. Crontab: [projects/apollo.md](projects/apollo.md). |
| **bbi-sst** | AWS us-east-2 | Daily Step Functions pipeline. `projects/bbi-sst`. |
| **Athena** | `192.168.4.24` | Vocelli / Marco’s / Flyers warehouse. Not mirrored in this repo. |
| **bbi-accuzip-api** | EC2 (NAS to AccuZIP VM) | SQS FIFO + `SendTaskSuccess`. `projects/bbi-accuzip-api`. |
| **Apollo AccuZIP HTTP** | apollo `api/accuzip/` + python watchdog | Legacy/on-prem CASS API; systemd `accuzip-watchdog.service` still active. |

---

## Infra / adjacent

| App | Repo | Role |
|---|---|---|
| **bbi-tf** | `projects/bbi-tf` | Cloudflare DNS/Workers (upload proxy), AWS Terraform. |
| **RocketShipIt** | apollo `:27015` | UPS rates/labels for `/new` shipping pages. |
| **AccuZIP VM** | `192.168.4.30` | Windows CASS; share `maiL_data`. |
| **render-vm** | `192.168.4.29` | Print/render. |
| **Artemis NAS** | `192.168.4.25` | `bbi-files`, `mail-exchange`. |

---

## What `bbi-sst` is vs is not

| Is | Is not |
|---|---|
| Replacement for Apollo **Pulse download → ingest → AccuZIP → NLL** | Replacement for `/new` CRM |
| API for `/sys` and Slack | The Gmail mailer (yet) |
| Owner of mailing **facts** in Postgres | Owner of franchisee **records** in `bbi_system` |
| Ingress for `upload.bbimarketing.com` zips | Athena Vocelli engine |

---

## Git layout (umbrella)

| Path | Remote |
|---|---|
| `projects/bbi-sst` | github.com/BBIMarketing/bbi-sst |
| `projects/bbi-cron-php` | github.com/BBIMarketing/bbi-cron-php |
| `projects/bbi-accuzip-api` | github.com/BBIMarketing/bbi-accuzip-api |
| `projects/bbi-dashboard` | github.com/BBIMarketing/bbi-dashboard |
| `projects/bbi-tf` | Terraform / Workers |
| `projects/apollo` | rsync of apollo `/var/www` |
| `projects/nwk1` | rsync of nwk1 `/var/www` |

See root `README.md` for submodule clone commands.
