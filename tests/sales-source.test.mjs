import test from 'node:test';
import assert from 'node:assert/strict';
import {collectClosedSales} from '../collectors/sales-source.mjs';

const base=(parcel_id,extra={})=>({record_type:'parcel',parcel_id,zip:'27260',county:'Guilford',geography_verification:'county_city_zip_agreement',geography_conflict:false,...extra});
const row=(reid,deed,extra={})=>({attributes:{OBJECTID:Number(reid),REID:reid,SITUS_ADDRESS:`${reid} TEST ST`,SITUS_ZIP:'27260',LAND_CLASS:'RESIDENTIAL',BUILDING_DESCRIPTION:'01-SFR',MAIN_BUILDING_HEATED_AREA:1000,HEATED_AREA:1000,PACKAGE_SALE_DATE:Date.parse('2026-05-01T12:00:00Z'),PACKAGE_SALE_PRICE:150000,DEED_DATE:Date.parse('2026-05-01T14:00:00Z'),DEED_BOOK_PAGE_NUMBER:deed,BUILD_COUNT:1,TOTAL_UNITS:1,...extra},geometry:{x:-79.99,y:35.95}});
function fake(rows,subjects=[],calls=[]){
  return async url=>{
    const q=new URL(url).searchParams;calls.push(q);
    return{ok:true,json:async()=>q.get('returnCountOnly')==='true'?{count:rows.length}:q.get('where').startsWith('REID IN')?{features:subjects}:{features:rows}};
  };
}

test('normalizes REIDs, uses qualified parcel geography and excludes a duplicate deed outside the ZIP',async()=>{
  const a=row('00111','1-1'),b=row('222','2-2'),outside=row('333','2-2',{SITUS_ZIP:'27401'}),otherCounty=row('444','4-4');
  const calls=[];
  const d=await collectClosedSales({parcelRecords:[base('111'),base('222'),base('444',{county:'Davidson'}),base('555',{geography_conflict:true})]},fake([a,b,outside,otherCounty],[],calls));
  assert.deepEqual(d.records.map(r=>r.parcel_id),['111','222']);
  assert.equal(d.records[0].rough_cohort_eligible,true);
  assert.equal(d.records[0].price_per_heated_sqft,150);
  assert.equal(d.records[0].verified_comp_eligible,false);
  assert.equal(d.records[0].renovated_condition_verified,false);
  assert.match(d.records[0].arm_length_status,/not verified/);
  assert.equal(d.records[1].rough_cohort_eligible,false);
  assert.equal(d.records[1].county_recent_parcels_on_deed,2);
  assert.ok(d.records[1].exclusion_reasons.some(x=>/multiple recent county parcel/.test(x)));
  assert.equal(d.metadata.county_recent_parcel_rows,4);
  assert.match(calls[0].get('where'),/>= DATE '2025-04-17'/);
  assert.match(calls[0].get('where'),/< DATE '2026-10-18'/);
  const fields=calls.find(q=>q.has('outFields')).get('outFields').split(',');
  assert.ok(fields.includes('PACKAGE_SALE_PRICE')&&fields.includes('MAIN_BUILDING_HEATED_AREA'));
  assert.ok(fields.every(x=>!/owner|mail|phone|email/i.test(x)));
});

test('subject response must contain unique requested canonical IDs, while missing context stays explicit',async()=>{
  const a=row('00111','1-1');
  const result=await collectClosedSales({parcelRecords:[base('111'),base('222')],subjectIds:['0000111','111','222']},fake([], [a]));
  assert.equal(result.subjects[0].parcel_id,'111');
  assert.equal(result.metadata.subject_ids_requested,2);
  assert.deepEqual(result.metadata.subject_ids_missing,['222']);
  for(const [rows,error] of [
    [[a,row('111','1-1')],/duplicate canonical/],
    [[row('999','9-9')],/unrequested/],
    [[row('111,222','1-1')],/invalid or unrequested/],
  ])await assert.rejects(()=>collectClosedSales({parcelRecords:[base('111')],subjectIds:['111']},fake([],rows)),error);
});

test('ZIP conflict, multiple buildings, nominal value and distant deed date cannot enter a rough cohort',async()=>{
  const rows=[row('111','1-1',{SITUS_ZIP:'27262'}),row('222','2-2',{BUILD_COUNT:2}),row('333','3-3',{PACKAGE_SALE_PRICE:3000}),row('444','4-4',{DEED_DATE:Date.parse('2026-07-01')})];
  const d=await collectClosedSales({parcelRecords:rows.map(r=>base(r.attributes.REID))},fake(rows));
  assert.ok(d.records.every(r=>r.rough_cohort_eligible===false&&r.price_per_heated_sqft===null));
  assert.equal(d.records.find(r=>r.parcel_id==='111').geography_conflict,true);
  assert.ok(d.records.find(r=>r.parcel_id==='444').exclusion_reasons.some(x=>/31days/.test(x)));
});

test('invalid dates, unbounded counts, incomplete pages and public-source failures fail closed',async()=>{
  const options={parcelRecords:[base('111')]};let calls=0;
  const untouched=async()=>{calls++;throw Error('should not fetch');};
  await assert.rejects(()=>collectClosedSales({...options,startDate:'2026-10-18',endDate:'2026-10-17'},untouched),/window/);
  await assert.rejects(()=>collectClosedSales({...options,startDate:'2026-02-30'},untouched),/window/);
  assert.equal(calls,0);
  await assert.rejects(()=>collectClosedSales(options,async()=>({ok:true,json:async()=>({count:25001})})),/unbounded/);
  await assert.rejects(()=>collectClosedSales(options,async url=>({ok:true,json:async()=>new URL(url).searchParams.has('returnCountOnly')?{count:2}:{features:[row('111','1-1')]}})),/Incomplete/);
  await assert.rejects(()=>collectClosedSales(options,async()=>({ok:false,status:503})),/HTTP503/);
});
