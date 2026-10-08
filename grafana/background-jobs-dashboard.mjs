const datasource = { type: 'prometheus', uid: 'grafana_prometheus' }
const service = 'service_name="dropleather-api-railway-candidate"'
const outboxBase = `${service},observation_role="lease_owner"`
const observation = `outbox_observation_timestamp_seconds{${outboxBase}}`
const statusObservation = `outbox_observation_timestamp_seconds{${outboxBase},outbox_type="order_status"}`
const newest = `(${observation} == on(outbox_type) group_left max by(outbox_type) (${observation}))`
const fresh = `(time() - max by(outbox_type) (${observation}) < 180)`

// An old OTel Gauge point can survive a worker restart. Match each point to
// the newest database-timestamped lease owner and reject old observations.
function outbox(metric, selector = '') {
  return `(max by(outbox_type) (${metric}{${outboxBase}${selector}} and on(outbox_type,host_name,process_pid) ${newest}) and on(outbox_type) ${fresh})`
}
function status(category, byReason = false, metric = 'outbox_classification_count') {
  const selected = `${metric}{${outboxBase},outbox_type="order_status",category="${category}"} and on(outbox_type,host_name,process_pid) ${newest}`
  const aggregate = byReason ? `sum by(reason) (${selected})` : `sum(${selected})`
  return `(${aggregate} and on() (time() - max(${statusObservation}) < 180))`
}
const emailObserved = `order_email_outbox_observation_timestamp_seconds{${service}}`
const emailOwner = `(${emailObserved} == on() group_left max(${emailObserved}))`
const emailFresh = `(time() - max(${emailObserved}) < 180)`
function email(metric, byReason = false) {
  const value = `${metric}{${service}} and on(host_name,process_pid) ${emailOwner}`
  return `((${byReason ? `sum by(reason) (${value})` : `sum(${value})`}) and on() ${emailFresh})`
}
const zero = expr => `(${expr}) or on() vector(0)`
// Production uses the legacy WooCommerce sync engine; canonical export and
// order-sync-v1 drains are disabled, though their observer still emits zeroes.
const activeOutboxes = ',outbox_type=~"domain_event|sync"'
const pending = outbox('outbox_pending_count', activeOutboxes)
const oldest = outbox('outbox_oldest_pending_age_seconds', activeOutboxes)
const emailPending = email('order_email_outbox_pending_count')
const emailAge = email('order_email_outbox_oldest_actionable_age_seconds')
const emailFailed = email('order_email_outbox_failed_count')

