// Synthetic TEST fixtures only; no live records are modified or refreshed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
const require = createRequire(import.meta.url);
const V = require('../docs/record-view-model.js');
const H = require('../docs/property-model.js');
const code = await readFile(new URL('../docs/records.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(query = '', responses = []) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: id === 'record-scope' ? '27260' : id === 'record-type' ? 'signals' : '', innerHTML: '', textContent: '', hidden: false, listeners: {}, setAttribute(name, value) { this[name] = value; }, addEventListener(type, handler) { this.listeners[type] = handler; }, focus() { this.focused = true; } });
    return elements.get(id);
  };
  const fixture = {
    generated_at: '2026-10-01T12:00:00Z',
    records: [{ id: 'test1', address: 'TEST <unsafe> address', parcel_id: '123', zip: '27260', record_type: 'code_case', source_id: 'code_cases', status: 'TEST fixture', amount: 0 }],
    sources: [{ id: 'code_cases', name: 'TEST source', state: 'collected', last_success_at: '2026-10-01T12:00:00Z' }]
  };
  const location = { pathname: '/', search: query, hash: '#public-records' };
  const intervals = [], events = {}, downloads = [];
  class TestURL extends URL { static createObjectURL(blob) { downloads.push(blob); return 'blob:TEST'; } static revokeObjectURL() {} }
  const context = {
    window: { RecordViewModel: V, PropertyModel: { sourceHealth: source => H.sourceHealth(source, Date.parse('2026-10-19T12:00:00Z')) }, addEventListener(type, fn) { events[type] = fn; } },
    document: { getElementById: element, dispatchEvent() {}, addEventListener() {}, createElement: () => ({ click() {} }) },
    location, history: { replaceState(_state, _title, url) { const parsed = new URL(url, 'http://test.local'); location.search = parsed.search; } },
    URL: TestURL, URLSearchParams, Blob,
    CustomEvent: class {}, setTimeout() {}, setInterval(fn) { intervals.push(fn); },
    fetch: async () => { const next = responses.length ? responses.shift() : fixture; if (next instanceof Error) throw next; return { ok: true, json: async () => next }; }
  };
  runInNewContext(code, context);
  return { element, location, intervals, events, fixture, downloads };
}

test('records UI restores the shared query, escapes source text and labels stale evidence', async () => {
  const ui = setup('?records_q=TEST&records_page=99'); await tick();
  assert.equal(ui.element('record-search').value, 'TEST');
  assert.equal(ui.element('record-count').textContent, '1 record');
  assert.match(ui.element('record-rows').innerHTML, /TEST &lt;unsafe&gt;/);
  assert.match(ui.element('record-rows').innerHTML, /records_q=TEST/);
  assert.match(ui.element('source-health').innerHTML, /Snapshot over 48 hours old/);
  assert.equal(ui.element('public-records')['aria-busy'], 'false');
  assert.equal(new URLSearchParams(ui.location.search).has('records_page'), false);
});

test('empty search exposes a reset action and reset restores results/focus', async () => {
  const ui = setup('?records_q=NO-MATCH'); await tick();
  assert.equal(ui.element('record-pagination').textContent, '0 records');
  assert.match(ui.element('record-rows').innerHTML, /Clear filters and show research signals/);
  ui.element('records-reset').listeners.click();
  assert.equal(ui.element('record-count').textContent, '1 record');
  assert.equal(ui.element('record-search').focused, true);
  assert.equal(ui.element('records-reset').hidden, true);
});

test('malformed later snapshots retain the last loaded records with a visible warning', async () => {
  const responses = [];
  const ui = setup('', responses); await tick();
  const before = ui.element('record-rows').innerHTML;
  responses.push({ ...ui.fixture, records: null }); // Separate synthetic failing response.
  ui.intervals[0](); await tick();
  assert.equal(ui.element('record-rows').innerHTML, before);
  assert.match(ui.element('record-message').textContent, /unexpected format.*last loaded records remain visible/);
});

test('JSON export contains only the filtered result set and truthful export count', async () => {
  const ui = setup('?records_q=NO-MATCH'); await tick();
  ui.element('records-json').listeners.click({ preventDefault() {} });
  const exported = JSON.parse(await ui.downloads[0].text());
  assert.deepEqual(exported.records, []);
  assert.equal(exported.export_record_count, 0);
});
