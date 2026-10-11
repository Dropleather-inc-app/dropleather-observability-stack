# Production order-email alerts

`grafana/order-email-alerts.mjs` defines five rules for the order-email
outbox, QStash callback, API sender, and telemetry pipeline. The existing
`Owner` contact point receives them. Publish or reconcile them with an
owner-only Grafana API token file:

```sh
GRAFANA_TOKEN_FILE=/path/to/owner-only-token node scripts/publish-order-email-alerts.mjs
```

The **Sustained Send Failures** rule counts three or more real retryable
provider-send failures in ten minutes, with a five-minute pending period.
No email traffic evaluates to zero. No Data cannot create a high-severity
send-failure incident; query errors remain errors.

The separate **Metrics Missing** warning checks that the Prometheus scrape
and the API's own HTTP instrumentation are present while the registered
retryable-failure counter has been
absent for five minutes. It has an additional five-minute pending period.
This warning means order-email telemetry is missing; it does not establish
that customer email delivery is failing. Investigate metric registration,
service labels, and the Prometheus scrape path. A separate API scrape alert
owns scrape outages.

The other rules monitor backlog age, terminal outbox jobs, and invalid
QStash signatures. They retain their existing thresholds and No Data
behavior. All rules target the production OpenTelemetry service label
`dropleather-api-railway-candidate`; the Railway service is named
`api-compat-candidate`.
