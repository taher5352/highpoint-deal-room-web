import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const M = require('../docs/property-model.js');
const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const SITE = 'https://taher5352.github.io/highpoint-deal-room-web/';
export const DOWNLOAD = SITE + 'downloads/High-Point-Property-Research.xlsx';
const col = (key, label, type = 'text', width = 20) => ({ key, label, type, width });
const safe = value => M.safeUrl(value);
const propertyKey = record => {
  const id = M.parcelId(record.parcel_id), county = M.countyKey(record);
  return county && id ? `${county}:${id}` : `record:${record.id}`;
};
const nonempty = value => value !== null && value !== undefined && value !== '';
const distinct = values => [...new Set(values.filter(nonempty))];
const cell = value => value === undefined || value === null ? null : typeof value === 'object' ? JSON.stringify(value) : value;
const table = (sheet, name, columns, objects) => ({ sheet, name, headerRow: 5, columns, rows: objects.map(object => columns.map(column => cell(object[column.key]))) });
const human = key => key.replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());

function rawColumn(key, values) {
  if (key === 'county_DEED_DATE') return col(key, 'County deed date raw epoch ms', 'number', 34);
  if (/url$|urls$/.test(key) && values.some(value => safe(value))) return col(key, human(key), 'url', 52);
  if (/date$|_at$/.test(key) && values.some(value => /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(String(value)))) return col(key, human(key), /_at$/.test(key) ? 'datetime' : 'date', 22);
  if (values.some(value => typeof value === 'number') && !/^(parcel_id|pin|id|source_record_id)$/.test(key)) return col(key, human(key), /amount|value|balance/i.test(key) ? 'currency' : 'number', 22);
  return col(key, human(key), 'text', /address|note|verification|status|source_url|description/i.test(key) ? 46 : 24);
}

