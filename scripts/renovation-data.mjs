import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {collectClosedSales,SALES_LAYER} from '../collectors/sales-source.mjs';
const require=createRequire(import.meta.url),P=require('../docs/property-model.js');
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const SITE='https://taher5352.github.io/highpoint-deal-room-web/';
const num=n=>typeof n==='number'&&Number.isFinite(n);
const norm=value=>String(value??'').trim().toUpperCase().replace(/\s+/g,' ');
const unique=values=>[...new Set(values)];
export function leadIds(dataset){return unique((dataset.records||[]).filter(r=>r.record_type!=='parcel'&&r.zip==='27260'&&!r.geography_conflict&&P.countyKey(r)==='guilford').map(r=>P.parcelId(r.parcel_id)).filter(Boolean));}
export function quantile(values,q){
  if(!values.length)return null;
  const a=[...values].sort((x,y)=>x-y),position=(a.length-1)*q,i=Math.floor(position);
  return a[i]+(a[Math.min(i+1,a.length-1)]-a[i])*(position-i);
}
export function miles(a,b){
  if(![a.latitude,b.latitude,a.longitude,b.longitude].every(num)||Math.abs(a.latitude)>90||Math.abs(b.latitude)>90||Math.abs(a.longitude)>180||Math.abs(b.longitude)>180)return null;
  const r=Math.PI/180,dlat=(b.latitude-a.latitude)*r,dlon=(b.longitude-a.longitude)*r;
  const h=Math.sin(dlat/2)**2+Math.cos(a.latitude*r)*Math.cos(b.latitude*r)*Math.sin(dlon/2)**2;
  return 3958.7613*2*Math.asin(Math.sqrt(Math.min(1,h)));
}
export function chooseCohort(subject,records,policy){
  if(!(subject.heated_area_sqft>0))return {basis:'No usable living area',records:[]};
  const validYear=v=>num(v)&&v>=1800&&v<=2100;
  const pool=records.filter(r=>r.rough_cohort_eligible===true&&num(r.sale_price)&&r.sale_price>0&&num(r.heated_area_sqft)&&r.heated_area_sqft>0
    &&/^\d{4}-\d{2}-\d{2}$/.test(r.sale_date||'')&&r.parcel_id!==subject.parcel_id&&r.zip==='27260'
    &&r.heated_area_sqft>=subject.heated_area_sqft*policy.sizeRatioLow&&r.heated_area_sqft<=subject.heated_area_sqft*policy.sizeRatioHigh
    &&(!(subject.bedrooms>0&&r.bedrooms>0)||Math.abs(subject.bedrooms-r.bedrooms)<=1)
    &&(!(validYear(subject.year_built)&&validYear(r.year_built))||Math.abs(subject.year_built-r.year_built)<=25));
  const street=pool.filter(r=>norm(subject.street)&&norm(r.street)===norm(subject.street));
  const neighborhood=pool.filter(r=>norm(subject.appraisal_neighborhood)&&norm(r.appraisal_neighborhood)===norm(subject.appraisal_neighborhood));
  let selected,basis;
  if(street.length>=policy.streetMinimum){selected=street;basis='Same street';}
  else if(neighborhood.length>=policy.neighborhoodMinimum){selected=neighborhood;basis='County neighborhood';}
  else if(pool.length>=policy.zipMinimum){selected=pool;basis='Nearby in ZIP 27260';}
  else return {basis:'Too few similar-size recorded transfers',records:[]};
  const withDistance=selected.map(r=>({...r,distance_miles:miles(subject,r)}));
  withDistance.sort((a,b)=>{
    if(a.distance_miles!==null&&b.distance_miles!==null&&a.distance_miles!==b.distance_miles)return a.distance_miles-b.distance_miles;
    if(a.distance_miles===null&&b.distance_miles!==null)return 1;
    if(a.distance_miles!==null&&b.distance_miles===null)return -1;
    return b.sale_date.localeCompare(a.sale_date)||a.parcel_id.localeCompare(b.parcel_id);
  });
  return {basis,records:withDistance.slice(0,policy.maximumComparables),eligible_pool_count:selected.length};
}
export function buildRenovationData(dataset,details,transfers,config,workspace){
  const ids=new Set(leadIds(dataset));
  const byDetails=new Map((details.records||[]).map(r=>[P.parcelId(r.parcel_id),r]));
  const contexts=new Map((transfers.subjects||[]).map(r=>[r.parcel_id,r]));
  const base=new Map((dataset.records||[]).filter(r=>r.record_type==='parcel'&&ids.has(P.parcelId(r.parcel_id))).map(r=>[P.parcelId(r.parcel_id),r]));
  const records=[];
  for(const parcelId of ids){
    const d=byDetails.get(parcelId),s=contexts.get(parcelId),b=base.get(parcelId);
    if(d?.Property_Type!=='RESIDENTIAL')continue;
    const reasons=[];
    if(!s)reasons.push('County building context missing');
    if(s&&s.building_description!=='01-SFR')reasons.push('Single-family building use is not established');
    if(s&&(s.build_count!==1||s.total_units!==1))reasons.push('One building and one unit are not established');
    if(!(s?.heated_area_sqft>0)||s?.heated_area_sqft!==s?.total_heated_area_sqft)reasons.push('Missing or inconsistent county living-area fields');
    if(s?.heated_area_sqft>0&&s.heated_area_sqft!==d.Structure_Size)reasons.push('Living area differs between county feeds');
    if(s?.source_situs_zip&&s.source_situs_zip.slice(0,5)!=='27260')reasons.push('County tax address ZIP conflicts with the matched address base');
    const areaEligible=reasons.length===0;
    const chosen=areaEligible?chooseCohort(s,transfers.records||[],config.benchmark):{basis:'Building details need review',records:[]};
    const prices=chosen.records.map(r=>r.sale_price/r.heated_area_sqft);
    const area=areaEligible?s.heated_area_sqft:null;
    const psfLow=quantile(prices,config.benchmark.lowerPercentile),psfBase=quantile(prices,.5),psfHigh=quantile(prices,config.benchmark.upperPercentile);
    const eligible=areaEligible&&prices.length>0;
    records.push({property_key:`guilford:${parcelId}`,parcel_id:parcelId,address:s?.address||d.LOCATION_ADDR||b?.address||`Parcel ${parcelId}`,
      parcel_base_address:b?.address||null,zip:'27260',county:'Guilford',county_property_type:d.Property_Type,
      street:s?.street||null,neighborhood:s?.neighborhood||null,appraisal_neighborhood:s?.appraisal_neighborhood||d.Neighborhood||null,
      building_sqft:area,county_reported_area:s?.heated_area_sqft||d.Structure_Size||null,
      area_eligible:areaEligible,area_status:areaEligible?'Matching county living-area fields; one single-family building and unit':reasons.join('; '),
      area_source_field:'Tax MAIN_BUILDING_HEATED_AREA matched to HEATED_AREA and GISDV Structure_Size',
      area_source_url:SALES_LAYER,year_built:s?.year_built||d.YEAR_BUILT||null,bedrooms:s?.bedrooms>0?s.bedrooms:null,
      county_url:`https://lrcpwa.ncptscloud.com/guilford/parcel-detail/${parcelId}`,property_url:`${SITE}property.html?parcel=${parcelId}`,
      resale_eligible:eligible,resale_low:eligible?area*psfLow:null,resale_base:eligible?area*psfBase:null,resale_high:eligible?area*psfHigh:null,
      resale_price_per_sqft_low:psfLow,resale_price_per_sqft_base:psfBase,resale_price_per_sqft_high:psfHigh,
      resale_basis:chosen.basis,cohort_count:chosen.records.length,eligible_pool_count:chosen.eligible_pool_count||0,
      resale_date:transfers.metadata?.latest_zip_reported_sale_date||null,resale_source_url:SALES_LAYER,
      comparables:chosen.records.map(r=>({id:r.id,parcel_id:r.parcel_id,address:r.address,sale_date:r.sale_date,price:r.sale_price,
        living_sqft:r.heated_area_sqft,price_per_sqft:r.sale_price/r.heated_area_sqft,year_built:r.year_built,bedrooms:r.bedrooms,
        distance_miles:r.distance_miles,source_url:r.county_property_url,deed_reference:r.deed_reference,
        price_source_code:r.sale_price_source_code,arm_length_verified:false,renovated_condition_verified:false})),
      notes:[...(areaEligible?[]:reasons),'No asking price or seller willingness to sell is established.',
        ...(eligible?['Resale range is subject area multiplied by the selected transfer cohort 25th and 75th percentiles per square foot. It is not a prediction interval or verified after-repair appraisal.']:['A resale range is not supplied until a usable similar-property cohort is available.'])]
    });
  }
  records.sort((a,b)=>a.address.localeCompare(b.address));
  const summary={properties:records.length,area_supported:records.filter(r=>r.area_eligible).length,estimated:records.filter(r=>r.resale_eligible).length,
    missing:records.filter(r=>!r.resale_eligible).length,street_benchmarks:records.filter(r=>r.resale_basis==='Same street').length,
    neighborhood_benchmarks:records.filter(r=>r.resale_basis==='County neighborhood').length,zip_benchmarks:records.filter(r=>r.resale_basis==='Nearby in ZIP 27260').length,
    transfer_records:transfers.records?.length||0,usable_transfers:(transfers.records||[]).filter(r=>r.rough_cohort_eligible).length,
    latest_transfer_date:transfers.metadata?.latest_zip_reported_sale_date||null,other_property_types:ids.size-records.length};
  return {schema_version:1,generated_at:new Date().toISOString(),source_status:transfers.last_error?'last_good_retained':'collected',last_error:transfers.last_error||null,
    source_checked_at:transfers.generated_at||null,last_attempt_at:transfers.last_attempt_at||transfers.generated_at||null,
    source_updated_at:null,latest_transfer_date:summary.latest_transfer_date,transfer_window:{start:transfers.start_date,end:transfers.end_date},
    settings:{...workspace.settings,otherCosts:config.otherCosts},tiers:config.tiers,summary,records,
    sources:[{name:'Guilford County recorded transfer and building facts',url:SALES_LAYER,checked_at:transfers.generated_at,notes:transfers.metadata?.data_freshness},config.cost_source,config.flipper_context],
    notes:[...config.notes,'Similarity policy: living area within 70–130%, bedrooms within one when both are known, construction year within 25 years when both are known. Use at least 3 same-street, else 5 county-neighborhood, else 10 ZIP records. Select at most 20 nearest available points. Exclude the subject itself.',
      'The county source labels its fields heated area. Two official property-card checks independently label the matching values Living Area (SQFT). Building-area conflicts are left unpriced.',
      'Historical prices are not time-adjusted. Current building attributes can differ from those present when the transfer occurred. Marketable or renovated condition has not been verified.'],
    source_metadata:transfers.metadata||{},policy:config.benchmark};
}
export async function refreshTransfers(previous,options,fetchImpl=fetch){
  const attempted=new Date().toISOString();
  try{
    const candidate=await collectClosedSales(options,fetchImpl);
    if(previous?.metadata?.county_recent_parcel_rows>0&&!candidate.metadata.county_recent_parcel_rows)throw Error('The county returned no recent transfers; retaining the previous snapshot');
    if(previous?.metadata?.rough_cohort_rows>0&&!candidate.metadata.rough_cohort_rows)throw Error('No usable transfer benchmarks returned; retaining the previous snapshot');
    return {...candidate,last_attempt_at:attempted,last_error:null};
  }catch(error){return {...(previous||{records:[],subjects:[],metadata:{},generated_at:null}),last_attempt_at:attempted,last_error:String(error.message||error)};}
}
export async function main(args=process.argv.slice(2)){
  const read=async path=>JSON.parse(await readFile(resolve(ROOT,path),'utf8'));
  const [dataset,details,config,workspace]=await Promise.all([read('docs/data/records.json'),read('docs/data/property-details.json'),read('config/renovation.json'),read('config/workspace.json')]);
  const cachePath=resolve(ROOT,'docs/data/transfer-benchmarks.json');
  let transfers;try{transfers=JSON.parse(await readFile(cachePath,'utf8'));}catch{}
  if(!args.includes('--cached-only')){
    const end=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const start=new Date(`${end}T00:00:00Z`);start.setUTCMonth(start.getUTCMonth()-config.benchmark.months);
    transfers=await refreshTransfers(transfers,{parcelRecords:dataset.records,subjectIds:leadIds(dataset),startDate:start.toISOString().slice(0,10),endDate:end});
    await writeFile(cachePath,JSON.stringify(transfers)+'\n');
  }
  if(!transfers)throw Error('No saved county transfer data available');
  const output=buildRenovationData(dataset,details,transfers,config,workspace);
  await writeFile(resolve(ROOT,'docs/data/renovation-estimates.json'),JSON.stringify(output)+'\n');
  console.log(JSON.stringify({source_status:output.source_status,...output.summary}));
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))await main();
