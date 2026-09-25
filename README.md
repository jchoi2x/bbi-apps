# bbi-marketing

Umbrella repo that consolidates BBI projects as [git submodules](https://git-scm.com/book/en/v2/Git-Tools-Submodules) under `projects/`.

| Path | Repo |
| --- | --- |
| `projects/bbi-sst` | [bbi-sst](https://github.com/BBIMarketing/bbi-sst) |
| `projects/bbi-cron-php` | [bbi-cron-php](https://github.com/BBIMarketing/bbi-cron-php) |
| `projects/bbi-accuzip-api` | [bbi-accuzip-api](https://github.com/BBIMarketing/bbi-accuzip-api) |

## Clone with all submodules

Clone the umbrella repo and check out every submodule in one step:

```bash
git clone --recurse-submodules https://github.com/BBIMarketing/bbi-marketing.git
cd bbi-marketing
```

If you already cloned without submodules, initialize and pull them:

```bash
git submodule update --init --recursive
```

To update all submodules to the commits recorded in this repo:

```bash
git pull --recurse-submodules
git submodule update --init --recursive
```
