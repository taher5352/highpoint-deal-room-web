import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const M = require('../docs/property-model.js');
const base = { id: 'parcel-123', source_id: 'parcels', record_type: 'parcel', parcel_id: '123', county: 'Guilford', address: '10 Test Street', zip: '27260', geography_verification: 'county_city_zip_agreement' };
const code = { id: 'code:selected', source_id: 'code_cases', record_type: 'code_case', parcel_id: '0000123', county: 'GUILFORD (100%)', address: '10 TEST ST, HIGH POINT, NC 27260', case_id: 'CV-26-1', amount: 45, status: 'Investigation' };
const tax = { id: 'tax:bill-one', source_id: 'tax_bills', record_type: 'tax_bill', parcel_id: '123', bill_number: 'one', tax_year: '2024', amount: 300 };
const foreclosure = { id: 'foreclosure:one', source_id: 'foreclosures', record_type: 'foreclosure', parcel_id: '00123', amount: 95000, amount_label: 'County tax assessed value' };
const dataset = records => ({ records, generated_at: '2026-10-17T23:00:00Z', sources: [] });

test('exact source record seeds the page and all records join by leading-zero-normalized Guilford REID', () => {
  const selected = M.selectProperty(dataset([base, code, tax, foreclosure]), '?record=code%3Aselected');
  assert.equal(selected.selected.id, code.id);
  assert.equal(selected.parcelId, '123');
  assert.equal(selected.address, base.address);
  assert.equal(selected.records.length, 4);
  assert.equal(selected.groups.codeCases[0].amount, 45);
  assert.equal(selected.groups.foreclosures[0].amount, 95000);
  assert.equal(selected.groups.taxBills[0].bill_number, 'one');
});

test('same parcel digits in another county never join to Guilford or receive its property link', () => {
  const davidson = { ...code, id: 'code:davidson', parcel_id: '123', county: 'Davidson(100%)' };
  const randolph = { ...code, id: 'code:randolph', parcel_id: '123', county: 'Randolph(100%)' };
  const all = dataset([base, code, tax, davidson, randolph]);
  assert.equal(M.selectProperty(all, '?record=code%3Aselected').records.length, 3);
  const detail = M.selectProperty(all, '?record=code%3Adavidson');
  assert.deepEqual(detail.records.map(r => r.id), ['code:davidson']);
  assert.equal(detail.canGroup, false);
  assert.equal(M.countyPropertyUrl(davidson), null);
});

test('unknown/mixed counties, missing IDs and lists of IDs remain selected-record only', () => {
  for (const change of [{ county: null }, { county: 'NA' }, { county: 'Guilford(50%), Davidson(50%)' }, { parcel_id: null }, { parcel_id: '123, 456' }, { parcel_id: '123456789012345678901234' }]) {
    const seed = { ...code, ...change };
    const detail = M.selectProperty(dataset([base, seed, tax]), '?record=code%3Aselected');
    assert.deepEqual(detail.records.map(r => r.id), [seed.id]);
    assert.equal(detail.canGroup, false);
    assert.equal(M.countyPropertyUrl(seed), null);
  }
});

test('address similarity is never used to combine different parcel IDs', () => {
  const different = { ...tax, id: 'tax:different', parcel_id: '456', address: base.address };
  const detail = M.selectProperty(dataset([base, code, different]), '?record=code%3Aselected');
  assert.equal(detail.records.length, 2);
  assert.equal(detail.groups.taxBills.length, 0);
});

test('missing selected record does not silently fall back to another parcel or address', () => {
  assert.equal(M.selectProperty(dataset([base]), '?record=removed&parcel=123').state, 'not_found');
  assert.equal(M.selectProperty(dataset([base]), '').state, 'missing');
  assert.equal(M.selectProperty(dataset([base]), '?parcel=000123').state, 'ready');
  assert.equal(M.selectProperty(dataset([code]), '?parcel=123').state, 'not_found');
});

test('ZIP disagreement remains visible and cannot be called verified27260', () => {
  const conflict = { ...code, address: '10 TEST ST, HIGH POINT, NC 27262' };
  const detail = M.selectProperty(dataset([base, conflict]), '?record=code%3Aselected');
  assert.equal(detail.zipConflict, true);
  assert.equal(detail.zip, null);
  assert.deepEqual(detail.zipEvidence.sort(), ['27260', '27262']);
  assert.equal(M.selectProperty(dataset([{ ...code, geography_conflict: true }]), '?record=code%3Aselected').zipConflict, true);
});

test('duplicate source IDs are deduplicated while separate tax years and foreclosure rows remain intact', () => {
  const olderBill = { ...tax, id: 'tax:bill-two', bill_number: 'two', tax_year: '2023', amount: 100 };
  const secondForeclosure = { ...foreclosure, id: 'foreclosure:two' };
  const detail = M.selectProperty(dataset([base, tax, tax, olderBill, foreclosure, secondForeclosure]), '?parcel=123');
  assert.equal(detail.groups.taxBills.length, 2);
  assert.equal(detail.groups.foreclosures.length, 2);
  assert.deepEqual(detail.groups.taxBills.map(r => r.tax_year), ['2024', '2023']);
  assert.equal(Object.hasOwn(detail, 'totalAssessedValue'), false);
});

test('links are safe HTTP(S), source labels describe generic destinations, and text is escaped', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,x', '/relative', 'https://name:secret@example.com/']) assert.equal(M.safeUrl(value), null);
  assert.equal(M.safeUrl('https://example.com/?a=1&b=2'), 'https://example.com/?a=1&b=2');
  assert.equal(M.escapeHtml('<img src=x onerror="x">'), '&lt;img src=x onerror=&quot;x&quot;&gt;');
  assert.equal(M.sourceLinkLabel(foreclosure), 'County foreclosure map (all cases)');
  assert.equal(M.countyPropertyUrl(code), 'https://lrcpwa.ncptscloud.com/guilford/parcel-detail/123');
});

test('current real dataset preserves selected evidence and does not group unsupported parcel strings', async () => {
  const real = JSON.parse(await readFile(new URL('../docs/data/records.json', import.meta.url), 'utf8'));
  const seed = real.records.find(r => r.record_type === 'tax_bill');
  assert.ok(seed);
  const detail = M.selectProperty(real, new URLSearchParams({ record: seed.id }));
  assert.equal(detail.selected.id, seed.id);
  assert.ok(detail.groups.taxBills.some(r => r.bill_number === seed.bill_number && r.tax_year === seed.tax_year));
  assert.ok(detail.records.every(r => M.countyKey(r) === 'guilford' && M.parcelId(r.parcel_id) === detail.parcelId));
  const unsupported = real.records.filter(r => r.record_type === 'code_case' && (!M.parcelId(r.parcel_id) || M.countyKey(r) !== 'guilford'));
  assert.ok(unsupported.length > 0);
  for (const record of unsupported) assert.equal(M.selectProperty(real, new URLSearchParams({ record: record.id })).records.length, 1);
});
