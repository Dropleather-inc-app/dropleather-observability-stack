# Grafana Stack on Railway

## Background jobs and delivery dashboard

`grafana/background-jobs-dashboard.mjs` defines the production dashboard
**DropLeather — Background Jobs & Delivery** in the `DropLeather API` folder.
It uses `grafana_prometheus` and is published through the Grafana API (the
repository does not provision dashboards on Grafana startup):

```sh
node scripts/validate-background-jobs-dashboard.mjs
GRAFANA_TOKEN_FILE=/path/to/owner-only-token node scripts/publish-background-jobs-dashboard.mjs
```

The dashboard selects the newest lease-owner database observation and rejects
outbox samples older than three minutes. Global actionable backlog excludes
order-status connection-blocked and superseded rows. Other outbox `pending`
counts include scheduled retries that still require eventual processing.
Current terminal failures combine authoritative order-status, order-email,
and WooCommerce recovery counts. The v3 database observer currently exports
zero for other outboxes' exhausted counts, so that aggregate is explicitly
**known failures**, not a claim that every queue has no dead letters.

| Production async subsystem | Execution and durable state | Dashboard signal |
|---|---|---|
| Order email | 15-second API sweep, Supabase outbox, QStash signed consumer, Resend | Pending/age/failure gauges, publish/send/signature counters, consumer HTTP outcomes |
| Order status | Supabase transactional outbox, Realtime wake, 60-second locked sweep | Runnable, blocked, superseded, current/historical exhausted classifications |
| Domain events | Supabase outbox, Realtime wake, 15-second locked sweep | Pending/age, observation freshness, dispatch outcomes |
| Sync / WooCommerce legacy export and recovery | Supabase sync and recovery outboxes; leased drain | Sync pending/age and WooCommerce connection/recovery gauges |
| WooCommerce polling and webhook jobs | QStash signed API consumers; polling enabled in production | Poll queue ratio and internal consumer HTTP outcomes |
| Shopify order processing | Webhook → QStash signed API consumer | Internal consumer HTTP outcomes; no authoritative backlog gauge |
| Stripe order processing | Webhook → QStash signed consumer, synchronous fallback | Internal consumer HTTP outcomes; no QStash-specific DLQ metric |
| Seller analytics event processing | API publish → QStash signed consumer | Internal consumer HTTP outcomes; no authoritative backlog gauge |
| Billing and payment reconciliation | QStash schedules plus Redis-locked API jobs and Supabase tracking | Internal endpoint HTTP outcomes, locked-job run/last-success, payment attempt sweep count |
| Shopify retry/inventory, order expiry, dead-letter retry, VAT and retention/cleanup jobs | In-process timers with distributed Redis locks | Locked-job run/last-success metrics |
| eBay timers | Disabled in production (`EBAY_ENABLED=false`) | Excluded; enabled eBay endpoint traffic can still appear in internal HTTP outcomes |
| Etsy | API integration routes only; no registered background worker found | No empty worker panel |

The canonical WooCommerce export and order-sync-v1 drains are disabled in the
current production variables (`WC_EXPORT_ENGINE` defaults to `legacy-sync-v1`;
`WC_ORDER_SYNC_PIPELINE_V1_ENABLED` is unset). Their database observer still
emits gauges, but the dashboard excludes those queues from active backlog and
worker freshness rather than presenting dormant tables as live workers.

The shared cron-lock instrumentation emits `background_job_run_total{task_name,outcome}`
and `background_job_last_success_timestamp_seconds{task_name}`. The `task_name` label is
restricted to code-owned, bounded names. A skipped lock is not a completed
run. A missing last-success series means no success has been observed since
the metric was introduced; it is not plotted as a fabricated zero. The
dashboard's 15-minute zeroes for event counters mean no observed event in
that window and do not prove the worker is running.

Existing alerts cover order-email backlog/failures/send retries/signatures,
outbox pending/age/status exhaustion/observation staleness, API failures, and
Vault availability. Dashboard links lead to the alert list. No new alert is
created here. QStash's order-email-specific DLQ remains a manual QStash
console/API check because no authoritative Prometheus metric exists. Resend
`sent` means its API accepted a request, not inbox delivery or bounce status.
Scheduled QStash jobs and Shopify consumers still lack an authoritative
QStash backlog/last-delivery signal; their HTTP counters show observed calls
only. Add provider-side telemetry before asserting that a quiet schedule is
healthy.

