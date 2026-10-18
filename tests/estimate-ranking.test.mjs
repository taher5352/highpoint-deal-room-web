import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
const require=createRequire(import.meta.url);
const M=require('../docs/estimate-model.js');
const AS_OF='2026-10-17';
const comp=(n,sale_date='2026-06-01',extra={})=>({id:`sale-${n}`,parcel_id:String(10000+n),deed_reference:`001000-${String(n).padStart(5,'0')}`,sale_date,price:150000,living_sqft:1000,...extra});
const comps=(count=5,recent=count,latest='2026-06-01')=>Array.from({length:count},(_,i)=>comp(i+1,i<recent?latest:'2025-05-01'));
const property=(key='1',extra={})=>({property_key:`guilford:${key}`,parcel_id:String(key),address:`${key} TEST ST`,area_eligible:true,resale_eligible:true,building_sqft:1000,resale_low:250000,resale_base:270000,resale_high:300000,cohort_count:5,comparables:comps(),...extra});
const rank=(properties,scope='moderate',asOf=AS_OF)=>M.rankProperties(properties,M.defaults,scope,M.defaultTiers,asOf);
const keys=rows=>rows.map(r=>r.property.property_key);

test('ranking uses the downside offer ratio and leaves transaction profit unknown without a purchase',()=>{
  const p=property();const before=structuredClone(p);
  const [row]=rank([p]);
  assert.equal(row.rank,1);assert.ok(row.priorityRatio>0);
  assert.equal(row.priorityRatio,row.result.offerLow/p.resale_low);
  assert.equal(row.result.offerLow,M.analyze(p,M.defaults,'moderate',null,M.defaultTiers).offerLow);
  assert.equal(row.result.purchase,null);
  for(const field of ['profitLow','profitHigh','roiLow','roiHigh','totalCostLow','totalCostHigh'])assert.equal(row.result[field],null,field);
  assert.equal(row.result.meetsTargets,false);
  assert.equal(Object.hasOwn(row,'probability'),false);
  assert.equal(Object.hasOwn(row,'chance'),false);
  assert.deepEqual(p,before);
});

test('at least five distinct valid transfers and an inclusive fifty-percent recent share are required',()=>{
  const cases=[
    property('four',{comparables:comps(4)}),
    property('stale',{comparables:comps(5,2)}),
    property('boundary',{comparables:comps(6,3,'2025-10-17')}),
    property('recent',{comparables:comps(5,3)}),
  ];
  const rows=rank(cases);
  assert.deepEqual(keys(rows),['guilford:recent','guilford:boundary']);
  assert.equal(rows[0].recentCount,3);assert.equal(rows[0].recentFraction,.6);
  assert.equal(rows[0].comparableCount,5);
  assert.equal(rows[1].recentCount,3);assert.equal(rows[1].recentFraction,.5);
  assert.equal(rows[1].comparableCount,6);
  assert.equal(rows[1].latestTransfer,'2025-10-17');
});

test('invalid, future, self, duplicate-parcel and duplicate-deed rows cannot satisfy the five-sale minimum',()=>{
  const four=comps(4);
  const p=[
    property('future',{comparables:[...four,comp(9,'2026-10-18')]}),
    property('invalid-date',{comparables:[...four,comp(9,'2026-02-30')]}),
    property('zero-price',{comparables:[...four,comp(9,'2026-06-01',{price:0})]}),
    property('missing-area',{comparables:[...four,comp(9,'2026-06-01',{living_sqft:null})]}),
    property('self',{comparables:[...four,comp(9,'2026-06-01',{parcel_id:'self'})]}),
    property('duplicate-parcel',{cohort_count:99,comparables:[...four,{...four[0],id:'another-source-row'}]}),
    property('duplicate-deed',{comparables:[...four,comp(9,'2026-06-01',{deed_reference:` ${four[0].deed_reference} `})]}),
  ];
  assert.deepEqual(rank(p),[]);
  const withFuture=property('safe',{comparables:[...comps(5,3),comp(10,'2099-01-01')]});
  const [safe]=rank([withFuture]);
  assert.equal(safe.comparableCount,5);assert.equal(safe.recentCount,3);assert.equal(safe.recentFraction,.6);assert.equal(safe.latestTransfer,'2026-06-01');
});

