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
  const api={defaults,defaultTiers,validSettings,ceiling,analyze};
  if(typeof module!=='undefined')module.exports=api;else root.RenovationModel=api;
})(typeof window!=='undefined'?window:globalThis);
