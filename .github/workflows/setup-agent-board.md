---
emoji: 📋
name: Setup Agent Board
description: Create the BBI Agent Board GitHub Project and file the remaining manual setup steps
intent: Bootstrap the Replit-like Projects board so Todo cards can start Pickup Todo
on:
  workflow_dispatch:
permissions:
  contents: read
  issues: read
  pull-requests: read
  actions: read
  copilot-requests: write
timeout-minutes: 15
tools:
  github:
    mode: gh-proxy
    toolsets: [default, projects]
    github-token: ${{ secrets.GH_AW_READ_PROJECT_TOKEN }}
safe-outputs:
  create-project:
    github-token: ${{ secrets.GH_AW_WRITE_PROJECT_TOKEN }}
    target-owner: jchoi2x
    views:
      - name: Agent Board
        layout: board
        filter: is:issue
  create-issue:
    title-prefix: "[agent-board] "
    labels: [documentation]
    max: 1
---

# Setup Agent Board

Create the user-owned GitHub Project used as the BBI Kanban.

## Task

1. Call `create-project` with:
   - `title`: `BBI Agent Board`
   - `owner`: `jchoi2x`
   - `owner_type`: `user`
2. File **one** `create-issue` whose body includes:
   - the new project URL
   - set repository variable `BBI_AGENT_BOARD_URL` to that URL (Settings → Actions → Variables)
   - add Status options exactly: `Backlog`, `Todo`, `In Progress`, `In Review`, `Done`
   - switch the project to the **Agent Board** board layout (Status as columns)
   - enable built-in Project workflows listed in the issue body (auto-add issues as Backlog; PR opened → In Review; closed/merged → Done; **do not** auto-set new items to Todo)
   - store project tokens as Actions secrets `GH_AW_READ_PROJECT_TOKEN` and `GH_AW_WRITE_PROJECT_TOKEN` (classic PAT scopes `project` + `repo`; do not paste token values)
   - run **Pickup Todo** once with an empty issue number after one card is in Todo

If a project titled `BBI Agent Board` already exists for `jchoi2x`, do not create a second board. Put that existing URL in the issue and call `noop` only if you also created nothing.

If `create-project` fails because this token cannot create user projects, file the issue with that exact GraphQL/API error and the owner-run command:

`gh aw project new "BBI Agent Board" --owner jchoi2x --link jchoi2x/bbi-apps`

## Safe outputs

Use only the configured safe outputs. Call `noop` if the board and setup issue already exist.
