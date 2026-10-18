(function () {
  'use strict';
  const M = window.PropertyModel;
  const esc = M.escapeHtml;
  const money = value => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'Not provided';
  const present = value => value !== null && value !== undefined && value !== '';
  const text = value => present(value) ? String(value) : 'Not provided';
  function date(value) {
    if (!present(value)) return 'Not provided';
    const raw = String(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const parsed = new Date(`${raw}T12:00:00Z`);
      return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' });
    }
    if (!/(?:Z|[+-]\d{2}:?\d{2})$/.test(raw)) return `${raw} (publisher timezone not specified)`;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleString('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  }
  function link(url, label, className = '') {
    const safe = M.safeUrl(url);
    return safe ? `<a${className ? ` class="${esc(className)}"` : ''} href="${esc(safe)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>` : '';
  }
  function field(label, value, full = false) {
    return `<div${full ? ' class="full"' : ''}><dt>${esc(label)}</dt><dd>${esc(text(value))}</dd></div>`;
  }
  function fields(rows, className = 'signal-dl') {
    return `<dl class="${className}">${rows.filter(row => row.length > 1).map(row => field(...row)).join('')}</dl>`;
  }
  function rawLinks(record) {
    return `<div class="signal-links">${link(record.source_url, M.sourceLinkLabel(record))}${record.reference_url ? link(record.reference_url, 'Publisher record guidance') : ''}</div>`;
  }
  function selectedLabel(record, model) {
    return record.id === model.selected.id ? '<span class="record-anchor">SELECTED SOURCE RECORD</span>' : '';
  }
  function signalCard(record, model, title, subtitle, rows, caution) {
    return `<article class="property-signal${record.id === model.selected.id ? ' is-selected' : ''}"><div class="signal-title"><div>${selectedLabel(record, model)}<h3>${esc(title)}</h3>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div><span class="signal-status">${esc(text(record.status))}</span></div>${fields(rows)}${rawLinks(record)}${caution ? `<p class="signal-caution">${esc(caution)}</p>` : ''}</article>`;
  }
  function cityCases(model) {
    return model.groups.codeCases.map(record => signalCard(record, model, record.case_id || record.id, record.case_type || 'City code case', [
      ['Source address', record.address, true],
      ['Case opened', date(record.opened_date)], ['Status date', date(record.status_date)],
      ['Notice sent', date(record.notice_date)], ['Compliance due', date(record.compliance_due_date)],
      ['Hearing date', date(record.hearing_date)], ['Failed / passed inspections', `${text(record.failed_inspections)} / ${text(record.passed_inspections)}`],
      [record.amount_label || 'Source-reported case amount', money(record.amount), true],
      ...(present(record.violation_type) ? [['Source violation description', record.violation_type, true]] : []),
      ...(present(record.lien_filed_date) ? [['Lien filed date', date(record.lien_filed_date)]] : []),
      ...(present(record.lien_release_date) ? [['Lien release date', date(record.lien_release_date)]] : []),
      ['Source county / jurisdiction', [record.county, record.jurisdiction].filter(Boolean).join(' · '), true]
    ], record.verification_note || 'An investigation may be an unverified complaint. Verify present condition, current case status, and any reported fees with the city.')).join('');
  }
  function taxBills(model) {
    return model.groups.taxBills.map(record => signalCard(record, model, `Tax year ${text(record.tax_year)}`, record.bill_number ? `Bill ${record.bill_number}` : record.case_id || record.id, [
      [record.amount_label || 'Published tax balance due', money(record.amount), true],
      ['Bill due date', date(record.due_date)], ['Bill type', record.bill_type],
      ['Publisher flags', Array.isArray(record.source_flags) ? record.source_flags.join(', ') : record.flags, true],
      ['Delinquency verification', record.tax_delinquency_verification, true],
      ['Source address', record.address, true]
    ], 'This is the published balance for this bill and tax year, not a current payoff quote. A due date or county flag does not establish when legal delinquency began. Historical bills remain separate.')).join('');
  }
  function foreclosures(model) {
    return model.groups.foreclosures.map(record => signalCard(record, model, record.case_id || 'County foreclosure record', present(record.source_record_id) ? `Published record ${record.source_record_id}` : record.id, [
      ['Source address', record.address, true], ['PIN', record.pin], ['Property type', record.property_type],
      [record.amount_label || 'Source-reported assessment', money(record.amount), true],
      ['Source auction date', date(record.event_date)], ['Source auction time', record.auction_time],
      ['Source auction location', record.auction_location, true],
      ...(present(record.year_built) ? [['Year built (source)', record.year_built]] : []),
      ...(present(record.building_sqft) ? [['Building square feet (source)', record.building_sqft]] : []),
      ...(present(record.bedrooms) ? [['Bedrooms (source)', record.bedrooms]] : []),
      ...(present(record.bathrooms) ? [['Bathrooms (source)', record.bathrooms]] : [])
    ], 'A tax assessment is not an asking price or market value. Multiple source rows can describe the same parcel; assessments are not added together. Verify auction timing and legal status with the county.')).join('');
  }
  function section(id, eyebrow, title, records, body, empty, note) {
    return `<section id="${id}" class="panel property-section"><div class="section-head"><div><span class="eyebrow">${eyebrow}</span><h2>${title} <span class="badge">${records.length}</span></h2>${note ? `<p>${esc(note)}</p>` : ''}</div></div>${records.length ? body : `<p class="property-empty">${esc(empty)}</p>`}</section>`;
  }
  function verification(model) {
    const rows = [
      ['County used for grouping', model.county ? model.county[0].toUpperCase() + model.county.slice(1) : 'Not established'],
      ['Canonical parcel identifier', model.parcelId || 'Not safe to establish'],
      ['Source parcel identifier', model.selected.parcel_id],
      ['Property-base address', model.base?.address || 'No matching property-base record'],
      ['Selected source address', model.selected.address],
      ['ZIP evidence', model.zipConflict ? `Conflict: ${model.zipEvidence.join(', ') || 'source conflict flag'}` : model.zip || 'Not verified'],
      ['27260 address agreement', model.base?.geography_verification === 'county_city_zip_agreement' && !model.zipConflict ? 'City and county active address records agree by parcel ID' : 'Not established for this property'],
      ['Source address-point count', model.base?.address_point_count]
    ];
    return `<section id="verification" class="panel property-section"><div class="section-head"><div><span class="eyebrow">KNOW WHAT IS MATCHED</span><h2>Address verification</h2></div></div><div class="verification-body">${fields(rows, 'verification-dl')}<p>Grouping uses a county-qualified parcel identifier. Addresses alone are not used to combine records. One parcel can have several site addresses.</p>${model.base ? `<div class="signal-links">${link(model.base.source_url, 'County address data service')}</div>` : ''}<p>Address agreement is a public-record cross-check, not postal-service certification. Processing timestamps can be newer than the underlying address information.</p></div></section>`;
  }
  function health(model) {
    const cards = model.sources.map(source => {
      const metadata = source.metadata || {};
      const sourceDate = metadata.source_updated_at || null;
      const sourceDateMeaning = metadata.source_date_meaning || metadata.update_date_meaning || (source.id === 'foreclosures' ? 'No per-record update date is supplied by this feed.' : 'Publisher dates do not establish a new investment opportunity.');
      return `<article class="source-health-card"><h3>${esc(source.name || source.id)} <span class="badge">${esc(source.state || 'Saved source')}</span></h3>${fields([
        ['Last successful collection', date(source.last_success_at)], ['Last collection attempt', date(source.last_attempt_at)],
        ['Reported source date', date(sourceDate)], ['Records in entire source', source.record_count]
      ])}${source.last_error ? `<p class="source-error"><strong>Last reported collection error:</strong> ${esc(typeof source.last_error === 'string' ? source.last_error : JSON.stringify(source.last_error))}</p>` : '<p>No collection error is recorded for this source in the saved dataset.</p>'}<p>${esc(sourceDateMeaning)}</p>${source.scope ? `<p><strong>Coverage:</strong> ${esc(source.scope)}</p>` : ''}${link(source.url, 'Source information')}${source.id === 'parcels' ? `<p>County original address update: ${esc(date(metadata.latest_original_address_update))}<br>County layer edit: ${esc(date(metadata.latest_address_layer_edit))}<br>City address edit: ${esc(date(metadata.latest_city_address_edit))}<br>City processing update: ${esc(date(metadata.latest_city_processing_update))}</p>` : ''}</article>`;
    }).join('');
    return `<section id="source-health" class="panel property-section"><div class="section-head"><div><span class="eyebrow">DATES AND COLLECTION STATUS</span><h2>Source health</h2><p>Saved dataset: ${esc(date(model.generatedAt))}. Last collection run: ${esc(text(model.lastRun?.status))}.</p></div></div>${cards ? `<div class="source-health-grid">${cards}</div>` : '<p class="property-empty">Collection metadata is not available for the selected source.</p>'}<p class="property-method">Last successful collection means the collector fetched a source. It does not mean that this property became distressed, newly available, or newly listed on that date. This page uses the saved public dataset and does not query an MLS or a live listing feed.</p></section>`;
  }
  function render(model) {
    const selectedType = ({ code_case: 'city code case', tax_bill: 'tax bill', foreclosure: 'foreclosure record', parcel: 'property-base record' })[model.selected.record_type] || 'source record';
    const countyLabel = model.county ? `${model.county[0].toUpperCase()}${model.county.slice(1)} County` : 'County not established';
    const countyUrl = M.countyPropertyUrl(model.selected);
    const zipLabel = model.zipConflict ? 'ZIP conflict · review required' : model.zip ? `ZIP ${model.zip}` : 'ZIP not verified';
    const rawSelected = model.groups.other.map(record => signalCard(record, model, record.case_id || record.id || 'Source record', '', [['Source address', record.address, true], ['Source date', date(record.event_date)], [record.amount_label || 'Source-reported amount', money(record.amount)]], 'Verify the published source before making a decision.')).join('');
    document.title = `${model.address} · High Point Deal Room`;
    document.getElementById('property-content').innerHTML = `
      <header class="property-hero"><div><span class="eyebrow">THE PROPERTY EVIDENCE</span><h1>${esc(model.address)}</h1><p>${esc([model.city, countyLabel].filter(Boolean).join(' · '))}</p><div class="property-identity"><span class="badge">${esc(model.parcelId ? `Parcel ${model.parcelId}` : 'Parcel not established')}</span><span class="badge">${esc(zipLabel)}</span></div></div><div class="property-actions">${link(countyUrl, 'Open county property record', 'button')}${link(M.countyTaxUrl(model.selected), 'Check current county tax bills', 'button')}${model.county==='guilford'&&model.parcelId&&model.zip==='27260'&&!model.zipConflict?`<a class="button" href="./index.html?estimate=${encodeURIComponent(model.parcelId)}#renovation">Renovation scenarios →</a>`:''}</div></header>
      <div class="property-notice"><strong>Research signals, with their source evidence.</strong> Live listing status, asking prices, property photos and owner willingness to sell have not been confirmed. The county property record may provide additional building, deed and photo tabs.</div>
      ${model.zipConflict ? '<div class="property-notice property-alert"><strong>Address ZIP conflict.</strong> Source records disagree about geography. This property is not verified for the exact 27260 view. Review the original addresses before acting.</div>' : ''}
      <p class="property-context">Opened from ${esc(selectedType)}: <strong>${esc(model.selected.case_id || model.selected.bill_number || model.selected.id)}</strong>. ${esc(model.groupNote)}</p>
      <section class="property-summary" aria-label="Related evidence counts"><article><strong>${model.groups.codeCases.length}</strong><span>City code cases</span><small>Each case retains its own status and fees.</small></article><article><strong>${model.groups.taxBills.length}</strong><span>Published tax bills</span><small>Separate bills and tax years; no balance total.</small></article><article><strong>${model.groups.foreclosures.length}</strong><span>Foreclosure source rows</span><small>Repeated assessments are not added together.</small></article></section>
      <div class="property-grid"><div id="evidence">
        ${section('city-cases', 'CITY-REPORTED EVENTS', 'City code cases', model.groups.codeCases, cityCases(model), 'No city code case is present for this county-qualified parcel in the current saved dataset. This does not certify that no case exists.', 'Case status and fees are shown as reported. An investigation can be an unverified complaint.')}
        ${section('tax-bills', 'BILL-BY-BILL EVIDENCE', 'Unpaid property-tax bills', model.groups.taxBills, taxBills(model), 'No matching unpaid property-tax bill is included in the current saved dataset. This is not a tax-clearance certificate.', 'Bills stay separate by bill number and tax year. A recent download can contain historical bills.')}
        ${section('foreclosure-records', 'COUNTY-REPORTED PROCEEDINGS', 'Foreclosure records', model.groups.foreclosures, foreclosures(model), 'No matching county foreclosure record is included in the current saved dataset. Check the county for current proceedings.', 'The source map covers all county cases. A source record does not establish a current offer or sale opportunity.')}
        ${model.groups.other.length ? section('other-records', 'PUBLISHED EVIDENCE', 'Other source records', model.groups.other, rawSelected, '') : ''}
      </div><aside class="property-verification" aria-label="Property identity and verification">${verification(model)}<section class="panel property-section"><div class="section-head"><div><span class="eyebrow">CONTINUE THE RESEARCH</span><h2>What still needs checking</h2></div></div><div class="verification-body"><p>Confirm the property’s current condition, title, occupancy and legal proceedings. Obtain a current tax payoff directly from the county.</p><p>Asking price, repair budget and resale value need separate evidence before underwriting. No investment score or profit estimate is generated from these public-record flags.</p><a href="./index.html#public-records">Return to all property records →</a></div></section></aside></div>
      ${health(model)}`;
    document.getElementById('property-state').hidden = true;
    document.getElementById('property-content').hidden = false;
  }
  function state(title, message, error = false) {
    const element = document.getElementById('property-state');
    element.setAttribute('role', error ? 'alert' : 'status');
    element.innerHTML = `<span class="eyebrow">PROPERTY EVIDENCE</span><h1>${esc(title)}</h1><p>${esc(message)}</p><a class="button" href="./index.html#public-records">Return to dashboard</a>`;
  }
  async function load() {
    try {
      const response = await fetch('./data/records.json', { cache: 'no-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const dataset = await response.json();
      if (!Array.isArray(dataset.records)) throw new Error('Saved records are unavailable');
      const model = M.selectProperty(dataset, new URLSearchParams(window.location.search));
      if (model.state !== 'ready') return state(model.state === 'missing' ? 'Choose a property to research.' : 'This record is not in the current snapshot.', model.message);
      render(model);
    } catch (_) {
      state('The saved records could not be loaded.', 'The dataset may be temporarily unavailable. Reload this page or return to the dashboard. No live listing or property API was queried.', true);
    }
  }
  load();
})();
