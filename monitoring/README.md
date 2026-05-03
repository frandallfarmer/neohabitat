# Monitoring

`the made` ships logs/metrics/traces to **Grafana Cloud** via two sidecar
containers from `docker-compose.monitoring.yml`:

| Container | Source | Sink |
|---|---|---|
| `otel-collector` | OTLP from `bridge_v2` (port 4318) | Grafana Cloud OTLP gateway (traces + metrics + logs) |
| `promtail`       | docker socket → all `neohabitat-*` container logs | Grafana Cloud Loki |

Dashboards live in [`grafana/dashboards/`](./grafana/dashboards/) as JSON
and are pushed to your Grafana Cloud org by the `deploy-dashboards` job
in `.github/workflows/build-and-push.yml` on every master push.

## First-time setup

### 1. Credentials on `the made`

Create `/etc/neohabitat/monitoring.env` (chmod 600, owned by `themade`)
with the values from your Grafana Cloud account → "Connections" → each
data source's "Send X" page:

```sh
sudo install -d -m 0750 -o themade -g themade /etc/neohabitat
sudo install -m 0600 -o themade -g themade /dev/null /etc/neohabitat/monitoring.env
sudoedit /etc/neohabitat/monitoring.env
```

```ini
GRAFANA_OTLP_ENDPOINT=https://otlp-gateway-prod-us-east-0.grafana.net/otlp
GRAFANA_OTLP_AUTH=Basic <base64(instance-id:api-key)>

GRAFANA_LOKI_URL=https://logs-prod-006.grafana.net/loki/api/v1/push
GRAFANA_LOKI_USERNAME=<loki instance id>
GRAFANA_LOKI_API_KEY=<api key with MetricsPublisher role>
```

(Pick the region endpoints that match your Grafana Cloud stack.)

The compose `env_file` directive uses `required: false`, so the stack
still comes up if this file is missing — the sidecars will just log
errors. Once the file is there, `docker compose up -d --force-recreate
otel-collector promtail` from `/home/themade/neohabitat`.

### 2. GitHub repo secrets (for dashboard push)

| Secret | Value |
|---|---|
| `GRAFANA_URL`   | `https://<your-stack>.grafana.net` |
| `GRAFANA_TOKEN` | Service-account token with **Editor** role and `dashboards:write` |

### 3. Adding a dashboard

1. Build it in Grafana Cloud UI.
2. Dashboard → Settings → JSON Model → copy.
3. Save as `monitoring/grafana/dashboards/<slug>.json`.
4. Make sure `uid` is set (used as the stable identifier across pushes).
5. Commit + push to master — the `deploy-dashboards` job uploads it.

`overwrite: true` is set on the API call, so subsequent pushes replace
the dashboard with the same `uid` rather than creating duplicates.
