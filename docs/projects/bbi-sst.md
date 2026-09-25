# Project: `bbi-sst`

**Primary docs:** [bbi-sst.md](../bbi-sst.md) (purpose, architecture, HTTP).  
**Coverage vs employees:** [coverage-matrix.md](../coverage-matrix.md).  
**In-repo:** `projects/bbi-sst/README.md`, `docs/how-it-works.md`.

## Constraints

- AWS SST Ion (Bun/TypeScript). Does **not** create RDS or the S3 bucket; links existing SSM/VPC.
- Fan-out unit is store / `file_list` row / unvalidated store — not PHP `polling_processes`.
- NLL TSV column order is a mail-vendor contract (`NLL_TSV_COLUMNS`). Do not reorder.
- `MassMail_RAW` epochs are America/New_York wall-clock. Report SQL must use `AT TIME ZONE 'America/New_York'`.
- AccuZIP production path is SQS FIFO + `WaitForTaskToken`, not HTTP `POST /exports`.
- Push zip names are **not** `_da_`; `_da_` is on synthesized tabs.
- `/new` polling UI still reads **Apollo** unless you are editing `/sys`.
- Do not copy SSM/DB secrets into source or these docs.
- If ingest or NLL output shape changes, verify `/new` and `/sys` consumers first ([employee-use-cases.md](../employee-use-cases.md)).
