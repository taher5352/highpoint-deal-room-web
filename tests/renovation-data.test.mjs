import test from 'node:test';
import assert from 'node:assert/strict';
import {quantile,miles,chooseCohort,leadIds,buildRenovationData,refreshTransfers} from '../scripts/renovation-data.mjs';

const policy={sizeRatioLow:.7,sizeRatioHigh:1.3,streetMinimum:3,neighborhoodMinimum:5,zipMinimum:10,maximumComparables:20,lowerPercentile:.25,upperPercentile:.75};
const subject={parcel_id:'1',address:'1 TEST ST',street:'TEST ST',appraisal_neighborhood:'N1',heated_area_sqft:1000,total_heated_area_sqft:1000,year_built:1950,bedrooms:3,latitude:35.95,longitude:-79.99,building_description:'01-SFR',build_count:1,total_units:1,source_situs_zip:'27260'};
const sale=(id,extra={})=>({id:`sale-${id}`,parcel_id:String(id),address:`${id} TEST ST`,zip:'27260',street:'TEST ST',appraisal_neighborhood:'N1',heated_area_sqft:1000,year_built:1950,bedrooms:3,rough_cohort_eligible:true,sale_price:150000,sale_date:'2026-05-01',latitude:35.95,longitude:-79.99,...extra});
const ids=cohort=>cohort.records.map(r=>r.parcel_id).sort();

test('failed or unexpectedly empty transfers retain the exact last-success records and collection date',async()=>{
  const previous={generated_at:'2026-10-17T12:00:00Z',records:[sale('2')],subjects:[subject],metadata:{county_recent_parcel_rows:10000,rough_cohort_rows:1}};
  const options={parcelRecords:[{record_type:'parcel',parcel_id:'1',zip:'27260',county:'Guilford',geography_verification:'county_city_zip_agreement'}]};
  const failed=await refreshTransfers(previous,options,async()=>({ok:false,status:503}));
  assert.deepEqual(failed.records,previous.records);assert.equal(failed.generated_at,previous.generated_at);assert.match(failed.last_error,/HTTP503/);assert.ok(failed.last_attempt_at);
  const empty=await refreshTransfers(previous,options,async()=>({ok:true,json:async()=>({count:0})}));
  assert.deepEqual(empty.records,previous.records);assert.equal(empty.generated_at,previous.generated_at);assert.match(empty.last_error,/no recent transfers/);
  assert.equal(previous.last_error,undefined,'Retaining an error does not mutate the prior success object');
});

test('quantiles interpolate an unsorted cohort without mutating it',()=>{
  const values=[400,100,300,200];
  assert.equal(quantile(values,.25),175);assert.equal(quantile(values,.5),250);assert.equal(quantile(values,.75),325);
  assert.deepEqual(values,[400,100,300,200]);
  assert.equal(quantile([], .5),null);assert.equal(quantile([0],.5),0);
});

test('cohorts exclude the subject and enforce inclusive size, bedroom and age limits',()=>{
  const records=[sale(1),sale(2,{heated_area_sqft:700,year_built:1925,bedrooms:2}),sale(3,{heated_area_sqft:1300,year_built:1975,bedrooms:4}),sale(4),sale(5,{heated_area_sqft:699}),sale(6,{heated_area_sqft:1301}),sale(7,{bedrooms:5}),sale(8,{year_built:1976}),sale(9,{zip:'27262'}),sale(10,{rough_cohort_eligible:false})];
  const result=chooseCohort(subject,records,policy);
  assert.equal(result.basis,'Same street');assert.deepEqual(ids(result),['2','3','4']);
  assert.equal(result.eligible_pool_count,3);
  assert.deepEqual(chooseCohort({...subject,heated_area_sqft:0},records,policy).records,[]);
});

test('minimums drive street to neighborhood to ZIP fallback, and insufficient cohorts stay unpriced',()=>{
  const street=[sale(2,{street:' test   st '}),sale(3),sale(4)];
  const neighborhood=[sale(5,{street:'OTHER ST'}),sale(6,{street:'OTHER ST'})];
  const elsewhere=Array.from({length:5},(_,i)=>sale(10+i,{street:'FAR ST',appraisal_neighborhood:'N2'}));
  assert.equal(chooseCohort(subject,[...street,...neighborhood,...elsewhere],policy).basis,'Same street');
  const neighborhoodPool=[...street.slice(0,2),...neighborhood,sale(7,{street:'ANOTHER ST'})];
  assert.equal(chooseCohort(subject,[...neighborhoodPool,...elsewhere],policy).basis,'County neighborhood');
  const zipPool=[...neighborhoodPool.slice(0,4),...elsewhere,sale(20,{street:'ELSE ST',appraisal_neighborhood:'N3'})];
  assert.equal(chooseCohort(subject,zipPool,policy).basis,'Nearby in ZIP 27260');
  assert.deepEqual(chooseCohort(subject,zipPool.slice(0,9),policy).records,[]);
});

