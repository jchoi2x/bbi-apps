---
name: sync-accuzip-bastion
description: Copy projects/bbi-accuzip-api onto the BBI bastion and restart systemd unit bbi-accuzip-api. Use when the user asks to sync, copy, deploy, or push the AccuZIP watcher to the bastion, or to restart bbi-accuzip-api after a code change.
---

# Sync bbi-accuzip-api to the bastion

Local tree: `/Users/jchoi/Documents/dev2/BBI/bbi-apps/projects/bbi-accuzip-api`. Remote tree: `/home/ec2-user/bbi-accuzip-api`. Service: `bbi-accuzip-api` (`uv run app/accuzip_watchdog.py`). Connection: [connect-bastion](../connect-bastion/SKILL.md).

Do this only when the user asked to sync or restart. Do not guess the bastion IP. Never print `systemctl cat bbi-accuzip-api`; the unit file contains AWS keys.

## Sync

From `projects/bbi-tf`, resolve the IP, then rsync the project. `--delete` applies only to files that are not excluded. Leave the SQLite job table, the log, and the watched validated file in place.

```bash
cd /Users/jchoi/Documents/dev2/BBI/bbi-apps/projects/bbi-tf
BASTION_IP=$(terraform output -raw bastion_public_ip)
rsync -az --delete \
  --exclude '.git/' \
  --exclude '.venv/' \
  --exclude '.agents/' \
  --exclude '__pycache__/' \
  --exclude '*.pyc' \
  --exclude 'db.sqlite' \
  --exclude 'db.sqlite-*' \
  --exclude 'file_changes.log' \
  --exclude 'postal_data/' \
  --exclude '.env' \
  -e "ssh -i $HOME/.ssh/bbi-kafka -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15" \
  /Users/jchoi/Documents/dev2/BBI/bbi-apps/projects/bbi-accuzip-api/ \
  "ec2-user@${BASTION_IP}:/home/ec2-user/bbi-accuzip-api/"
```

If `terraform output` errors or prints `null`, stop. Do not guess the IP. Do not run `terraform apply` or `terraform destroy`.

A one-file copy is only for a change the user named. Same SSH options, destination under `/home/ec2-user/bbi-accuzip-api/`.

## Restart

Python does not reload on its own. After a successful sync:

```bash
ssh -i ~/.ssh/bbi-kafka \
  -o BatchMode=yes \
  -o StrictHostKeyChecking=accept-new \
  -o ConnectTimeout=15 \
  "ec2-user@${BASTION_IP}" \
  'sudo systemctl restart bbi-accuzip-api && systemctl is-active bbi-accuzip-api'
```

Confirm startup. Do not dump the unit file or a long journal.

```bash
ssh -i ~/.ssh/bbi-kafka \
  -o BatchMode=yes \
  -o StrictHostKeyChecking=accept-new \
  -o ConnectTimeout=15 \
  "ec2-user@${BASTION_IP}" \
  'sudo journalctl -u bbi-accuzip-api -n 30 --no-pager | grep -E "Starting AccuZip|Observer started|Traceback|Error"'
```

`active` plus `Starting AccuZip validated output watcher` and `Observer started watching` is success. A traceback is not.

Restart clears the in-memory checksum of `postal_data/api_massmail_valid.txt`. The next copy of that file is treated as new content. Rows in `validation_jobs` survive. Do not delete them as part of a sync.
