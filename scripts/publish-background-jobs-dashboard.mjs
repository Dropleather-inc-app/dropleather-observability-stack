import { readFileSync, statSync } from 'node:fs'
import { dashboard } from '../grafana/background-jobs-dashboard.mjs'

const tokenFile = process.env.GRAFANA_TOKEN_FILE
if (!tokenFile) throw new Error('GRAFANA_TOKEN_FILE must name an owner-only Grafana API token file')
if (statSync(tokenFile).mode & 0o077) throw new Error('Grafana token file must be owner-only')
const token = readFileSync(tokenFile, 'utf8').trim()
if (!token) throw new Error('Grafana token file is empty')

const base = process.env.GRAFANA_URL || 'https://gr.dropleather.com'
async function grafana(path, init = {}) {
  const response = await fetch(new URL(path, base), {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
  })
  if (!response.ok) throw new Error(`${init.method || 'GET'} ${path} returned HTTP ${response.status}`)
  return response.json()
}

const folderUid = 'cfwrpuv46m39ca'
const folder = await grafana(`/api/folders/${folderUid}`)
if (folder.title !== 'DropLeather') throw new Error('Production folder mismatch')
const existing = await grafana('/api/search?type=dash-db')
if (existing.some(item => item.title === dashboard.title && item.uid !== dashboard.uid)) {
  throw new Error('A dashboard with this title already exists under a different UID')
}
const result = await grafana('/api/dashboards/db', {
  method: 'POST',
  body: JSON.stringify({ dashboard, folderUid, overwrite: true, message: 'Publish production background jobs dashboard' }),
})
console.log(JSON.stringify({ uid: result.uid, url: new URL(result.url, base).toString(), status: result.status }))