test('distance handles missing or invalid points and limits comparables by nearest known points',()=>{
  assert.equal(miles(subject,subject),0);
  assert.ok(Math.abs(miles(subject,{...subject,latitude:35.96})-.690934)<.001);
  for(const change of [{latitude:null},{latitude:'35.95'},{latitude:91},{longitude:181},{longitude:NaN}])assert.equal(miles(subject,{...subject,...change}),null);
  const result=chooseCohort(subject,[sale(2,{latitude:null}),sale(3,{latitude:35.96}),sale(4,{latitude:35.97}),sale(5)],{...policy,maximumComparables:3});
  assert.deepEqual(result.records.map(r=>r.parcel_id),['5','3','4']);
  assert.equal(result.eligible_pool_count,4);
});

function fixtures(){
  const base=(parcel_id,extra={})=>({id:`parcel-${parcel_id}`,source_id:'parcels',record_type:'parcel',parcel_id,county:'Guilford',zip:'27260',address:`${parcel_id} TEST ST`,...extra});
  const lead=(parcel_id,extra={})=>({id:`tax-${parcel_id}`,source_id:'tax_bills',record_type:'tax_bill',parcel_id,zip:'27260',...extra});
  return {
    dataset:{records:[base('1'),lead('00001'),base('2'),lead('2'),base('3'),lead('3'),lead('4',{county:'Davidson'}),lead('5',{geography_conflict:true})]},
    details:{records:[{parcel_id:'1',Property_Type:'RESIDENTIAL',Structure_Size:1000},{parcel_id:'2',Property_Type:'RESIDENTIAL',Structure_Size:0},{parcel_id:'3',Property_Type:'COMM',Structure_Size:1000}]},
    transfers:{generated_at:'2026-10-17T12:00:00Z',start_date:'2025-04-17',end_date:'2026-10-17',subjects:[subject,{...subject,parcel_id:'2',heated_area_sqft:0,total_heated_area_sqft:0},{...subject,parcel_id:'3'}],records:[sale(10,{sale_price:100000}),sale(11,{sale_price:200000}),sale(12,{sale_price:300000}),sale(13,{sale_price:400000})],metadata:{latest_zip_reported_sale_date:'2026-05-01'}},
    config:{benchmark:policy,otherCosts:0,tiers:[],notes:[],cost_source:{name:'Fictional test cost source'},flipper_context:{name:'Fictional test context'}},
    workspace:{settings:{monthlyHolding:1200}},
  };
}

test('build scales cohort quartiles by supported living area; zero area and other property types never gain values',()=>{
  const f=fixtures();assert.deepEqual(leadIds(f.dataset),['1','2','3']);
  const data=buildRenovationData(f.dataset,f.details,f.transfers,f.config,f.workspace);
  const a=data.records.find(r=>r.parcel_id==='1'),missing=data.records.find(r=>r.parcel_id==='2');
  assert.equal(a.resale_low,175000);assert.equal(a.resale_base,250000);assert.equal(a.resale_high,325000);
  assert.equal(a.cohort_count,4);assert.ok(a.comparables.every(c=>c.arm_length_verified===false&&c.renovated_condition_verified===false));
  assert.equal(missing.area_eligible,false);assert.equal(missing.building_sqft,null);assert.equal(missing.resale_base,null);assert.equal(missing.resale_eligible,false);
  assert.equal(data.records.some(r=>r.parcel_id==='3'),false);
  assert.equal(data.summary.other_property_types,1);assert.equal(data.summary.estimated,1);assert.equal(data.summary.missing,1);
});

test('area disagreement and explicit ZIP conflicts block valuation; retained-source error stays visible without erasing good estimates',()=>{
  const f=fixtures();
  const good=buildRenovationData(f.dataset,f.details,{...f.transfers,last_error:'Public source unavailable',last_attempt_at:'2026-10-18T12:00:00Z'},f.config,f.workspace);
  assert.equal(good.source_status,'last_good_retained');assert.equal(good.last_error,'Public source unavailable');
  assert.equal(good.summary.estimated,1);assert.equal(good.source_checked_at,f.transfers.generated_at);assert.equal(good.last_attempt_at,'2026-10-18T12:00:00Z');
  for(const change of [{heated_area_sqft:999,total_heated_area_sqft:999},{source_situs_zip:'27262'},{building_description:'08-DUPLEX/TRIPLEX'}]){
    const changed={...f.transfers,subjects:[{...subject,...change},...f.transfers.subjects.slice(1)]};
    const d=buildRenovationData(f.dataset,f.details,changed,f.config,f.workspace).records.find(r=>r.parcel_id==='1');
    assert.equal(d.area_eligible,false);assert.equal(d.resale_eligible,false);assert.equal(d.resale_low,null);assert.deepEqual(d.comparables,[]);
  }
});
