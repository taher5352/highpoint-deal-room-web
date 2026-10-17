/**
 * Public county ArcGIS Query adapter. No credentials, owner/contact data, page
 * scraping, or access-control bypass. Records are research signals only.
 * Import into the server; do not schedule inside a browser tab.
 */
export const FORECLOSURE_SOURCE = Object.freeze({
  id: 'guilford-foreclosures',
  name: 'Guilford County public foreclosure GIS',
  layerUrl: 'https://gcgis.guilfordcountync.gov/arcgis/rest/services/Foreclosure/ForeclosuresPublic/FeatureServer/0',
  metadataUrl: 'https://gcgis.guilfordcountync.gov/arcgis/rest/services/Foreclosure/ForeclosuresPublic/FeatureServer/info/iteminfo?f=json',
  pageUrl: 'https://www.guilfordcountync.gov/government/departments-and-agencies/tax-department/foreclosures',
  applicationUrl: 'https://gcgis.guilfordcountync.gov/portal/apps/experiencebuilder/experience/?id=c8d88c0dc2884860ac98ae9a777839e6',
  publisherCadence: 'Daily Monday–Friday at 6:45 a.m. (publisher metadata; timezone not specified)',
  coverage: 'Guilford County, NC; property ZIP requires a separate parcel join',
});

const FIELDS = [
  'OBJECTID', 'PARCEL_ID', 'REID', 'PIN', 'LOCATION_ADDR', 'FLAG_TYPE',
  'FLAG_STATUS', 'AuctionDate', 'AuctionTime', 'AuctionLocation',
  'Total_Assessed', 'YEAR_BUILT', 'Property_Type', 'Structure_Size',
  'Lot_Size', 'BEDROOMS', 'Bathrooms', 'DEED_DATE',
];
const text = v => typeof v === 'string' ? v.trim() || null : v == null ? null : String(v);
const number = v => typeof v === 'number' && Number.isFinite(v) ? v : null;
const date = v => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};

export function normalizeForeclosureRecord(feature, retrievedAt) {
  const a = feature.attributes ?? feature;
  const parcelId = text(a.REID) || text(a.PARCEL_ID);
  if (!parcelId) return null;
  const sourceStatus = text(a.FLAG_STATUS);
  return {
    id: `${FORECLOSURE_SOURCE.id}:${parcelId}:${a.OBJECTID}`,
    propertyId: `guilford:${parcelId}`,
    parcelId,
    pin: text(a.PIN),
    address: text(a.LOCATION_ADDR),
    city: null,
    state: 'NC',
    postalCode: null,
    county: 'Guilford',
    geographyMatch: 'county-only; situs ZIP not supplied by this source',
    signalType: 'foreclosure',
    sourceStatus,
    sourceFlagType: text(a.FLAG_TYPE),
    auctionAt: date(a.AuctionDate),
    auctionTimeText: text(a.AuctionTime),
    auctionLocation: text(a.AuctionLocation),
    assessedValue: number(a.Total_Assessed),
    propertyType: text(a.Property_Type),
    yearBuilt: number(a.YEAR_BUILT),
    buildingSqft: number(a.Structure_Size),
    lotAreaRaw: number(a.Lot_Size),
    lotAreaUnit: null,
    bedrooms: number(a.BEDROOMS),
    bathrooms: number(a.Bathrooms),
    deedRecordedAt: date(a.DEED_DATE),
    askingPrice: null,
    marketValue: null,
    sourceId: FORECLOSURE_SOURCE.id,
    sourceRecordId: String(a.OBJECTID),
    sourceUrl: FORECLOSURE_SOURCE.applicationUrl,
    sourceLayerUrl: FORECLOSURE_SOURCE.layerUrl,
    retrievedAt,
    sourceUpdatedAt: null,
    sourceEventDate: null,
    verification: 'Public GIS signal; status and legal details require independent verification',
  };
}

