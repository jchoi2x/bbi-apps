---
emoji: 📋
name: Suggest Backlog
description: Assess BBI project status and file Suggestion or Bug cards into Backlog
intent: Keep the BBI Agent Board Backlog stocked with reviewed suggestions without starting Pickup Todo or touching SST/NLL work
on:
  schedule:
    - cron: "15 9 * * 1,3,5"
      timezone: America/New_York
  workflow_dispatch:
    inputs:
      notes:
        description: Optional focus for this assessment (omit for a full board review)
        required: false
        type: string
  status-comment: true
  cooldown: 12h
if: ${{ vars.BBI_AGENT_BOARD_URL != '' }}
permissions:
  contents: read
  issues: read
  pull-requests: read
  actions: read
  copilot-requests: write
timeout-minutes: 25
concurrency:
  group: suggest-backlog
  job-discriminator: ${{ github.run_id }}
env:
  BBI_AGENT_BOARD_URL: ${{ vars.BBI_AGENT_BOARD_URL }}
  ASSESS_NOTES: ${{ github.event.inputs.notes }}
tools:
  github:
    mode: gh-proxy
    toolsets: [default, projects]
    github-token: ${{ secrets.GH_AW_READ_PROJECT_TOKEN }}
safe-outputs:
  create-issue:
    labels: [automation]
    allowed-labels: [suggestion, enhancement, bug, automation]
    allowed-fields: [Status]
    max: 3
    deduplicate-by-title: true
  update-project:
    github-token: ${{ secrets.GH_AW_WRITE_PROJECT_TOKEN }}
    project: https://github.com/users/jchoi2x/projects/<BBI_AGENT_BOARD>
    max: 3
    views:
      - name: Agent Board
        layout: board
        filter: is:issue
---

# Suggest Backlog

Assess current BBI work and file **zero to three** new cards on the BBI Agent Board. Cards must land in **Backlog**. This workflow does **not** implement tickets and must never start Pickup Todo.

## Board

Project URL: `${{ env.BBI_AGENT_BOARD_URL }}`

View: [BBI Agent Board](https://github.com/users/jchoi2x/projects/2/views/1)

Status values (exact): `Backlog` | `Todo` | `In Progress` | `In Review` | `Done`

Pickup Todo (`.github/workflows/pickup-todo.md`) claims **Todo** cards. Do not create, move, or label anything as Todo. Do not add `agent-todo` or `agent-enqueued`.

Optional dispatch notes: `${{ env.ASSESS_NOTES }}`

## Assess first

Read before writing. Use the GitHub `projects` toolset plus repository checkout.

1. Open issues in `jchoi2x/bbi-apps` (titles, labels, bodies).
2. Board items and Status counts for Backlog / Todo / In Progress / In Review / Done.
3. Recent pull requests (open, draft, merged) and recent commits on `main`.
4. Known workstreams in-repo: `docs/` (especially `docs/coverage-matrix.md`, `docs/README.md`, `docs/bbi-sst.md`), `.github/workflows/`, `.github/ISSUE_TEMPLATE/`. Treat SST ingest, NLL generate/report, and LegacyParse as **protected active work** — suggest around them, never “stop”, “replace in place”, or “kill” those pipelines.

Write a short private assessment (do not put secrets in it): what is moving, what is stuck, what is missing that a human would want on Backlog.

## When to file nothing

Call `noop` with a short reason when:

- `BBI_AGENT_BOARD_URL` is empty
- the board already has **5 or more** open Backlog cards and there is no new, distinct bug
- every idea duplicates an open issue or an existing board item (same outcome, even if the title differs)
- the only ideas would implement SST/NLL/LegacyParse, change submodule SHAs, or edit `.gitmodules`
- dispatch notes ask for implementation (this workflow never implements)

Prefer **0–1** new cards when Backlog already has open items. Use the max of 3 only when Backlog is empty and each card is a different, actionable gap.

## Cards to create

Use the existing issue templates. Do not invent a third template.

**Suggestion card** (`.github/ISSUE_TEMPLATE/suggestion.yml`):

- Title starts with `[suggestion] `
- Labels: `suggestion`, `enhancement`, `automation`
- Body headings exactly:

```
### Kind

<Feature | Improvement | Docs / workflow | Other>

### What should we do?

<one or two sentences; this is the future Pickup Todo prompt>

### Done when

<observable checks that do not need production writes>

### Area

<Umbrella docs / GitHub automation (this repo) | nwk1 /new dashboard | Apollo / vpn.bbimarketing.com | AccuZIP / files | Other (describe below)>

### Out of scope / do not touch

Do not change SST/NLL pipeline code or submodule SHAs unless this card is explicitly about that area and has been reviewed.
```

**Bug card** (`.github/ISSUE_TEMPLATE/bug.yml`):

- Title starts with `[bug] `
- Labels: `bug`, `automation`
- Body headings exactly:

```
### Expected

### Actual

### How to see it

### Area

<Umbrella docs / GitHub automation (this repo) | nwk1 /new dashboard | Apollo / vpn.bbimarketing.com | AccuZIP / files | Other>

### Out of scope

Do not change SST/NLL pipeline code or submodule SHAs unless this card is explicitly about that area.
```

Prefer **Suggestion** cards for docs / `.github` / umbrella gaps Pickup Todo can later implement. Use **Bug** only for a concrete, observable defect.

After each `create-issue`:

1. Include `fields: [{"name": "Status", "value": "Backlog"}]`.
2. `update-project` on that issue: Status **`Backlog`** only. Always include `project: ${{ env.BBI_AGENT_BOARD_URL }}`.

Never set Status to `Todo`, `In Progress`, `In Review`, or `Done`. Never open a pull request. Never edit repository files. Never merge. Never print or paste secrets, tokens, passwords, cookies, or key material into issue titles or bodies.

## Quality bar

Each card must be:

- Actionable in this umbrella repo or clearly labeled as a human-scoped area
- Distinct from open issues and from the last two weeks of PRs
- Small enough that “Done when” can be checked without Apollo/MySQL writes
- Explicit that SST ingest, NLL generate/report, LegacyParse, and live pipeline jobs stay running

Do not file “rewrite the pipeline”, “stop staging”, or secret-rotation cards that would need credential values in the issue.

## Safe outputs

Use only the configured safe outputs (`create-issue`, `update-project`, `noop`). If you create no issues, call `noop`.
