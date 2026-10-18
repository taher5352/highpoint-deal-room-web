'use strict';
const M=DealModel,$=selector=>document.querySelector(selector);
const fresh=()=>({version:1,settings:{...M.defaults},properties:M.samples.map(property=>({...property}))});
let state=fresh();
const money=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(value);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function fillSettings(){for(const [key,value]of Object.entries(state.settings)){const input=$('#settings').elements.namedItem(key);if(input){input.value=value;input.disabled=true;}}}
function render(){
 const all=state.properties.map(property=>({...property,...M.analyze(property,state.settings)}));
 $('#count').textContent=all.length;$('#best-score').textContent=all.length?Math.max(...all.map(property=>property.score))+' / 100':'—';$('#best-profit').textContent=all.length?money(Math.max(...all.map(property=>property.profit))):'—';
 const search=$('#search').value.trim().toLowerCase(),sort=$('#sort').value;
 const rows=all.filter(property=>property.name.toLowerCase().includes(search)).sort((a,b)=>sort==='price'?a.purchase-b.purchase:sort==='profit'?b.profit-a.profit:b.score-a.score);
 $('#shown').textContent=rows.length;
 $('#rows').innerHTML=rows.length?rows.map(property=>`<tr><td><button class="property-link" data-review="${esc(property.id)}">${esc(property.name)}</button><small>${property.sample?'FICTIONAL SAMPLE':'OWNER-ENTERED SCENARIO'} · High Point, NC 27260</small></td><td>${money(property.purchase)}</td><td>${money(property.rehab)}</td><td>${money(property.resale)}</td><td class="${property.profit>=0?'profit':'negative'}">${money(property.profit)}</td><td>${property.roi.toFixed(1)}%</td><td><span class="score ${property.score<60?'low':''}">${property.score}</span></td><td><button class="edit" data-review="${esc(property.id)}" aria-label="Review ${esc(property.name)}">Review ↗</button></td></tr>`).join(''):'<tr><td colspan="8" class="empty">No scenarios match your search.</td></tr>';
}
function review(id){
 const property=state.properties.find(item=>item.id===id);if(!property)return;
 const form=$('#property-form');form.reset();form.elements.id.value=property.id;
 $('#editor-title').textContent=property.sample?'Review fictional sample':'Review shared scenario';
 for(const key of ['name','purchase','rehab','resale','source','notes','researched']){const input=form.elements.namedItem(key);input.value=property[key]??'';input.readOnly=true;}
 const result=M.analyze(property,state.settings),lines=[['Purchase closing costs',money(result.closing)],['Renovation contingency',money(result.contingency)],['Holding costs',money(result.holding)],['Resale costs',money(result.selling)],['Total cost',money(result.cost)],['Estimated net profit',money(result.profit)],['Return on total cost',result.roi.toFixed(1)+'%'],['Illustrative score',result.score+' / 100']];
 $('#breakdown').innerHTML=lines.map(([label,value])=>`<div>${esc(label)}<strong>${esc(value)}</strong></div>`).join('');
 $('#editor').showModal();
}
$('#close').addEventListener('click',()=>$('#editor').close());
$('#rows').addEventListener('click',event=>{const button=event.target.closest('[data-review]');if(button)review(button.dataset.review);});
$('#search').addEventListener('input',render);$('#sort').addEventListener('change',render);
$('#property-form').addEventListener('submit',event=>event.preventDefault());$('#settings').addEventListener('submit',event=>event.preventDefault());
$('#export').addEventListener('click',()=>{const link=document.createElement('a'),objectUrl=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}));link.href=objectUrl;link.download='highpoint-shared-scenarios.json';link.click();setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);$('#message').textContent='Shared scenarios downloaded.';});
function syncNavigation(){const hash=location.hash||'#overview';document.querySelectorAll('nav a').forEach(link=>link.classList.toggle('active',link.getAttribute('href')===hash));}
document.querySelectorAll('nav a').forEach(link=>link.addEventListener('click',()=>{document.querySelectorAll('nav a').forEach(item=>item.classList.remove('active'));link.classList.add('active');}));
window.addEventListener('hashchange',syncNavigation);syncNavigation();
fillSettings();render();
(async()=>{try{const response=await fetch('./data/workspace.json',{cache:'no-store'});if(!response.ok)throw Error('Shared scenarios unavailable');const value=await response.json(),workspace=value.workspace??value;if(!M.validState(workspace))throw Error('Shared scenarios have an invalid format');state=workspace;fillSettings();render();$('#storage-warning').hidden=true;}catch{$('#storage-warning').hidden=false;}})();
