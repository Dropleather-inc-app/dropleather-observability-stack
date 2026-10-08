const datasource = { type: 'prometheus', uid: 'grafana_prometheus' }
const service = 'service_name="dropleather-api-railway-candidate"'
const age = `order_email_outbox_oldest_actionable_age_seconds{${service}}`
const failed = `order_email_outbox_failed_count{${service}}`
const observed = `order_email_outbox_observation_timestamp_seconds{${service}}`

// The leased observer emits one authoritative sample. Select that owner and
// reject a cached gauge once its database observation is more than 3m old.
const newestOwner = `(${observed} == on() group_left max(${observed}))`
const fresh = `(time() - max(${observed}) < 180)`
export const backlogQuery = `max(${age} and on(host_name,process_pid) ${newestOwner}) and on() ${fresh}`
export const failedQuery = `sum(${failed} and on(host_name,process_pid) ${newestOwner}) and on() ${fresh}`

const retryable = `order_email_send_total{${service},outcome="retryable_failure"}`
const signature = `order_email_qstash_signature_failure_total{${service}}`
// A single newly started counter sample yields zero; a wholly missing series
// still yields No Data, which Grafana treats as Alerting for these rules.
export const sendFailureQuery = `(sum(increase(${retryable}[10m])) or on() (sum(${retryable}) * 0))`
export const signatureFailureQuery = `(sum(increase(${signature}[5m])) or on() (sum(${signature}) * 0))`

function prometheusQuery(refId, expr) {
  return {
    refId, queryType: '', relativeTimeRange: { from: 900, to: 0 },
    datasourceUid: datasource.uid,
    model: {
      datasource, editorMode: 'code', expr, hide: false, instant: true,
      intervalMs: 1000, legendFormat: '__auto', maxDataPoints: 43200,
      range: false, refId,
    },
  }
}

function threshold(refId, expression, value) {
  return {
    refId, queryType: 'expression', relativeTimeRange: { from: 0, to: 0 },
    datasourceUid: '__expr__',
    model: {
      conditions: [{
        evaluator: { params: [value], type: 'gt' }, operator: { type: 'and' },
        query: { params: [refId] }, reducer: { params: [], type: 'last' },
        type: 'query',
      }],
      datasource: { type: '__expr__', uid: '__expr__' }, expression,
      intervalMs: 1000, maxDataPoints: 43200, refId, type: 'threshold',
    },
  }
}

function rule({ uid, title, query, thresholdValue, duration, severity,
  summary, description, booleanThreshold = false }) {
  const data = [prometheusQuery('A', query)]
  if (booleanThreshold) data.push(prometheusQuery('B', `(${query}) >= bool ${thresholdValue}`))
  data.push(threshold('C', booleanThreshold ? 'B' : 'A', booleanThreshold ? 0.5 : thresholdValue))
  return {
    uid, orgID: 1, folderUID: 'cfwrpuv46m39ca',
    ruleGroup: 'order-email-operational', title, condition: 'C', data,
    noDataState: 'Alerting', execErrState: 'Error', for: duration,
    keep_firing_for: '5m',
    annotations: { summary, description, observed_value: '{{ $values.A.Value }}' },
    labels: {
      component: 'order_email', environment: 'production',
      service: 'dropleather-api-railway-candidate', severity,
    },
    notification_settings: { receiver: 'Owner' }, isPaused: false,
  }
}

export const orderEmailAlerts = [
  rule({
    uid: 'order-email-backlog-age', title: 'DropLeather Order Email — Backlog Age',
    query: backlogQuery, thresholdValue: 600, duration: '5m', severity: 'high',
    summary: 'Oldest actionable order email has exceeded 10 minutes',
    description: 'Inspect the order-email outbox, dispatcher, and QStash delivery. Check the row status and provider idempotency state before manually resending. A missing or stale database observation also requires investigation.',
  }),
  rule({
    uid: 'order-email-failed-jobs', title: 'DropLeather Order Email — Failed Jobs',
    query: failedQuery, thresholdValue: 0, duration: '2m', severity: 'high',
    summary: 'Terminal or uncertain order-email jobs need review',
    description: 'Inspect order_email_outbox_failed_count by reason and the affected outbox row. send_outcome_unknown may already have reached Resend; check provider outcome and idempotency before any retry. A missing or stale database observation also requires investigation.',
  }),
  rule({
    uid: 'order-email-send-failures', title: 'DropLeather Order Email — Sustained Send Failures',
    query: sendFailureQuery, thresholdValue: 3, booleanThreshold: true,
    duration: '5m', severity: 'high',
    summary: 'Three or more retryable order-email sends failed within 10 minutes',
    description: 'Check Resend availability, rate limits, Railway API logs, and QStash retries. One isolated provider failure does not trigger this alert. A Resend API acceptance is not proof of inbox delivery.',
  }),
  rule({
    uid: 'order-email-invalid-signatures', title: 'DropLeather Order Email — Invalid QStash Signatures',
    query: signatureFailureQuery, thresholdValue: 3, booleanThreshold: true,
    duration: '2m', severity: 'warning',
    summary: 'Repeated invalid QStash signatures reached the order-email endpoint',
    description: 'Inspect the order-email endpoint security logs and QStash signing-key configuration. Do not disclose signatures, tokens, or request bodies. One stray rejected request does not trigger this alert.',
  }),
]
