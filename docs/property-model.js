(function (root) {
  'use strict';
  // Match the dashboard's leading-zero normalization without turning a list of
  // parcel identifiers into a different, apparently valid identifier.
  const normalId = value => String(value ?? '').replace(/[^\da-z]/gi, '').replace(/^0+(?=\d)/, '').toUpperCase();
  const parcelId = value => {
    const raw = String(value ?? '').trim();
    if (!/^\d+$/.test(raw)) return null;
    const id = normalId(raw);
    return /^\d{1,7}$/.test(id) && id !== '0' ? id : null;
  };
  function countyKey(record) {
    const value = String(record?.county ?? '').trim();
    if (value) {
      const match = value.match(/^(Guilford|Davidson|Randolph|Forsyth)(?:\s+County)?(?:\s*\(100%\))?$/i);
      return match ? match[1].toLowerCase() : null;
    }
    // These collectors publish Guilford-only feeds. City cases span counties.
    return ['parcels', 'foreclosures', 'tax_bills'].includes(record?.source_id) ? 'guilford' : null;
  }
  const addressZip = value => String(value ?? '').match(/\bNC[\s,]+(\d{5})(?:-\d{4})?\s*$/i)?.[1] || null;
  function safeUrl(value) {
    if (typeof value !== 'string') return null;
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
    } catch (_) { return null; }
  }
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  function countyPropertyUrl(record) {
    const id = parcelId(record?.parcel_id);
    return id && countyKey(record) === 'guilford' ? `https://lrcpwa.ncptscloud.com/guilford/parcel-detail/${id}` : null;
  }
  function countyTaxUrl(record) {
    const id = parcelId(record?.parcel_id);
    return id && countyKey(record) === 'guilford' ? `https://bcpwa.ncptscloud.com/guilford/bill-search?parcelid=${id}` : null;
  }
  const countyMapUrl = () => null;
  function sourceLinkLabel(record) {
    return ({ code_case: 'City case data (JSON)', tax_bill: 'County tax download / source', foreclosure: 'County foreclosure map (all cases)', parcel: 'County address data service' })[record?.record_type] || 'Published source';
  }
  function selectProperty(dataset, query) {
    const records = Array.isArray(dataset?.records) ? dataset.records : [];
    const params = query instanceof URLSearchParams ? query : new URLSearchParams(query || '');
    const requestedRecord = params.get('record');
    const requestedParcel = params.get('parcel');
    const unique = [];
    const seen = new Set();
    for (const record of records) {
      if (!record || typeof record !== 'object') continue;
      if (record.id && seen.has(record.id)) continue;
      if (record.id) seen.add(record.id);
      unique.push(record);
    }
    let selected;
    if (requestedRecord !== null) {
      selected = unique.find(record => record.id === requestedRecord);
      if (!selected) return { state: 'not_found', message: 'This source record is not in the current saved dataset. It may have changed or been removed by its publisher.' };
    } else if (requestedParcel !== null) {
      const id = parcelId(requestedParcel);
      selected = id ? unique.find(record => record.record_type === 'parcel' && countyKey(record) === 'guilford' && parcelId(record.parcel_id) === id) : null;
      if (!selected) return { state: 'not_found', message: 'This parcel does not have a county-qualified property-base record in the current dataset. Open an individual source record from the dashboard.' };
    } else {
      return { state: 'missing', message: 'Open a property or source record from the dashboard to see its evidence here.' };
    }
    const id = parcelId(selected.parcel_id);
    const county = countyKey(selected);
    const canGroup = Boolean(id && county === 'guilford');
    const related = canGroup ? unique.filter(record => countyKey(record) === county && parcelId(record.parcel_id) === id) : [selected];
    const base = related.find(record => record.record_type === 'parcel') || null;
    const groups = { codeCases: [], taxBills: [], foreclosures: [], parcels: [], other: [] };
    const keys = { code_case: 'codeCases', tax_bill: 'taxBills', foreclosure: 'foreclosures', parcel: 'parcels' };
    for (const record of related) groups[keys[record.record_type] || 'other'].push(record);
    groups.codeCases.sort((a, b) => String(b.event_date || '').localeCompare(String(a.event_date || '')) || String(a.id).localeCompare(String(b.id)));
    groups.taxBills.sort((a, b) => String(b.tax_year || '').localeCompare(String(a.tax_year || '')) || String(a.bill_number || a.id).localeCompare(String(b.bill_number || b.id)));
    const zipEvidence = [...new Set(related.flatMap(record => [record.zip === '27260' ? '27260' : null, addressZip(record.address)]).filter(Boolean))];
    const zipConflict = related.some(record => record.geography_conflict === true) || zipEvidence.length > 1;
    const zip = zipConflict ? null : base?.zip || addressZip(selected.address) || selected.zip || null;
    const sourceIds = [...new Set(related.map(record => record.source_id).filter(Boolean))];
    const sources = (Array.isArray(dataset?.sources) ? dataset.sources : []).filter(source => sourceIds.includes(source.id));
    return {
      state: 'ready', selected, records: related, groups, base, parcelId: id, county,
      canGroup, zip, zipConflict, zipEvidence, sources,
      address: base?.address || selected.address || (id ? `Parcel ${id}` : 'Source record'),
      city: base?.city || selected.city || null,
      generatedAt: dataset?.generated_at || null,
      lastRun: dataset?.last_run || null,
      groupNote: canGroup ? 'Related records use the same Guilford County parcel identifier across the complete saved dataset. Current dashboard filters do not limit this page.' : 'Showing only the selected source record. Its county or parcel identifier does not support a safe Guilford County join; matching street names are not used.'
    };
  }
  const api = { normalId, parcelId, countyKey, addressZip, safeUrl, escapeHtml, countyPropertyUrl, countyTaxUrl, countyMapUrl, sourceLinkLabel, selectProperty };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PropertyModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
