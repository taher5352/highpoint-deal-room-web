import test from 'node:test';
import assert from 'node:assert/strict';
import { joinMarket } from '../scripts/market.mjs';
import { collectSnapshot, validateResult } from '../scripts/collect.mjs';

const parcel = (id, zip = '27260') => ({ id: `parcel-${id}`, source_id: 'parcels', record_type: 'parcel', parcel_id: id, zip });
const code = (id, county = 'Guilford', address = '') => ({ id: `case-${id}`, source_id: 'code_cases', record_type: 'code_case', parcel_id: id, county, address });
const result = records => ({ records, metadata: {}, source_updated_at: null });

test('geography requires a current exact parcel match and correct county', () => {
  const records = joinMarket({ parcels: [parcel('123')], code_cases: [code('000123'), code('999'), { ...code('123', 'Davidson'), id: 'other-county' }], tax_bills: [{ id: 'bill-old', source_id: 'tax_bills', record_type: 'tax_bill', parcel_id: '777', zip: '27260' }] });
  assert.equal(records.find(record => record.id === 'case-000123').zip, '27260');
  for (const id of ['case-999', 'other-county', 'bill-old']) assert.equal(records.find(record => record.id === id).zip, null);
});

test('an explicit conflicting case ZIP removes that parcel from the target view', () => {
  const records = joinMarket({ parcels: [parcel('123')], code_cases: [code('123', 'Guilford', '10 Main St, High Point NC 27262')], tax_bills: [{ id: 'bill', source_id: 'tax_bills', parcel_id: '123' }] });
  assert.ok(records.every(record => record.zip === null && record.geography_conflict));
});

test('partial failure retains last good source and its success date', async () => {
  const previous = { records: [parcel('123'), code('123')], sources: [{ id: 'parcels', last_success_at: '2026-10-16T13:00:00Z' }, { id: 'code_cases', last_success_at: '2026-10-16T13:00:00Z' }] };
  let taxIds;
  const snapshot = await collectSnapshot(previous, {
    parcels: async () => { throw Error('County temporarily unavailable'); },
    code_cases: async () => result([code('123'), code('456')]),
    foreclosures: async () => result([]),
    tax_bills: async targets => { taxIds = [...targets.keys()]; return result([]); }
  }, () => '2026-10-17T13:00:00Z');
  assert.equal(snapshot.last_run.status, 'partial');
  assert.equal(snapshot.sources.find(source => source.id === 'parcels').last_success_at, '2026-10-16T13:00:00Z');
  assert.equal(snapshot.sources.find(source => source.id === 'parcels').state, 'last_good_retained');
  assert.equal(snapshot.records.find(record => record.id === 'parcel-123').zip, '27260');
  assert.deepEqual(taxIds, ['123']);
  assert.equal(snapshot.records.find(record => record.id === 'case-456').zip, null);
});

test('all-source failure preserves research signals and reports failure', async () => {
  const previous = { records: [parcel('123'), code('123')], sources: [{ id: 'parcels', last_success_at: '2026-10-16T13:00:00Z' }, { id: 'code_cases', last_success_at: '2026-10-16T13:00:00Z' }] };
  const fail = async () => { throw Error('Unavailable'); };
  const snapshot = await collectSnapshot(previous, { parcels: fail, code_cases: fail, foreclosures: fail, tax_bills: fail });
  assert.equal(snapshot.last_run.status, 'failed');
  assert.equal(snapshot.records.length, 2);
  assert.equal(snapshot.records.find(record => record.id === 'case-123').zip, '27260');
});

test('empty parcel bases and duplicate IDs cannot replace a good source', () => {
  assert.throws(() => validateResult('parcels', result([])), /empty/);
  assert.throws(() => validateResult('code_cases', result([code('1'), code('1')])), /Duplicate/);
  assert.throws(() => validateResult('tax_bills', result([code('1')])), /validation/);
});

test('tax download failures do not publish a temporary signed URL', async () => {
  const snapshot = await collectSnapshot({ records: [parcel('123')], sources: [] }, {
    parcels: async () => result([parcel('123')]), code_cases: async () => result([]), foreclosures: async () => result([]),
    tax_bills: async () => { throw Error('https://download.example/file?sig=PRIVATE'); }
  });
  assert.ok(!JSON.stringify(snapshot).includes('PRIVATE'));
  assert.match(snapshot.sources.find(source => source.id === 'tax_bills').last_error, /Public tax collection failed/);
});