## Production Vault health signal

Vault is in the `Dropleather | API` Railway project, while Prometheus and
Grafana are in `Dropleather | Grafana`. Railway private networking is scoped to
one project/environment, so Prometheus cannot scrape Vault directly. Deploy
`vault-health-probe/` as a separate service named `vault-health-probe` in the
API project's production environment, without a public domain. The official
OpenTelemetry HTTP Check receiver polls Vault's unauthenticated health endpoint
over Railway private networking and sends metrics through the existing
authenticated OTLP collector at `https://otel.dropleather.com`. That collector
already exposes API metrics to the Prometheus datasource `grafana_prometheus`.

Required variables for the probe service:

| Name | Value/source |
|------|--------------|
| `VAULT_HEALTH_URL` | `http://vault-dropleather.railway.internal:8200/v1/sys/health` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Existing authenticated collector URL, `https://otel.dropleather.com` |
| `OTEL_AUTHORIZATION` | Existing OTLP `Authorization` header value; store as a Railway secret, never in Git |
| `RAILWAY_DOCKERFILE_PATH` | `vault-health-probe/Dockerfile` when deploying from repository root |

The probe does not require a Vault token or a public Vault route. Do not use
`vault.dropleather.com` as its target: Cloudflare Access protects that hostname.
The primary metric is `vault_health_http_status_code`, a stable gauge with no
per-status-code labels. It is derived from the official HTTP Check receiver's
`httpcheck.status` metric. Query it in Grafana:

```promql
vault_health_http_status_code{service_name="vault-health-probe"}
absent_over_time(vault_health_http_status_code{service_name="vault-health-probe"}[2m])
```

Vault's health endpoint returns HTTP 200 for active/unsealed, 503 for sealed,
and 501 for uninitialized. The gauge is 0 if Vault cannot be reached. The
receiver also exports `httpcheck_error` and
`httpcheck_duration_milliseconds` for diagnosis. An absent gauge means the probe
or telemetry pipeline itself has stopped. The derived gauge deliberately avoids
per-code series that Prometheus may retain briefly after a state change. This
production alert rule is defined in `grafana/vault-health-alert.mjs` and can be
published once with `GRAFANA_TOKEN_FILE=/path/to/owner-only-token node
scripts/publish-vault-health-alert.mjs`.

### Vault alert response

`DropLeather Vault — Sealed or Unavailable` runs in the production
`dependency-operational` group every 60 seconds, with a 2-minute pending
period and `severity=critical`. It uses the existing `Owner` contact point.
It alerts on codes 0, 501, 503, and other unusable codes; Vault's valid standby
codes 429 and 473 do not trigger it. A missing metric produces an alert signal,
and Grafana's No Data state is also set to Alerting. The observed code appears
in the alert annotation; -1 means no recent metric. Check Vault's private
health endpoint and the Railway probe deployment. If Vault is sealed, follow
the manual 2-of-3 unseal procedure. Do not put unseal shares or tokens into
Grafana. The probe's data may remain in the collector briefly if the probe
itself stops; missing-data detection occurs after that cached series expires.

## Production order-email alerts

Four rules in `grafana/order-email-alerts.mjs` monitor the Supabase outbox →
QStash → signed Railway API → Resend path. They run in the `DropLeather API`
folder's `order-email-operational` group every 60 seconds, route to the
existing `Owner` contact point, and use `Error` on query errors and `Alerting`
on No Data. Publish missing rules with an owner-only Grafana API token file:

```sh
GRAFANA_TOKEN_FILE=/path/to/owner-only-token node scripts/publish-order-email-alerts.mjs
```

| Rule | PromQL source and condition | For | Severity | Operator response |
|------|-----------------------------|-----|----------|-------------------|
| DropLeather Order Email — Backlog Age | `order_email_outbox_oldest_actionable_age_seconds > 600`, selected from the freshest leased observer and rejected when its observation is older than 180 seconds | 5m | high | Inspect the outbox, dispatcher, and QStash delivery. Check idempotency before any manual resend. |
| DropLeather Order Email — Failed Jobs | `sum(order_email_outbox_failed_count) > 0`, selected from the freshest leased observer with the same freshness guard | 2m | high | Inspect the `reason` series and row. `send_outcome_unknown` may already have reached Resend; verify provider outcome before retrying. |
| DropLeather Order Email — Sustained Send Failures | `sum(increase(order_email_send_total{outcome="retryable_failure"}[10m])) >= 3` | 5m | high | Check Resend availability/rate limits, API logs, and QStash retries. A single failure does not alert. |
| DropLeather Order Email — Invalid QStash Signatures | `sum(increase(order_email_qstash_signature_failure_total[5m])) >= 3` | 2m | warning | Inspect endpoint security logs and signing-key configuration. One stray rejection does not alert. |

