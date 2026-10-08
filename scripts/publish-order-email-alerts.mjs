import { readFileSync, statSync } from 'node:fs'
import { orderEmailAlerts } from '../grafana/order-email-alerts.mjs'

const tokenFile = process.env.GRAFANA_TOKEN_FILE
if (!tokenFile) throw new Error('GRAFANA_TOKEN_FILE must name an owner-only Grafana API token file')
if (statSync(tokenFile).mode & 0o077) throw new Error('Grafana token file must be owner-only')
const token = readFileSync(tokenFile, 'utf8').trim()
if (!token) throw new Error('Grafana token file is empty')

const base = process.env.GRAFANA_URL || 'https://gr.dropleather.com'
async function grafana(path, init = {}) {
  const response = await fetch(new URL(path, base), {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`, Accept: 'application/json',
      'Content-Type': 'application/json', ...(init.headers || {}),
    },
  })
  if (!response.ok) throw new Error(`${init.method || 'GET'} ${path} returned HTTP ${response.status}`)
  return response.json()
}

const [existing, contacts] = await Promise.all([
  grafana('/api/v1/provisioning/alert-rules'),
  grafana('/api/v1/provisioning/contact-points'),
])
if (!contacts.some(point => point.name === 'Owner')) throw new Error('Existing Owner contact point missing')
if (!existing.some(rule => rule.folderUID === 'cfwrpuv46m39ca' && rule.ruleGroup === 'outbox-operational')) {
  throw new Error('Expected production outbox alert folder/group missing')
}
for (const rule of orderEmailAlerts) {
  const matches = existing.filter(item => item.uid === rule.uid || item.title === rule.title)
  if (matches.length) {
    if (matches.length !== 1 || matches[0].uid !== rule.uid || matches[0].title !== rule.title) {
      throw new Error(`Conflicting existing alert for ${rule.uid}`)
    }
    console.log(JSON.stringify({ uid: rule.uid, status: 'already-exists' }))
    continue
  }
  const created = await grafana('/api/v1/provisioning/alert-rules', {
    method: 'POST', headers: { 'X-Disable-Provenance': 'true' },
    body: JSON.stringify(rule),
  })
  console.log(JSON.stringify({ uid: created.uid, title: created.title, group: created.ruleGroup }))
}
