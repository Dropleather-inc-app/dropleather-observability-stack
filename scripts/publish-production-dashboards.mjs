import { readFileSync, statSync } from 'node:fs'
import { dashboard as admin } from '../grafana/admin-operational-health.mjs'
import { dashboard as background } from '../grafana/background-jobs-dashboard.mjs'

const tokenFile = process.env.GRAFANA_TOKEN_FILE
if (!tokenFile) throw new Error('GRAFANA_TOKEN_FILE must name an owner-only Grafana API token file')
if (statSync(tokenFile).mode & 0o077) throw new Error('Grafana token file must be owner-only')
const token = readFileSync(tokenFile, 'utf8').trim()
if (!token) throw new Error('Grafana token file is empty')
const base = process.env.GRAFANA_URL || 'https://gr.dropleather.com'
const folderUid = 'cfwrpuv46m39ca'
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
for (let i = 0; i < names.length; i++) {
  if (definitions[i].title !== names[i]) throw new Error(`Unexpected dashboard title at ${i}`)
}
async function grafana(path, init = {}) {
  const response = await fetch(new URL(path, base), {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json', ...(init.headers || {}) },
  })
  if (!response.ok) throw new Error(`${init.method || 'GET'} ${path} returned HTTP ${response.status}`)
  return response.json()
}
const folder = await grafana(`/api/folders/${folderUid}`)
if (!['DropLeather API', 'DropLeather'].includes(folder.title)) throw new Error('Production folder mismatch')
const existing = await grafana('/api/search?type=dash-db')
for (const d of definitions) {
  if (!existing.some(item => item.uid === d.uid)) throw new Error(`Existing dashboard missing: ${d.uid}`)
  if (existing.some(item => item.title === d.title && item.uid !== d.uid)) throw new Error(`Dashboard title collision: ${d.title}`)
}
if (folder.title !== 'DropLeather') {
  await grafana(`/api/folders/${folderUid}`, { method: 'PUT', body: JSON.stringify({ title: 'DropLeather', uid: folderUid, overwrite: true }) })
}
for (const d of definitions) {
  const saved = await grafana('/api/dashboards/db', {
    method: 'POST', body: JSON.stringify({ dashboard: d, folderUid, overwrite: true, message: 'Canonical production dashboard reorganization' }),
  })
  if (saved.uid !== d.uid) throw new Error(`Dashboard UID changed for ${d.title}`)
  console.log(JSON.stringify({ title: d.title, uid: saved.uid, status: saved.status }))
}
