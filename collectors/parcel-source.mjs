// Public, read-only county address queries; no credentials, phone, email, or owner fields.
export const ADDRESS_LAYER = 'https://gcgis.guilfordcountync.gov/arcgis/rest/services/SiteStructureAddressPoints/FeatureServer/0';
export const PARCEL_LAYER = 'https://gcgis.guilfordcountync.gov/arcgis/rest/services/GISDV/Parcels/FeatureServer/0';
export const CITY_ADDRESS_LAYER = 'https://gisentapp01.highpointnc.gov/server/rest/services/Addresses/MapServer/0';
const ADDRESS_WHERE = "Post_Code='27260' AND Status='Active'";
const ADDRESS_FIELDS = 'OBJECTID,REID,FullAddress,Post_Comm,Post_Code,DateUpdate,last_edited_date';
const CITY_ADDRESS_WHERE = "ZIP='27260' AND is_active=1 AND County='Guilford County'";
const CITY_ADDRESS_FIELDS = 'OBJECTID,parcel,ADDRESS,CITY,ZIP,County,ADD_TYPE,is_active,last_edited_date,ts_update';
const iso = value => typeof value === 'number' && Number.isFinite(value) ? new Date(value).toISOString() : null;
const cleanId = value => String(value ?? '').trim().replace(/^0+(?=\d)/, '');

