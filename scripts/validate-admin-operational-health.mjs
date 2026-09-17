import { alerts, dashboard } from '../grafana/admin-operational-health.mjs'

const serialized = JSON.stringify([
  ...dashboard.panels.flatMap(panel => panel.targets || []),
  ...alerts.flatMap(alert => alert.data.map(item => item.model)),
])
for (const forbidden of ['user_id', 'email', 'session_id', 'access_token', 'refresh_token', 'cookie', 'password']) {
  if (serialized.toLowerCase().includes(forbidden)) throw new Error(`Forbidden high-cardinality or secret field: ${forbidden}`)
}
if (dashboard.title !== 'DropLeather Admin — Operational Health') throw new Error('Unexpected dashboard title')
if (dashboard.panels.some(panel => panel.fieldConfig?.defaults?.noValue === 'OK')) throw new Error('Missing data must not render as healthy')
if (alerts.some(rule => !rule.notification_settings?.receiver || rule.keep_firing_for !== '5m')) throw new Error('Alert routing or recovery window missing')
if (alerts.some(rule => /401|403|invalid.password/i.test(rule.data[0].model.expr))) throw new Error('Expected denial included in alert query')
console.log(JSON.stringify({ panels: dashboard.panels.length, alerts: alerts.length, status: 'valid' }))
