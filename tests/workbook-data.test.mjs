import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkbookData } from '../scripts/workbook-data.mjs';
const base = { id: 'parcel-123', source_id: 'parcels', record_type: 'parcel', parcel_id: '123', county: 'Guilford', address: '10 Main St', zip: '27260' };
const bill = { id: 'tax:00001', source_id: 'tax_bills', record_type: 'tax_bill', parcel_id: '000123', bill_number: '00001', tax_year: '2020', amount: 100.25, zip: '27260' };
const objects = table => table.rows.map(row => Object.fromEntries(table.columns.map((column, index) => [column.key, row[index]])));

test('Excel property groups are county-qualified and tax balances deduplicate bill numbers', () => {
  const model = buildWorkbookData({ records: [base, bill, { ...bill, id: 'duplicate-feed-row' }, { ...bill, id: 'another-year', bill_number: '00002', tax_year: '2021', amount: 2.5 }, { ...bill, id: 'other-county', county: 'Davidson', record_type: 'code_case', source_id: 'code_cases' }] }, {});
  const properties = objects(model.tables[0]);
  assert.equal(properties.length, 1);
  assert.equal(properties[0].property_key, 'guilford:123');
  assert.equal(properties[0].tax_bills, 2);
  assert.equal(properties[0].published_tax_balance, 102.75);
  assert.equal(properties[0].code_cases, 0);
  assert.equal(properties[0].asking_price, null);
  assert.equal(model.tables[1].rows.length, 5);
});

test('Excel retains every source field, source row, array and leading-zero identifier', () => {
  const source = { ...bill, source_url: 'https://example.com/records', custom_new_field: 'Keep this', source_flags: ['DLQ'], unknown_balance: 0 };
  const model = buildWorkbookData({ records: [base, source] }, {});
  const raw = objects(model.tables[1]).find(row => row.id === source.id);
  for (const [key, value] of Object.entries(source)) assert.deepEqual(raw[key], typeof value === 'object' ? JSON.stringify(value) : value);
  assert.equal(raw.bill_number, '00001');
  assert.equal(raw.unknown_balance, 0);
});

test('Photo pages remain distinct from unavailable direct image links', () => {
  const model = buildWorkbookData({ records: [base, bill] }, {}, { records: [{ parcel_id: '123', photo_url: 'javascript:alert(1)', deed_date: '1960-01-02', deed_date_status: 'source_reported' }] });
  const property = objects(model.tables[0])[0];
  assert.equal(property.photo_url, null);
  assert.equal(property.photo_page_url, 'https://lrcpwa.ncptscloud.com/guilford/parcel-detail/123');
  assert.equal(property.county_deed_date, '1960-01-02');
  assert.equal(model.tables[0].columns.find(column => column.key === 'county_deed_date').type, 'date');
});