export const queries = {
  globalBacklog: `sum(${pending}) + ${status('runnable')} + ${emailPending}`,
  globalAge: `max(${oldest} or label_replace(${status('runnable', false, 'outbox_classification_oldest_age_seconds')},"outbox_type","order_status","__name__",".*") or label_replace(${emailAge},"outbox_type","order_email","__name__",".*"))`,
  // The current v3 outbox RPC hardcodes exhausted=0 for non-status outboxes.
  // Only add authoritative terminal sources to this total.
  globalFailures: `${status('current_exhausted')} + ${emailFailed} + max(woocommerce_reconciliation_unresolved_exhausted{${service}})`,
  globalBlocked: status('blocked'),
  backlog: `${pending} or label_replace(${status('runnable')},"outbox_type","order_status","__name__",".*") or label_replace(${emailPending},"outbox_type","order_email","__name__",".*")`,
  age: `${oldest} or label_replace(${status('runnable', false, 'outbox_classification_oldest_age_seconds')},"outbox_type","order_status","__name__",".*") or label_replace(${emailAge},"outbox_type","order_email","__name__",".*")`,
  dispatchSuccess: zero(`sum by(outbox_type) (increase(outbox_dispatch_success_count_total{${service}}[15m]))`),
  dispatchFailure: zero(`sum by(outbox_type) (increase(outbox_dispatch_failure_count_total{${service}}[15m]))`),
  dispatchRecovery: zero(`sum by(outbox_type) (increase(outbox_recovery_count_total{${service}}[15m]))`),
  qstashPublish: zero(`sum by(outcome) (increase(order_email_qstash_publish_total{${service}}[15m]))`),
  emailSend: zero(`sum by(outcome) (increase(order_email_send_total{${service}}[15m]))`),
  emailSignature: zero(`sum(increase(order_email_qstash_signature_failure_total{${service}}[15m]))`),
  emailHttp: zero(`sum by(status_code) (increase(http_server_request_count_total{${service},route="/v1/internal/jobs/order-email"}[15m]))`),
  otherDeliveryHttp: zero(`sum by(route,status_code) (increase(http_server_request_count_total{${service},route=~"/v1/internal/.*|/v1/webhooks/stripe-orders/process",route!="/v1/internal/jobs/order-email"}[1h]))`),
  emailPending,
  emailAge,
  emailFailedByReason: email('order_email_outbox_failed_count', true),
  statusRunnable: status('runnable'),
  statusAge: status('runnable', false, 'outbox_classification_oldest_age_seconds'),
  statusExhausted: status('current_exhausted', true),
  statusBlocked: status('blocked', true),
  statusSuperseded: status('superseded'),
  statusHistorical: status('historical_exhausted'),
  wooConnections: `max by(__name__) ({${service},__name__=~"woocommerce_integration_healthy|woocommerce_integration_waiting_for_signal|woocommerce_integration_dormant|woocommerce_integration_disconnected"})`,
  wooUnresolved: `max(woocommerce_reconciliation_unresolved_exhausted{${service}})`,
  wooPollDepth: `max(poll_queue_depth_ratio{${service}})`,
  outboxFreshness: `time() - max by(outbox_type) (outbox_observation_timestamp_seconds{${outboxBase},outbox_type=~"domain_event|sync|order_status"})`,
  emailFreshness: `time() - max(${emailObserved})`,
  paymentSweep: zero(`sum(increase(payment_reconciliation_attempt_sweep_succeeded_total{${service}}[6h]))`),
  cronRuns: zero(`sum by(task_name,outcome) (increase(background_job_run_total{${service}}[1h]))`),
  cronLastSuccessAge: `time() - max by(task_name) (background_job_last_success_timestamp_seconds{${service}})`,
}

function target(expr, legend = '__auto', instant = false) {
  return { refId: 'A', datasource, editorMode: 'code', expr, legendFormat: legend, instant, range: !instant }
}
function panel(id, title, type, x, y, w, h, expr, unit = 'short', legend = '__auto') {
  const p = { id, title, type, datasource, gridPos: { x, y, w, h }, targets: [target(expr, legend, type === 'stat' || type === 'bargauge')],
    fieldConfig: { defaults: { unit, noValue: 'NO DATA', color: { mode: 'palette-classic' }, thresholds: { mode: 'absolute', steps: [{ color: 'green' }, { color: 'orange', value: 1 }, { color: 'red', value: 10 }] } }, overrides: [] } }
  if (type === 'stat') p.options = { colorMode: 'background', graphMode: 'none', reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false } }
  if (type === 'bargauge') p.options = { displayMode: 'gradient', orientation: 'horizontal', reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false } }
  if (type === 'timeseries') p.options = { legend: { displayMode: 'table', placement: 'bottom', calcs: ['lastNotNull'] }, tooltip: { mode: 'multi', sort: 'desc' } }
  return p
}
const row = (id, title, y) => ({ id, title, type: 'row', collapsed: false, gridPos: { x: 0, y, w: 24, h: 1 }, panels: [] })
const stat = (id, title, x, y, w, expr, unit = 'short') => panel(id, title, 'stat', x, y, w, 5, expr, unit)
const line = (id, title, x, y, w, expr, legend, unit = 'short') => panel(id, title, 'timeseries', x, y, w, 7, expr, unit, legend)

