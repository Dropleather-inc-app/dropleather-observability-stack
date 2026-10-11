const prometheus = { type: 'prometheus', uid: 'grafana_prometheus' }
const dashboardUid = 'dropleather-admin-health'

function target(refId, expr, legendFormat = '__auto', instant = false) {
  return { refId, datasource: prometheus, editorMode: 'code', expr, legendFormat, range: !instant, instant }
}

function stat(id, title, x, y, expr, unit = 'short', options = {}) {
  return {
    id, title, type: 'stat', datasource: prometheus, gridPos: { h: 5, w: 6, x, y },
    targets: [target('A', expr, '__auto', true)],
    fieldConfig: { defaults: { unit, noValue: 'NO DATA', thresholds: options.thresholds || { mode: 'absolute', steps: [{ color: 'green' }] }, mappings: options.mappings || [] }, overrides: [] },
    options: { colorMode: 'background', graphMode: 'none', justifyMode: 'auto', textMode: 'auto', reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false } },
  }
}

function timeseries(id, title, x, y, w, expr, legendFormat, unit = 'short') {
  return {
    id, title, type: 'timeseries', datasource: prometheus, gridPos: { h: 8, w, x, y },
    targets: [target('A', expr, legendFormat)],
    fieldConfig: { defaults: { unit, noValue: 'NO TRAFFIC', color: { mode: 'palette-classic' }, custom: { drawStyle: 'line', lineInterpolation: 'linear', lineWidth: 2, fillOpacity: 12, showPoints: 'never', spanNulls: false } }, overrides: [] },
    options: { legend: { displayMode: 'table', placement: 'bottom', calcs: ['lastNotNull', 'sum'] }, tooltip: { mode: 'multi', sort: 'desc' } },
  }
}

function row(id, title, y) {
  return { id, title, type: 'row', collapsed: false, gridPos: { h: 1, w: 24, x: 0, y }, panels: [] }
}

