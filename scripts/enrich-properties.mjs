import { readFile, writeFile, rename } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { collectParcelDetails } from '../collectors/parcel-details-source.mjs';
const M = createRequire(import.meta.url)('../docs/property-model.js');
const root = fileURLToPath(new URL('../', import.meta.url));
const dataset = JSON.parse(await readFile(resolve(root, 'docs/data/records.json'), 'utf8'));
const ids = [...new Set(dataset.records.filter(record => record.zip === '27260' && !record.geography_conflict && record.record_type !== 'parcel' && M.countyKey(record) === 'guilford').map(record => M.parcelId(record.parcel_id)).filter(Boolean))];
const path = resolve(root, 'docs/data/property-details.json');
let before = { records: [], retrieved_at: null };
try { before = JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const attempted = new Date().toISOString();
let result;
try {
  result = { ...await collectParcelDetails(ids), last_attempt_at: attempted, last_error: null };
} catch (error) {
  result = { ...before, last_attempt_at: attempted, last_error: String(error?.message || 'County property detail collection failed').slice(0, 600) };
}
await writeFile(path + '.tmp', JSON.stringify(result));
await rename(path + '.tmp', path);
console.log(JSON.stringify({ records: result.records.length, last_success_at: result.retrieved_at, last_error: result.last_error }));
