import assert from 'node:assert/strict'
import test from 'node:test'
import { orderEmailAlerts, sendFailureQuery, metricsMissingQuery } from '../grafana/order-email-alerts.mjs'

test('send failures require three real failures and never page on NoData', () => {
  const rule = orderEmailAlerts.find(x => x.uid === 'order-email-send-failures')
  assert.ok(rule)
  assert.match(sendFailureQuery, /sum\(increase\(order_email_send_total.*\[10m\]\)\)/)
  assert.match(sendFailureQuery, /or vector\(0\)/)
  assert.equal(rule.data[1].model.expr, `(${sendFailureQuery}) >= bool 3`)
  assert.equal(rule.for, '5m')
  assert.equal(rule.noDataState, 'OK')
  assert.equal(rule.execErrState, 'Error')
})

test('missing instrumentation is a separate warning gated by healthy API scrape', () => {
  const rule = orderEmailAlerts.find(x => x.uid === 'order-email-metrics-missing')
  assert.ok(rule)
  assert.match(metricsMissingQuery, /up\{job="dropleather-api"\}/)
  assert.match(metricsMissingQuery, /http_server_active_requests\{service_name="dropleather-api-railway-candidate"\}/)
  assert.match(metricsMissingQuery, /absent_over_time\(order_email_send_total.*\[5m\]\)/)
  assert.equal(rule.for, '5m')
  assert.equal(rule.labels.severity, 'warning')
  assert.equal(rule.labels.component, 'order_email_telemetry')
  assert.equal(rule.noDataState, 'OK')
  assert.equal(rule.execErrState, 'Error')
  assert.match(rule.annotations.description, /does NOT by itself mean customer emails are failing/)
})