export const dashboard = {
  uid: dashboardUid,
  title: 'Admin Operations',
  tags: ['production', 'admin'],
  timezone: 'browser', schemaVersion: 42, version: 1, refresh: '30s',
  time: { from: 'now-6h', to: 'now' },
  timepicker: { refresh_intervals: ['10s', '30s', '1m', '5m', '15m'] },
  links: [
    { title: 'Authentication & Security', type: 'link', url: '/d/dropleather-auth', targetBlank: false },
    { title: 'Admin Sentry issues', type: 'link', url: 'https://dropleather-inc.sentry.io/issues/?project=4510771954253824&query=environment%3Aproduction', targetBlank: true },
    { title: 'Admin Railway service', type: 'link', url: 'https://railway.com/project/b208f0a2-a2d7-4441-84c0-ceedce23dae8', targetBlank: true },
  ],
  panels: [
    row(1, 'Overview — telemetry absence is not service health', 0),
    stat(2, 'Telemetry ingestion', 0, 1, 'max(admin_observability_heartbeat{service_name="dropleather-admin"})', 'short', {
      mappings: [{ type: 'value', options: { '1': { text: 'INGESTING', color: 'green' } } }],
      thresholds: { mode: 'absolute', steps: [{ color: 'red' }, { color: 'green', value: 1 }] },
    }),
    stat(3, 'BFF requests — last 15m', 6, 1, 'sum(increase(admin_http_request_total{service_name="dropleather-admin"}[15m]))', 'short'),
    stat(4, 'Unexpected failures — last 15m', 12, 1, '(sum(increase(admin_auth_outcome_total{service_name="dropleather-admin",outcome_class="unexpected_failure"}[15m]))) or on() vector(0)', 'short', {
      thresholds: { mode: 'absolute', steps: [{ color: 'green' }, { color: 'amber', value: 1 }, { color: 'red', value: 3 }] },
    }),
    stat(5, 'Process uptime', 18, 1, 'time() - max(admin_process_start_time_seconds{service_name="dropleather-admin"})', 's'),
    timeseries(6, 'Request rate', 0, 6, 12, 'sum by (operation, status_code) (rate(admin_http_request_total{service_name="dropleather-admin"}[5m]))', '{{operation}} {{status_code}}', 'reqps'),
    timeseries(7, 'BFF p95 latency', 12, 6, 12, 'histogram_quantile(0.95, sum by (le, operation) (rate(admin_http_request_duration_milliseconds_bucket{service_name="dropleather-admin"}[5m])))', '{{operation}}', 'ms'),

    row(10, 'Authentication and session', 14),
    timeseries(11, 'Authentication outcomes', 0, 15, 12, 'sum by (operation, outcome, outcome_class) (increase(admin_auth_outcome_total{service_name="dropleather-admin"}[$__rate_interval]))', '{{operation}} · {{outcome}} · {{outcome_class}}'),
    timeseries(12, 'Session clearing — definitive reasons only', 12, 15, 12, '(sum by (reason) (increase(admin_session_clear_total{service_name="dropleather-admin"}[$__rate_interval]))) or on() vector(0)', '{{reason}}'),

    row(20, 'Dependencies', 23),
    timeseries(21, 'API and Redis outcomes', 0, 24, 12, 'sum by (dependency, operation, outcome) (increase(admin_dependency_operation_total{service_name="dropleather-admin"}[$__rate_interval]))', '{{dependency}} · {{operation}} · {{outcome}}'),
    timeseries(22, 'Dependency p95 latency', 12, 24, 12, 'histogram_quantile(0.95, sum by (le, dependency, operation) (rate(admin_dependency_operation_duration_milliseconds_bucket{service_name="dropleather-admin"}[5m])))', '{{dependency}} · {{operation}}', 'ms'),

    row(30, 'Security denials — expected denials are separate from failures', 32),
    timeseries(31, 'Security denials', 0, 33, 12, '(sum by (layer, reason) (increase(admin_security_denial_total{service_name="dropleather-admin"}[$__rate_interval]))) or on() vector(0)', '{{layer}} · {{reason}}'),
    timeseries(32, 'Login rate-limit decisions', 12, 33, 12, '(sum by (decision) (increase(admin_rate_limit_decision_total{service_name="dropleather-admin"}[$__rate_interval]))) or on() vector(0)', '{{decision}}'),

    row(40, 'Deployment health', 41),
    timeseries(41, 'Process start timestamp (changes indicate restarts/releases)', 0, 42, 12, 'max by (service_version) (admin_process_start_time_seconds{service_name="dropleather-admin"})', '{{service_version}}', 'dateTimeAsIso'),
    timeseries(42, 'Restart changes — rolling 15m', 12, 42, 12, 'changes(admin_process_start_time_seconds{service_name="dropleather-admin"}[15m])', '{{service_version}}'),
  ],
}

const folderUID = 'cfwrpuv46m39ca'

function alert(uid, title, expr, threshold, severity, summary, description, panelId, duration = '5m', noDataState = 'OK') {
  return {
    uid, orgID: 1, folderUID, ruleGroup: 'admin-operational', title, condition: 'C',
    data: [
      { refId: 'A', queryType: '', relativeTimeRange: { from: 900, to: 0 }, datasourceUid: prometheus.uid, model: { datasource: prometheus, editorMode: 'code', expr, hide: false, instant: true, intervalMs: 1000, legendFormat: '__auto', maxDataPoints: 43200, range: false, refId: 'A' } },
      { refId: 'C', queryType: 'expression', relativeTimeRange: { from: 0, to: 0 }, datasourceUid: '__expr__', model: { conditions: [{ evaluator: { params: [threshold], type: 'gt' }, operator: { type: 'and' }, query: { params: ['C'] }, reducer: { params: [], type: 'last' }, type: 'query' }], datasource: { type: '__expr__', uid: '__expr__' }, expression: 'A', intervalMs: 1000, maxDataPoints: 43200, refId: 'C', type: 'threshold' } },
    ],
    noDataState, execErrState: 'Error', for: duration, keep_firing_for: '5m',
    annotations: { __dashboardUid__: dashboardUid, __panelId__: String(panelId), summary, description },
    labels: { environment: 'production', service: 'dropleather-admin', severity, team: 'authentication' },
    isPaused: false,
    notification_settings: {
      receiver: 'Owner',
      group_by: ['alertname', 'environment', 'service', 'severity'],
      group_wait: '30s',
      group_interval: '5m',
      repeat_interval: '4h',
    },
  }
}