All queries filter `service_name="dropleather-api-railway-candidate"`. The
backlog and failed-job rules use the newest `order_email_outbox_observation_timestamp_seconds`
sample; a stale or absent sample becomes No Data and alerts. The complete
PromQL is versioned in `grafana/order-email-alerts.mjs`. The signature rule
adds a sustained Grafana signal alongside the application's per-event Sentry
alarm. No QStash DLQ alert exists because there is no order-email-specific
Prometheus DLQ metric; inspect the QStash console/API manually. `sent` means
Resend accepted the API request, not confirmed inbox delivery. Do not trigger
these rules by creating fake production orders or emails.

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/template/8TLSQD?referralCode=IFlm92)

## What is this template

This template deploys a complete Grafana observability stack on Railway with just one click! The stack includes four integrated services:

- **Grafana**: The leading open-source analytics and monitoring solution
- **Loki**: A horizontally-scalable, highly-available log aggregation system
- **Prometheus**: A powerful metrics collection and alerting system
- **Tempo**: A high-scale distributed tracing backend

This template is perfect for teams who need a comprehensive observability solution for their railway project without the hassle of manual configuration and infrastructure management.

### Key Features

- **Pre-configured Integration**: _All services come pre-connected_, so Grafana is ready to query your data immediately.
- **Persistent Storage**: All four services use Railway volumes to ensure your data, dashboards, and configurations persist between updates and deploys.
- **Version Control**: Pin specific Docker image versions for each service using environment variables.
- **Customizable**: Fork the repository to customize configuration files for any service. You can take full control and edit anything you'd need to as you scale.
- **One-Click Deploy**: Get a complete Grafana-based observability stack running in minutes.

## Quick Start Guide

1. Click the "Deploy on Railway" button at the top of this page
2. Enter your desired Grafana admin username in the `GF_SECURITY_ADMIN_USER` variable
3. Leave all other variables at their defaults (or customize as needed)
4. Wait for your stack to deploy (this typically takes 3-5 minutes)
5. Navigate to the Grafana URL provided by Railway
6. Log in with your admin username and the auto-generated password found in the `GF_SECURITY_ADMIN_PASSWORD` environment variable
7. Hook up your applications to the datasources.
8. Create dashboards, alerts, and explore your data in Grafana!

## Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GF_SECURITY_ADMIN_USER` | Username for the Grafana admin account | Required input |
| `GF_SECURITY_ADMIN_PASSWORD` | Password for the Grafana admin account | Auto-generated secure string |
| `GF_DEFAULT_INSTANCE_NAME` | Name of your Grafana instance | `Grafana on Railway` |
| `GF_INSTALL_PLUGINS` | Comma-separated list of Grafana plugins to install | `grafana-simple-json-datasource,grafana-piechart-panel,grafana-worldmap-panel,grafana-clock-panel` |

### Internal Service URLs

The Grafana service exposes these environment variables that you can reference in your other Railway applications to easily send data to your observability stack:

| Variable | Description | Usage |
|----------|-------------|-------|
| `LOKI_INTERNAL_URL` | Internal URL for the Loki service | Use in your applications to send logs to and query Loki |
| `PROMETHEUS_INTERNAL_URL` | Internal URL for the Prometheus service | Use in your applications to send metrics to and query Prometheus |
| `TEMPO_INTERNAL_URL` | Internal URL for the Tempo service | Use in your applications to query Tempo |

These variables make it easy to configure your other Railway services to send telemetry data to your observability stack.

Tempo also exposes a few variables to make it easier to push tracing information to the service using either HTTP or GRPC

| Variable | Description | Usage |
|----------|-------------|-------|
| `INTERNAL_HTTP_INGEST` | Internal HTTP ingest server URL for Tempo | Use in your applications to send traces to tempo via HTTP |
| `INTERNAL_GRPC_INGEST` | Internal GRPC ingest server URL for Tempo | Use in your applications to send traces to tempo via GRPC |

### Version Control

