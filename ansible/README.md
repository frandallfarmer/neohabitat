# Neohabitat Ansible

Three idempotent roles to provision and operate the Neohabitat host (`the made` and any future replicas):

| Role | What it owns |
|------|--------------|
| `base`        | apt packages, `themade` user + SSH keys, timezone, unattended-upgrades. UFW left disabled (Azure NSG is the perimeter). |
| `worldsaway`  | Azure / Hyper-V guest agent stack — `walinuxagent`, `hv-*` daemons, `/etc/waagent.conf`. Skipped automatically on non-Azure hosts. |
| `neohabitat`  | Docker engine + compose plugin, `criu`, NodeSource Node 20, the docker-compose stack (mongo / mariadb / elko / qlink / bots), bot consolidation (mask the legacy systemd units), and the `bridge_v2` deploy pipeline (build → ship → SIGHUP). |

## Layout

```
ansible/
  ansible.cfg
  inventory/production.yml      # the made (20.3.249.92)
  group_vars/all.yml            # SSH keys, repo path, deploy mode
  playbooks/
    site.yml                    # full converge
    deploy-bridge.yml           # bridge_v2 only (steady-state push)
  roles/{base,worldsaway,neohabitat}/
```

## Prerequisites (controller)

- Ansible >= 2.14 with `community.general`, `community.docker`, `ansible.posix` collections.
- Go 1.25 toolchain (the bridge_v2 binary is built locally for `linux/amd64` and shipped — Go is **not** installed on the production host).
- `rsync` (for the `synchronize` module).
- SSH key at `~/Downloads/neohabitat_admin.cer` (or update `inventory/production.yml`).

Install collections:
```
ansible-galaxy collection install community.general community.docker ansible.posix
```

## Common operations

```sh
# Dry run against `the made`
ansible-playbook playbooks/site.yml --check --diff

# Full converge (steady-state — bridge upgrade is SIGHUP, sessions survive)
ansible-playbook playbooks/site.yml

# One-shot adoption: cut public :1337 from old Node bridge over to bridge_v2.
# WARNING: ~5s gap on host port 1337; existing C64 sessions through the OLD
# Node bridge will drop. New sessions land on bridge_v2.
ansible-playbook playbooks/site.yml -e bridge_deploy_mode=adopt-cutover

# Deploy a new bridge_v2 build only (no host config changes)
ansible-playbook playbooks/deploy-bridge.yml

# Just one role
ansible-playbook playbooks/site.yml --tags neohabitat
ansible-playbook playbooks/site.yml --tags worldsaway

# Skip the Azure stack on a non-Azure host
ansible-playbook playbooks/site.yml --skip-tags worldsaway
```

## Bridge_v2 deploy modes

The `neohabitat` role has three modes, gated by `bridge_deploy_mode` (default `upgrade`):

- **`adopt-cutover`** — first run on a host that still has the old Node bridge fronting `:1337`. Recreates the compose stack so `bridge_v2` binds host port `1337`. One-shot; ~5s `docker-proxy` rebind gap; existing sessions through the old bridge **do** drop.
- **`upgrade`** — steady state. Builds binary, syncs it to `volumes/bridge_v2_bin/bridge_v2`, then `docker exec ... kill -HUP 1`. `tableflip` re-execs the new binary; `TCP_REPAIR` hands active sockets to the child. **Active C64 sessions survive.**
- **`refresh-only`** — only converge config / units, skip the bridge SIGHUP entirely.

The `upgrade` task is a thin wrapper around `scripts/deploy-bridge.sh` (no args) — implementation details (binary location, healthcheck) live there.

## Notes

- `the made` is Ubuntu 20.04 (Focal) — EOL April 2025. The roles target Focal/Jammy/Noble and should work after an in-place upgrade.
- `host_is_azure: true` in inventory makes the `worldsaway` role apply. Set to `false` (or override per-host) to skip on non-Azure replicas.
- SSH hardening (`base_harden_sshd: true`) is opt-in. Don't flip it on against `the made` until every operator has key-based access.
- The role does **not** manage the `/home/themade/neohabitat` git checkout (`neohabitat_manage_repo: false` in inventory). Operators continue to `git pull` by hand. For greenfield deploys to `/opt/neohabitat`, set `neohabitat_manage_repo: true`.
