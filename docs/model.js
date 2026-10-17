(function(root) {
  const defaults = {buyPct:3,sellPct:8,contingencyPct:15,monthlyHold:1200,months:6,targetRoi:15,targetProfit:30000};
  const samples = [
    {id:'sample-a',name:'Sample A · Cosmetic renovation',purchase:115000,rehab:28000,resale:205000,notes:'Fictional practice scenario. No actual address or listing.',source:'',researched:'',sample:true},
    {id:'sample-b',name:'Sample B · Larger renovation',purchase:92000,rehab:58000,resale:212000,notes:'Fictional practice scenario. Test a higher renovation contingency.',source:'',researched:'',sample:true},
    {id:'sample-c',name:'Sample C · Thin margin',purchase:147000,rehab:24000,resale:208000,notes:'Fictional practice scenario. Use the worksheet to examine the costs.',source:'',researched:'',sample:true}
  ];
  function analyze(p,s) {
    const closing=p.purchase*s.buyPct/100, contingency=p.rehab*s.contingencyPct/100, holding=s.monthlyHold*s.months, selling=p.resale*s.sellPct/100;
    const cost=p.purchase+p.rehab+closing+contingency+holding+selling, profit=p.resale-cost, roi=cost>0?profit/cost*100:0;
    const score=Math.round(Math.max(0,Math.min(1,roi/s.targetRoi))*70+Math.max(0,Math.min(1,profit/s.targetProfit))*30);
    return {closing,contingency,holding,selling,cost,profit,roi,score};
  }
  const limits={buyPct:[0,100],sellPct:[0,100],contingencyPct:[0,100],monthlyHold:[0,1e7],months:[0,120],targetRoi:[0.1,1000],targetProfit:[1,1e8]};
  function validSettings(s){return s && Object.entries(limits).every(([k,[a,b]])=>typeof s[k]==='number'&&Number.isFinite(s[k])&&s[k]>=a&&s[k]<=b);}
  function validProperty(p){return p && typeof p.id==='string'&&p.id.length>0&&p.id.length<100&&typeof p.name==='string'&&p.name.trim().length>0&&p.name.length<=180&&['purchase','rehab','resale'].every(k=>typeof p[k]==='number'&&Number.isFinite(p[k])&&p[k]>=(k==='rehab'?0:1)&&p[k]<=1e8)&&typeof p.notes==='string'&&p.notes.length<=4000&&typeof p.source==='string'&&p.source.length<=2000&&(!p.source||/^https?:\/\//i.test(p.source))&&typeof p.researched==='string'&&(!p.researched||/^\d{4}-\d{2}-\d{2}$/.test(p.researched))&&typeof p.sample==='boolean';}
  function validState(d){return d&&d.version===1&&validSettings(d.settings)&&Array.isArray(d.properties)&&d.properties.length<=1000&&d.properties.every(validProperty)&&new Set(d.properties.map(p=>p.id)).size===d.properties.length;}
  const api={defaults,samples,analyze,validSettings,validProperty,validState};
  if(typeof module!=='undefined')module.exports=api;else root.DealModel=api;
})(typeof window!=='undefined'?window:globalThis);
