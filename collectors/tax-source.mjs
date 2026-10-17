/**
 * Reads the county-linked, public taxpayer download API and streams its CSV.
 * No credentials or access-control bypass; temporary download URLs stay in memory.
 * Only an explicit allowlist of official situs parcels is retained. Owner and
 * mailing fields are never returned or used to decide property geography.
 */
const TAX_API = 'https://bcpwa.ncptscloud.com/api';
const TAX_PAGE = 'https://bcpwa.ncptscloud.com/Guilford/downloads';
const TAX_HEADERS = { Accept: 'application/json', 'X-Tenant': 'Guilford' };
const MAX_BYTES = 65 * 1024 * 1024;
const REQUIRED_COLUMNS = ['BILL_NUMBER', 'BILL_TYPE', 'PARCEL_NUM', 'TAX_YEAR', 'BILL_STATUS', 'TOTAL_DUE_AMOUNT', 'BILL_DUE_DATE', 'FLAGS'];

export const canonicalTaxParcel = value => String(value ?? '').trim().replace(/[^a-zA-Z0-9]/g, '').replace(/^0+(?=.)/, '').toUpperCase();
const clean = value => String(value ?? '').trim() || null;
const money = value => {
  const s = String(value ?? '').trim().replace(/[$,]/g, '');
  return s !== '' && Number.isFinite(Number(s)) ? Number(s) : null;
};
const dueDate = value => {
  const s = String(value ?? '').trim();
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s|$)/.exec(s);
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null;
};

/** Incremental RFC4180 parser: bounded row/field memory; quoted newlines allowed. */
export async function scanCsvStream(body, onRow, { maxBytes = MAX_BYTES, maxRowChars = 262144, maxFieldChars = 65536 } = {}) {
  if (!body?.getReader) throw new Error('Public tax download does not support streaming');
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let field = '', row = [], state = 'start', skipLF = false, rowChars = 0;
  let bytes = 0, rowCount = 0, sawAny = false;
  const endField = () => { row.push(field); field = ''; state = 'start'; if (row.length > 256) throw new Error('Tax CSV has too many columns'); };
  const endRow = () => {
    endField();
    if (row.some(v => v !== '')) { onRow(row, rowCount++); }
    row = []; rowChars = 0;
  };
  const consume = chunk => {
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];
      if (!sawAny) { sawAny = true; if (c === '\uFEFF') continue; }
      if (skipLF) { skipLF = false; if (c === '\n') continue; }
      if (++rowChars > maxRowChars) throw new Error('Tax CSV row exceeds safe size');
      if (state === 'quoted') {
        if (c === '"') state = 'closed';
        else field += c;
      } else if (state === 'closed') {
        if (c === '"') { field += '"'; state = 'quoted'; }
        else if (c === ',') endField();
        else if (c === '\n' || c === '\r') { endRow(); skipLF = c === '\r'; }
        else if (c !== ' ' && c !== '\t') throw new Error('Tax CSV has invalid content after quoted field');
      } else if (c === ',' ) endField();
      else if (c === '\n' || c === '\r') { endRow(); skipLF = c === '\r'; }
      else if (c === '"' && state === 'start') state = 'quoted';
      else { field += c; state = 'unquoted'; }
      if (field.length > maxFieldChars) throw new Error('Tax CSV field exceeds safe size');
    }
  };
  let completed = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error('Tax CSV exceeds configured safe download limit');
      consume(decoder.decode(value, { stream: true }));
    }
    consume(decoder.decode());
    if (state === 'quoted') throw new Error('Tax CSV ended inside a quoted field');
    if (field.length || row.length || state === 'closed') endRow();
    completed = true;
    return { bytes, rows: rowCount };
  } finally {
    if (!completed) { try { await reader.cancel(); } catch {} }
    reader.releaseLock();
  }
}

async function jsonFromPublicTaxApi(fetchImpl, path) {
  let response;
  try { response = await fetchImpl(`${TAX_API}/${path}`, { headers: TAX_HEADERS }); }
  catch { throw new Error('Public county tax API could not be reached'); }
  if (!response.ok) throw new Error(`Public county tax API returned HTTP ${response.status}`);
  let data;
  try { data = await response.json(); }
  catch { throw new Error('Public county tax API did not return JSON'); }
  return data;
}