test('the twelve-calendar-month boundary clamps leap day rather than losing February28 sales',()=>{
  const boundary=property('leap',{comparables:comps(6,3,'2023-02-28').map((c,i)=>i<3?c:{...c,sale_date:'2023-02-27'})});
  const tooOld=property('older',{comparables:comps(5,2,'2023-03-01').map((c,i)=>i<2?c:{...c,sale_date:'2023-02-27'})});
  const rows=rank([boundary,tooOld],'moderate','2024-02-29');
  assert.deepEqual(keys(rows),['guilford:leap']);
  assert.equal(rows[0].recentFraction,.5);
});

test('unusable area/resale, nonpositive downside ceilings and invalid calendar as-of dates yield no fallback picks',()=>{
  const cases=[property('no-area',{area_eligible:false}),property('no-resale',{resale_eligible:false}),property('zero-area',{building_sqft:0}),property('no-resale-value',{resale_low:null}),property('infeasible',{resale_low:10000,resale_high:300000})];
  assert.deepEqual(rank(cases),[]);
  assert.deepEqual(rank([property()],'moderate','2026-02-30'),[]);
  assert.deepEqual(rank([property()],'moderate','2026-13-01'),[]);
  assert.deepEqual(rank([]),[]);
  assert.equal(rank([property('one'),...cases]).length,1);
});

test('ties use recent fraction, recent count, latest transfer and finally property key deterministically',()=>{
  const rows=[
    property('b',{comparables:comps(5,5,'2026-08-01')}),
    property('fraction-lower',{comparables:comps(10,9,'2026-10-01')}),
    property('c',{comparables:comps(5,5,'2026-09-01')}),
    property('count-higher',{comparables:comps(10,10,'2026-06-01')}),
    property('a',{comparables:comps(5,5,'2026-08-01')}),
  ];
  const expected=['guilford:count-higher','guilford:c','guilford:a','guilford:b','guilford:fraction-lower'];
  assert.deepEqual(keys(rank(rows)),expected);
  assert.deepEqual(keys(rank([...rows].reverse())),expected);
});

test('scope changes recompute ranking rather than preserving a previous shortlist order',()=>{
  const small=property('small',{building_sqft:1000,resale_low:250000,resale_high:250000});
  const large=property('large',{building_sqft:2000,resale_low:470000,resale_high:470000});
  assert.deepEqual(keys(rank([small,large],'light')),['guilford:large','guilford:small']);
  assert.deepEqual(keys(rank([small,large],'heavy')),['guilford:small','guilford:large']);
  assert.ok(rank([small,large],'heavy').every(r=>r.result.offerLow>0));
});

test('output is capped at ten unique properties and remains shorter when fewer properties qualify',()=>{
  const rows=Array.from({length:12},(_,i)=>property(String(i+1)));
  const duplicate={...rows[0],property_key:'guilford:duplicate-source'};
  const result=rank([duplicate,...rows]);
  assert.equal(result.length,10);
  assert.equal(new Set(result.map(r=>r.property.parcel_id)).size,10);
  assert.deepEqual(result.map(r=>r.rank),[1,2,3,4,5,6,7,8,9,10]);
  assert.equal(rank([property('one'),property('two')]).length,2);
});

test('the saved real estimate snapshot can be ranked without changing its evidence or estimates',async()=>{
  const snapshot=JSON.parse(await readFile(new URL('../docs/data/renovation-estimates.json',import.meta.url),'utf8'));
  const before=structuredClone(snapshot);
  assert.equal(snapshot.records.filter(p=>p.resale_eligible).length,snapshot.summary.estimated);
  assert.ok(snapshot.summary.estimated>0);
  const result=M.rankProperties(snapshot.records,snapshot.settings,'moderate',snapshot.tiers,snapshot.as_of_date||snapshot.transfer_window.end);
  assert.ok(result.length<=10);
  assert.equal(new Set(result.map(r=>r.property.parcel_id||r.property.property_key)).size,result.length);
  for(let i=0;i<result.length;i++){
    const row=result[i];assert.equal(row.rank,i+1);
    assert.equal(row.property.area_eligible,true);assert.equal(row.property.resale_eligible,true);
    assert.ok(row.result.offerLow>0&&row.recentCount>=3&&row.recentFraction>=.5);
    assert.equal(row.result.profitLow,null);
    if(i)assert.ok(result[i-1].priorityRatio>=row.priorityRatio);
  }
  assert.deepEqual(snapshot,before);
});
