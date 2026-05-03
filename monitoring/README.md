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
| `GRAFANA_URL`    | `https://<your-stack>.grafana.net` — the **Grafana instance URL**, NOT a prometheus/loki/tempo endpoint. |
| `GRAFANA_TOKEN`  | A **Grafana service-account token** with the Editor role (Settings → Service accounts → New → Add token). NOT a Grafana Cloud Access Policy token (`glc_*` tokens are for management APIs and return 401 against `/api/dashboards/db`). |

### `MONITORING_ENV` template

Use the var names that Grafana Cloud's bootstrap script gives you (so
you can paste the output verbatim, with newlines):

```ini
GCLOUD_HOSTED_METRICS_ID=<your prometheus instance id>
GCLOUD_HOSTED_METRICS_URL=https://prometheus-prod-XX-prod-us-east-N.grafana.net/api/prom/push
GCLOUD_HOSTED_LOGS_ID=<your loki instance id>
GCLOUD_HOSTED_LOGS_URL=https://logs-prod-NNN.grafana.net/loki/api/v1/push
GCLOUD_RW_API_KEY=glc_…
```

For traces, add (once you grab them from Grafana Cloud → Connections → Tempo):

```ini
GCLOUD_TEMPO_ID=<your tempo instance id>
GCLOUD_TEMPO_URL=https://tempo-prod-NN.grafana.net/tempo
```

…then uncomment the `traces` pipeline + `otlphttp/grafana_tempo`
exporter in `otel-collector-config.yml`.

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
