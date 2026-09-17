import { alerts, dashboard } from '../grafana/admin-operational-health.mjs'

const configuredUrl = process.env.GRAFANA_URL || process.env.RAILWAY_STATIC_URL || 'https://gr.dropleather.com'
const baseUrl = /^https?:\/\//.test(configuredUrl) ? configuredUrl : `https://${configuredUrl}`
const username = process.env.GF_SECURITY_ADMIN_USER
const password = process.env.GF_SECURITY_ADMIN_PASSWORD
if (!username || !password) throw new Error('Grafana admin credentials are required')
const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`

async function grafana(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { authorization, 'content-type': 'application/json', ...(init.headers || {}) },
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${init.method || 'GET'} ${path}: ${response.status} ${text.slice(0, 500)}`)
  return text ? JSON.parse(text) : null
}

const saved = await grafana('/api/dashboards/db', {
  method: 'POST', body: JSON.stringify({ dashboard, overwrite: true, message: 'Publish DropLeather admin operational health dashboard' }),
})

const existing = await grafana('/api/v1/provisioning/alert-rules')
for (const rule of alerts) {
  const found = existing.find(item => item.uid === rule.uid)
  await grafana(`/api/v1/provisioning/alert-rules${found ? `/${rule.uid}` : ''}`, {
    method: found ? 'PUT' : 'POST', body: JSON.stringify(rule),
  })
}

console.log(JSON.stringify({ dashboardUrl: new URL(saved.url, baseUrl).toString(), dashboardUid: dashboard.uid, alerts: alerts.map(({ uid, title }) => ({ uid, title })) }))
