import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
const require = createRequire(import.meta.url);
const { sourceHealth } = require('../docs/property-model.js');
const now = Date.parse('2026-10-19T12:00:00Z');
const source = { state: 'collected', last_success_at: '2026-10-18T12:00:00Z' };

test('viewing time overrides the saved collected badge as a snapshot ages', () => {
  assert.equal(sourceHealth(source, now).state, 'collected');
  assert.equal(sourceHealth(source, now + 48 * 3600000).state, 'stale');
  assert.equal(source.state, 'collected');
});

test('48-hour policy includes the exact boundary and expires immediately after', () => {
  const boundary = Date.parse(source.last_success_at) + 48 * 3600000;
  assert.equal(sourceHealth(source, boundary).state, 'collected');
  assert.equal(sourceHealth(source, boundary + 1).state, 'stale');
});

test('a failed latest attempt keeps last-good evidence explicit, even when old', () => {
  const retained = sourceHealth({ ...source, last_success_at: '2026-10-01T12:00:00Z', last_error: 'Unavailable' }, now);
  assert.equal(retained.state, 'last_good_retained');
  assert.match(retained.note, /latest collection attempt failed/);
});

test('missing, invalid, timezone-less and future timestamps never establish freshness', () => {
  for (const last_success_at of [null, '', 'bad date', '2026-02-30T12:00:00Z', '2026-10-18T12:00:00', '2026-10-20T12:00:00Z', 123]) {
    for (const last_error of [null, 'Unavailable']) {
      assert.equal(sourceHealth({ state: 'collected', last_success_at, last_error }, now).state, 'not_verified');
    }
  }
  assert.equal(sourceHealth(null, now).state, 'not_verified');
});

test('equivalent timezone offsets have identical age and badges do not imply new events', () => {
  const result = sourceHealth({ ...source, last_success_at: '2026-10-18T08:00:00-04:00' }, now);
  assert.deepEqual(result, sourceHealth(source, now));
  assert.match(result.note, /does not establish.*property record changed/);
});

test('the direct property page renders an aged saved collected source as stale', async () => {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { innerHTML: '', hidden: true, setAttribute() {} });
    return elements.get(id);
  };
  const dataset = {
    generated_at: '2026-10-01T12:00:00Z',
    records: [{ id: 'code:test', source_id: 'code_cases', record_type: 'code_case', county: 'Guilford', parcel_id: '123', address: 'Test address' }],
    sources: [{ ...source, id: 'code_cases', name: 'Test city source', last_success_at: '2026-10-01T12:00:00Z' }]
  };
  const context = {
    window: { location: { search: '?record=code%3Atest' } },
    document: { getElementById: element }, URL, URLSearchParams,
    Date: class extends Date { static now() { return now; } },
    fetch: async () => ({ ok: true, json: async () => dataset })
  };
  runInNewContext(await readFile(new URL('../docs/property-model.js', import.meta.url), 'utf8'), context);
  runInNewContext(await readFile(new URL('../docs/property.js', import.meta.url), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(element('property-content').hidden, false);
  assert.match(element('property-content').innerHTML, /Test city source.*Snapshot over 48 hours old/);
  assert.match(element('property-content').innerHTML, /Check refresh history and the official source/);
  assert.doesNotMatch(element('property-content').innerHTML, /Collected within 48 hours/);
});