/**
 * Dashboard collector contract. parcelIds MUST be the official property-situs
 * allowlist prepared by the parcel collector. No mailing address heuristics.
 */
async function collectTaxInternal(fetchImpl, options) {
  const targetParcels = new Map([...(options.targetParcels || [])].map(([id, property]) => [canonicalTaxParcel(id), property]));
  if (targetParcels.size) options = { ...options, parcelIds: new Set(targetParcels.keys()) };
  const parcelIds = new Set([...(options.parcelIds || [])].map(canonicalTaxParcel).filter(Boolean));
  if (!parcelIds.size) throw new Error('Tax collection requires official target parcel IDs first');
  const list = await jsonFromPublicTaxApi(fetchImpl, 'GetTaxpayerDownloadList');
  if (!Array.isArray(list)) throw new Error('Public tax download list has an unexpected format');
  const file = list.find(r => /(?:^|\/)DelinquentExtract\.csv$/i.test(String(r.blobName || '')));
  if (!file) throw new Error('Public tax delinquency CSV is not listed by the county');
  if (Number(file.fileSize) > MAX_BYTES) throw new Error('Public tax delinquency CSV exceeds safe worker size');
  const link = await jsonFromPublicTaxApi(fetchImpl, `DownloadTaxpayerDownloadBlob?fileName=${encodeURIComponent(file.blobName)}`);
  let downloadUrl;
  try {
    downloadUrl = new URL(link.downloadUrl);
    if (downloadUrl.protocol !== 'https:' || !downloadUrl.hostname.endsWith('.blob.core.windows.net')) throw new Error();
  } catch { throw new Error('Public tax API returned an unexpected download location'); }
  let response;
  try { response = await fetchImpl(downloadUrl.toString(), { headers: { Accept: 'text/csv' } }); }
  catch { throw new Error('Public tax CSV could not be downloaded'); }
  if (!response.ok || response.status === 206) throw new Error(`Public tax CSV returned HTTP ${response.status}; full download required`);
  const contentLength = Number(response.headers.get('Content-Length'));
  if (contentLength > MAX_BYTES) { try { await response.body.cancel(); } catch {} throw new Error('Tax CSV exceeds safe worker size'); }
  const records = [], seen = new Set();
  const byType = {}, byStatus = {};
  let columns, expectedColumnCount, dataRows = 0, matchedRows = 0, skippedNonReal = 0, skippedZeroBalance = 0, duplicateBills = 0;
  const retrievedAt = new Date().toISOString();
  const scan = await scanCsvStream(response.body, (values, index) => {
    if (index === 0) {
      expectedColumnCount = values.length;
      columns = Object.fromEntries(values.map((name, i) => [name.trim().toUpperCase(), i]));
      if (REQUIRED_COLUMNS.some(name => columns[name] === undefined)) throw new Error('Public tax CSV schema changed; required columns missing');
      return;
    }
    if (values.length !== expectedColumnCount) throw new Error('Public tax CSV row has an unexpected column count; retain prior snapshot');
    dataRows++;
    const get = key => values[columns[key]];
    const billType = clean(get('BILL_TYPE'));
    const status = clean(get('BILL_STATUS'));
    byType[billType || '(blank)'] = (byType[billType || '(blank)'] || 0) + 1;
    byStatus[status || '(blank)'] = (byStatus[status || '(blank)'] || 0) + 1;
    const parcel = canonicalTaxParcel(get('PARCEL_NUM'));
    if (!parcel || !parcelIds.has(parcel)) return;
    matchedRows++;
    // Exact published bill type is verified against the full county extract.
    if (billType !== 'REI') { skippedNonReal++; return; }
    const balance = money(get('TOTAL_DUE_AMOUNT'));
    if (balance == null || balance <= 0) { skippedZeroBalance++; return; }
    const bill = clean(get('BILL_NUMBER'));
    const year = clean(get('TAX_YEAR'));
    if (!bill) throw new Error('Matching tax row has no bill identifier');
    const id = `guilford-tax:${bill}`;
    if (seen.has(id)) { duplicateBills++; return; }
    seen.add(id);
    const property = targetParcels.get(parcel) || {};
    const sourceFlags = String(get('FLAGS') || '').split(',').map(s => s.trim()).filter(Boolean);
    const billDueDate = dueDate(get('BILL_DUE_DATE'));
    records.push({
      id,
      source_id: 'tax_bills',
      record_type: 'tax_bill',
      parcel_id: parcel,
      pin: property.pin || null,
      address: property.address || null,
      city: property.city || null,
      zip: property.zip || null,
      case_id: `${bill} / tax year ${year || 'unknown'}`,
      bill_number: bill,
      tax_year: year,
      bill_type: billType,
      status,
      status_label: 'Published unpaid property-tax bill',
      flags: clean(get('FLAGS')),
      source_flags: sourceFlags,
      source_flag_dlq_present: sourceFlags.includes('DLQ'),
      tax_delinquency_verification: 'Needs current verification',
      due_date: billDueDate,
      event_date: billDueDate,
      event_date_type: 'bill_due_date',
      amount: balance,
      amount_label: 'Published total tax balance due (verify current)',
      source_url: TAX_PAGE,
      retrieved_at: retrievedAt,
    });
    if (records.length > 50000) throw new Error('Target tax records exceed configured safe output limit');
  });
  if (!columns || !dataRows) throw new Error('Public tax CSV contained no data; retain prior snapshot');
  if (Number(file.fileSize) > 0 && scan.bytes !== Number(file.fileSize)) throw new Error('Public tax CSV length differs from published file size; retain prior snapshot');
  return {
    records,
    source_updated_at: file.fileDate || null,
    metadata: {
      source_name: 'Guilford County published unpaid property-tax bills',
      source_url: TAX_PAGE,
      api_url: `${TAX_API}/GetTaxpayerDownloadList`,
      source_file: file.blobName,
      source_file_date_raw: file.fileDate || null,
      source_file_date_timezone: 'not specified by publisher',
      retrieved_at: retrievedAt,
      published_bytes: Number(file.fileSize) || null,
      full_csv_bytes: scan.bytes,
      scanned_rows: dataRows,
      source_bill_types: byType,
      source_bill_statuses: byStatus,
      target_parcel_ids: parcelIds.size,
      matching_parcel_rows: matchedRows,
      skipped_non_real_property_rows: skippedNonReal,
      skipped_nonpositive_balance_rows: skippedZeroBalance,
      duplicate_bill_rows: duplicateBills,
      unique_matching_parcels: new Set(records.map(r => r.parcel_id)).size,
      warnings: [
        'Only parcels in the official property-situs allowlist are retained. Owner mailing ZIP is never used.',
        'Balance is the published extract amount, not a verified current payoff; payment, penalties, disputes and corrections can change it.',
        'Bill due date is not the date delinquency began or the date the owner decided to sell.',
        'A delinquent tax record does not establish owner selling intent or property availability.',
        'Keep bills separate; deduplicate bill IDs before any balance total.',
        'The extract includes historical bills. A newly downloaded file is not evidence of a newly delinquent property.',
        'UNPAID, due date and raw county flags are preserved separately; no legal delinquency determination is inferred.',
      ],
    },
  };
}

/** The timeout aborts the download body too, covering the complete scan. */
export async function collectTax(fetchImpl = globalThis.fetch, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 90000);
  const timedFetch = (url, init = {}) => fetchImpl(url, { ...init, signal: controller.signal });
  try {
    return await collectTaxInternal(timedFetch, options);
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Public tax CSV collection timed out; retain the prior snapshot');
    throw error;
  } finally { clearTimeout(timeout); }
}

export async function collectTaxDelinquencies({ fetchImpl = globalThis.fetch, targetParcels, timeoutMs } = {}) {
  return collectTax(fetchImpl, { targetParcels, timeoutMs });
}
