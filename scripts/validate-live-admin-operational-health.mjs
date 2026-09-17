const configuredUrl = process.env.GRAFANA_URL || process.env.RAILWAY_STATIC_URL || 'https://gr.dropleather.com'
const baseUrl = /^https?:\/\//.test(configuredUrl) ? configuredUrl : `https://${configuredUrl}`
const username = process.env.GF_SECURITY_ADMIN_USER
const password = process.env.GF_SECURITY_ADMIN_PASSWORD
if (!username || !password) throw new Error('Grafana admin credentials are required')
const headers = { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` }

async function json(path) {
  const response = await fetch(`${baseUrl}${path}`, { headers })
  const body = await response.json()
  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(body).slice(0, 500)}`)
  return body
}

const saved = await json('/api/dashboards/uid/dropleather-admin-health')
const queryResults = []
for (const panel of saved.dashboard.panels) {
  for (const target of panel.targets || []) {
    const expr = target.expr.replaceAll('$__rate_interval', '5m')
    const result = await json(`/api/datasources/proxy/uid/grafana_prometheus/api/v1/query?query=${encodeURIComponent(expr)}`)
    if (result.status !== 'success') throw new Error(`Prometheus rejected panel ${panel.id}`)
    queryResults.push({ panelId: panel.id, title: panel.title, series: result.data.result.length })
  }
}

const heartbeat = queryResults.find(result => result.panelId === 2)
if (!heartbeat || heartbeat.series < 1) throw new Error('Production admin heartbeat is not ingested')
const rules = await json('/api/v1/provisioning/alert-rules')
const adminRules = rules.filter(rule => rule.ruleGroup === 'admin-operational')
if (adminRules.length !== 6 || adminRules.some(rule => rule.isPaused)) throw new Error('Admin alert rule publication mismatch')

console.log(JSON.stringify({
  dashboard: saved.meta.url,
  dashboardVersion: saved.meta.version,
  panelQueries: queryResults,
  alertRules: adminRules.map(rule => ({ uid: rule.uid, title: rule.title, noDataState: rule.noDataState, receiver: rule.notification_settings?.receiver })),
}))