export const dashboard = {
  uid: 'dropleather-background-jobs', title: 'DropLeather — Background Jobs & Delivery',
  tags: ['dropleather', 'production', 'background-jobs', 'operations'],
  timezone: 'browser', schemaVersion: 42, version: 1, refresh: '30s',
  time: { from: 'now-6h', to: 'now' },
  links: [{ title: 'Production alerts', type: 'link', url: '/alerting/list?view=list', targetBlank: true }],
  panels: [
    row(1, 'Global async health — actionable work only', 0),
    stat(2, 'Actionable backlog', 0, 1, 6, queries.globalBacklog),
    stat(3, 'Oldest actionable age', 6, 1, 6, queries.globalAge, 's'),
    stat(4, 'Known terminal / uncertain failures', 12, 1, 6, queries.globalFailures),
    stat(5, 'Connection-blocked status work', 18, 1, 6, queries.globalBlocked),
    row(10, 'Backlog by subsystem', 6),
    panel(11, 'Actionable backlog by outbox', 'bargauge', 0, 7, 24, 7, queries.backlog, 'short', '{{outbox_type}}'),
    row(20, 'Oldest actionable age', 14),
    line(21, 'Oldest actionable work by outbox', 0, 15, 24, queries.age, '{{outbox_type}}', 's'),
    row(30, 'Processing outcomes — rolling 15 minutes', 22),
    line(31, 'Dispatch successes', 0, 23, 8, queries.dispatchSuccess, '{{outbox_type}}'),
    line(32, 'Dispatch failures', 8, 23, 8, queries.dispatchFailure, '{{outbox_type}}'),
    line(33, 'Recovered / retried outbox items', 16, 23, 8, queries.dispatchRecovery, '{{outbox_type}}'),
    row(40, 'QStash / asynchronous delivery', 30),
    line(41, 'Order-email QStash publish outcomes', 0, 31, 8, queries.qstashPublish, '{{outcome}}'),
    line(42, 'Signed order-email consumer outcomes', 8, 31, 8, queries.emailHttp, 'HTTP {{status_code}}'),
    line(43, 'Order-email signature denials', 16, 31, 8, queries.emailSignature, 'invalid signatures'),
    line(44, 'Other QStash / internal consumer HTTP outcomes', 0, 38, 24, queries.otherDeliveryHttp, '{{route}} · {{status_code}}'),
    row(50, 'Order email — Supabase outbox → QStash → Resend', 45),
    stat(51, 'Actionable email jobs', 0, 46, 6, queries.emailPending),
    stat(52, 'Oldest actionable email', 6, 46, 6, queries.emailAge, 's'),
    line(53, 'Terminal / uncertain email failures', 12, 46, 12, queries.emailFailedByReason, '{{reason}}'),
    line(54, 'Resend request outcomes (not inbox delivery)', 0, 53, 24, queries.emailSend, '{{outcome}}'),
    row(60, 'Durable order-status delivery — blocked and superseded separated', 60),
    stat(61, 'Runnable status pushes', 0, 61, 6, queries.statusRunnable),
    stat(62, 'Oldest runnable status push', 6, 61, 6, queries.statusAge, 's'),
    stat(63, 'Superseded (historical)', 12, 61, 6, queries.statusSuperseded),
    stat(64, 'Historical exhausted', 18, 61, 6, queries.statusHistorical),
    line(65, 'Current exhausted by reason', 0, 66, 12, queries.statusExhausted, '{{reason}}'),
    line(66, 'Connection-blocked by reason', 12, 66, 12, queries.statusBlocked, '{{reason}}'),
    row(70, 'Marketplace workers — enabled integrations only', 73),
    line(71, 'WooCommerce connection state', 0, 74, 12, queries.wooConnections, '{{__name__}}'),
    stat(72, 'WooCommerce unresolved exhausted', 12, 74, 6, queries.wooUnresolved),
    stat(73, 'WooCommerce polling queue ratio', 18, 74, 6, queries.wooPollDepth, 'percentunit'),
    row(80, 'Worker execution / observation freshness', 81),
    line(81, 'Scheduled cron last success age', 0, 82, 12, queries.cronLastSuccessAge, '{{task_name}}', 's'),
    line(82, 'Scheduled cron runs — 1h', 12, 82, 12, queries.cronRuns, '{{task_name}} · {{outcome}}'),
    line(83, 'Leased outbox observation age', 0, 89, 12, queries.outboxFreshness, '{{outbox_type}}', 's'),
    line(84, 'Order-email observation age', 12, 89, 6, queries.emailFreshness, 'order email', 's'),
    line(85, 'Payment attempt sweeps — 6h', 18, 89, 6, queries.paymentSweep, 'succeeded'),
  ],
}
