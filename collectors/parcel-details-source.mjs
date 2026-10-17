/** Bounded, public Guilford GIS property enrichment. No owner/contact fields. */
export const PARCEL_DETAILS_SOURCE = 'https://gcgis.guilfordcountync.gov/arcgis/rest/services/GISDV/Parcels/FeatureServer/0';
export const PARCEL_DETAILS_FIELDS = [
  'REID', 'PIN', 'LOCATION_ADDR', 'PROPERTY_DESCR', 'Deed', 'Plat', 'Condo',
  'Total_Assessed', 'Total_Building_Value', 'Total_Out_Building_Value',
  'Total_Land_Value', 'TOTAL_DEFERRED_VALUE', 'BLDG_CARD', 'Appraisal_Model_Code',
  'DEED_DATE', 'Neighborhood', 'Property_Type', 'Structure_Size', 'Lot_Size',
  'YEAR_BUILT', 'BEDROOMS', 'Bathrooms', 'GRADE', 'Short_Parcel_ID',
];
const MAX_TARGETS = 5000;
const BATCH_SIZE = 250;
const canonical = value => {
  const raw = String(value ?? '').trim();
  if (!/^\d+$/.test(raw)) throw new Error('Property enrichment requires numeric Guilford REIDs');
  const id = raw.replace(/^0+(?=\d)/, '');
  if (!/^\d{1,7}$/.test(id) || id === '0') throw new Error('Property enrichment REID is outside the supported county format');
  return id;
};

export function normalizeParcelDetails(attributes) {
  const parcel_id = canonical(attributes.REID);
  // Keep the exact publisher values; expose a safe date beside the raw epoch.
  const record = Object.fromEntries(PARCEL_DETAILS_FIELDS.filter(key => key !== 'REID').map(key => [key, attributes[key] ?? null]));
  const rawDate = record.DEED_DATE;
  const date = typeof rawDate === 'number' && Number.isFinite(rawDate) ? new Date(rawDate) : null;
  const iso = date && Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
  const suspectedPlaceholder = iso === '1900-01-01';
  const official_property_url = `https://lrcpwa.ncptscloud.com/guilford/parcel-detail/${parcel_id}`;
  return {
    ...record, parcel_id, county: 'Guilford', state: 'NC',
    deed_date: suspectedPlaceholder ? null : iso,
    deed_date_status: suspectedPlaceholder ? 'suspected_publisher_placeholder' : iso ? 'source_reported' : 'not_provided',
    lot_size_unit: null,
    official_property_url,
    photo_page_url: official_property_url,
    photo_url: null,
    photo_status: 'Official property page offers a Photos tab; no bulk/direct photo URL is provided by this GIS layer',
  };
}

/** targetIds must already be verified Guilford property IDs, never mailing ZIPs. */
export async function collectParcelDetails(targetIds, fetchImpl = fetch) {
  if (!targetIds || typeof targetIds === 'string' || typeof targetIds[Symbol.iterator] !== 'function') throw new Error('Property enrichment requires an explicit parcel-ID allowlist');
  const ids = [...new Set([...targetIds].map(canonical))].sort((a, b) => Number(a) - Number(b));
  if (!ids.length || ids.length > MAX_TARGETS) throw new Error('Property enrichment target count is outside the bounded limit');
  const wanted = new Set(ids), records = new Map(), batches = [];
  let rawReturnedRows = 0;
  for (let offset = 0; offset < ids.length; offset += BATCH_SIZE) {
    const batch = ids.slice(offset, offset + BATCH_SIZE), batchSet = new Set(batch);
    const params = new URLSearchParams({
      where: `REID IN (${batch.map(id => `'${id}'`).join(',')})`,
      outFields: PARCEL_DETAILS_FIELDS.join(','), returnGeometry: 'false',
      resultRecordCount: '2000', f: 'json',
    });
    const response = await fetchImpl(`${PARCEL_DETAILS_SOURCE}/query`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: params.toString(), signal: AbortSignal.timeout(45000),
    });
    if (!response.ok) throw new Error(`Public property enrichment returned HTTP ${response.status}`);
    const data = await response.json();
    if (data.error) throw new Error(`Public property enrichment source error: ${data.error.message || data.error.code}`);
    if (!Array.isArray(data.features) || data.exceededTransferLimit) throw new Error('Public property enrichment response is incomplete or limited');
    rawReturnedRows += data.features.length;
    const returned = new Set();
    for (const feature of data.features) {
      const record = normalizeParcelDetails(feature.attributes || {});
      if (!batchSet.has(record.parcel_id) || !wanted.has(record.parcel_id)) throw new Error('Public property enrichment returned an unrequested parcel');
      const previous = records.get(record.parcel_id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(record)) throw new Error('Public property enrichment returned conflicting rows for one parcel');
      records.set(record.parcel_id, record);
      returned.add(record.parcel_id);
    }
    if (returned.size !== batch.length) throw new Error('Public property enrichment did not return every requested parcel; retain the previous snapshot');
    batches.push(returned.size);
  }
  if (records.size !== ids.length) throw new Error('Public property enrichment is incomplete');
  return {
    source_url: PARCEL_DETAILS_SOURCE, retrieved_at: new Date().toISOString(),
    source_updated_at: null, requested_parcels: ids.length, returned_rows: records.size,
    raw_returned_rows: rawReturnedRows, batches,
    scope: 'Explicit county-qualified Guilford parcel-ID allowlist; geography established before collection',
    records: [...records.values()].sort((a, b) => Number(a.parcel_id) - Number(b.parcel_id)),
    notes: [
      'Read-only public GIS Query service; no owner, owner history, mailing address, phone or email fields requested.',
      'REID is the county parcel identifier. Short_Parcel_ID and PIN are retained separately; no address matching establishes identity.',
      'Assessed values are county tax assessments, not asking prices or current market valuations. Repeated total assessments are not summed.',
      'Lot_Size is retained as a raw publisher value; its unit is not explicit in GIS metadata. One UI cross-check matches the county Acreage field, but no unit is inferred across all records.',
      'DEED_DATE is a raw ArcGIS epoch in milliseconds. Negative epochs can be valid pre-1970 deeds; only January 1, 1900 is flagged as a suspected publisher placeholder and omitted from normalized deed_date.',
      'No direct/bulk photograph URL field or attachment service is supplied by this GIS layer. photo_page_url opens the official property page; select Photos. Photo availability and capture date vary by parcel.',
      'Retrieved time is collection time, not the date property facts changed. No per-record source update timestamp is supplied by this layer.',
    ],
  };
}
