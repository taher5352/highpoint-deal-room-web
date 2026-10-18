(function () {
  'use strict';
  const section=document.querySelector('#renovation');
  if(!section)return;
  const $=selector=>document.querySelector(selector),M=window.RenovationModel;
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const finite=value=>typeof value==='number'&&Number.isFinite(value);
  const currency=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});
  const whole=new Intl.NumberFormat('en-US',{maximumFractionDigits:0});
  const money=value=>finite(value)?currency.format(value):'—';
  const range=(low,high)=>!finite(low)||!finite(high)?'—':low===high?money(low):money(low)+' – '+money(high);
  const pct=value=>finite(value)?value.toFixed(1).replace(/\.0$/,'')+'%':'—';
  const link=value=>{if(typeof value!=='string'||!value.trim())return '';try{const url=new URL(value,location.href);return ['http:','https:'].includes(url.protocol)?url.href:'';}catch{return '';}};
  const date=value=>{const parsed=new Date(value);return value&&!Number.isNaN(parsed.valueOf())?new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:/^\d{4}-\d{2}-\d{2}$/.test(value)?'UTC':'America/New_York'}).format(parsed):'Date not supplied';};
  let data=null,scope='moderate',view='top',page=0,selected=null,refreshing=false;
  const pageSize=20;
  const dialog=document.createElement('dialog');dialog.className='rough-dialog';dialog.id='rough-detail';dialog.setAttribute('aria-labelledby','rough-detail-title');document.body.append(dialog);
  const method=document.createElement('dialog');method.className='rough-dialog rough-source-dialog';method.id='rough-method';method.setAttribute('aria-labelledby','rough-method-title');document.body.append(method);
  function analyze(property,purchase=null,tier=scope){return M.analyze(property,data.settings,tier,purchase,data.tiers);}
  function sourceList(){return Array.isArray(data.sources)?data.sources:Object.values(data.sources||{});}
  function sourceCards(){
    return sourceList().map(source=>{
      if(typeof source==='string')return `<div class="rough-source-card"><p>${esc(source)}</p></div>`;
      const url=link(source.url||source.source_url||''),title=source.name||source.label||source.title||'Source reference';
      const details=[source.description||source.meaning||source.basis,source.period||source.as_of?('Period: '+(source.period||source.as_of)):'',source.date?'Published: '+date(source.date):source.checked_at?'Checked: '+date(source.checked_at):'',source.note||source.notes||source.caveats].filter(Boolean).map(value=>Array.isArray(value)?value.join(' '):value).join(' ');
      return `<div class="rough-source-card">${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(title)} ↗</a>`:`<b>${esc(title)}</b>`}${details?`<p>${esc(details)}</p>`:''}</div>`;
    }).join('')||'<p>Source references are not available in this snapshot.</p>';
  }
  function assumptions(){
    const s=data.settings||{},items=[['Purchase closing costs',pct(s.buyPct)],['Resale costs',pct(s.sellPct)],['Repair contingency',pct(s.contingencyPct)],['Holding period',s.months+' months'],['Monthly holding costs',money(s.monthlyHold)],['Other / financing costs',money(s.otherCosts)+' assumed'],['Target profit before income tax',money(s.targetProfit)],['Target return on total cost',pct(s.targetRoi)]];
    return `<div class="rough-assumptions-list">${items.map(([label,value])=>`<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('')}</div><p>Other costs assume an all-cash purchase. Borrowing costs, demolition, additions and a rebuild need their own scope and inputs. Future price growth is assumed to be zero.</p>`;
  }
  function methodBody(){
    const tiers=data.tiers||[];
    return `<div class="rough-dialog-head"><div><span class="eyebrow">HOW THESE NUMBERS WORK</span><h2 id="rough-method-title">Assumptions & source evidence</h2><p>Snapshot ${esc(date(data.generated_at))}</p></div><button type="button" data-rough-close aria-label="Close assumptions">✕</button></div><div class="rough-detail-body"><p class="rough-evidence-note">These estimates screen a research queue. Repair scopes are choices, not photo diagnoses. Recorded transfers have not been verified as renovated, arm’s-length comparable sales.</p><div class="rough-detail-section"><h3>Three assumed repair scopes</h3>${tiers.map(tier=>`<p><b>${esc(tier.label)}: ${money(tier.rateLow)}–${money(tier.rateHigh)} per usable square foot.</b></p>`).join('')}<p>The scope bands are analyst assumptions within a published national cost range. Local measured quotes may differ. Repair estimates are shown before contingency; offer ceilings include it. Spending more does not raise the resale range.</p></div><div class="rough-detail-section"><h3>Offer ceiling assumptions</h3>${assumptions()}<p>The lower ceiling pairs the lower resale scenario with the higher repair estimate. The upper ceiling pairs the higher resale scenario with the lower repair estimate. Each ceiling must satisfy both the target profit and target return.</p></div><div class="rough-detail-section"><h3>Sources & limits</h3>${sourceCards()}${(data.notes||[]).map(note=>`<p>${esc(note)}</p>`).join('')}<div class="rough-detail-links"><a class="button" href="https://github.com/taher5352/highpoint-deal-room-web/edit/main/config/renovation.json" target="_blank" rel="noopener noreferrer">Owner: edit repair assumptions (GitHub) ↗</a></div></div></div>`;
  }
  function showMethod(){if(!data)return;method.innerHTML=methodBody();method.showModal();}
  function shortlist(){return M.rankProperties(data.records,data.settings,scope,data.tiers,data.as_of_date||new Date().toISOString().slice(0,10)).slice(0,10);}
  function filtered(){
    const query=$('#rough-search').value.trim().toLowerCase(),coverage=$('#rough-coverage').value,sort=$('#rough-sort').value;
    const pool=view==='top'?shortlist():data.records.map(property=>({property,result:analyze(property)}));
    return pool.filter(({property,result})=>{
      const matches=[property.address,property.parcel_id,property.property_key,property.street,property.zip].join(' ').toLowerCase().includes(query);
      return matches&&(coverage==='all'||coverage==='estimated'&&result.areaAvailable||coverage==='missing'&&!result.areaAvailable);
    }).sort((a,b)=>{
      if(view==='top')return a.rank-b.rank;
      if(sort==='address')return a.property.address.localeCompare(b.property.address,undefined,{numeric:true});
      const key=sort==='repair'?'repairLow':'offerLow',av=a.result[key],bv=b.result[key];
      if(!finite(av)&&!finite(bv))return a.property.address.localeCompare(b.property.address,undefined,{numeric:true});
      if(!finite(av))return 1;if(!finite(bv))return -1;
      return sort==='repair'?av-bv:bv-av;
    });
  }
  function render(){
    if(!data)return;
    const ranked=shortlist();
    $('#rough-sort').disabled=view==='top';
    section.querySelectorAll('[data-rough-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.roughView===view)));
    $('#rough-shortlist-summary').textContent=view==='top'?`${ranked.length} research priorities for this scope${ranked.length<10?' · fewer than 10 meet the shortlist rules':''}. Ranked across the full queue before your filters.`:`All ${whole.format(data.records.length)} residential parcels. Your search, coverage and sorting apply to the complete queue.`;
    $('#rough-shortlist-rules').textContent='Shortlist rules: positive offer ceiling using lower resale and higher repair assumptions, 5+ distinct transfer comparisons, and at least half in the past 12 months. Rank favors more buying room relative to lower resale, then recent evidence. The fixed dollar profit target can favor higher-value properties. Asking prices and condition are unknown; profit probabilities are not calculated.';
    const rows=filtered();page=Math.max(0,Math.min(page,Math.max(0,Math.ceil(rows.length/pageSize)-1)));
    const start=page*pageSize,shown=rows.slice(start,start+pageSize);
    $('#rough-rows').innerHTML=shown.length?shown.map(({property:p,result:r,rank,priorityRatio,recentCount,comparableCount})=>{
      const id=esc(p.parcel_id),offer=r.available?`<strong class="rough-money rough-offer">${r.offerHigh<0?'No feasible offer':range(r.offerLow,r.offerHigh)}</strong><small>${esc(r.offerHigh<0?range(r.offerLow,r.offerHigh):r.offerLow<0?'Only the optimistic case supports an offer':'Lower to upper modeled ceiling')}</small>`:'<span class="rough-unknown">Not estimated</span><small>More source evidence needed</small>';
      return `<tr><td><div class="rough-property-title">${rank?`<span class="rough-rank" aria-label="Research rank ${rank}">#${rank}</span>`:''}<button type="button" class="rough-address" data-rough-property="${id}">${esc(p.address)}</button></div><small>Parcel ${id} · ${esc(p.zip||'27260')}</small>${rank&&finite(priorityRatio)?`<small class="rough-rank-caption">Offer ceiling / lower resale: ${pct(priorityRatio*100)}</small>`:''}</td><td data-label="Reported area">${r.areaAvailable?whole.format(r.buildingSqft)+' sq ft':'<span class="rough-unknown">Building check needed</span>'}<small>${esc(r.areaAvailable?'Source-qualified living area':p.area_status||'No usable living area in this snapshot')}</small></td><td data-label="Repair estimate"><strong class="rough-money">${range(r.repairLow,r.repairHigh)}</strong><small>${r.areaAvailable?'Before contingency':'Building details need verification'}</small></td><td data-label="Resale scenario"><strong class="rough-money">${range(r.resaleLow,r.resaleHigh)}</strong><small>${esc(r.resaleAvailable?(p.resale_basis||'Unreviewed transfer benchmark'):'Usable transfer benchmark needed')}</small></td><td data-label="Offer ceiling">${offer}</td><td data-label="Condition evidence"><span class="rough-review">${r.areaAvailable?'Needs condition review':'Needs building review'}</span><small>${finite(p.cohort_count)&&p.cohort_count>0?whole.format(rank&&finite(comparableCount)?comparableCount:p.cohort_count)+' transfer comparisons':'No reviewed sale comparables'}${rank&&finite(recentCount)?' · '+whole.format(recentCount)+' in past 12 months':''}</small></td><td><button type="button" class="rough-open" data-rough-property="${id}">Inspect estimate ↗</button></td></tr>`;
    }).join(''):`<tr><td colspan="7" class="rough-empty">${view==='top'?(ranked.length===0?'No properties meet the shortlist rules for this repair scope.':'No shortlisted properties match these filters.'):'No properties match these filters.'}<br>${view==='top'?'<button type="button" data-rough-view="all">Browse all properties</button>':'Try a different street or coverage filter.'}</td></tr>`;
    $('#rough-pagination').textContent=rows.length?`${start+1}–${Math.min(start+pageSize,rows.length)} of ${whole.format(rows.length)} ${view==='top'?'shortlisted properties':'properties'}`:view==='top'?'0 shortlisted properties':'0 properties';
    $('#rough-prev').disabled=page===0;$('#rough-next').disabled=start+pageSize>=rows.length;
    $('#rough-count').textContent=whole.format(data.records.length)+' parcels';
  }
  function comparison(property){
    return `<table class="rough-comparison"><thead><tr><th>Assumed scope</th><th>Repair range</th><th>Offer ceilings</th></tr></thead><tbody>${data.tiers.map(tier=>{const r=analyze(property,null,tier.key);return `<tr class="${scope===tier.key?'rough-selected':''}"><td><button type="button" data-rough-select-scope="${esc(tier.key)}">${esc(tier.label)}</button></td><td><b>${range(r.repairLow,r.repairHigh)}</b><small>Before contingency</small></td><td><b>${range(r.offerLow,r.offerHigh)}</b><small>${esc(r.offerHigh!==null&&r.offerHigh<0?'No feasible purchase in either case':r.offerStatus)}</small></td></tr>`;}).join('')}</tbody></table>`;
  }
  function comparableRows(property){
    const comparables=Array.isArray(property.comparables)?property.comparables:[];
    if(!comparables.length)return '<div class="rough-comp-empty">No individual transfer examples are attached to this property. A market-level benchmark is not a reviewed property appraisal.</div>';
    return `<p>These recorded transfers are evidence to inspect. Sale condition, renovation history, sale terms and arm’s-length status have not been verified.</p><table class="rough-comparison"><thead><tr><th>Recorded property</th><th>Transfer date</th><th>Recorded price</th><th>Living area / $ per sq ft</th></tr></thead><tbody>${comparables.map(comp=>{const url=link(comp.source_url||''),name=comp.address||'Parcel '+comp.parcel_id;return `<tr><td>${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(name)} ↗</a>`:esc(name)}<small>Parcel ${esc(comp.parcel_id||'Unknown')}</small></td><td>${esc(date(comp.sale_date))}</td><td>${money(comp.price)}</td><td>${finite(comp.living_sqft)?whole.format(comp.living_sqft)+' sq ft':'Area unknown'}<small>${finite(comp.price_per_sqft)?money(comp.price_per_sqft)+' / sq ft':''}</small></td></tr>`;}).join('')}</tbody></table>`;
  }
  function showProperty(parcelId,preserveOffer=false){
    if(!data)return;
    const property=data.records.find(item=>String(item.parcel_id)===String(parcelId));if(!property)return;
    const oldOffer=preserveOffer?$('#rough-offer')?.value||'':'';selected=property;
    const r=analyze(property),county=link(property.county_url||''),propertyUrl=link(property.property_url||`./property.html?parcel=${encodeURIComponent(property.parcel_id)}`);
    dialog.innerHTML=`<div class="rough-dialog-head"><div><span class="eyebrow">RENOVATION SCREENING WORKSHEET</span><h2 id="rough-detail-title">${esc(property.address)}</h2><p>Parcel ${esc(property.parcel_id)} · ${esc(property.zip||'27260')} · ${esc(property.county_property_type||'County residential class')}</p></div><button type="button" data-rough-close aria-label="Close property estimate">✕</button></div><div class="rough-detail-body"><p class="rough-evidence-note">Current building condition has not been established. These repair bands are assumed scopes, and resale figures use unreviewed transfer evidence.</p><div class="rough-detail-metrics"><article><span>Source-qualified living area</span><strong>${r.areaAvailable?whole.format(r.buildingSqft)+' sq ft':'Needs verification'}</strong><small>${esc(property.area_status||'Check county building-area evidence')}</small></article><article><span>Resale scenario · all three scopes</span><strong>${range(r.resaleLow,r.resaleHigh)}</strong><small>${esc(property.resale_basis||'No usable resale benchmark supplied')}</small></article></div><div class="rough-detail-section"><h3>Compare assumed scopes</h3>${comparison(property)}<p>The resale range stays the same when you change scope. The selected scope changes repair costs and the conditional offer ceilings.</p></div><section class="rough-offer-input"><h3>Try an offer price</h3><p>No purchase price is connected to this record. Enter your own amount to calculate conditional profit for the selected ${esc(r.tier?.label?.toLowerCase()||'repair')} scope.</p><label>Your proposed purchase price ($)<input id="rough-offer" type="number" min="1" max="100000000" step="1000" inputmode="numeric" placeholder="Enter an offer price" value="${esc(oldOffer)}"></label><div id="rough-offer-result" aria-live="polite"></div></section><div class="rough-detail-section"><h3>Recorded transfer examples</h3>${comparableRows(property)}${(property.notes||[]).map(note=>`<p>${esc(note)}</p>`).join('')}</div><div class="rough-detail-section"><h3>Screening assumptions</h3>${assumptions()}</div><div class="rough-detail-section"><h3>Cost & market source references</h3>${sourceCards()}</div><div class="rough-detail-links">${propertyUrl?`<a class="button" href="${esc(propertyUrl)}">Open property records ↗</a>`:''}${county?`<a class="button" href="${esc(county)}" target="_blank" rel="noopener noreferrer">County property page ↗</a>`:''}</div></div>`;
    if(!dialog.open)dialog.showModal();renderOffer();
  }
  function renderOffer(){
    if(!selected)return;
    const input=$('#rough-offer'),output=$('#rough-offer-result'),raw=input.value.trim(),purchase=raw===''?null:Number(raw),r=analyze(selected,purchase);
    if(!raw){output.innerHTML='<p class="subtle" style="margin:12px 0 0">Profit remains blank until you enter a purchase price.</p>';return;}
    if(!finite(purchase)||purchase<=0||purchase>100000000){output.innerHTML='<p class="subtle" style="margin:12px 0 0">Enter a purchase price greater than zero and no more than $100 million.</p>';return;}
    if(r.profitLow===null){output.innerHTML='<p class="subtle" style="margin:12px 0 0">More building-area or resale evidence is needed before this scenario can be calculated.</p>';return;}
    output.innerHTML=`<div class="rough-offer-result"><div class="rough-project-cost"><span>Modeled total project cost</span><strong>${range(r.totalCostLow,r.totalCostHigh)}</strong></div><div><span>Conditional profit before income tax</span><strong class="${r.profitLow<0?'rough-negative':''}">${range(r.profitLow,r.profitHigh)}</strong></div><div><span>Conditional return on total cost</span><strong class="${r.roiLow<0?'rough-negative':''}">${pct(r.roiLow)} – ${pct(r.roiHigh)}</strong></div><div class="rough-cost-lines"><div><span>Your purchase price</span><b>${money(purchase)}</b></div><div><span>Purchase closing costs · ${pct(data.settings.buyPct)}</span><b>${money(purchase*data.settings.buyPct/100)}</b></div><div><span>Repairs including ${pct(data.settings.contingencyPct)} contingency</span><b>${range(r.repairWithContingencyLow,r.repairWithContingencyHigh)}</b></div><div><span>Holding costs · ${esc(data.settings.months)} months</span><b>${money(r.holding)}</b></div><div><span>Resale costs · ${pct(data.settings.sellPct)}</span><b>${range(r.resaleLow*data.settings.sellPct/100,r.resaleHigh*data.settings.sellPct/100)}</b></div><div><span>Other / financing costs · assumed</span><b>${money(r.otherCosts)}</b></div></div><small>${r.meetsTargets?'The downside scenario meets the chosen targets. Evidence and condition still need review.':'The downside scenario does not meet both chosen targets.'} This is a calculation from assumptions, not a profit forecast.</small></div>`;
  }
  function setScope(value){if(!data?.tiers.some(tier=>tier.key===value))return;scope=value;const radio=section.querySelector(`input[name="rough-scope"][value="${value}"]`);if(radio)radio.checked=true;page=0;render();if(dialog.open&&selected)showProperty(selected.parcel_id,true);}
  for(const id of ['rough-search','rough-coverage','rough-sort'])$( '#'+id).addEventListener(id==='rough-search'?'input':'change',()=>{page=0;render();});
  section.addEventListener('change',event=>{if(event.target.name==='rough-scope')setScope(event.target.value);});
  section.addEventListener('click',event=>{const toggle=event.target.closest('[data-rough-view]');if(toggle){view=toggle.dataset.roughView;page=0;render();return;}const button=event.target.closest('[data-rough-property]');if(button)showProperty(button.dataset.roughProperty);});
  $('#rough-prev').addEventListener('click',()=>{page--;render();});$('#rough-next').addEventListener('click',()=>{page++;render();});$('#rough-show-method').addEventListener('click',showMethod);
  for(const target of [dialog,method])target.addEventListener('click',event=>{if(event.target.closest('[data-rough-close]'))target.close();const button=event.target.closest('[data-rough-select-scope]');if(button)setScope(button.dataset.roughSelectScope);});
  dialog.addEventListener('input',event=>{if(event.target.id==='rough-offer')renderOffer();});dialog.addEventListener('close',()=>{selected=null;refresh();});method.addEventListener('close',()=>refresh());
  function context(){
    const deepLink=new URLSearchParams(location.search).get('estimate');
    if(deepLink&&!data.records.some(property=>String(property.parcel_id)===deepLink))return `Parcel ${deepLink} is not included in this residential estimate queue. No renovation estimate is available for it. You can browse the properties below.`;
    return `${data.source_status!=='collected'?'The latest source check failed; showing the saved snapshot. ':''}Resale uses unreviewed county transfers, not appraisals. No asking price or current condition review is connected. Latest reported transfer: ${date(data.latest_transfer_date)}. Offer ceilings include a ${pct(data.settings.contingencyPct)} repair contingency.`;
  }
  async function refresh(initial=false){
    if(refreshing||!initial&&(document.hidden||dialog.open||method.open))return;
    refreshing=true;
    try{
      if(!M)throw Error('Calculation model unavailable');
      const response=await fetch('./data/renovation-estimates.json',{cache:'no-cache'});if(!response.ok)throw Error('Estimate snapshot unavailable');
      const value=await response.json();if(!Array.isArray(value.records)||!Array.isArray(value.tiers)||!value.tiers.length||!M.validSettings(value.settings))throw Error('Estimate snapshot has an invalid format');
      if(!initial&&(document.hidden||dialog.open||method.open))return;
      if(data&&value.generated_at===data.generated_at&&value.last_attempt_at===data.last_attempt_at&&value.source_status===data.source_status){$('#rough-context').textContent=context();return;}
      data=value;if(!data.tiers.some(tier=>tier.key===scope))scope=data.tiers[0].key;
      const usable=data.records.filter(property=>analyze(property).available).length,missingArea=data.records.filter(property=>!analyze(property).areaAvailable).length,missing=data.records.length-usable;
      $('#rough-summary').innerHTML=`<article><strong>${whole.format(data.records.length)}</strong><span>County residential parcels in the queue</span></article><article><strong>${whole.format(usable)}</strong><span>With area and resale inputs for rough estimates</span></article><article><strong>${whole.format(missing)}</strong><span>Not yet priced · ${whole.format(missingArea)} need building details, ${whole.format(missing-missingArea)} need transfer evidence</span></article>`;
      $('#rough-updated').textContent='Snapshot '+date(data.generated_at)+(data.source_status!=='collected'?' · Saved source data':'');
      $('#rough-context').textContent=context();
      for(const tier of data.tiers){const radio=section.querySelector(`input[name="rough-scope"][value="${tier.key}"]`);if(radio){radio.checked=tier.key===scope;radio.closest('label').querySelector('strong').textContent=money(tier.rateLow)+'–'+money(tier.rateHigh)+' / sq ft';}}
      render();
      const deepLink=new URLSearchParams(location.search).get('estimate');
      if(initial&&deepLink){
        section.scrollIntoView({block:'start'});
        if(data.records.some(property=>String(property.parcel_id)===deepLink))showProperty(deepLink);
      }
    }catch(error){
      if(data)$('#rough-context').textContent='The latest snapshot check did not complete. Your last loaded estimates remain visible. '+context();
      else{
        $('#rough-count').textContent='Unavailable';$('#rough-context').textContent='The last estimate snapshot could not be loaded. Public property records remain available above.';
        $('#rough-rows').innerHTML='<tr><td colspan="7" class="rough-error">Renovation estimates are temporarily unavailable. Try refreshing the page after the next completed source check.</td></tr>';
        $('#rough-pagination').textContent='No estimate snapshot loaded';$('#rough-prev').disabled=true;$('#rough-next').disabled=true;
      }
      console.warn('Renovation estimates:',error.message);
    }finally{refreshing=false;}
  }
  refresh(true);setInterval(()=>refresh(),5*60*1000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
})();
