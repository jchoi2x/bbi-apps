# Project: nwk1 legacy site root

**Host:** nwk1 `/var/www/system.bbimarketing.com/` **outside** `/new` and `/sys`.  
**PHP:** nginx default is **5.6 FPM**.

Older hotel/reorder/pobuilder/kobuilder/vacation flows. Sidebar “Vacation” still links here. Some CLI Excel exporters live under site-root `cli/` and include `/new/config/mailClient.inc`.

## Constraints

- **Do not break** shared session cookies used by `/new/` (`sysData` on `.bbimarketing.com`). Legacy may also use older cookie names — do not assume one auth for all PHP on the vhost.
- Prefer putting new employee features on `/new` or `/sys`, not the root app.
- ETL/warehouse work does **not** belong here; that is Apollo or `bbi-sst`.

See [projects/bbi-nwk1-new.md](bbi-nwk1-new.md) for the AdminLTE app employees use daily.
