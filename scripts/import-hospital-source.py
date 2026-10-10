"""Import only selected hospital-held fields from the official synthetic sample.

The archive stays in memory; only the explicit allowlist below is written.
Run with Python 3. No third-party packages are needed.
"""
import csv
import hashlib
import io
import json
from pathlib import Path
import re
import urllib.request
import zipfile

URL = 'https://synthetichealth.github.io/synthea-sample-data/downloads/10k_synthea_covid19_csv.zip'
AS_OF = '2026-10-10'
ROOT = Path(__file__).resolve().parents[1]

def import_source():
    archive_bytes = urllib.request.urlopen(URL, timeout=180).read()
    archive = zipfile.ZipFile(io.BytesIO(archive_bytes))

    def rows(table):
        name = next(name for name in archive.namelist() if name.endswith('/' + table + '.csv') or name == table + '.csv')
        return csv.DictReader(io.TextIOWrapper(archive.open(name), encoding='utf-8-sig'))

    adults = []
    for row in rows('patients'):
        if row['DEATHDATE'] or row['BIRTHDATE'] > '2008-10-10':
            continue
        birth = row['BIRTHDATE']
        age = 2026 - int(birth[:4]) - (birth[5:] > '10-10')
        adults.append({
            'syntheaId': row['Id'], 'birthDate': birth, 'age': age, 'sex': row['GENDER'],
            'name': re.sub(r'\d+', '', row['FIRST'] + ' ' + row['LAST']),
        })
    adults.sort(key=lambda row: row['syntheaId'])
    if len(adults) < 1000:
        raise ValueError('The official sample must contain at least 1,000 living adults.')
    selected = adults[:1000]
    anchor = next(row for row in adults if row['sex'] == 'F' and row['age'] == 67)
    if anchor in selected:
        anchor_index = selected.index(anchor)
        selected[anchor_index], selected[411] = selected[411], selected[anchor_index]
    else:
        selected[411] = anchor
    indexed = {row['syntheaId']: row for row in selected}
    for row in rows('conditions'):
        if row['PATIENT'] in indexed and not row['STOP']:
            indexed[row['PATIENT']].setdefault('sourceProblem', {
                'code': row['CODE'], 'display': row['DESCRIPTION'], 'date': row['START'], 'system': 'SNOMED CT',
            })
    provenance = {
        'source': 'Official Synthea COVID-19 10K CSV sample', 'sourceUrl': URL,
        'downloadPage': 'https://synthetichealth.github.io/downloads.html',
        'archiveSha256': hashlib.sha256(archive_bytes).hexdigest(),
        'selectedAdults': len(selected), 'availableAdults': len(adults), 'asOf': AS_OF,
        'importedFields': ['synthetic identifier', 'name', 'birth date', 'sex', 'active problem code and description'],
        'adaptation': 'Synthetic source demographics and active problems are imported. Index admissions, dates, labs, prescriptions, pharmacy pickup, appointments, social needs, and clinical notes are deterministic hospital scenarios added for this demonstration. They are not native source stays.',
    }
    output = '/** Allowlisted synthetic source records; regenerate with scripts/import-hospital-source.py. */\n'
    output += 'export const sourceProvenance = ' + json.dumps(provenance, ensure_ascii=True, separators=(',', ':')) + ';\n'
    output += 'export const sourcePatients = ' + json.dumps(selected, ensure_ascii=True, separators=(',', ':')) + ';\n'
    (ROOT / 'dist' / 'hospital-data.js').write_text(output, encoding='utf-8')
    print(json.dumps({'selectedAdults': len(selected), 'availableAdults': len(adults), 'archiveSha256': provenance['archiveSha256']}))

if __name__ == '__main__':
    import_source()
