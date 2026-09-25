# System topology

ASCII diagrams for current vs Phase 1 cloud: [infrastructure.md](infrastructure.md).  
This page is the **named inventory** (hosts, networks, nginx, MySQL) used when routing work.

Inspection snapshot: 2026-08-30 via `ssh nwk1` and `ssh apollo`. Local rsync: `projects/nwk1/system.bbimarketing.com`, `projects/apollo`.

---

## Hosts

| Role | Host | Addresses | SSH | Stack (live) | Workspace |
|---|---|---|---|---|---|
| Frontend VPS | **nwk1** | Public `198.74.60.204`; Linode private `192.168.156.176`; WireGuard `10.14.0.100` (`wg0`) | `5022` | nginx + **PHP 5.6 FPM** (`/run/php/php5.6-fpm.sock`; 8.2 FPM installed; CLI `php` is 8.2). MariaDB `127.0.0.1:3306`. | `projects/nwk1/` |
| Domino’s ETL | **apollo** | LAN `192.168.4.26/24`; GLS `tun0` `10.244.15.246` | `5022` | nginx + **PHP 5.6 FPM**. MySQL `127.0.0.1:3306` + LAN `:13306`. GOST SOCKS `:1080`. RocketShipIt `:27015`. | `projects/apollo/` |
| Non-Domino warehouse | **athena** | LAN `192.168.4.24` | `5022` | nginx, PHP 5 FPM, MySQL | not mirrored |
| Hypervisor / NAS | **artemis** | `192.168.4.25` | — | CIFS `bbi-files`, `mail-exchange` | — |
| AccuZIP VM | **accuzip-vm** | `192.168.4.30` | — | Windows AccuZIP CASS; share `maiL_data` | — |
| Render VM | **render-vm** | `192.168.4.29` | — | Print/render | — |
| SST | **AWS us-east-2** | VPC `172.16.0.0/16` (Phase 1 target) | — | Lambda, SFN, APIGW, S3, RDS Postgres | `projects/bbi-sst/` |
| AccuZIP daemon | **EC2** | (see `bbi-accuzip-api`) | — | Python uv; NAS mount | `projects/bbi-accuzip-api/` |

**nwk1:** `https://system.bbimarketing.com` (legacy + `/new` + `/sys`). Master CRM. Triggers reports against apollo. Hosts `upload.bbimarketing.com` (legacy drop; SST Worker now proxies most uploads).

**apollo:** Pulse poller, `MassMail_RAW` / `OR2_Raw`, AccuZIP handshake, NLL/ROI PHP. Public name `vpn.bbimarketing.com` (Cloudflare → office WAN).

**athena:** Marco’s / Vocelli / Flyers. Callers use `https://192.168.4.24/v2/…` on LAN.

Docker: nwk1 has `docker0` but **no running containers** on inspection. Production PHP is not containerized.

---

## Networks

```
GLS / Domino's 10.x / 100.x :59101 (NTLM HTTP PulseWeb)
        ↑
 OpenConnect tun0 on apollo
        │
Tampa LAN 192.168.4.0/24
 gateway 192.168.4.1
 WAN gateway.bbimarketing.com = 47.198.214.106
 apollo .26 ↔ athena .24
 artemis .25  accuzip-vm .30  render-vm .29
        ↑
 WireGuard 10.14.0.0 (nwk1 = 10.14.0.100)
        │
nwk1 198.74.60.204
 /etc/hosts: 192.168.4.26 vpn.bbimarketing.com
```

| Name | Resolves / used as |
|---|---|
| `system.bbimarketing.com` | nwk1 public HTTPS |
| `nwk1.nj.bbimarketing.com` | nwk1 hostname |
| `vpn.bbimarketing.com` | Cloudflare → office WAN → apollo `:443` |
| `upload.bbimarketing.com` | nwk1 vhost **and** CF Worker → SST `POST /upload` |
| `gateway.bbimarketing.com` | Office WAN `47.198.214.106` |

Pulse queries: `http://{vpn_ip}:59101/PulseWeb/{EOutbox|EArchive}/` with `CURLAUTH_NTLM`. Traffic leaves apollo on `tun0`. GOST (`192.168.4.26:1080`) is SOCKS for **operators not on GLS**; PHP pollers do not use it. SST download uses VPC SOCKS analog (SSM `/bbi/dev/socks-proxy`).

---

## Nginx (live)

**nwk1:** `client_max_body_size 100M`. `system.bbimarketing.com`: HTTP→HTTPS; root `/var/www/system.bbimarketing.com`; PHP → php5.6-fpm socket for default vhost (`/new` is 8.2 in practice per dashboard doc). `/new/min/` minify rewrite; `/new/api/v2/` `try_files` + `HTTP_AUTHORIZATION`. Deny `.pem|.key|.inc|.json` (`444`).

**apollo:** `client_max_body_size 50M`. HTTP `:80` `/api/` and `/api/accuzip/` php5-fpm (`fastcgi_read_timeout 1800s`); else HTTPS. Cert `vpn.bbimarketing.com`. `.inc` → `444`.

---

## NAS (apollo fstab)

Do not copy share passwords into new files.

| Share | Mount | Purpose |
|---|---|---|
| `//192.168.4.25/bbi-files` | `/media/bbi-files` | Press PDFs / hotel keys — **not** CASS |
| `//192.168.4.25/mail-exchange` | `/media/mail-data` | Archive / AccuZIP settings |
| `//192.168.4.30/maiL_data` | `/media/mail-data-accuzip` | AccuZIP watch dirs |

Symlinks: `/var/www/services/pulse_fetch/mail_data` → accuzip mount; `mail_data_storage` → mail-exchange.

nwk1 has **no** mail-data mounts. Presort is Athena HTTP.

---

## Phase 1 cloud (intent)

When Phase 1 completes: Apollo **EC2** in VPC + RDS MySQL/Postgres + S3, site-to-site IPsec to Tampa for AccuZIP/Athena. SST already occupies the “Lambda + SFN + S3 + RDS Postgres” slice; Pulse reachability still needs VPN/SOCKS into GLS.

See [infrastructure.md](infrastructure.md) Phase 1 diagram.

---

## Guardrails

1. Public `*.bbimarketing.com` vs Tampa `192.168.4.0/24` vs Domino’s GLS vs WireGuard `10.14.0.0`.
2. Changing SST ingest or AccuZIP apply — check `/new` consumers (`pollingStatus`, NLL dates, `mailing_addresses` join keys) and `/sys`.
3. Secrets stay in PHP defines / SSM; never paste CIFS or DB passwords into docs.