export function normalizeAddress(address) {
  const words = { STREET: 'ST', AVENUE: 'AVE', AV: 'AVE', ROAD: 'RD', DRIVE: 'DR', COURT: 'CT', CIRCLE: 'CIR', PLACE: 'PL', LANE: 'LN', BOULEVARD: 'BLVD', PARKWAY: 'PKWY', HIGHWAY: 'HWY', TERRACE: 'TER', NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W', NORTHEAST: 'NE', NORTHWEST: 'NW', SOUTHEAST: 'SE', SOUTHWEST: 'SW' };
  return String(address ?? '').toUpperCase().replace(/[.,]/g, '').trim().split(/\s+/).map(word => words[word] || word).join(' ');
}

async function query(fetchImpl, layer, params, post = false) {
  const body = new URLSearchParams({ f: 'json', ...params });
  const response = await fetchImpl(post ? `${layer}/query` : `${layer}/query?${body}`, post ? { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: String(body), signal: AbortSignal.timeout(60000) } : { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`County public query failed: HTTP ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(`County public query failed: ${data.error.message || data.error.code}`);
  return data;
}

export function normalizeParcels(addresses, expectedCount = addresses.length) {
  const groups = new Map();
  const unmatched = [];
  let lastEdit = null;
  let originalUpdate = null;
  for (const address of addresses) {
    if (String(address.Post_Code).trim() !== '27260') throw new Error('Unexpected ZIP in county address extract');
    const id = cleanId(address.REID);
    if (!/^\d{1,7}$/.test(id)) { unmatched.push(address); continue; }
    const group = groups.get(id) || [];
    group.push(address);
    groups.set(id, group);
    if (address.last_edited_date > (lastEdit || 0)) lastEdit = address.last_edited_date;
    if (address.DateUpdate > (originalUpdate || 0)) originalUpdate = address.DateUpdate;
  }
  const records = [...groups.entries()].map(([id, rows]) => {
    rows.sort((a, b) => String(a.FullAddress).localeCompare(String(b.FullAddress)) || a.OBJECTID - b.OBJECTID);
    const primary = rows[0];
    const aliases = [...new Set(rows.map(row => String(row.FullAddress || '').trim()).filter(Boolean))];
    return {
      id: `parcel-${id}`, source_id: 'parcels', record_type: 'parcel', parcel_id: id,
      pin: null, address: String(primary.FullAddress || '').trim(), city: primary.Post_Comm || 'HIGH POINT',
      county: 'Guilford', state: 'NC', zip: '27260', case_id: null, status: 'Property address', event_date: null,
      last_sale_date: null, assessed_value: null, year_built: null,
      address_aliases: aliases, address_point_count: rows.length,
      address_point_ids: rows.map(row => row.OBJECTID),
      source_url: ADDRESS_LAYER,
      source_record_edited_at: iso(Math.max(...rows.map(row => row.last_edited_date || 0))),
      verification: 'ZIP from county active site address record; does not establish sale availability or owner motivation.'
    };
  }).sort((a, b) => Number(a.parcel_id) - Number(b.parcel_id));
  if (addresses.length !== expectedCount) throw new Error(`Incomplete county address extract: ${addresses.length}/${expectedCount}`);
  return {
    records,
    // This is the address layer's edit timestamp, not the currentness of ownership/tax/case facts.
    source_updated_at: iso(lastEdit),
    metadata: {
      publisher: 'Guilford County GIS', source_url: ADDRESS_LAYER,
      where: ADDRESS_WHERE, geography_basis: 'Exact active site-address Post_Code=27260; owner mailing ZIP is never used.',
      address_points: addresses.length, unique_parcels: records.length, unmatched_address_points: unmatched.length,
      latest_address_layer_edit: iso(lastEdit), latest_original_address_update: iso(originalUpdate),
      update_date_meaning: 'last_edited_date is a layer edit/processing timestamp; it does not certify source-event freshness.',
      limitations: ['Guilford County only; other counties are not included.', 'Parcels without an active site address are not included.', 'Multiple site addresses can belong to one parcel.', 'Property existence and ZIP are geography context, not an off-market or distress signal.'],
      access: 'Public county Query service; no credentials or site interaction bypass.',
      terms: 'No license text is supplied on the address layer. County public data attribution retained. No phone, email, or owner contact fields requested.'
    }
  };
}

export async function collectParcels(fetchImpl = fetch) {
  const count = await query(fetchImpl, ADDRESS_LAYER, { where: ADDRESS_WHERE, returnCountOnly: 'true' });
  if (!Number.isInteger(count.count) || count.count < 1 || count.count > 25000) throw new Error('Unexpected county address count; refusing unbounded collection');
  const addresses = [];
  for (let offset = 0; offset < count.count; offset += 2000) {
    const page = await query(fetchImpl, ADDRESS_LAYER, { where: ADDRESS_WHERE, outFields: ADDRESS_FIELDS, returnGeometry: 'false', resultOffset: String(offset), resultRecordCount: '2000', orderByFields: 'OBJECTID ASC' });
    if (!Array.isArray(page.features) || !page.features.length) throw new Error('Empty county address page before expected end');
    addresses.push(...page.features.map(feature => feature.attributes));
  }
  if (new Set(addresses.map(row => row.OBJECTID)).size !== addresses.length) throw new Error('Duplicate county address page detected');
  const county = normalizeParcels(addresses, count.count);
  // County postal labels contain localized errors. Require the city's active
  // address layer to independently report ZIP27260 for the same parcel REID.
  const cityCount = await query(fetchImpl, CITY_ADDRESS_LAYER, { where: CITY_ADDRESS_WHERE, returnCountOnly: 'true' });
  if (!Number.isInteger(cityCount.count) || cityCount.count < 1 || cityCount.count > 25000) throw new Error('Unexpected city address count; refusing unbounded collection');
  const cityAddresses = [];
  for (let offset = 0; offset < cityCount.count; offset += 2000) {
    const page = await query(fetchImpl, CITY_ADDRESS_LAYER, { where: CITY_ADDRESS_WHERE, outFields: CITY_ADDRESS_FIELDS, returnGeometry: 'false', resultOffset: String(offset), resultRecordCount: '2000', orderByFields: 'OBJECTID ASC' });
    if (!Array.isArray(page.features) || !page.features.length) throw new Error('Empty city address page before expected end');
    cityAddresses.push(...page.features.map(feature => feature.attributes));
  }
  if (cityAddresses.length !== cityCount.count || new Set(cityAddresses.map(row => row.OBJECTID)).size !== cityCount.count) throw new Error('Incomplete or duplicate city address extract');
  const cityGroups = new Map();
  let cityLastEdit = null;
  let cityProcessingUpdate = null;
  for (const address of cityAddresses) {
    if (String(address.ZIP).trim() !== '27260' || address.is_active !== 1 || address.County !== 'Guilford County') throw new Error('Unexpected geography/status in city address extract');
    const id = cleanId(address.parcel);
    if (!/^\d{1,7}$/.test(id)) continue;
    const rows = cityGroups.get(id) || [];
    rows.push(address);
    cityGroups.set(id, rows);
    if (address.last_edited_date > (cityLastEdit || 0)) cityLastEdit = address.last_edited_date;
    if (address.ts_update > (cityProcessingUpdate || 0)) cityProcessingUpdate = address.ts_update;
  }
  const countyIds = new Set(county.records.map(record => record.parcel_id));
  const agreed = county.records.filter(record => cityGroups.has(record.parcel_id));
  for (const record of agreed) {
    const cityRows = cityGroups.get(record.parcel_id);
    record.city_address_aliases = [...new Set(cityRows.map(row => String(row.ADDRESS || '').trim()).filter(Boolean))].sort();
    record.address_aliases = [...new Set([...record.address_aliases, ...record.city_address_aliases])];
    record.geography_verification = 'county_city_zip_agreement';
    record.geography_source_urls = [ADDRESS_LAYER, CITY_ADDRESS_LAYER];
    record.verification = 'County and city active site-address records both report ZIP27260 for this REID; source-address ZIP conflicts still require exclusion/review. Does not establish sale availability or owner motivation.';
  }
  return {
    records: agreed.map(r => ({id:r.id,source_id:r.source_id,record_type:r.record_type,parcel_id:r.parcel_id,pin:r.pin,address:r.address,city:r.city,county:r.county,state:r.state,zip:r.zip,status:r.status,source_url:r.source_url,geography_verification:r.geography_verification,address_point_count:r.address_point_count})),
    source_updated_at: county.source_updated_at,
    metadata: {
      ...county.metadata,
      unique_parcels: agreed.length,
      geography_basis: 'Conservative intersection: county active Post_Code=27260 and city active ZIP=27260, Guilford County, joined by exact REID. Owner mailing ZIP is never used.',
      geography_verification: 'county_city_zip_agreement',
      geography_source_urls: [ADDRESS_LAYER, CITY_ADDRESS_LAYER],
      city_source_url: CITY_ADDRESS_LAYER,
      city_where: CITY_ADDRESS_WHERE,
      county_candidate_unique_parcels: county.records.length,
      city_address_points: cityAddresses.length,
      city_candidate_unique_parcels: cityGroups.size,
      excluded_county_candidates_without_city_zip_agreement: county.records.length - agreed.length,
      city_candidates_without_county_zip_agreement: [...cityGroups.keys()].filter(id => !countyIds.has(id)).length,
      retained_county_address_points: agreed.reduce((total, record) => total + record.address_point_count, 0),
      latest_city_address_edit: iso(cityLastEdit),
      latest_city_processing_update: iso(cityProcessingUpdate),
      update_date_meaning: 'County last_edited_date and city ts_update can reflect bulk processing. They do not certify current postal accuracy or source-event freshness. County original DateUpdate can be substantially older.',
      limitations: [...county.metadata.limitations,
        'County and city address labels can disagree or be stale; candidates lacking agreement are excluded.',
        'Agreement is by parcel REID, which can have multiple addresses. It is not independent postal-service validation.',
        'An explicit conflicting ZIP on an individual case record must still be flagged and excluded from the exact27260 view.'
      ]
    }
  };
}

// Optional: enrich only selected matched leads, rather than downloading the entire county.
export async function lookupParcelDetails(parcelIds, fetchImpl = fetch) {
  const ids = [...new Set(parcelIds.map(cleanId))];
  if (ids.some(id => !/^\d{1,7}$/.test(id)) || ids.length > 1000) throw new Error('Invalid/broad parcel lookup');
  const records = [];
  for (let offset = 0; offset < ids.length; offset += 250) {
    const slice = ids.slice(offset, offset + 250);
    const page = await query(fetchImpl, PARCEL_LAYER, { where: `REID IN (${slice.map(id => `'${id}'`).join(',')})`, outFields: 'REID,PIN,LOCATION_ADDR,Property_Type,Total_Assessed,Total_Building_Value,Total_Land_Value,DEED_DATE,Structure_Size,Lot_Size,YEAR_BUILT,BEDROOMS,Bathrooms', returnGeometry: 'false', resultRecordCount: '2000' }, true);
    if (page.exceededTransferLimit) throw new Error('Parcel lookup transfer limit exceeded');
    for (const feature of page.features || []) {
      const a = feature.attributes;
      records.push({ parcel_id: cleanId(a.REID), pin: a.PIN || null, county_address: a.LOCATION_ADDR || null, property_type: a.Property_Type || null, assessed_value: a.Total_Assessed ?? null, assessed_land_value: a.Total_Land_Value ?? null, assessed_building_value: a.Total_Building_Value ?? null, deed_date: iso(a.DEED_DATE), structure_size: a.Structure_Size ?? null, lot_size: a.Lot_Size ?? null, year_built: a.YEAR_BUILT ?? null, bedrooms: a.BEDROOMS ?? null, bathrooms: a.Bathrooms ?? null, source_url: PARCEL_LAYER });
    }
  }
  return records;
}
