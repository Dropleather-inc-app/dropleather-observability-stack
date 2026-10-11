const prometheus = { type: 'prometheus', uid: 'grafana_prometheus' }
const metric = 'vault_health_http_status_code{service_name="vault-health-probe"}'
const recentCode = `last_over_time(${metric}[1m])`

// Standby (429) and performance standby (473) are valid Vault health states.
// All other non-200 codes are unusable for this single-node production Vault.
export const observedCodeQuery = `max(${recentCode}) or on() vector(-1)`
export const failureQuery = `max((${recentCode} != bool 200) * (${recentCode} != bool 429) * (${recentCode} != bool 473)) or on() vector(0)`
export const telemetryMissingQuery = `absent_over_time(${metric}[2m]) or on() vector(0)`

function query(refId, expr) {
  return {
    refId,
    queryType: '',
    relativeTimeRange: { from: 600, to: 0 },
    datasourceUid: prometheus.uid,
    model: {
      datasource: prometheus,
      editorMode: 'code',
      expr,
      hide: false,
      instant: true,
      intervalMs: 1000,
      legendFormat: '__auto',
      maxDataPoints: 43200,
      range: false,
      refId,
    },
  }
}

export const vaultHealthAlert = {
  uid: 'vault-sealed-unavailable',
  orgID: 1,
  folderUID: 'cfwrpuv46m39ca',
  ruleGroup: 'dependency-operational',
  title: 'DropLeather Vault — Sealed or Unavailable',
  condition: 'C',
  data: [
    query('A', observedCodeQuery),
    query('B', failureQuery),
    {
      refId: 'C',
      queryType: 'expression',
      relativeTimeRange: { from: 0, to: 0 },
      datasourceUid: '__expr__',
      model: {
        conditions: [{
          evaluator: { params: [0.5], type: 'gt' },
          operator: { type: 'and' },
          query: { params: ['C'] },
          reducer: { params: [], type: 'last' },
          type: 'query',
        }],
        datasource: { type: '__expr__', uid: '__expr__' },
        expression: 'B',
        intervalMs: 1000,
        maxDataPoints: 43200,
        refId: 'C',
        type: 'threshold',
      },
    },
  ],
  noDataState: 'OK',
  execErrState: 'Error',
  for: '2m',
  keep_firing_for: '5m',
  annotations: {
    summary: 'Production Vault is sealed, unavailable, or not reporting health',
    description: 'Observed health HTTP code: {{ $values.A.Value }} (-1 means no recent metric). 503 = sealed; 501 = uninitialized; 0 = unreachable; other unusable states also alert. Check Vault status and Railway probe/telemetry logs. If sealed, authorized operators must perform the manual 2-of-3 unseal procedure. Never place unseal shares or tokens in Grafana.',
    observed_status_code: '{{ $values.A.Value }}',
  },
  labels: {
    component: 'vault',
    dependency: 'vault',
    environment: 'production',
    service: 'vault-dropleather',
    severity: 'critical',
  },
  notification_settings: { receiver: 'Owner' },
  isPaused: false,
}

export const vaultTelemetryMissingAlert = {
  ...vaultHealthAlert,
  uid: 'vault-telemetry-missing',
  title: 'DropLeather Vault — Telemetry Missing',
  data: [query('A', telemetryMissingQuery), {
    ...vaultHealthAlert.data[2],
    model: {
      ...vaultHealthAlert.data[2].model,
      expression: 'A',
    },
  }],
  condition: 'C',
  for: '5m',
  keep_firing_for: '5m',
  annotations: {
    summary: 'Production Vault health telemetry is missing',
    description: 'The Vault health probe metric has been absent for at least two minutes. This does not prove Vault is sealed. Check the probe, exporter, Prometheus ingestion, and datasource separately from Vault seal status.',
  },
  labels: {
    ...vaultHealthAlert.labels,
    severity: 'warning',
  },
}
