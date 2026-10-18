(function (root) {
  'use strict';
  const defaults = {buyPct:3,sellPct:8,contingencyPct:15,monthlyHold:1200,months:6,targetProfit:30000,targetRoi:15,otherCosts:0};
  const defaultTiers = [
    {key:'light',label:'Light / cosmetic',rateLow:15,rateHigh:30},
    {key:'moderate',label:'Moderate renovation',rateLow:30,rateHigh:60},
    {key:'heavy',label:'Heavy / gut renovation',rateLow:60,rateHigh:150}
  ];
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const positive = value => finite(value) && value > 0;
  const floorCents = value => Math.floor((value + 1e-9) * 100) / 100;
  function validSettings(s) {
    return s && ['buyPct','sellPct'].every(key=>finite(s[key])&&s[key]>=0&&s[key]<100)
      && finite(s.contingencyPct)&&s.contingencyPct>=0&&s.contingencyPct<=300
      && finite(s.monthlyHold)&&s.monthlyHold>=0&&finite(s.months)&&s.months>=0&&s.months<=120
      && positive(s.targetProfit)&&positive(s.targetRoi)&&s.targetRoi<=1000
      && finite(s.otherCosts)&&s.otherCosts>=0;
  }
  function ceiling(resale, repair, settings) {
    if(!positive(resale)||!finite(repair)||repair<0||!validSettings(settings))return null;
    const buy=settings.buyPct/100,sell=settings.sellPct/100,cont=settings.contingencyPct/100;
    const fixed=repair*(1+cont)+settings.monthlyHold*settings.months+settings.otherCosts;
    return floorCents(Math.min((resale*(1-sell)-fixed-settings.targetProfit)/(1+buy),
      (resale/(1+settings.targetRoi/100)-resale*sell-fixed)/(1+buy)));
  }
  function analyze(property, suppliedSettings=defaults, scope='moderate', purchase=null, tiers=defaultTiers) {
    const settings={...defaults,...suppliedSettings},tier=tiers.find(item=>item.key===scope);
    const areaAvailable=property?.area_eligible===true&&positive(property.building_sqft);
    const resaleAvailable=property?.resale_eligible===true&&positive(property.resale_low)&&positive(property.resale_high)&&property.resale_high>=property.resale_low;
    const ratesValid=tier&&finite(tier.rateLow)&&tier.rateLow>=0&&finite(tier.rateHigh)&&tier.rateHigh>=tier.rateLow;
    const settingsValid=validSettings(settings);
    const available=areaAvailable&&resaleAvailable&&!!ratesValid&&settingsValid;
    const repairLow=areaAvailable&&ratesValid?property.building_sqft*tier.rateLow:null;
    const repairHigh=areaAvailable&&ratesValid?property.building_sqft*tier.rateHigh:null;
    const repairWithContingencyLow=repairLow===null||!settingsValid?null:repairLow*(1+settings.contingencyPct/100);
    const repairWithContingencyHigh=repairHigh===null||!settingsValid?null:repairHigh*(1+settings.contingencyPct/100);
    const offerLow=available?ceiling(property.resale_low,repairHigh,settings):null;
    const offerHigh=available?ceiling(property.resale_high,repairLow,settings):null;
    const purchaseValid=positive(purchase);
    let totalCostLow=null,totalCostHigh=null,costDownside=null,costUpside=null,profitLow=null,profitHigh=null,roiLow=null,roiHigh=null;
    const holding=settingsValid?settings.monthlyHold*settings.months:null;
    if(available&&purchaseValid){
      const acquisition=purchase*(1+settings.buyPct/100);
      const downside=acquisition+repairWithContingencyHigh+holding+settings.otherCosts+property.resale_low*settings.sellPct/100;
      const upside=acquisition+repairWithContingencyLow+holding+settings.otherCosts+property.resale_high*settings.sellPct/100;
      costDownside=downside;costUpside=upside;
      totalCostLow=acquisition+repairWithContingencyLow+holding+settings.otherCosts+property.resale_low*settings.sellPct/100;
      totalCostHigh=acquisition+repairWithContingencyHigh+holding+settings.otherCosts+property.resale_high*settings.sellPct/100;
      profitLow=property.resale_low-downside;profitHigh=property.resale_high-upside;
      roiLow=profitLow/downside*100;roiHigh=profitHigh/upside*100;
    }
    return {available,areaAvailable,resaleAvailable,settingsValid,scope,tier,
      buildingSqft:areaAvailable?property.building_sqft:null,repairLow,repairHigh,repairWithContingencyLow,repairWithContingencyHigh,
      resaleLow:resaleAvailable?property.resale_low:null,resaleBase:resaleAvailable?property.resale_base:null,resaleHigh:resaleAvailable?property.resale_high:null,
      holding,otherCosts:settings.otherCosts,offerLow,offerHigh,
      offerStatus:!settingsValid?'Invalid screening assumptions':!available?'Missing area or usable transfer benchmark':offerHigh<0?'No feasible purchase in either modeled case':offerLow<0?'Only the optimistic case supports a nonnegative offer':'Conditional offer ceilings',
      purchase:purchaseValid?purchase:null,totalCostLow,totalCostHigh,costDownside,costUpside,profitLow,profitHigh,roiLow,roiHigh,
      meetsTargets:profitLow!==null&&profitLow>=settings.targetProfit&&roiLow>=settings.targetRoi};
  }
  function calendarDate(value) {
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
    const date=new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value?date:null;
  }
  const parcelKey = value => value==null?'':String(value).trim().replace(/^0+(?=\d)/,'');
  function rankProperties(records,suppliedSettings=defaults,scope='moderate',tiers=defaultTiers,asOf=new Date().toISOString().slice(0,10)) {
    const cutoff=calendarDate(asOf);
    if(!cutoff||!Array.isArray(records)||!Array.isArray(tiers))return [];
    const year=cutoff.getUTCFullYear()-1,month=cutoff.getUTCMonth();
    const recentFrom=new Date(Date.UTC(year,month,Math.min(cutoff.getUTCDate(),new Date(Date.UTC(year,month+1,0)).getUTCDate()))).toISOString().slice(0,10);
    const candidates=[],seenProperties=new Set();
    for(const property of records){
      const key=parcelKey(property?.parcel_id)||property?.property_key;
      if(!key||seenProperties.has(key))continue;
      seenProperties.add(key);
      const result=analyze(property,suppliedSettings,scope,null,tiers);
      if(!result.available||!positive(result.offerLow))continue;
      const seenParcels=new Set(),seenDeeds=new Set(),comparisons=[];
      for(const comp of property.comparables||[]){
        const parcel=parcelKey(comp.parcel_id),deed=String(comp.deed_reference||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
        if(!parcel||parcel===parcelKey(property.parcel_id)||!calendarDate(comp.sale_date)||comp.sale_date>asOf||!positive(comp.price)||!positive(comp.living_sqft))continue;
        if(seenParcels.has(parcel)||(deed&&seenDeeds.has(deed)))continue;
        seenParcels.add(parcel);if(deed)seenDeeds.add(deed);comparisons.push(comp);
      }
      const comparableCount=comparisons.length,recentCount=comparisons.filter(comp=>comp.sale_date>=recentFrom).length;
      if(comparableCount<5||recentCount/comparableCount<.5)continue;
      candidates.push({property,result,priorityRatio:result.offerLow/result.resaleLow,comparableCount,recentCount,
        recentFraction:recentCount/comparableCount,latestTransfer:comparisons.reduce((latest,comp)=>comp.sale_date>latest?comp.sale_date:latest,'')});
    }
    candidates.sort((a,b)=>b.priorityRatio-a.priorityRatio||b.recentFraction-a.recentFraction||b.recentCount-a.recentCount
      ||b.comparableCount-a.comparableCount||b.latestTransfer.localeCompare(a.latestTransfer)
      ||String(a.property.property_key||a.property.parcel_id).localeCompare(String(b.property.property_key||b.property.parcel_id)));
    return candidates.slice(0,10).map((item,index)=>({...item,rank:index+1}));
  }
  const api={defaults,defaultTiers,validSettings,ceiling,analyze,rankProperties};
  if(typeof module!=='undefined')module.exports=api;else root.RenovationModel=api;
})(typeof window!=='undefined'?window:globalThis);
