#!/usr/bin/env python3
"""Update only Grafana dashboard/panel annotations after panel ownership changes."""
import json
import os
import pathlib
import urllib.error
import urllib.request

base = os.environ.get('GRAFANA_URL', 'https://gr.dropleather.com').rstrip('/')
token_file = pathlib.Path(os.environ['GRAFANA_TOKEN_FILE'])
if token_file.stat().st_mode & 0o077:
    raise SystemExit('Grafana token file must be owner-only')
token = token_file.read_text().strip()
if not token:
    raise SystemExit('Grafana token file is empty')
headers = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json', 'X-Disable-Provenance': 'true'}

# Alert UID: (existing dashboard UID, existing panel ID, new dashboard UID, new panel ID).
changes = {
    'efws0na2d9d6od': ('ou85rg7', '32', 'integrations-operational-health', '108'),
    'ffws2fit7c54wa': ('ou85rg7', '42', 'dropleather-background-jobs', '21'),
    'dfwrz1m97gg00c': ('ou85rg7', '42', 'dropleather-background-jobs', '21'),
    'afwsjzb1q0g74f': ('ou85rg7', '45', 'dropleather-background-jobs', '65'),
    'dfwrxb0kky7swb': ('ou85rg7', '43', 'dropleather-background-jobs', '83'),
    'bfws2zuq4rocga': ('ou85rg7', '41', 'dropleather-background-jobs', '11'),
    'ffwy5fcjzjrb4e': ('d402d94e-da48-48e4-ac52-53026b96a000', '323', 'd402d94e-da48-48e4-ac52-53026b96a000', '370'),
    'bfwy5ff4iscg0d': ('d402d94e-da48-48e4-ac52-53026b96a000', '323', 'd402d94e-da48-48e4-ac52-53026b96a000', '371'),
    'cfwy5felg29dsa': ('d402d94e-da48-48e4-ac52-53026b96a000', '154', 'd402d94e-da48-48e4-ac52-53026b96a000', '372'),
}

def request(path, *, method='GET', body=None):
    data = None if body is None else json.dumps(body).encode()
    try:
        with urllib.request.urlopen(urllib.request.Request(base + path, data=data, method=method, headers=headers), timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        if method != 'PUT' or error.code != 409:
            raise
        # Some existing rules were created with API provenance. Grafana rejects
        # X-Disable-Provenance for those rules, so preserve their provenance.
        api_headers = {key: value for key, value in headers.items() if key != 'X-Disable-Provenance'}
        with urllib.request.urlopen(urllib.request.Request(base + path, data=data, method=method, headers=api_headers), timeout=30) as response:
            return json.load(response)

for uid, (old_dashboard, old_panel, new_dashboard, new_panel) in changes.items():
    rule = request(f'/api/v1/provisioning/alert-rules/{uid}')
    annotations = rule.get('annotations', {})
    actual = (annotations.get('__dashboardUid__'), annotations.get('__panelId__'))
    if actual == (new_dashboard, new_panel) and rule.get('missingSeriesEvalsToResolve') == 2:
        print(f'{uid}: already linked')
        continue
    if actual not in {(old_dashboard, old_panel), (new_dashboard, new_panel)}:
        raise SystemExit(f'{uid}: unexpected original link; stopped')
    for field in ('id', 'orgID', 'updated', 'record'):
        rule.pop(field, None)
    rule['missingSeriesEvalsToResolve'] = 2
    rule['annotations']['__dashboardUid__'] = new_dashboard
    rule['annotations']['__panelId__'] = new_panel
    updated = request(f'/api/v1/provisioning/alert-rules/{uid}', method='PUT', body=rule)
    if updated.get('annotations', {}).get('__panelId__') != new_panel:
        raise SystemExit(f'{uid}: relink verification failed')
    print(f'{uid}: linked')