export const alerts = [
  alert('admintelemetrymissing', 'DropLeather Admin — Telemetry Missing', 'absent_over_time(admin_observability_heartbeat{service_name="dropleather-admin"}[5m]) or on() vector(0)', 0.5, 'critical', 'Admin telemetry has been absent for more than five minutes', 'Check the Railway deployment and restarts, then OTLP egress and collector authentication. No traffic is not sufficient evidence of availability; this heartbeat is independent of requests.', 2, '2m', 'Alerting'),
  alert('adminbffservererrors', 'DropLeather Admin — Sustained BFF Server Errors', '(sum(increase(admin_http_request_total{service_name="dropleather-admin",status_code=~"5.."}[10m])) >= 3) and on() (sum(increase(admin_http_request_total{service_name="dropleather-admin"}[10m])) >= 5) and on() ((sum(increase(admin_http_request_total{service_name="dropleather-admin",status_code=~"5.."}[10m])) / clamp_min(sum(increase(admin_http_request_total{service_name="dropleather-admin"}[10m])), 1)) > 0.2)', 0.5, 'high', 'Admin BFF server errors are sustained and traffic-significant', 'Review the dashboard request outcomes, Railway logs by X-Request-ID, Sentry traces, and the current release. Expected 401/403/429 responses are excluded.', 6),
  alert('adminredisfailures', 'DropLeather Admin — Redis Login Limiter Failures', 'sum(increase(admin_dependency_operation_total{service_name="dropleather-admin",dependency="redis",outcome=~"unavailable|invalid_response|timeout"}[10m])) >= 2', 0.5, 'high', 'Admin Redis login limiter has failed repeatedly', 'The production limiter fails closed, so legitimate logins may be blocked. Verify Upstash connectivity and Railway variables; do not disable rate limiting.', 21, '2m'),
  alert('adminapidepfailures', 'DropLeather Admin — API Dependency Failures', 'sum(increase(admin_dependency_operation_total{service_name="dropleather-admin",dependency="api",outcome=~"unavailable|timeout|invalid_response"}[10m])) >= 3', 0.5, 'high', 'Admin BFF to API dependency failures are sustained', 'Correlate X-Request-ID in Railway admin logs, API logs, and Sentry traces. Check API availability and recent deployments before changing session behavior.', 21),
  alert('adminunexpectedauth', 'DropLeather Admin — Sustained Unexpected Authentication Failures', '(sum(increase(admin_auth_outcome_total{service_name="dropleather-admin",outcome_class="unexpected_failure"}[15m])) >= 3) and on() (sum(increase(admin_auth_outcome_total{service_name="dropleather-admin"}[15m])) >= 5) and on() ((sum(increase(admin_auth_outcome_total{service_name="dropleather-admin",outcome_class="unexpected_failure"}[15m])) / clamp_min(sum(increase(admin_auth_outcome_total{service_name="dropleather-admin"}[15m])), 1)) > 0.3)', 0.5, 'high', 'Unexpected admin authentication failures are sustained', 'Invalid passwords, ordinary permission denials, missing sessions, and rate-limited clients do not satisfy this rule. Inspect API/Redis outcomes and Sentry traces.', 11, '5m'),
  alert('adminrestartloop', 'DropLeather Admin — Restart Loop', 'changes(admin_process_start_time_seconds{service_name="dropleather-admin"}[15m]) >= 2', 0.5, 'critical', 'Admin process restarted repeatedly within 15 minutes', 'Inspect Railway deployment/runtime logs, health, memory, and the release shown on the dashboard. Confirm the previous compatible deployment before rollback.', 42, '2m'),
]