/** Fails closed on incomplete/error responses; callers should retain last good snapshot. */
export async function fetchForeclosures({ fetchImpl = globalThis.fetch, now = () => new Date(), maxPages = 10 } = {}) {
  const retrievedAt = now().toISOString();
  const records = [];
  let missingParcelRows = 0;
  let complete = false;
  let sourceRowCount = 0;
  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      f: 'json', where: '1=1', outFields: FIELDS.join(','),
      returnGeometry: 'false', orderByFields: 'OBJECTID ASC',
      resultRecordCount: '2000', resultOffset: String(page * 2000),
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    let response;
    try {
      response = await fetchImpl(`${FORECLOSURE_SOURCE.layerUrl}/query?${params}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
    } finally { clearTimeout(timeout); }
    if (!response.ok) throw new Error(`County foreclosure source returned HTTP ${response.status}`);
    const data = await response.json();
    if (data.error) throw new Error(`County foreclosure source error: ${data.error.code || 'unknown'} ${data.error.message || ''}`);
    if (!Array.isArray(data.features)) throw new Error('County foreclosure response did not contain features');
    sourceRowCount += data.features.length;
    for (const feature of data.features) {
      const normalized = normalizeForeclosureRecord(feature, retrievedAt);
      if (normalized) records.push(normalized);
      else missingParcelRows++;
    }
    if (!data.exceededTransferLimit) { complete = true; break; }
    if (!data.features.length) throw new Error('County foreclosure pagination stopped before completion');
  }
  if (!complete) throw new Error('County foreclosure query exceeded configured safe page limit');
  if (!records.length) throw new Error('County foreclosure source returned no usable records; keep previous snapshot pending verification');
  const ids = new Set(records.map(r => r.sourceRecordId));
  if (ids.size !== records.length) throw new Error('County foreclosure pagination returned duplicate record IDs');
  return {
    source: FORECLOSURE_SOURCE,
    retrievedAt,
    sourceUpdatedAt: null,
    sourceRowCount,
    missingParcelRows,
    uniqueParcels: new Set(records.map(r => r.parcelId)).size,
    statusCounts: records.reduce((a, r) => { a[r.sourceStatus || 'Unknown'] = (a[r.sourceStatus || 'Unknown'] || 0) + 1; return a; }, {}),
    warnings: [
      'This is countywide. Join REID/parcelId or PIN to official property ZIP data before labeling a record 27260.',
      'Assessed value is a tax assessment, not an asking price or market valuation.',
      'Publisher describes weekday updates; no per-record update or case-opening date is supplied.',
      'A foreclosure signal does not establish that a property is for sale, unlisted, or that its owner wants to sell.',
      'County GIS data carries accuracy and completeness disclaimers; verify legal proceedings separately.',
    ],
    records,
  };
}

/** Dashboard collector contract; amount is explicitly the tax assessment. */
export async function collectForeclosures(fetchImpl = globalThis.fetch) {
  const result = await fetchForeclosures({ fetchImpl });
  return {
    records: result.records.map(r => ({
      id: r.id,
      source_id: 'foreclosures',
      record_type: 'foreclosure',
      parcel_id: r.parcelId,
      pin: r.pin,
      address: r.address,
      city: null,
      zip: null,
      case_id: null,
      status: r.sourceStatus,
      event_date: r.auctionAt,
      event_date_type: r.auctionAt ? 'auction_datetime' : null,
      amount: r.assessedValue,
      amount_label: 'County tax assessed value',
      source_url: r.sourceUrl,
      source_record_id: r.sourceRecordId,
      retrieved_at: r.retrievedAt,
      property_type: r.propertyType,
      year_built: r.yearBuilt,
      building_sqft: r.buildingSqft,
      bedrooms: r.bedrooms,
      bathrooms: r.bathrooms,
      auction_time: r.auctionTimeText,
      auction_location: r.auctionLocation,
    })),
    source_updated_at: null,
    metadata: {
      source_name: FORECLOSURE_SOURCE.name,
      source_url: FORECLOSURE_SOURCE.pageUrl,
      query_url: `${FORECLOSURE_SOURCE.layerUrl}/query`,
      out_fields: FIELDS,
      retrieved_at: result.retrievedAt,
      publisher_cadence: FORECLOSURE_SOURCE.publisherCadence,
      source_row_count: result.sourceRowCount,
      excluded_missing_parcel_rows: result.missingParcelRows,
      unique_parcels: result.uniqueParcels,
      status_counts: result.statusCounts,
      scope: 'countywide-until-parcel-join',
      warnings: result.warnings,
    },
  };
}
