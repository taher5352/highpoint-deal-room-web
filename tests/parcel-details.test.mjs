import test from 'node:test';
import assert from 'node:assert/strict';
import { collectParcelDetails, normalizeParcelDetails } from '../collectors/parcel-details-source.mjs';

test('County deed placeholders stay distinct from valid historic dates', () => {
  const placeholder = normalizeParcelDetails({ REID: '000123', DEED_DATE: Date.parse('1900-01-01T00:01:00Z') });
  assert.equal(placeholder.parcel_id, '123');
  assert.equal(placeholder.deed_date, null);
  assert.equal(placeholder.deed_date_status, 'suspected_publisher_placeholder');
  const historic = normalizeParcelDetails({ REID: '123', DEED_DATE: Date.parse('1960-01-02T00:00:00Z') });
  assert.equal(historic.deed_date, '1960-01-02');
  assert.equal(historic.photo_url, null);
});

test('Invalid parcel identifiers cannot trigger broad county queries', async () => {
  let fetched = false;
  const fetchImpl = async () => { fetched = true; throw Error('Unexpected request'); };
  await assert.rejects(() => collectParcelDetails(['123 OR 1=1'], fetchImpl), /numeric/);
  assert.equal(fetched, false);
});

test('An incomplete county property response cannot replace the retained data', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ features: [{ attributes: { REID: '123' } }] }));
  await assert.rejects(() => collectParcelDetails(['123', '456'], fetchImpl), /every requested parcel/);
});
