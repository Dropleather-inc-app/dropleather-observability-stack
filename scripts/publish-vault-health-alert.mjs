import { readFileSync, statSync } from 'node:fs'
import { vaultHealthAlert } from '../grafana/vault-health-alert.mjs'

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
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  if (!response.ok) throw new Error(`${init.method || 'GET'} ${path} returned HTTP ${response.status}`)
  return response.json()
}

const [rules, contacts] = await Promise.all([
  grafana('/api/v1/provisioning/alert-rules'),
  grafana('/api/v1/provisioning/contact-points'),
])
if (rules.some(rule => rule.uid === vaultHealthAlert.uid || rule.title === vaultHealthAlert.title)) {
  throw new Error('Vault alert already exists; review the live rule before changing it')
}
if (!rules.some(rule => rule.folderUID === vaultHealthAlert.folderUID && rule.ruleGroup === vaultHealthAlert.ruleGroup)) {
  throw new Error('Expected production dependency alert group is missing')
}
if (!contacts.some(contact => contact.name === vaultHealthAlert.notification_settings.receiver)) {
  throw new Error('Expected production contact point is missing')
}

// Existing dependency rules are UI-managed. Preserve their provenance and editability.
const created = await grafana('/api/v1/provisioning/alert-rules', {
  method: 'POST',
  headers: { 'X-Disable-Provenance': 'true' },
  body: JSON.stringify(vaultHealthAlert),
})
console.log(JSON.stringify({ uid: created.uid, title: created.title, group: created.ruleGroup }))
