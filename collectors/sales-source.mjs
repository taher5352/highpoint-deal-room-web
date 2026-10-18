// Public county facts only. No owner, mailing, phone, email, listing or private API fields.
export const SALES_LAYER = 'https://gcgis.guilfordcountync.gov/arcgis/rest/services/Tax/GCCadastral_FeatureToPointWGS84/MapServer/0';
export const SALES_ITEM = 'https://gcgis.guilfordcountync.gov/portal/sharing/rest/content/items/4e10d39bd0c74072a24c05593164b251?f=json';
export const VALIDITY_SOURCE = 'https://www.guilfordcountync.gov/schedule-values-2026/open';
const FIELDS = 'OBJECTID,REID,PIN_PLUS_EXTENSION,SITUS_ADDRESS,SITUS_CITY,SITUS_STATE,SITUS_ZIP,SITUS_STREET_NUMBER,SITUS_DIRECTION_PREFIX,SITUS_STREET,SITUS_STREET_TYPE,SITUS_DIRECTION_SUFFIX,LAND_CLASS,BUILDING_DESCRIPTION,MAIN_BUILDING_HEATED_AREA,HEATED_AREA,PACKAGE_SALE_DATE,PACKAGE_SALE_PRICE,LAND_SALE_DATE,LAND_SALE_PRICE,DEED_DATE,DEED_BOOK_PAGE_NUMBER,REVENUE_STAMP_VALUE,SALE_PRICE_SOURCE,BUILD_COUNT,TOTAL_UNITS,YEAR_BUILT,BEDROOMS,BATH_FULL,BATH_HALF,GRADE,CONDITION,NEIGHBORHOOD,APPRAISAL_NEIGHBORHOOD';
const MAX_ROWS = 25000;
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_SUBJECTS = 1500;
const id = value => /^\d{1,7}$/.test(String(value ?? '').trim()) ? String(value).trim().replace(/^0+/, '') || null : null;
const num = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const text = value => value == null ? null : String(value).trim() || null;
const day = value => typeof value === 'number' && Number.isFinite(value) ? new Date(value).toISOString().slice(0, 10) : null;
const dateKey = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

async function query(fetchImpl, params) {
  const response = await fetchImpl(`${SALES_LAYER}/query?${new URLSearchParams({f:'json', ...params})}`, {signal:AbortSignal.timeout(60000)});
  if (!response.ok) throw new Error(`Public county transfer query failed: HTTP${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(`Public county transfer query failed: ${data.error.message || data.error.code}`);
  return data;
}

function context(feature) {
  const a = feature.attributes;
  const parcelId = id(a.REID);
  return {
    parcel_id:parcelId, county:'Guilford', source_object_id:a.OBJECTID,
    pin:text(a.PIN_PLUS_EXTENSION), address:text(a.SITUS_ADDRESS),
    city:text(a.SITUS_CITY), state:text(a.SITUS_STATE), source_situs_zip:text(a.SITUS_ZIP),
    source_zip_conflict:Boolean(text(a.SITUS_ZIP) && text(a.SITUS_ZIP)!=='27260'),
    street:[a.SITUS_DIRECTION_PREFIX,a.SITUS_STREET,a.SITUS_STREET_TYPE,a.SITUS_DIRECTION_SUFFIX].map(text).filter(Boolean).join(' '),
    land_class:text(a.LAND_CLASS), building_description:text(a.BUILDING_DESCRIPTION),
    heated_area_sqft:num(a.MAIN_BUILDING_HEATED_AREA), total_heated_area_sqft:num(a.HEATED_AREA),
    area_source_field:'MAIN_BUILDING_HEATED_AREA',
    build_count:num(a.BUILD_COUNT), total_units:num(a.TOTAL_UNITS),
    year_built:num(a.YEAR_BUILT), bedrooms:num(a.BEDROOMS), full_baths:num(a.BATH_FULL), half_baths:num(a.BATH_HALF),
    grade:text(a.GRADE), county_condition:text(a.CONDITION),
    neighborhood:text(a.NEIGHBORHOOD), appraisal_neighborhood:text(a.APPRAISAL_NEIGHBORHOOD),
    last_reported_sale_price:num(a.PACKAGE_SALE_PRICE), last_reported_sale_date:day(a.PACKAGE_SALE_DATE),
    last_reported_sale_price_source_code:text(a.SALE_PRICE_SOURCE),
    current_deed_date:day(a.DEED_DATE), current_deed_reference:text(a.DEED_BOOK_PAGE_NUMBER),
    longitude:num(feature.geometry?.x), latitude:num(feature.geometry?.y),
    county_property_url:parcelId ? `https://lrcpwa.ncptscloud.com/guilford/parcel-detail/${parcelId}` : null,
    source_url:SALES_LAYER,
  };
}

