# Project: Apollo (legacy Pulse engine)

**Host:** `192.168.4.26` / `vpn.bbimarketing.com`. **Workspace:** `projects/apollo` (rsync), `projects/bbi-cron-php` (git).

**Primary docs:** [legacy-system.md](../legacy-system.md), [data-pipeline.md](../data-pipeline.md), [system-topology.md](../system-topology.md).

## Constraints

- Requires **Domino’s VPN** (OpenConnect `tun0`) for Pulse `:59101` NTLM. GOST `:1080` is for humans, not the PHP poller.
- PHP 5.6 FPM. Weekly Pulse chain is the user crontab below (`polling.php` + 6-minute `pollingProcessing.php`).
- AccuZIP is a **NAS file drop**, not an HTTP call, in the weekly job. Wait loop = `file_exists` on the 6-minute tick.
- Dashboard callers mix `vpn.bbimarketing.com` and `192.168.4.26`. Browser POSTs to the LAN IP need VPN.
- Vocelli (`rd_available=3`) is **proxied to Athena** (`192.168.4.24`). Do not “fix” missing MassMail rows for non-numeric stores by querying apollo RAW.
- Shared-secret `auth` must match nwk1 `new/api/index.php`. Rotate both sides together.
- RocketShipIt `:27015` and ZPL `:27016` are **shipping**, colocated on this VM — not part of Pulse ETL.
- Do not copy CIFS or MySQL passwords from `fstab` / `config.inc` into new files.

## Crontab

User crontab on apollo (captured 2026-09-19). Times are the host clock (**Eastern**). These jobs are **not** in `/etc/cron.d` (that tree is only certbot, php5 sessionclean, sendmail).

```
0 16 * * 0 /usr/bin/php5 /var/www/services/pulse_fetch/core/polling.php > /dev/null
*/6 * * * * /usr/bin/php5 /var/www/services/pulse_fetch/core/pollingProcessing.php > /dev/null
45 15 * * 1-5 /usr/bin/php5 /var/www/services/dominos/key_index.php > /dev/null
0 11 * * * /usr/bin/php5 /var/www/v2/customProjects/mediaMixModelCron.php > /dev/null
```

| When | Script | What |
|---|---|---|
| Sunday 16:00 | `polling.php` | Weekly Pulse kickoff (store list from nwk1, spawn download threads). |
| Every 6 minutes | `pollingProcessing.php` | State machine: insert → AccuZIP wait → parse → NLL → ROI. |
| Mon–Fri 15:45 | `key_index.php` | Truncate/rebuild `key_index` from hotel-key PDFs under `/media/bbi-files/Press Ready/4-Color/0-Hotel Keys`. CRM, not Pulse ETL. SST does not replace this. |
| Daily 11:00 | `mediaMixModelCron.php` | Domino’s media-mix CSV (`bbiPrintData-YYYYMMDD*.csv`) → SFTP `filetransfer.dominos.com`. NLL New/Late/Lapsed rows are written only on **Tuesday**; EDDM/saturation rows run every day. SST does not replace this. |
