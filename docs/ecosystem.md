# Ecosystem map

How the moving parts relate. Start here only if you need a **one-page** picture; then follow links.

```
                    GLS Pulse stores
                           │ NTLM :59101
            ┌──────────────┼──────────────┐
            │              │              │
         Apollo         SST download   Push zip
      (PHP weekly)     (daily SFN)    upload.bbimarketing.com
            │              │              │
            └──────┬───────┴──────S3/MySQL/Postgres
                   │
              AccuZIP VM (NAS)
                   │
         NLL press + ROI PHP     SST NLL Slack
                   │                    │
                   ▼                    ▼
         Gmail  donotreply@      Slack + /sys
                   │                    │
                   └────────┬───────────┘
                            ▼
              Employees on system.bbimarketing.com
                   /new  CRM + Apollo widgets
                   /sys  SST runs
```

| Need | Doc |
|---|---|
| Why SST exists | [overview.md](overview.md) |
| What Apollo did | [legacy-system.md](legacy-system.md) |
| What SST does | [bbi-sst.md](bbi-sst.md) |
| What AMs click | [employee-use-cases.md](employee-use-cases.md) |
| What hits the inbox | [email-reports.md](email-reports.md) |
| Gap vs done | [coverage-matrix.md](coverage-matrix.md) |
| Hosts / VPN | [system-topology.md](system-topology.md) |
| Repo list | [applications.md](applications.md) |

**SST replaces the left-hand Pulse engine, not the CRM box in the middle.**
