# BBI Marketing — System Documentation

This directory is the canonical documentation for **BBI Marketing’s data platform**: what the company does, how the on-prem PHP systems have been used, and how **`bbi-sst`** (AWS SST / Step Functions) replaces the Pulse ETL, mailing-list generation, and related reporting that employees currently run through `system.bbimarketing.com` and Gmail.

**Status as of 2026-08-30.** Live production still runs the Apollo PHP weekly job. SST is deployed in AWS and is the target replacement for that pipeline. Where SST does not yet cover a use-case, this set says so explicitly.

---

## Who this is for

| Audience | Start here |
|---|---|
| Engineer joining the platform | [Overview](overview.md) → [Glossary](glossary.md) → [bbi-sst](bbi-sst.md) |
| Product / ops asking “what does SST replace?” | [Coverage matrix](coverage-matrix.md) |
| Someone who lives in the dashboard | [Employee use-cases](employee-use-cases.md) |
| Someone who lives in the weekly emails | [Email reports](email-reports.md) |
| Someone debugging Pulse / AccuZIP / NLL | [Data pipeline](data-pipeline.md) → [Data model](data-model.md) |

---

## Read in this order

1. **[Overview](overview.md)** — Business, systems, and why `bbi-sst` exists.
2. **[Glossary](glossary.md)** — NLL, Pulse, MMC, OR2, AccuZIP, watchdog, and related terms.
3. **[Legacy system](legacy-system.md)** — Apollo PHP: what it did, when it ran, how employees used it.
4. **[bbi-sst](bbi-sst.md)** — Purpose, architecture, workflows, HTTP, Slack, cron.
5. **[Employee use-cases](employee-use-cases.md)** — Every dashboard workflow that touches Pulse data, plus CRM that does not.
6. **[Email reports](email-reports.md)** — Automated and on-demand Gmail reports.
7. **[Coverage matrix](coverage-matrix.md)** — Use-case → SST status (replaced / partial / planned / out of scope).
8. **[Data pipeline](data-pipeline.md)** — Old weekly chain vs new daily chain.
9. **[Data model](data-model.md)** — nwk1 CRM, Apollo MySQL, SST Postgres.
10. **[API directory](api-directory.md)** — HTTP contracts employees and systems actually call.
11. **[Applications](applications.md)** — Repo / host inventory.
12. **[System topology](system-topology.md)** — Networks, hosts, Phase 1 cloud.

Existing files kept in place:

- [infrastructure.md](infrastructure.md) — ASCII current vs Phase 1 diagrams.
- [projects/bbi-nwk1-new.md](projects/bbi-nwk1-new.md) — Deep dive on `/new` (AdminLTE dashboard).

---

## Project pointers (workspace routing)

These files exist so code work can be routed to the right constraints:

| Path | Project |
|---|---|
| [projects/bbi-sst.md](projects/bbi-sst.md) | AWS SST pipeline |
| [projects/apollo.md](projects/apollo.md) | On-prem Pulse ETL (`vpn.bbimarketing.com`) |
| [projects/bbi-nwk1-legacy.md](projects/bbi-nwk1-legacy.md) | Legacy PHP site root on nwk1 |
| [projects/bbi-nwk1-new.md](projects/bbi-nwk1-new.md) | `/new` dashboard |

Implementation-level specs live in the submodule:

- `projects/bbi-sst/README.md`
- `projects/bbi-sst/docs/how-it-works.md`
- `projects/bbi-sst/docs/queries/report_procedures.sql`

---

## Scope of `bbi-sst`

`bbi-sst` is **not** a rewrite of the entire BBI CRM. It replaces the **Pulse data engine** and the reports that engine feeds:

| In scope | Out of scope (stays on `/new`) |
|---|---|
| Download Pulse MMC / OR2 tabs | Hotel calling, approvals, gift certificates |
| Ingest into warehouse tables | Art tasks, proofing, print job manager |
| AccuZIP CASS validation | UPS / ShipStation shipping |
| New / Late / Lapsed lists (NLL) | Invoices, employees, file hosting |
| Saturation counts / reports | Client CRM records (franchisee, store, hotel) |
| Polling run observability | Session auth, AdminLTE chrome |
| (Planned) mail ROI and NLL ROI | School calling, social creatives as a CMS |

The CRM at `https://system.bbimarketing.com/new/` remains the system of record for **who** BBI’s clients are, **which stores** have Pulse credentials, **NLL campaign settings**, and **mail job logistics**. SST is the system of record for **what Pulse said this week** and **which addresses are mailable**.

---

## Conventions used in this set

- **nwk1** — public VPS hosting `system.bbimarketing.com`.
- **Apollo** — Tampa office VM hosting `vpn.bbimarketing.com` and the PHP Pulse poller.
- **Athena** — Tampa warehouse for non-Domino’s brands (Vocelli, Marco’s, Flyers).
- **SST** — `projects/bbi-sst`, AWS us-east-2.
- **Satisfied** in the coverage matrix means the employee’s *outcome* is available from SST (possibly via `/sys`, Slack, or HTTP), not that the old PHP page is deleted.
- Shared-secret tokens that appear in PHP are **not** copied into these docs.
