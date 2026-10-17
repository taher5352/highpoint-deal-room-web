import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { collectParcels } from '../collectors/parcel-source.mjs';
import { collectCodeCases } from '../collectors/code-source.mjs';
import { collectForeclosures } from '../collectors/foreclosure-source.mjs';
import { collectTax } from '../collectors/tax-source.mjs';
import { joinMarket, normalId, slimParcel } from './market.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const { validState } = require('../docs/model.js');
export const SOURCE_INFO = {
  parcels: { name: 'Official parcel addresses · 27260', scope: 'County and city active property addresses agree on ZIP 27260; Guilford County only', url: 'https://parcelresearch.guilfordcountync.gov/' },
  code_cases: { name: 'High Point code cases', scope: 'High Point city jurisdiction; ZIP matched by Guilford parcel ID', url: 'https://www.highpointnc.gov/2982/Development-Records' },
  foreclosures: { name: 'Guilford County foreclosures', scope: 'Guilford County; ZIP matched through official parcel records', url: 'https://www.guilfordcountync.gov/government/departments-and-agencies/tax-department/foreclosures' },
  tax_bills: { name: 'Guilford unpaid property-tax bills', scope: 'Real-property bills matched to the official 27260 parcel base', url: 'https://bcpwa.ncptscloud.com/Guilford/downloads' }
};
const SCHEDULE = { enabled: true, timezone: 'America/New_York', times: ['09:00', '16:00'], provider: 'GitHub Actions', timing_note: 'Scheduled jobs may be delayed. Public repositories with no activity for 60 days can have schedules disabled; successful refresh commits normally keep this repository active.' };
const NOTES = [
  'Public records are research signals. Owner willingness, listing status, asking price, market value and repair cost have not been established.',
  'ZIP is an exact identifier join to a county/city property-address agreement, never an owner mailing ZIP. Unmatched or conflicting geography stays outside the 27260 view.',
  'Tax bills may be historical or not yet legally delinquent. Keep bill IDs, years, balances and publisher flags distinct.',
  'Probate is not connected. The archived 2019 city code layer is excluded. No owner contact details are published.',
  'Collection runs independently on GitHub Actions. Shared scenarios are edited by the repository owner in config/workspace.json.'
];

export function validateResult(id, result) {
  if (!Array.isArray(result?.records) || result.records.length > 25000) throw Error('Unexpected source record count; last good data retained');
  if (result.records.some(record => !record.id || record.source_id !== id)) throw Error('Source record IDs failed validation');
  if (new Set(result.records.map(record => record.id)).size !== result.records.length) throw Error('Duplicate source record IDs');
  if (id === 'parcels' && result.records.length === 0) throw Error('Parcel base is empty; refusing to discard the last good base');
}

export async function collectSnapshot(previous, collectors, now = () => new Date().toISOString()) {
  const started_at = now(), datasets = {}, statuses = new Map((previous.sources || []).map(source => [source.id, source]));
  for (const id of Object.keys(SOURCE_INFO)) datasets[id] = (previous.records || []).filter(record => record.source_id === id);
  const summary = {};
  for (const id of Object.keys(SOURCE_INFO)) {
    const attempt = now();
    try {
      const targetParcels = new Map(datasets.parcels.map(parcel => [normalId(parcel.parcel_id), parcel]));
      if (id === 'tax_bills' && !targetParcels.size) throw Error('No verified property parcel base available for tax filtering');
      const result = await collectors[id](targetParcels);
      validateResult(id, result);
      datasets[id] = id === 'parcels' ? result.records.map(slimParcel) : result.records;
      statuses.set(id, { id, ...SOURCE_INFO[id], record_count: datasets[id].length, last_attempt_at: attempt,
        last_success_at: now(), last_error: null, state: 'collected', metadata: { ...result.metadata, source_updated_at: result.source_updated_at || null } });
      summary[id] = { status: 'succeeded', records: datasets[id].length };
    } catch (error) {
      // Generic errors only: temporary signed download URLs never reach logs or public JSON.
      const message = id === 'tax_bills' && /https?:|sig=/i.test(String(error?.message)) ? 'Public tax collection failed; check provider availability' : String(error?.message || 'Source collection failed').slice(0, 600);
      const before = statuses.get(id);
      statuses.set(id, { ...before, id, ...SOURCE_INFO[id], record_count: datasets[id].length,
        last_attempt_at: attempt, last_success_at: before?.last_success_at || null, last_error: message,
        state: before?.last_success_at ? 'last_good_retained' : 'not_collected', metadata: before?.metadata || {} });
      summary[id] = { status: 'failed', retained_records: datasets[id].length, error: message };
    }
  }
  const successes = Object.values(summary).filter(source => source.status === 'succeeded').length;
  return { schema_version: 1, generated_at: now(), sources: Object.keys(SOURCE_INFO).map(id => statuses.get(id)), records: joinMarket(datasets),
    last_run: { id: `refresh-${started_at}`, started_at, finished_at: now(), status: successes === 4 ? 'succeeded' : successes ? 'partial' : 'failed', summary }, schedule: SCHEDULE, notes: NOTES };
}

async function writeJson(path, value) {
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(path + '.tmp', JSON.stringify(value) + '\n');
  await rename(path + '.tmp', path);
}

export async function main(args = process.argv.slice(2)) {
  const workspace = JSON.parse(await readFile(resolve(ROOT, 'config/workspace.json'), 'utf8'));
  if (!validState(workspace)) throw Error('Shared scenario file is invalid. Fix config/workspace.json before publishing.');
  if (args.includes('--workspace-only')) {
    await writeJson(resolve(ROOT, 'docs/data/workspace.json'), workspace);
    return;
  }
  const seedFlag = args.indexOf('--seed');
  const dataPath = resolve(ROOT, 'docs/data/records.json');
  let previous;
  try { previous = JSON.parse(await readFile(seedFlag >= 0 ? resolve(args[seedFlag + 1]) : dataPath, 'utf8')); }
  catch (error) { if (seedFlag >= 0 || error.code !== 'ENOENT') throw error; previous = { sources: [], records: [] }; }
  let data;
  if (seedFlag >= 0) {
    const datasets = Object.fromEntries(Object.keys(SOURCE_INFO).map(id => [id, previous.records.filter(record => record.source_id === id).map(record => id === 'parcels' ? slimParcel(record) : record)]));
    for (const [id, records] of Object.entries(datasets)) validateResult(id, { records });
    data = { ...previous, records: joinMarket(datasets), schedule: SCHEDULE, notes: NOTES };
  } else {
    data = await collectSnapshot(previous, { parcels: () => collectParcels(), code_cases: () => collectCodeCases(), foreclosures: () => collectForeclosures(), tax_bills: targetParcels => collectTax(fetch, { targetParcels }) });
  }
  await writeJson(dataPath, data);
  await writeJson(resolve(ROOT, 'docs/data/workspace.json'), workspace);
  console.log(JSON.stringify({ status: data.last_run?.status, records: data.records.length, sources: data.sources.map(source => ({ id: source.id, records: source.record_count, error: source.last_error })) }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