Each service has its own `VERSION` environment variable that can be set independently in each service's settings in the Railway dashboard:

- **Grafana Service**: Set `VERSION` to control the Grafana Docker image tag
- **Loki Service**: Set `VERSION` to control the Loki Docker image tag
- **Prometheus Service**: Set `VERSION` to control the Prometheus Docker image tag
- **Tempo Service**: Set `VERSION` to control the Tempo Docker image tag

By default, all services use the `latest` tag, but you can pin specific versions for stability:

Examples:
- Grafana: `VERSION=11.5.2`
- Loki: `VERSION=3.4.2`
- Prometheus: `VERSION=v3.2.1`
- Tempo: `VERSION=2.9.0`

This allows you to update each component independently as needed.

> **⚠️ Note on Tempo v2.10.0**: There is a known issue with Tempo v2.10.0 where the `compactor` configuration block is not recognized, causing startup failures. This template is pinned to v2.9.0 until this issue is resolved in a future release.

## Project Structure & Services

This template deploys four interconnected services:

### Grafana
- The central visualization and dashboarding platform
- Pre-configured with connections to all other services
- Persistent volume for storing dashboards, users, and configurations
- Comes with useful plugins pre-installed
- Exposes internal URLs for other Railway services to connect to Loki, Prometheus, and Tempo

### Prometheus
- Time-series database for metrics collection
- Configured with sensible defaults for monitoring
- Persistent volume for metrics data

### Loki
- Log aggregation system designed to be cost-effective
- Horizontally scalable architecture
- Persistent volume for log storage

### Tempo
- Distributed tracing system for tracking requests across services
- High-performance trace storage
- Persistent volume for trace data

All services are deployed using official Docker images and configured to work together seamlessly.

## Connecting Your Applications

### Using [Locomotive](https://railway.com/template/jP9r-f) for Loki

You can easily ingest *all* of your railway logs into Loki from *any* service using [Locomotive](https://railway.com/template/jP9r-f). Just spin up their template, drop in your Railway API key, the ID of the services you want to monitor, and a link to your new Loki instance and logs will start flowing! no code changes needed anywhere!

### Using OpenTelemetry libraries for Tempo 

Tempo is a bit different than both Prometheus and Loki in that exposes separate GRPC and HTTP servers on ports `:4317` and `:4318` respectively specifically for ingesting your tracing data or "spans".

When configuring your application to send traces to Tempo, please use one of the preconfigured variables in the Tempo service: `INTERNAL_HTTP_INGEST` or `INTERNAL_GRPC_INGEST`.

Another thing to note is that the ingest API endpoint for the HTTP server is `/v1/traces`. For a working example of this in a node.js express API, see `/examples/api/tracer.js` in our GitHub repository.

### Using otherwise standard observability tooling

To send data from your other Railway applications to this observability stack:

1. In your application's Railway service, add environment variables that reference the internal URLs:
   ```
   LOKI_URL=${{Grafana.LOKI_INTERNAL_URL}}
   PROMETHEUS_URL=${{Grafana.PROMETHEUS_INTERNAL_URL}}
   TEMPO_URL=${{Grafana.TEMPO_INTERNAL_URL}}
   ```
2. Configure your application's logging, metrics, or tracing libraries to use these URLs
3. Your application data will automatically appear in your Grafana dashboards

## Customizing Your Stack

To customize the configuration of Loki, Prometheus, or Tempo:

1. Fork the [GitHub repository](https://github.com/yourusername/grafana-railway-template)
2. Modify the configuration files in their respective directories
3. In Railway, disconnect the service you want to customize
4. Reconnect the service to your forked repository
5. Deploy the updated service

The pre-configured Grafana connections will continue to work with your customized services.

## Additional Resources

- [Locomotive: a loki transport for railway services](https://railway.com/template/jP9r-f)
- [Grafana Documentation](https://grafana.com/docs/grafana/latest/)
- [Loki Documentation](https://grafana.com/docs/loki/latest/)
- [Prometheus Documentation](https://prometheus.io/docs/introduction/overview/)
- [Tempo Documentation](https://grafana.com/docs/tempo/latest/)
- [Grafana Community Forums](https://community.grafana.com/)
- [Grafana Plugins Directory](https://grafana.com/grafana/plugins/)

---

Developed and maintained by [Mykal](https://mykal.codes). For issues or suggestions, please open an issue on the [GitHub repository](https://github.com/MykalMachon/grafana-stack-railway).
