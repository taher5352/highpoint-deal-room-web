'use strict';
(()=>{
const el=id=>document.getElementById(id),escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const safeUrl=value=>{try{const url=new URL(value);return /^https?:$/.test(url.protocol)?url.href:null;}catch{return null;}};
const V=window.RecordViewModel,H=window.PropertyModel;
let state=V.readState(location.search);
const labels={foreclosures:'Foreclosure',code_cases:'City code case',parcels:'Official parcel',tax_bills:'Property tax bill'};
const propertyHref=record=>{const query=V.params({...state,page});query.set('record',record.id);return './property.html?'+query;};
let data=null,page=state.page,filtered=[],loading=false,initialRenderSettled=false;const size=30;
const date=value=>{if(!value)return 'Not supplied';const parsed=new Date(value.length===10?value+'T12:00:00Z':value);return Number.isNaN(parsed.getTime())?String(value):parsed.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'America/New_York'});};
const checked=value=>{if(!value)return 'Never';const parsed=new Date(value);return Number.isNaN(parsed.getTime())?'Not supplied':parsed.toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:'America/New_York'})+' ET';};
const money=value=>typeof value==='number'&&Number.isFinite(value)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(value):'Not supplied';
const sourceState=source=>H.sourceHealth(source).state;
function render(){
 if(!data)return;
 const excel=el('excel-workbook');if(excel)excel.href='./downloads/High-Point-Property-Research.xlsx?v='+encodeURIComponent(data.generated_at||'latest');
 el('schedule-state').textContent=data.schedule?.enabled?'9 AM & 4 PM Eastern':'Schedule not confirmed';
 el('schedule-detail').textContent=data.schedule?.enabled?'Scheduled checks · Runs may be delayed':'Check refresh history for completed runs';
 const query=el('record-search').value.trim().toLowerCase(),scope=el('record-scope').value,type=el('record-type').value;
 state={query:el('record-search').value,scope,type,page};
 filtered=V.filterRecords(data.records,state);
 page=V.pageInfo(filtered.length,page,size).page;state.page=page;
 const search=V.params(state,location.search).toString();
 try{history.replaceState(null,'',location.pathname+(search?'?'+search:'')+location.hash);}catch{}
 el('records-reset').hidden=!state.query&&scope==='27260'&&type==='signals';
 el('record-count').textContent=filtered.length.toLocaleString()+(filtered.length===1?' record':' records');
 const matched=data.records.filter(record=>record.zip==='27260'&&record.record_type!=='parcel'),parcels=new Set(matched.map(record=>record.parcel_id||record.address));
 const latest=data.sources.filter(source=>sourceState(source)!=='not_verified').map(source=>source.last_success_at).filter(Boolean).sort().at(-1);
 el('record-overview').innerHTML=`<div><strong>${matched.length.toLocaleString()}</strong><span>Research records in 27260</span></div><div><strong>${parcels.size.toLocaleString()}</strong><span>Distinct matched parcel identifiers</span></div><div><strong>${escape(checked(latest))}</strong><span>Latest successful source check</span></div><div><strong>Unverified</strong><span>Listing status and owner sale intent</span></div>`;
 el('record-rows').innerHTML=filtered.slice(page*size,(page+1)*size).map(record=>{const href=escape(propertyHref(record));return `<tr role="row"><td role="cell"><a class="record-property-link" href="${href}">${escape(record.address||'Address not supplied')}</a><small>Parcel ${escape(record.parcel_id||'not supplied')} · ${record.zip==='27260'?'27260 address match':record.geography_conflict?'ZIP conflict · needs review':escape(record.city||'Source geography')+' · ZIP unverified'}</small></td><td role="cell" data-label="Source">${escape(labels[record.source_id]||record.record_type)}<small>${escape(record.case_id||record.source_record_id||'')}</small></td><td role="cell" data-label="Source status">${escape(record.status||'Not supplied')}${record.verification_status==='unverified_complaint'?'<small class="negative">Unverified complaint / review</small>':''}</td><td role="cell" data-label="Reported date">${escape(date(record.event_date))}<small>${escape(record.event_date_type?record.event_date_type.replaceAll('_',' '):record.record_type==='code_case'?'Case status / opened':record.record_type==='parcel'?'Source address update':'Source event')}</small></td><td role="cell" data-label="Reported amount · not asking price">${escape(money(record.amount))}<small>${escape(record.amount_label||'')}</small></td><td role="cell" class="record-actions"><a class="button edit" href="${href}" aria-label="Open property at ${escape(record.address||'parcel '+record.parcel_id)}">Open property →</a></td></tr>`;}).join('')||'<tr role="row"><td role="cell" colspan="6" class="empty">No records match your filters. Try a shorter address or reset the view.<br><button type="button" data-record-reset>Clear filters and show research signals</button></td></tr>';
 el('record-pagination').textContent=filtered.length?`${page*size+1}–${Math.min((page+1)*size,filtered.length)} of ${filtered.length.toLocaleString()}`:'0 records';
 el('records-prev').disabled=page===0;el('records-next').disabled=(page+1)*size>=filtered.length;
 el('source-count').textContent=data.sources.length+' source feeds';
 el('source-health').innerHTML=data.sources.map(source=>{const health=H.sourceHealth(source),state=health.state,url=safeUrl(source.url),updated=source.metadata?.source_updated_at;return `<article><span class="source-state ${state!=='collected'?'pending':''}">${escape(health.label)}</span><p>${escape(health.note)}</p><h3>${escape(source.name)}</h3><p>${Number(source.record_count||0).toLocaleString()} source records<br>Last success: ${escape(checked(source.last_success_at))}<br>${source.id==='parcels'?'Layer edit / processing':source.id==='tax_bills'?'Publisher file date (timezone unspecified)':'Newest source event'}: ${escape(date(updated))}</p><p>${escape(source.scope)}</p>${source.last_error?`<p class="negative">Latest attempt: ${escape(source.last_error)}. Last good data retained.</p>`:''}${url?`<a href="${escape(url)}" rel="noreferrer">Official source →</a>`:''}</article>`;}).join('');
}
async function load(){
 if(loading)return;loading=true;el('public-records').setAttribute('aria-busy','true');
 try{const response=await fetch('./data/records.json',{cache:'no-store'});if(!response.ok)throw Error('Could not load the published records');const next=await response.json();if(!Array.isArray(next.records)||!Array.isArray(next.sources)||!next.records.every(record=>record&&typeof record==='object'&&typeof record.id==='string')||!next.sources.every(source=>source&&typeof source==='object'))throw Error('Published records have an unexpected format');data=next;render();const failed=data.sources.filter(source=>source.last_error).length,stale=data.sources.filter(source=>sourceState(source)==='stale').length,unknown=data.sources.filter(source=>sourceState(source)==='not_verified').length;el('record-message').textContent=failed?`${failed} source check(s) need attention. The last successful records remain available.`:stale?`${stale} source snapshot(s) are over 48 hours old. Check refresh history.`:unknown?`${unknown} source feed(s) have unverified collection dates. Check source health before using them.`:`Published public-record snapshots · ${checked(data.generated_at)}. Downloads match your current filters. This page checks for newly published data every 5 minutes.`;}catch(error){el('record-message').textContent=error.message+(data?'. The last loaded records remain visible.':'. Renovation estimates load separately.');}finally{loading=false;el('public-records').setAttribute('aria-busy','false');if(!initialRenderSettled){initialRenderSettled=true;document.dispatchEvent(new CustomEvent('highpoint:initial-render',{detail:{section:'records'}}));}}
}
const csvFields=['id','source_id','record_type','parcel_id','pin','address','city','zip','market_match','case_id','status','event_date','event_date_type','amount','amount_label','source_url','off_market_status','asking_price'];
const csvCell=value=>{let text=value==null?'':String(value);if(/^[=+@\-\t\r]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
function download(format,event){event.preventDefault();if(!data){el('record-message').textContent='Records have not loaded yet. Try again after the source check completes.';return;}const content=format==='csv'?'\uFEFF'+[csvFields.join(','),...filtered.map(record=>csvFields.map(field=>csvCell(record[field])).join(','))].join('\r\n'):JSON.stringify({...data,records:filtered,exported_at:new Date().toISOString(),export_record_count:filtered.length},null,2),objectUrl=URL.createObjectURL(new Blob([content],{type:format==='csv'?'text/csv;charset=utf-8':'application/json'})),link=document.createElement('a');link.href=objectUrl;link.download='highpoint-filtered-records.'+format;link.click();setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);}
function restoreView(){state=V.readState(location.search);page=state.page;el('record-search').value=state.query;el('record-scope').value=state.scope;el('record-type').value=state.type;}
function resetView(){el('record-search').value='';el('record-scope').value='27260';el('record-type').value='signals';page=0;render();el('record-search').focus();}
restoreView();
window.addEventListener('popstate',()=>{restoreView();render();});
el('records-reset').addEventListener('click',resetView);
el('record-rows').addEventListener('click',event=>{if(event.target.closest('[data-record-reset]'))resetView();});
for(const id of ['record-search','record-scope','record-type'])el(id).addEventListener(id==='record-search'?'input':'change',()=>{page=0;render();});
el('records-prev').addEventListener('click',()=>{page--;render();});el('records-next').addEventListener('click',()=>{page++;render();});
el('records-csv').addEventListener('click',event=>download('csv',event));el('records-json').addEventListener('click',event=>download('json',event));
load();setInterval(()=>{if(!document.hidden)load();},5*60*1000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});
})();
