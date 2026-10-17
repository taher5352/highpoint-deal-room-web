export const normalId = value => String(value ?? '').replace(/[^\da-z]/gi, '').replace(/^0+(?=\d)/, '').toUpperCase();

// Only exact parcel identifiers establish geography; street similarity is not proof.
export function joinMarket(datasets) {
  const byParcel = new Map(), byPin = new Map(), conflicts = new Set();
  for (const parcel of datasets.parcels || []) {
    if (parcel.zip !== '27260') continue;
    if (parcel.parcel_id) byParcel.set(normalId(parcel.parcel_id), parcel);
    if (parcel.pin) byPin.set(normalId(parcel.pin), parcel);
  }
  for (const record of datasets.code_cases || []) {
    const explicitZip = String(record.address || '').match(/\bNC[\s,]+(\d{5})(?:-\d{4})?\s*$/i)?.[1];
    if (/guilford/i.test(record.county || '') && explicitZip && explicitZip !== '27260' && byParcel.has(normalId(record.parcel_id))) conflicts.add(normalId(record.parcel_id));
  }
  return Object.values(datasets).flat().map(record => {
    const countySafe = record.source_id !== 'code_cases' || /guilford/i.test(record.county || '');
    const parcel = countySafe ? byParcel.get(normalId(record.parcel_id)) || byPin.get(normalId(record.pin)) : null;
    const conflict = conflicts.has(normalId(record.parcel_id));
    const zip = conflict ? null : record.record_type === 'parcel' ? record.zip : parcel?.zip || null;
    return { ...record, zip, city: record.city || parcel?.city || null, geography_conflict: conflict,
      market_match: conflict ? 'Conflicting source ZIP; review' : record.record_type === 'parcel' && zip === '27260' ? 'Source situs ZIP' : parcel ? 'Matched official 27260 parcel' : 'ZIP not verified',
      off_market_status: 'Not verified', asking_price: null };
  });
}

// Avoid republishing address aliases, owner/contact details, or unnecessary source fields.
export function slimParcel(record) {
  const fields = ['id', 'source_id', 'record_type', 'parcel_id', 'pin', 'address', 'city', 'county', 'state', 'zip', 'status', 'source_url', 'geography_verification', 'address_point_count'];
  return Object.fromEntries(fields.filter(key => key in record).map(key => [key, record[key]]));
}
