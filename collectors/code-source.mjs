/** Read-only adapter for High Point's published code-enforcement GIS service.
 * Requests a small property/case field allowlist, never owner or cited-party data.
 */
export const CODE_SOURCE = Object.freeze({
  id: 'code_cases',
  name: 'City of High Point code-enforcement cases',
  endpoint: 'https://gisentapp01.highpointnc.gov/server/rest/services/Internal/AccelaCodeViolations/MapServer/0',
  public_reference_url: 'https://www.highpointnc.gov/2982/Development-Records',
  metadata_url: 'https://gisentapp01.highpointnc.gov/server/rest/services/Internal/AccelaCodeViolations/MapServer/info/iteminfo?f=pjson',
  publisher: 'City of High Point / HPITS',
  published_refresh_description: 'updated from SQL Stored Proc Nightly',
  access_note: 'Published ArcGIS query service; no authentication required when verified on 2026-10-17. Service licenseInfo is "none"; this is not a legal guarantee.',
  limitations: [
    'Cases are city-wide; a county parcel join is needed to establish ZIP 27260.',
    'An investigation is an unverified complaint, not a confirmed violation.',
    'A code case does not establish sale intent, vacancy, condition, title, or investment value.',
    'Closed cases, including Closed - Lien Filed, are excluded; this is not a complete outstanding-lien feed.',
    'Source dates describe case events, not guaranteed database extraction time.',
  ],
});

const FIELDS = [
  'OBJECTID', 'Record_ID', 'Record_Type', 'Address', 'Open_Date', 'Closed_Date',
  'Notice_Sent', 'Hearing_Date', 'Compliance_Due', 'Failed_Insp', 'Passed_Insp',
  'Parcel_Number', 'County', 'Jurisdiction', 'Rec_Status', 'Rec_Status_Date',
  'Lien_Filed', 'Lien_Release', 'Inv_Fee_Bal', 'Violation', 'Total_Cost',
].join(',');
export const ACTIVE_CASE_WHERE = "Closed_Date IS NULL AND (Rec_Status NOT LIKE 'Closed%' OR Rec_Status IS NULL)";

function dateOnly(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(typeof value === 'number' ? value : String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}
function text(value) { return value == null ? null : String(value).trim() || null; }
function numeric(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function maxDate(dates) { return dates.filter(Boolean).sort().at(-1) || null; }

export function normalizeCodeFeature(feature) {
  const a = feature?.attributes || {};
  if (a.Closed_Date != null || /^closed\b/i.test(a.Rec_Status || '')) return null;
  const caseId = text(a.Record_ID);
  if (!caseId) return null;
  const status = text(a.Rec_Status) || 'Status not provided';
  const investigation = /investigation|ownership validation/i.test(status);
  const eventDate = dateOnly(a.Rec_Status_Date) || dateOnly(a.Open_Date);
  const feeBalance = numeric(a.Inv_Fee_Bal);
  return {
    id: `code:${caseId}`,
    source_id: 'code_cases',
    record_type: 'code_case',
    parcel_id: text(a.Parcel_Number),
    pin: null,
    address: text(a.Address),
    city: 'High Point',
    zip: null,
    case_id: caseId,
    case_type: text(a.Record_Type),
    status,
    event_date: eventDate,
    amount: feeBalance,
    amount_label: feeBalance == null ? null : 'Reported case invoice balance; verify current status',
    source_url: `${CODE_SOURCE.endpoint}/query?${new URLSearchParams({ where: `Record_ID='${caseId.replaceAll("'", "''")}'`, outFields: FIELDS, returnGeometry: 'false', f: 'pjson' })}`,
    reference_url: CODE_SOURCE.public_reference_url,
    opened_date: dateOnly(a.Open_Date),
    status_date: dateOnly(a.Rec_Status_Date),
    notice_date: dateOnly(a.Notice_Sent),
    hearing_date: dateOnly(a.Hearing_Date),
    compliance_due_date: dateOnly(a.Compliance_Due),
    lien_filed_date: dateOnly(a.Lien_Filed),
    lien_release_date: dateOnly(a.Lien_Release),
    failed_inspections: numeric(a.Failed_Insp),
    passed_inspections: numeric(a.Passed_Insp),
    county: text(a.County),
    jurisdiction: text(a.Jurisdiction),
    violation_type: text(a.Violation),
    verification_status: investigation ? 'unverified_complaint' : 'source_reported_case',
    verification_note: investigation
      ? 'Investigation or ownership review pending. No confirmed violation should be inferred.'
      : 'City case record. Verify present condition, current case status, and any balance with the city.',
    longitude: numeric(feature?.geometry?.x),
    latitude: numeric(feature?.geometry?.y),
  };
}

async function readQuery(fetchImpl, query) {
  const url = `${CODE_SOURCE.endpoint}/query?${new URLSearchParams({ ...query, f: 'json' })}`;
  const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`High Point code source returned HTTP ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(`High Point code source error: ${data.error.message || data.error.code}`);
  return data;
}

export async function collectCodeCases(fetchImpl = fetch) {
  const records = [];
  const seen = new Set();
  // Sequential 1,000-case pages with a hard ceiling; current active feed has fewer than one page.
  let offset = 0;
  for (let page = 0; page < 20; page += 1) {
    const data = await readQuery(fetchImpl, {
      where: ACTIVE_CASE_WHERE, outFields: FIELDS, orderByFields: 'OBJECTID',
      resultOffset: String(offset), resultRecordCount: '1000', returnGeometry: 'true', outSR: '4326',
    });
    if (!Array.isArray(data.features)) throw new Error('High Point code source did not return a feature array');
    for (const feature of data.features) {
      const record = normalizeCodeFeature(feature);
      if (record && !seen.has(record.id)) { seen.add(record.id); records.push(record); }
    }
    if (!data.exceededTransferLimit) break;
    if (!data.features.length || page === 19) throw new Error('High Point code source pagination incomplete');
    offset += data.features.length;
  }
  if (!records.length) throw new Error('High Point active code feed was empty; preserve the previous snapshot for review');
  const stats = await readQuery(fetchImpl, {
    where: '1=1', returnGeometry: 'false',
    outStatistics: JSON.stringify([
      { statisticType: 'max', onStatisticField: 'Rec_Status_Date', outStatisticFieldName: 'max_status_date' },
      { statisticType: 'max', onStatisticField: 'Open_Date', outStatisticFieldName: 'max_open_date' },
    ]),
  });
  const dates = stats.features?.[0]?.attributes || {};
  return {
    records,
    source_updated_at: maxDate([dateOnly(dates.max_status_date), dateOnly(dates.max_open_date)]),
    metadata: { ...CODE_SOURCE, query: ACTIVE_CASE_WHERE, returned_cases: records.length, source_date_meaning: 'Newest reported case open/status date across the published layer, not last extraction time' },
  };
}