/** Current county parcel records of recent reported transfers; NOT a complete deed history or verified ARV comps. */
export async function collectClosedSales({parcelRecords, subjectIds = [], startDate='2025-04-17', endDate='2026-10-17'} = {}, fetchImpl=fetch) {
  if (!Array.isArray(parcelRecords) || !parcelRecords.length) throw new Error('Exact county+city qualified ZIP27260 parcel records required');
  if (!dateKey(startDate) || !dateKey(endDate) || startDate > endDate) throw new Error('Invalid bounded transfer window');
  const endExclusive = new Date(`${endDate}T00:00:00Z`); endExclusive.setUTCDate(endExclusive.getUTCDate()+1);
  const allowed = new Set(parcelRecords.filter(p => p.record_type === 'parcel' && p.zip === '27260' && /^Guilford$/i.test(p.county || '') && p.geography_verification === 'county_city_zip_agreement' && !p.geography_conflict).map(p=>id(p.parcel_id)).filter(Boolean));
  if (!allowed.size || allowed.size > 20000) throw new Error('Invalid exact ZIP parcel allowlist');
  const where = `PACKAGE_SALE_DATE >= DATE '${startDate}' AND PACKAGE_SALE_DATE < DATE '${endExclusive.toISOString().slice(0,10)}' AND PACKAGE_SALE_PRICE > 0`;
  const count = await query(fetchImpl, {where, returnCountOnly:'true'});
  if (!Number.isInteger(count.count) || count.count < 0 || count.count > MAX_ROWS) throw new Error('Unexpected county transfer count; refusing unbounded collection');
  const features=[]; let bytes=0;
  for (let offset=0; offset<count.count; offset+=2000) {
    const page=await query(fetchImpl, {where, outFields:FIELDS, returnGeometry:'true', outSR:'4326', resultOffset:String(offset), resultRecordCount:'2000', orderByFields:'OBJECTID ASC'});
    if (!Array.isArray(page.features) || !page.features.length) throw new Error('Empty transfer page before expected end');
    bytes += JSON.stringify(page).length;
    if (bytes > MAX_BYTES) throw new Error('County transfer extract exceeded20MB bound');
    features.push(...page.features);
  }
  if (features.length !== count.count || new Set(features.map(f=>f.attributes.OBJECTID)).size !== count.count) throw new Error('Incomplete or duplicated county transfer pages');
  const deeds = new Map(); const repeatedParcel = new Map();
  for (const {attributes:a} of features) {
    const parcelId=id(a.REID); const deed=text(a.DEED_BOOK_PAGE_NUMBER);
    if (deed) {const values=deeds.get(deed)||new Set(); values.add(parcelId || `unknown:${a.OBJECTID}`); deeds.set(deed,values);}
    if (parcelId) repeatedParcel.set(parcelId,(repeatedParcel.get(parcelId)||0)+1);
  }
  const records=features.filter(f=>allowed.has(id(f.attributes.REID))).map(feature=>{
    const a=feature.attributes; const c=context(feature); const deed=text(a.DEED_BOOK_PAGE_NUMBER);
    const reasons=[];
    if (c.source_situs_zip && c.source_situs_zip.slice(0,5) !== '27260') reasons.push('Tax situs ZIP conflicts with the matched address base');
    if(c.source_zip_conflict) reasons.push('Current county situs ZIP conflicts with independently qualified ZIP27260 base');
    if (c.land_class !== 'RESIDENTIAL' || c.building_description !== '01-SFR') reasons.push('Not county-classified single-family residence');
    if (c.build_count !== 1 || c.total_units !== 1) reasons.push('Building/unit count is not exactly one');
    if (!(c.heated_area_sqft > 0) || c.total_heated_area_sqft !== c.heated_area_sqft) reasons.push('Missing or inconsistent heated area');
    if (!deed) reasons.push('Missing deed reference');
    if (deed && deeds.get(deed).size > 1) reasons.push('Same deed appears on multiple recent county parcel records; package/allocation unclear');
    if (repeatedParcel.get(c.parcel_id) !== 1) reasons.push('Multiple source rows for this parcel');
    if (!(num(a.PACKAGE_SALE_PRICE) > 3000)) reasons.push('Price is missing, nonnumeric, nominal or no greater than3000');
    if (!day(a.PACKAGE_SALE_DATE) || day(a.PACKAGE_SALE_DATE) < startDate || day(a.PACKAGE_SALE_DATE) > endDate) reasons.push('Reported sale date is outside the requested window');
    if (num(a.LAND_SALE_PRICE)>0) reasons.push('Land-sale value also present; improved-sale scope unclear');
    if (!day(a.DEED_DATE)) reasons.push('Missing deed date');
    if (day(a.DEED_DATE) && Math.abs(Date.parse(`${day(a.DEED_DATE)}T00:00:00Z`)-Date.parse(`${day(a.PACKAGE_SALE_DATE)}T00:00:00Z`))>31*86400000) reasons.push('Sale and current deed dates differ by more than31days; transaction scope unclear');
    const deedCount=deed ? deeds.get(deed).size : null;
    return {
      id:`county-transfer-${c.parcel_id}-${a.OBJECTID}`, ...c,
      zip:'27260', geography_verification:'county_city_zip_agreement', geography_conflict:c.source_zip_conflict,
      sale_price:num(a.PACKAGE_SALE_PRICE), sale_date:day(a.PACKAGE_SALE_DATE),
      sale_price_source_field:'PACKAGE_SALE_PRICE', sale_date_source_field:'PACKAGE_SALE_DATE',
      raw_sale_date_epoch:num(a.PACKAGE_SALE_DATE), deed_date:day(a.DEED_DATE), raw_deed_date_epoch:num(a.DEED_DATE),
      deed_reference:deed, revenue_stamp_value:num(a.REVENUE_STAMP_VALUE), sale_price_source_code:text(a.SALE_PRICE_SOURCE),
      land_sale_price:num(a.LAND_SALE_PRICE), land_sale_date:day(a.LAND_SALE_DATE),
      county_recent_parcels_on_deed:deedCount,
      transaction_key:deed ? `${deed}|${day(a.PACKAGE_SALE_DATE)}|${a.PACKAGE_SALE_PRICE}` : null,
      multi_parcel_status:deedCount>1 ? 'Observed multiple parcels on deed; excluded' : 'No duplicate deed observed in current recent-sale snapshot; single-parcel conveyance not verified',
      arm_length_status:'Not published in this service; not verified',
      renovated_condition_verified:false, verified_comp_eligible:false,
      rough_cohort_eligible:reasons.length===0, exclusion_reasons:reasons,
      price_per_heated_sqft:reasons.length===0 ? a.PACKAGE_SALE_PRICE/c.heated_area_sqft : null,
      record_meaning:'County-reported transfer attributes on the current parcel record; not an asking price, complete sales history, or verified renovated comparable',
    };
  }).sort((a,b)=>b.sale_date.localeCompare(a.sale_date)||Number(a.parcel_id)-Number(b.parcel_id));
  const requested=[...new Set(subjectIds.map(id).filter(x=>x && allowed.has(x)))];
  if (requested.length>MAX_SUBJECTS) throw new Error('Too many property context requests');
  const subjects=[]; const returnedSubjectIds=new Set();
  for (let offset=0; offset<requested.length; offset+=200) {
    const batch=requested.slice(offset,offset+200);
    const page=await query(fetchImpl,{where:`REID IN (${batch.map(x=>`'${x}'`).join(',')})`,outFields:FIELDS,returnGeometry:'true',outSR:'4326',resultRecordCount:'2000',orderByFields:'OBJECTID ASC'});
    if (!Array.isArray(page.features) || page.exceededTransferLimit) throw new Error('Incomplete subject context query');
    for (const f of page.features) {
      const parcelId=id(f.attributes?.REID);
      if(!parcelId || !batch.includes(parcelId)) throw new Error('County subject query returned an invalid or unrequested parcelID');
      if(returnedSubjectIds.has(parcelId)) throw new Error('County subject query returned duplicate canonical parcelIDs');
      returnedSubjectIds.add(parcelId);
    }
    subjects.push(...page.features.map(context));
  }
  const eligible=records.filter(r=>r.rough_cohort_eligible);
  const exclusion_counts={};for (const r of records) for (const why of r.exclusion_reasons) exclusion_counts[why]=(exclusion_counts[why]||0)+1;
  return {
    schema_version:1, generated_at:new Date().toISOString(), start_date:startDate, end_date:endDate,
    records, subjects,
    metadata:{
      publisher:'Guilford County GIS / Tax', source_url:SALES_LAYER, portal_item_url:SALES_ITEM,
      county_validity_guidance_url:VALIDITY_SOURCE, source_fields:FIELDS.split(','),
      query:where, county_recent_parcel_rows:features.length, downloaded_query_json_bytes:bytes,
      exact_zip_parcel_allowlist:allowed.size, zip_transfer_rows:records.length,
      rough_cohort_rows:eligible.length, excluded_rows:records.length-eligible.length, exclusion_counts,
      oldest_zip_reported_sale_date:records.at(-1)?.sale_date||null, latest_zip_reported_sale_date:records[0]?.sale_date||null,
      latest_county_reported_sale_date:features.reduce((m,f)=>{const d=day(f.attributes.PACKAGE_SALE_DATE);return d>m?d:m;},'')||null,
      subject_ids_requested:requested.length, subject_context_rows:subjects.length,
      subject_ids_missing:requested.filter(x=>!returnedSubjectIds.has(x)),
      geography_basis:'Exact parcelREID intersection with independently agreeing county and city active-address ZIP27260 records; source situs ZIP alone is not trusted.',
      data_freshness:'Retrieved now; latest reported transfer date is not a feed update timestamp. This layer supplies current parcel sale attributes, not every historical transaction.',
      area_basis:'Explicit county MAIN_BUILDING_HEATED_AREA field; retains county total HEATED_AREA separately. Current building characteristics can postdate a transfer.',
      rough_cohort_policy:'Only county RESIDENTIAL/01-SFR, one building and unit, positive matching main/total heated area, price above3000, deed reference within31calendar days of reported sale, no observed duplicate deed/REID or additional land sale. Arm-length and condition remain unverified; never verified ARV. Thresholds are conservative analyst screening policy, not county sale-validity codes.',
      duplicate_scope:'Duplicate deed check spans all selected countywide recent current parcel rows, including parcels outside27260. Older rows overwritten by a later transfer and historical parcel changes can conceal packages.',
      price_source_code_meaning:'County code retained verbatim (for example REV). No code definition or sale-validity field is published on this layer; no arm-length inference is made.',
      limits:['Not a complete transaction history; cannot prove a historical flip pair, rehab spend, interior condition or renovation premium.','Related-party, fractional-interest, foreclosure, package allocation and other nonmarket transfers may remain.','No time/condition/location adjustments are inferred from rawpricepersqft.','Current structures can differ from those present at sale.','County tax assessment is not used as saleprice.'],
      access:'Public Query endpoint and public portal item; no credentials, private APIs, site-interaction bypass, owner/contact/mailing fields requested.',
      usage:'Portal access=public and licenseInfo=null. No explicit unrestricted reuse license is supplied; retain county attribution and source links, and county no-warranty/data-currentness caveats. This statement is not a legal permission guarantee.',
    },
  };
}
