---
name: connect-bastion
description: SSH to the BBI temporary bastion (BBI-Temp-Bastion, Amazon Linux 2023, user ec2-user) to diagnose VPC, RDS, VPN, SQS, or Step Functions issues and run commands on that host. Use when the user asks to connect to the bastion, check something from inside the VPC, or diagnose an issue that needs the bastion. Resolve the public IP with `terraform output -raw bastion_public_ip` in projects/bbi-tf, then `ssh -i ~/.ssh/bbi-kafka ec2-user@$BASTION_IP`.
---

# Connect to the BBI bastion

The bastion is the EC2 instance `BBI-Temp-Bastion` in `projects/bbi-tf` (region `us-east-2`). It has a public IP and sits in the VPC, so use it for checks that cannot run from the laptop (private RDS, on-prem routes over the site-to-site VPN, instance IAM).

## Connect

From `projects/bbi-tf`:

```bash
cd /Users/jchoi/Documents/dev2/BBI/bbi-apps/projects/bbi-tf
BASTION_IP=$(terraform output -raw bastion_public_ip)
ssh -i ~/.ssh/bbi-kafka ec2-user@$BASTION_IP
```

For a one-shot command (do not open an interactive shell):

```bash
ssh -i ~/.ssh/bbi-kafka \
  -o BatchMode=yes \
  -o StrictHostKeyChecking=accept-new \
  -o ConnectTimeout=15 \
  ec2-user@$BASTION_IP 'command'
```

If `terraform output` errors or prints `null`, stop and say so. Do not guess the IP. Do not run `terraform apply`, `terraform destroy`, or any other Terraform write.

Fallback only when Terraform state is unavailable: look up the running instance tagged `Name=BBI-Temp-Bastion` in `us-east-2` and use its public IP.

## What the host can reach

- Private RDS MySQL and PostgreSQL (and their RDS proxies). `mariadb105` is installed. Endpoint names from Terraform: `rds_endpoint`, `rds_proxy_endpoint`, `rds_postgres_endpoint`, `rds_postgres_proxy_endpoint`.
- Office LAN `192.168.4.0/24` over the site-to-site VPN, including Apollo gost SOCKS5 on port `1080`.
- Instance role `bbi-bastion-ssm-role`: SSM core, `states:SendTaskSuccess` / `SendTaskFailure` / `SendTaskHeartbeat`, and SQS receive/send/delete/visibility.
- A Python app listens on port `8765` (private URL in SSM `/bbi/bastion/python-app-url`). Leave it running.

Kafka (`kafka_private_ip`) is a different instance. This key also opens it, but only SSH there when the user asked about Kafka.

## Running work on the user's behalf

1. Resolve `BASTION_IP` as above.
2. Run the smallest remote command that answers the question. Quote it so the laptop shell does not expand it.
3. Prefer read-only checks: `nc`/`curl` to a host:port, process and disk status, `aws` describe/get calls, log tails.
4. Change remote state only when the user explicitly asked for that change (restarts, `SendTaskSuccess` / `SendTaskFailure`, SQS deletes, SQL writes).
5. Report the command, the exit status, and the relevant output. Omit secrets.

## Secrets

Never print, copy into docs, or commit DB passwords, `terraform.tfvars` values, VPN preshared keys (`vpn_tunnel1_preshared_key`, `vpn_tunnel2_preshared_key`), or the contents of `~/.ssh/bbi-kafka`. If a database check needs a password, use one the user already supplied in the environment and do not echo it.
