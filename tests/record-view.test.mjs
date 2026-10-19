import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const V = require('../docs/record-view-model.js');

test('a shared record view round-trips filters/page without overwriting estimate links', () => {
  const state = { query: 'TEST & "fixture"', scope: 'all', type: 'tax_bill', page: 3 };
  const params = V.params(state, 'estimate=123&records_page=999');
  assert.deepEqual(V.readState(params), state);
  assert.equal(params.get('estimate'), '123');
  assert.equal(params.get('records_page'), '4');
  assert.equal(V.params(V.defaults, params).toString(), 'estimate=123');
});

test('invalid URL filters and unbounded page values fall back safely', () => {
  assert.deepEqual(V.readState('?records_scope=other&records_type=invalid&records_page=Infinity'), V.defaults);
  assert.equal(V.readState('?records_page=-4').page, 0);
  assert.equal(V.readState('?records_page=2.5').page, 0);
  assert.equal(V.readState('?records_q=' + 'a'.repeat(300)).query.length, 200);
});

test('combined filters preserve exact ZIP scope and original input ordering', () => {
  const records = [
    { id: 'test1', address: 'TEST First', zip: '27260', record_type: 'code_case', event_date: '2026-01-01' },
    { id: 'test2', address: 'TEST Second', zip: '27260', record_type: 'parcel', event_date: '2026-03-01' },
    { id: 'test3', address: 'TEST First', zip: null, record_type: 'code_case', event_date: '2026-02-01' }
  ];
  assert.deepEqual(V.filterRecords(records, { ...V.defaults, query: 'first' }).map(r => r.id), ['test1']);
  assert.deepEqual(V.filterRecords(records, { ...V.defaults, scope: 'all' }).map(r => r.id), ['test3', 'test1']);
  assert.deepEqual(records.map(r => r.id), ['test1', 'test2', 'test3']);
  assert.equal(V.filterRecords(records, { ...V.defaults, type: 'tax_bill' }).length, 0);
});

test('page bounds and property return links keep a narrow trusted dashboard route', () => {
  assert.deepEqual(V.pageInfo(31, 999), { page: 1, start: 30, end: 31 });
  assert.deepEqual(V.pageInfo(0, 9), { page: 0, start: 0, end: 0 });
  assert.equal(V.backUrl('?records_q=TEST&records_page=2&return=https://evil.example&record=code1'), './index.html?records_q=TEST&records_page=2#public-records');
});
