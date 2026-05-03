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

All credentials live as **GitHub repo secrets** — the deploy job ships
them onto `the made` automatically.

### Repo secrets to add

| Secret | Value |
|---|---|
| `MONITORING_ENV` | The full multi-line content of `/etc/neohabitat/monitoring.env` (see template below). The deploy job writes this verbatim to the made on each run, chmod 600, owned by `themade`, and restarts the sidecars when it changes. |
| `GRAFANA_URL`    | `https://<your-stack>.grafana.net` (used by the dashboard-push job). |
| `GRAFANA_TOKEN`  | Service-account token with `dashboards:write` (used by the dashboard-push job). |

### `MONITORING_ENV` template

Pick the region endpoints that match your Grafana Cloud stack, then
paste the whole thing (including newlines) into the secret value:

```ini
GRAFANA_OTLP_ENDPOINT=https://otlp-gateway-prod-us-east-0.grafana.net/otlp
GRAFANA_OTLP_AUTH=Basic <base64(instance-id:api-key)>

GRAFANA_LOKI_URL=https://logs-prod-006.grafana.net/loki/api/v1/push
GRAFANA_LOKI_USERNAME=<loki instance id>
GRAFANA_LOKI_API_KEY=<api key with MetricsPublisher role>
```

The compose `env_file` directive uses `required: false`, so the stack
still comes up if `MONITORING_ENV` isn't set yet — the sidecars will
just log loudly until it is.

### 3. Adding a dashboard

1. Build it in Grafana Cloud UI.
2. Dashboard → Settings → JSON Model → copy.
3. Save as `monitoring/grafana/dashboards/<slug>.json`.
4. Make sure `uid` is set (used as the stable identifier across pushes).
5. Commit + push to master — the `deploy-dashboards` job uploads it.

`overwrite: true` is set on the API call, so subsequent pushes replace
the dashboard with the same `uid` rather than creating duplicates.
