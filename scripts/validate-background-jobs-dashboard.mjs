import { dashboard, queries } from '../grafana/background-jobs-dashboard.mjs'

if (dashboard.title !== 'Background Jobs & Delivery') throw new Error('Unexpected dashboard title')
if (dashboard.uid !== 'dropleather-background-jobs') throw new Error('Unexpected dashboard UID')
const panels = dashboard.panels.filter(panel => panel.type !== 'row')
const metricPanels = panels.filter(panel => panel.type !== 'alertlist')
if (panels.length < 25) throw new Error('Incomplete background processing coverage')
if (new Set(dashboard.panels.map(panel => panel.id)).size !== dashboard.panels.length) throw new Error('Duplicate panel ID')
if (panels.filter(panel => panel.type === 'alertlist').length !== 1) throw new Error('Async alert-state stat missing')
for (const panel of metricPanels) {
  if (panel.datasource?.uid !== 'grafana_prometheus' || panel.targets?.length !== 1) throw new Error(`Invalid datasource: ${panel.title}`)
  if (panel.fieldConfig?.defaults?.noValue !== 'NO DATA') throw new Error(`Missing-data rendering is misleading: ${panel.title}`)
  if (panel.gridPos.x < 0 || panel.gridPos.x + panel.gridPos.w > 24) throw new Error(`Invalid layout: ${panel.title}`)
}
for (const a of panels) for (const b of panels) {
  if (a.id >= b.id) continue
  const xOverlap = a.gridPos.x < b.gridPos.x + b.gridPos.w && b.gridPos.x < a.gridPos.x + a.gridPos.w
  const yOverlap = a.gridPos.y < b.gridPos.y + b.gridPos.h && b.gridPos.y < a.gridPos.y + a.gridPos.h
  if (xOverlap && yOverlap) throw new Error(`Overlapping panels: ${a.title} / ${b.title}`)
}
const serialized = JSON.stringify(queries).toLowerCase()
for (const forbidden of ['user_id', 'order_id', 'connection_id', 'message_id', 'email', 'url', 'error_message']) {
  if (forbidden === 'email') continue // Metric family is intentionally named order_email.
  if (serialized.includes(`by(${forbidden}`) || serialized.includes(`by (${forbidden}`)) throw new Error(`High-cardinality grouping: ${forbidden}`)
}
if (serialized.includes('qstash_dlq_count')) throw new Error('Unverified QStash DLQ metric')
console.log(JSON.stringify({ rows: dashboard.panels.length - panels.length, panels: panels.length, queries: Object.keys(queries).length, status: 'valid' }))
