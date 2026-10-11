import { readFileSync } from 'node:fs'
import { dashboard as admin } from '../grafana/admin-operational-health.mjs'
import { dashboard as background } from '../grafana/background-jobs-dashboard.mjs'
const definitions = [
  JSON.parse(readFileSync(new URL('../grafana/dashboards/api.json', import.meta.url))),
  JSON.parse(readFileSync(new URL('../grafana/dashboards/auth.json', import.meta.url))),
  admin,
  JSON.parse(readFileSync(new URL('../grafana/dashboards/database.json', import.meta.url))),
  JSON.parse(readFileSync(new URL('../grafana/dashboards/integrations.json', import.meta.url))),
  background,
]
const names = ['API & Platform Health', 'Authentication & Security', 'Admin Operations', 'Data & Database Health', 'Integrations Health', 'Background Jobs & Delivery']
if (new Set(definitions.map(d => d.uid)).size !== 6) throw new Error('Duplicate dashboard UID')
const expressions = new Map()
let count = 0
for (let i = 0; i < definitions.length; i++) {
  const d = definitions[i]
  if (d.title !== names[i]) throw new Error(`Unexpected title: ${d.title}`)
  if (!d.tags.includes('production')) throw new Error(`Missing production tag: ${d.title}`)
  const ids = new Set()
  const nonRow = d.panels.filter(p => p.type !== 'row')
  for (const p of d.panels) {
    if (ids.has(p.id)) throw new Error(`Duplicate panel ID: ${d.title}/${p.id}`)
    ids.add(p.id)
    if (p.gridPos.x < 0 || p.gridPos.x + p.gridPos.w > 24) throw new Error(`Invalid grid: ${d.title}/${p.title}`)
    for (const t of p.targets || []) {
      if (!t.expr) continue
      const expr = t.expr.replace(/\s+/g, '')
      if (expressions.has(expr)) throw new Error(`Duplicate query: ${d.title}/${p.title} and ${expressions.get(expr)}`)
      expressions.set(expr, `${d.title}/${p.title}`)
      if (/by\((user_id|order_id|connection_id|message_id|email|url|error_message)/.test(expr)) throw new Error(`High-cardinality grouping: ${d.title}/${p.title}`)
    }
  }
  for (const a of nonRow) for (const b of nonRow) {
    if (a.id >= b.id) continue
    if (a.gridPos.x < b.gridPos.x + b.gridPos.w && b.gridPos.x < a.gridPos.x + a.gridPos.w && a.gridPos.y < b.gridPos.y + b.gridPos.h && b.gridPos.y < a.gridPos.y + a.gridPos.h) throw new Error(`Overlapping panels: ${d.title}/${a.title}/${b.title}`)
  }
  count += nonRow.length
}
console.log(JSON.stringify({ dashboards: definitions.length, panels: count, uniqueQueries: expressions.size, status: 'valid' }))
