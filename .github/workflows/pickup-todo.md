---
emoji: ▶️
name: Pickup Todo
description: Claim a Todo board card, move it In Progress, implement it, open a PR, then move it to In Review
intent: When a BBI Agent Board card is ready in Todo, a gh-aw agent starts the work and walks the card across the board
on:
  schedule: every 5 minutes
  workflow_dispatch:
    inputs:
      issue_number:
        description: Issue number to pick up (optional; omit to claim the oldest Todo card)
        required: false
        type: string
  issues:
    types: [labeled]
  labels: [agent-todo]
  status-comment: true
  cooldown: 5m
if: ${{ vars.BBI_AGENT_BOARD_URL != '' }}
permissions:
  contents: read
  issues: read
  pull-requests: read
  actions: read
  copilot-requests: write
timeout-minutes: 45
concurrency:
  group: pickup-todo
  job-discriminator: ${{ github.run_id }}
env:
  BBI_AGENT_BOARD_URL: ${{ vars.BBI_AGENT_BOARD_URL }}
tools:
  github:
    mode: gh-proxy
    toolsets: [default, projects]
    github-token: ${{ secrets.GH_AW_READ_PROJECT_TOKEN }}
safe-outputs:
  update-project:
    github-token: ${{ secrets.GH_AW_WRITE_PROJECT_TOKEN }}
    project: https://github.com/users/jchoi2x/projects/<BBI_AGENT_BOARD>
    max: 2
    views:
      - name: Agent Board
        layout: board
        filter: is:issue
  add-comment:
    max: 1
  add-labels:
    allowed: [agent-enqueued]
    max: 1
  create-pull-request:
    title-prefix: "[agent-board] "
    labels: [automation]
    draft: true
    max: 1
    allowed-files:
      - "docs/**"
      - ".github/**"
      - ".cursor/**"
      - "README.md"
      - ".gitattributes"
      - "bbi-apps.code-workspace"
    protected-files: fallback-to-issue
---

# Pickup Todo

Claim one ready card from the BBI Agent Board and implement it in this umbrella repo.

## Board

Project URL: `${{ env.BBI_AGENT_BOARD_URL }}`

Status values (exact): `Backlog` | `Todo` | `In Progress` | `In Review` | `Done`

This workflow is the agent. Do not invent another dispatcher. Do not call external agent APIs.

## Activation

Pick **one** issue, in this order:

1. `workflow_dispatch` input `issue_number` when set
2. The triggering issue when this run is an `issues.labeled` `agent-todo` event
3. The oldest **open** project item whose Status is `Todo` and that does not have label `agent-enqueued`

Call `noop` with a short reason when:

- `BBI_AGENT_BOARD_URL` is empty
- no matching Todo / dispatch / labeled issue exists
- the candidate is already `In Progress`, `In Review`, or `Done`
- the candidate already has `agent-enqueued`
- the ticket requires edits under `projects/bbi-sst`, NLL generate/report pipelines, LegacyParse, submodule SHAs, or `.gitmodules`

## Required effects (only after a valid candidate)

1. `update-project`: set Status to `In Progress` on that issue. Always include `project: ${{ env.BBI_AGENT_BOARD_URL }}`.
2. `add-labels`: add `agent-enqueued`.
3. `add-comment`: say this gh-aw run claimed the card and link `${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}`.
4. Implement the smallest change that satisfies the issue. Stay in allowed files. Prefer docs and `.github` over speculative refactors.
5. `create-pull-request` as a draft. Body must reference `Fixes #<issue>` and summarize what changed.
6. `update-project`: set Status to `In Review`.

Do not merge. Do not change Apollo/MySQL data. Do not print secrets.

## Safe outputs

Use only the configured safe outputs. If you take no write action, call `noop`.