export function buildWorkbookData(dataset, workspace, enrichment = {}) {
  const records = dataset.records || [], byKey = new Map(), leads = new Set();
  for (const record of records) {
    const key = propertyKey(record);
    const group = byKey.get(key) || []; group.push(record); byKey.set(key, group);
    if (record.zip === '27260' && !record.geography_conflict && record.record_type !== 'parcel' && key.startsWith('guilford:')) leads.add(key);
  }
  const details = new Map((enrichment.records || []).map(record => [M.parcelId(record.parcel_id || record.Short_Parcel_ID), record]));
  const detailKeys = distinct((enrichment.records || []).flatMap(Object.keys)).filter(key => !['parcel_id', 'official_property_url', 'photo_page_url', 'photo_url'].includes(key)).sort();
  const propertyObjects = [...leads].map(key => {
    const group = byKey.get(key), base = group.find(record => record.record_type === 'parcel'), first = base || group[0], id = M.parcelId(first.parcel_id);
    const cases = group.filter(record => record.record_type === 'code_case'), taxes = group.filter(record => record.record_type === 'tax_bill'), foreclosures = group.filter(record => record.record_type === 'foreclosure');
    const bills = new Map(taxes.map(record => [record.bill_number || record.id, record]));
    const detail = details.get(id) || {};
    const assessmentValues = distinct(foreclosures.map(record => record.amount));
    const sourceIds = distinct(group.map(record => record.source_id));
    const dates = (dataset.sources || []).filter(source => sourceIds.includes(source.id)).map(source => source.last_success_at).filter(Boolean).sort();
    return {
      property_key: key, parcel_id: id, address: first.address, city: first.city || 'High Point', county: 'Guilford', state: 'NC', zip: '27260',
      code_cases: cases.length, tax_bills: bills.size, foreclosure_rows: foreclosures.length, research_records: cases.length + taxes.length + foreclosures.length,
      latest_case_date: cases.map(record => record.event_date).filter(Boolean).sort().at(-1) || null,
      code_statuses: distinct(cases.map(record => record.status)).join('; '), foreclosure_statuses: distinct(foreclosures.map(record => record.status)).join('; '),
      tax_years: distinct(taxes.map(record => record.tax_year)).sort().join(', '),
      published_tax_balance: taxes.length ? Math.round([...bills.values()].reduce((total, record) => total + (Number.isFinite(record.amount) ? record.amount : 0), 0) * 100) / 100 : null,
      tax_balance_meaning: taxes.length ? 'Deduplicated published bill balances across the listed tax years; historical extract, not current payoff' : 'No matched bill in published extract; not tax clearance',
      foreclosure_assessed_value: assessmentValues.length === 1 ? assessmentValues[0] : null,
      foreclosure_assessed_values: assessmentValues.join(', '),
      asking_price: null, listing_status: 'Not verified', owner_sale_intent: 'Not verified',
      property_url: SITE + 'property.html?parcel=' + encodeURIComponent(id),
      official_property_url: M.countyPropertyUrl(first), current_tax_url: M.countyTaxUrl(first),
      photo_url: safe(detail.photo_url), photo_page_url: safe(detail.photo_page_url) || M.countyPropertyUrl(first),
      photo_status: safe(detail.photo_url) ? 'Direct public photo link supplied; image content and currentness not independently verified' : 'Use the county property page Photos tab; no direct image URL supplied',
      source_url: safe(enrichment.source_url) || base?.source_url || group[0].source_url,
      parcel_details_checked_at: detail.parcel_id ? enrichment.retrieved_at || null : null,
      oldest_related_source_check: dates[0] || null, latest_related_source_check: dates.at(-1) || null,
      ...Object.fromEntries(detailKeys.map(field => ['county_' + field, detail[field] ?? null]))
    };
  }).sort((a, b) => String(a.address).localeCompare(String(b.address)) || a.parcel_id.localeCompare(b.parcel_id));

  const propertyColumns = [
    col('property_key', 'Property key', 'text', 24), col('parcel_id', 'Parcel ID', 'text', 16), col('address', 'Property address', 'text', 38), col('city', 'City', 'text', 18), col('county', 'County', 'text', 16), col('state', 'State', 'text', 10), col('zip', 'Property ZIP', 'text', 14),
    col('code_cases', 'City code cases', 'number'), col('tax_bills', 'Published tax bills', 'number'), col('foreclosure_rows', 'Foreclosure source rows', 'number', 25), col('research_records', 'Research record count', 'number', 25),
    col('latest_case_date', 'Latest city case date', 'date', 24), col('code_statuses', 'City case statuses', 'text', 44), col('foreclosure_statuses', 'Foreclosure statuses', 'text', 36), col('tax_years', 'Tax years in extract', 'text', 36),
    col('published_tax_balance', 'Published tax balance total', 'currency', 28), col('tax_balance_meaning', 'Tax balance meaning', 'text', 62), col('foreclosure_assessed_value', 'Foreclosure assessed value', 'currency', 30), col('foreclosure_assessed_values', 'Distinct foreclosure assessments', 'text', 34),
    col('asking_price', 'Asking price not supplied', 'currency', 28), col('listing_status', 'Listing status', 'text', 22), col('owner_sale_intent', 'Sale intent', 'text', 22),
    col('property_url', 'Dashboard property link', 'url', 55), col('official_property_url', 'Official county property link', 'url', 55), col('current_tax_url', 'Current county tax bills link', 'url', 55),
    col('photo_url', 'Direct photograph link', 'url', 55), col('photo_page_url', 'County photograph page link', 'url', 55), col('photo_status', 'Photograph availability', 'text', 62),
    col('source_url', 'Parcel detail source link', 'url', 55), col('parcel_details_checked_at', 'Parcel details checked UTC', 'datetime', 26), col('oldest_related_source_check', 'Oldest related source check UTC', 'datetime', 30), col('latest_related_source_check', 'Latest related source check UTC', 'datetime', 30),
    ...detailKeys.map(key => rawColumn('county_' + key, (enrichment.records || []).map(record => record[key])))
  ];
  const firstKeys = ['property_key', 'id', 'source_id', 'record_type', 'parcel_id', 'pin', 'address', 'city', 'county', 'state', 'zip', 'case_id', 'status', 'event_date', 'event_date_type', 'amount', 'amount_label', 'source_url'];
  const allKeys = distinct([...firstKeys, ...records.flatMap(Object.keys).sort()]);
  const allObjects = records.map(record => ({ ...record, property_key: propertyKey(record) }));
  const allColumns = allKeys.map(key => rawColumn(key, records.map(record => record[key])));
  const sourceObjects = [...(dataset.sources || []).map(source => ({ ...source, metadata: source.metadata }))];
  if (enrichment.source_url) sourceObjects.push({ id: 'parcel_details', name: 'Guilford County public parcel characteristics', scope: enrichment.scope || 'Verified 27260 research parcels', url: enrichment.source_url, record_count: (enrichment.records || []).length,
    state: enrichment.last_error ? 'last_good_retained' : 'collected', last_success_at: enrichment.retrieved_at, last_attempt_at: enrichment.last_attempt_at || enrichment.retrieved_at, last_error: enrichment.last_error || null,
    metadata: { notes: enrichment.notes || [], requested_parcels: enrichment.requested_parcels, returned_rows: enrichment.returned_rows, batches: enrichment.batches, fields: detailKeys } });
  const sourceColumns = [col('id', 'Source ID'), col('name', 'Source name', 'text', 48), col('scope', 'Coverage', 'text', 62), col('url', 'Source link', 'url', 60), col('record_count', 'Source record count', 'number', 24), col('state', 'Collection status'), col('last_success_at', 'Last successful check UTC', 'datetime', 28), col('last_attempt_at', 'Last attempted check UTC', 'datetime', 28), col('last_error', 'Latest error', 'text', 60), col('metadata', 'Source metadata JSON', 'text', 90)];
  const scenarios = (workspace?.properties || []).map(property => ({ ...property, ...Object.fromEntries(Object.entries(workspace.settings || {}).map(([key, value]) => ['assumption_' + key, value])) }));
  const scenarioKeys = distinct(['id', 'name', 'purchase', 'rehab', 'resale', 'notes', 'source', 'researched', 'sample', ...['buyPct', 'sellPct', 'contingencyPct', 'monthlyHold', 'months', 'targetRoi', 'targetProfit'].map(key => 'assumption_' + key), ...scenarios.flatMap(Object.keys)]);
  return { tables: [table('Properties', 'PropertiesTable', propertyColumns, propertyObjects), table('All records', 'AllRecordsTable', allColumns, allObjects), table('Sources', 'SourcesTable', sourceColumns, sourceObjects), table('Scenarios', 'ScenariosTable', scenarioKeys.map(key => rawColumn(key, scenarios.map(record => record[key]))), scenarios)],
    snapshot: { generatedAt: dataset.generated_at, lastRunStatus: dataset.last_run?.status || 'Not supplied', finishedAt: dataset.last_run?.finished_at || null,
      schedule: '9 AM and 4 PM Eastern (runs may be delayed)', properties: propertyObjects.length, records: records.length, sources: sourceObjects.length,
      sourceErrors: sourceObjects.filter(source => source.last_error).length, directPhotos: propertyObjects.filter(property => property.photo_url).length, latestDownload: DOWNLOAD, dashboard: SITE, recordsUrl: SITE + 'data/records.json',
      notes: ['These are government property research records, not verified real-estate listings. Asking prices, listing descriptions and sale intent are not supplied.', 'Properties contains matched 27260 research parcels. All records retains every saved source row, including the parcel base and records outside verified ZIP scope.', 'County DEED_DATE can contain a historical placeholder. Raw county date values are retained as supplied; do not infer a valid sale date from a placeholder.', 'Lot size is retained in the source unit; verify units with the county metadata before using it in calculations.', 'Download the latest workbook for each daily review. A previously saved copy does not refresh itself. Keep personal notes in a separate file keyed by Property key.', 'Named Excel tables support filtering, PivotTables and dashboard imports. Source amounts and assessments do not establish current payoff or market value.'] } };
}

export async function main(args = process.argv.slice(2)) {
  const dataset = JSON.parse(await readFile(resolve(ROOT, 'docs/data/records.json'), 'utf8'));
  const workspace = JSON.parse(await readFile(resolve(ROOT, 'config/workspace.json'), 'utf8'));
  let enrichment = {};
  try { enrichment = JSON.parse(await readFile(resolve(ROOT, 'docs/data/property-details.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const data = buildWorkbookData(dataset, workspace, enrichment);
  for (const entry of data.tables) for (const row of entry.rows) for (const value of row) if (typeof value === 'string' && value.length > 32767) throw Error('Source text exceeds Excel cell capacity; retain original JSON and revise export before publication');
  const output = resolve(args[0] || resolve(ROOT, '../../work/publication/workbook-data.json'));
  await mkdir(resolve(output, '..'), { recursive: true });
  await writeFile(output, JSON.stringify(data));
  console.log(JSON.stringify({ output, tables: data.tables.map(entry => ({ sheet: entry.sheet, rows: entry.rows.length, columns: entry.columns.length })), snapshot: data.snapshot.generatedAt }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
