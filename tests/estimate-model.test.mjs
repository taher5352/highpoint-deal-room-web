import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { analyze, ceiling, defaults, defaultTiers, validSettings, normalizeSettings } = require('../docs/estimate-model.js');

let checks = 0;
function test(name, run) {
  try { run(); checks++; }
  catch (error) { error.message = `${name}: ${error.message}`; throw error; }
}
const close = (actual, expected, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const property = (overrides = {}) => ({ area_eligible: true, building_sqft: 1000, resale_eligible: true, resale_low: 205000, resale_base: 205000, resale_high: 205000, ...overrides });
const flat28 = [{ key: 'custom', label: 'Test scope', rateLow: 28, rateHigh: 28 }];
const noTransaction = result => {
  for (const key of ['totalCostLow','totalCostHigh','costDownside','costUpside','profitLow','profitHigh','roiLow','roiHigh']) assert.equal(result[key], null, key);
  assert.equal(result.meetsTargets, false);
};

test('independent 115k purchase / 28k repair / 205k resale ledger', () => {
  const r = analyze(property(), defaults, 'custom', 115000, flat28);
  assert.equal(r.available, true);
  assert.equal(r.repairLow, 28000);
  close(r.repairWithContingencyHigh, 32200);
  // 115000 purchase + 3450 buying costs + 32200 rehab/contingency + 7200 holding + 16400 selling costs.
  close(r.totalCostLow, 174250);
  close(r.totalCostHigh, 174250);
  close(r.profitLow, 30750);
  close(r.profitHigh, 30750);
  close(r.roiLow, 30750 / 174250 * 100);
  assert.equal(r.meetsTargets, true);
  assert.equal(r.offerLow, 115728.15);
  assert.equal(r.offerHigh, 115728.15);
});

test('conditional total-cost interval and downside/upside profit scenarios differ', () => {
  const range = [{ key: 'range', rateLow: 20, rateHigh: 40 }];
  const r = analyze(property({ resale_low: 190000, resale_high: 220000 }), defaults, 'range', 100000, range);
  close(r.totalCostLow, 148400);
  close(r.totalCostHigh, 173800);
  close(r.costDownside, 171400);
  close(r.costUpside, 150800);
  close(r.profitLow, 18600);
  close(r.profitHigh, 69200);
  close(r.roiLow, 18600 / 171400 * 100);
  close(r.roiHigh, 69200 / 150800 * 100);
  assert.equal(r.meetsTargets, false);
});

test('purchase is required; zero cannot masquerade as a free property', () => {
  for (const price of [null, undefined, 0, -1, NaN, Infinity, '115000', '']) {
    const r = analyze(property(), defaults, 'custom', price, flat28);
    assert.equal(r.purchase, null);
    assert.equal(r.available, true);
    assert.equal(r.offerLow, 115728.15);
    noTransaction(r);
  }
});

test('ineligible or missing area never creates a renovation dollar estimate', () => {
  for (const area of [null, undefined, 0, -1, NaN, Infinity, '1000']) {
    const r = analyze(property({ building_sqft: area }), defaults, 'custom', 115000, flat28);
    assert.equal(r.areaAvailable, false);
    assert.equal(r.repairLow, null);
    assert.equal(r.repairHigh, null);
    assert.equal(r.offerLow, null);
    noTransaction(r);
  }
  assert.equal(analyze(property({ area_eligible: false }), defaults, 'custom', null, flat28).repairLow, null);
});

test('missing, ineligible or inverted resale never creates an offer or profit', () => {
  for (const changes of [{resale_eligible:false},{resale_low:null},{resale_high:0},{resale_low:210000,resale_high:200000},{resale_high:Infinity}]) {
    const r = analyze(property(changes), defaults, 'custom', 115000, flat28);
    assert.equal(r.available, false);
    assert.equal(r.offerLow, null);
    noTransaction(r);
  }
});

test('unknown scope and invalid custom rates do not price the property', () => {
  for (const tiers of [[], [{key:'custom',rateLow:-1,rateHigh:30}], [{key:'custom',rateLow:30,rateHigh:20}], [{key:'custom',rateLow:NaN,rateHigh:30}], [{key:'custom',rateLow:20,rateHigh:Infinity}]]) {
    const r = analyze(property(), defaults, 'custom', 115000, tiers);
    assert.equal(r.available, false);
    assert.equal(r.repairLow, null);
    assert.equal(r.offerLow, null);
    noTransaction(r);
  }
  assert.equal(analyze(property(), defaults, 'not-a-scope', 115000).repairLow, null);
});

test('invalid percentages and financial assumptions suppress offer/profit', () => {
  const cases = [
    {buyPct:-1},{buyPct:100},{sellPct:100},{sellPct:NaN},{sellPct:'8'},
    {contingencyPct:-1},{contingencyPct:301},{contingencyPct:Infinity},
    {monthlyHold:-1},{months:-1},{months:121},{otherCosts:-1},
    {targetProfit:0},{targetProfit:NaN},{targetRoi:0},{targetRoi:1001}
  ];
  for (const changes of cases) {
    const s = {...defaults,...changes};
    assert.equal(validSettings(s), false, JSON.stringify(changes));
    const r = analyze(property(), s, 'custom', 115000, flat28);
    assert.equal(r.available, false);
    assert.equal(r.settingsValid, false);
    assert.equal(r.repairWithContingencyLow, null);
    assert.equal(r.repairWithContingencyHigh, null);
    assert.equal(r.holding, null);
    assert.equal(r.offerLow, null);
    assert.equal(ceiling(205000, 28000, s), null);
    noTransaction(r);
  }
});

test('contingency is charged exactly once and updates predictably', () => {
  const a = analyze(property(), {...defaults,contingencyPct:0}, 'custom', 115000, flat28);
  const b = analyze(property(), {...defaults,contingencyPct:15}, 'custom', 115000, flat28);
  const c = analyze(property(), {...defaults,contingencyPct:30}, 'custom', 115000, flat28);
  assert.equal(a.repairWithContingencyHigh, 28000);
  close(b.totalCostHigh - a.totalCostHigh, 4200);
  close(c.totalCostHigh - b.totalCostHigh, 4200);
  close(a.profitLow - b.profitLow, 4200);
  close(a.offerLow - b.offerLow, 4200 / 1.03, 0.01);
});

test('zero transactional percentages and zero holding are valid', () => {
  const s = {...defaults,buyPct:0,sellPct:0,contingencyPct:0,monthlyHold:0,months:0,otherCosts:0};
  assert.equal(validSettings(s), true);
  const r = analyze(property(), s, 'custom', 115000, flat28);
  assert.equal(r.totalCostHigh, 143000);
  assert.equal(r.profitLow, 62000);
});

test('other costs and additional holding reduce profit by their exact amount', () => {
  const base = analyze(property(), defaults, 'custom', 115000, flat28);
  const changed = analyze(property(), {...defaults,months:7,otherCosts:2500}, 'custom', 115000, flat28);
  assert.equal(changed.totalCostHigh - base.totalCostHigh, 3700);
  assert.equal(base.profitLow - changed.profitLow, 3700);
});

test('offer ceiling actually meets both targets and one extra cent breaks a binding target', () => {
  for (const s of [defaults, {...defaults,targetProfit:1000,targetRoi:100}]) {
    const max = ceiling(205000, 28000, s);
    assert.ok(max > 0);
    const at = analyze(property(), s, 'custom', max, flat28);
    assert.ok(at.profitLow >= s.targetProfit - 1e-7);
    assert.ok(at.roiLow >= s.targetRoi - 1e-7);
    const above = analyze(property(), s, 'custom', max + 0.01, flat28);
    assert.ok(above.profitLow < s.targetProfit || above.roiLow < s.targetRoi);
  }
});

test('negative offer ceilings are retained and explicitly infeasible', () => {
  const s = {...defaults,buyPct:0,sellPct:0,contingencyPct:0,monthlyHold:0,months:0,targetProfit:100000,targetRoi:10};
  const tiers = [{key:'ten',rateLow:10,rateHigh:10}];
  const r = analyze(property({resale_low:100000,resale_high:100000}), s, 'ten', null, tiers);
  assert.equal(r.offerLow, -10000);
  assert.equal(r.offerHigh, -10000);
  assert.equal(r.offerStatus, 'No feasible purchase in either modeled case');
  noTransaction(r);
  const mixed = analyze(property({resale_low:80000,resale_high:200000}), s, 'ten', null, tiers);
  assert.equal(mixed.offerLow, -30000);
  assert.equal(mixed.offerHigh, 90000);
  assert.equal(mixed.offerStatus, 'Only the optimistic case supports a nonnegative offer');
});

test('scenario low/high bounds use living SF without changing the default rate bands', () => {
  const expected = [[22500,45000],[45000,90000],[90000,225000]];
  for (let i = 0; i < defaultTiers.length; i++) {
    const r = analyze(property({building_sqft:1500}), defaults, defaultTiers[i].key);
    assert.deepEqual([r.repairLow,r.repairHigh], expected[i]);
  }
});

test('normalization preserves legacy cash defaults and derives complete monthly carrying costs without mutation', () => {
  assert.equal(defaults.financingMode, 'cash');
  assert.equal(defaults.monthlyHold, 1200);
  assert.equal(Object.hasOwn(defaults, 'monthlyTax'), false);
  assert.equal(validSettings({}), false);
  const settings = { ...defaults, monthlyHold: 9999, monthlyTax: 200, monthlyInsurance: 200, monthlyUtilities: 250, monthlyMaintenance: 100 };
  const before = structuredClone(settings),normalized = normalizeSettings(settings);
  assert.equal(normalized.monthlyHold, 750);
  assert.equal(validSettings(settings), true);
  const result = analyze(property(), settings, 'custom', 115000, flat28);
  assert.equal(result.monthlyCarry, 750);
  assert.equal(result.holding, 4500);
  assert.deepEqual(settings, before);
  const zeros = { ...settings, monthlyTax: 0, monthlyInsurance: 0, monthlyUtilities: 0, monthlyMaintenance: 0 };
  assert.equal(validSettings(zeros), true);
  assert.equal(analyze(property(), zeros, 'custom', 115000, flat28).holding, 0);
});

test('financed purchase ledger charges interest and points, while principal remains financing rather than an extra expense', () => {
  const financed = { ...defaults, financingMode: 'loan', loanPct: 80, annualInterestPct: 12, loanPointsPct: 2 };
  const cash = analyze(property(), { ...financed, financingMode: 'cash' }, 'custom', 115000, flat28);
  const result = analyze(property(), financed, 'custom', 115000, flat28);
  assert.equal(result.loanPrincipal, 92000);
  assert.equal(result.financingInterest, 5520); // 92000 × 12% × 6/12.
  assert.equal(result.financingPoints, 1840); // 92000 × 2%, charged once.
  assert.equal(result.financingCost, 7360);
  close(result.totalCostLow, 181610);
  close(result.totalCostHigh, 181610);
  close(result.profitLow, 23390);
  close(result.roiLow, 23390 / 181610 * 100); // Return on project cost, not cash-on-cash.
  assert.equal(result.totalCostHigh - cash.totalCostHigh, 7360);
  assert.equal(cash.profitLow - result.profitLow, 7360);
  assert.equal(result.offerLow, 108957.95);
  const atCeiling = analyze(property(), financed, 'custom', 108957.95, flat28);
  const aboveCeiling = analyze(property(), financed, 'custom', 108957.96, flat28);
  assert.ok(atCeiling.profitLow >= defaults.targetProfit && atCeiling.roiLow >= defaults.targetRoi);
  assert.ok(aboveCeiling.profitLow < defaults.targetProfit);
  const extraContingency = analyze(property(), { ...financed, contingencyPct: 30 }, 'custom', 115000, flat28);
  assert.equal(extraContingency.totalCostHigh - result.totalCostHigh, 4200);
  assert.equal(extraContingency.financingCost, result.financingCost);
  for (const key of ['loanPrincipal','financingInterest','financingPoints','financingCost']) assert.equal(cash[key], 0, key);
});

test('loan points are upfront once, interest varies with the hold, and missing purchase never becomes a zero-dollar loan', () => {
  const settings = { ...defaults, financingMode: 'loan', loanPct: 80, annualInterestPct: 12, loanPointsPct: 2, monthlyHold: 0 };
  const at = months => analyze(property(), { ...settings, months }, 'custom', 115000, flat28);
  const zero = at(0), six = at(6), twelve = at(12);
  assert.equal(zero.financingInterest, 0);
  assert.equal(six.financingInterest, 5520);
  assert.equal(twelve.financingInterest, 11040);
  for (const result of [zero, six, twelve]) assert.equal(result.financingPoints, 1840);
  assert.equal(six.totalCostHigh - zero.totalCostHigh, 5520);
  assert.equal(twelve.totalCostHigh - six.totalCostHigh, 5520);
  for (const price of [null, undefined, 0, -1, NaN, '115000']) {
    const result = analyze(property(), settings, 'custom', price, flat28);
    for (const key of ['loanPrincipal','financingInterest','financingPoints','financingCost']) assert.equal(result[key], null, key);
    noTransaction(result);
  }
});

test('the financed shared planning assumptions have an independent ledger and bind the return target', () => {
  const settings = { ...defaults, financingMode: 'loan', loanPct: 80, annualInterestPct: 12, loanPointsPct: 2,
    contingencyPct: 20, monthlyTax: 200, monthlyInsurance: 200, monthlyUtilities: 250, monthlyMaintenance: 100,
    months: 6, targetProfit: 30000, targetRoi: 20, resaleDiscountPct: 5 };
  const result = analyze(property(), settings, 'custom', 115000, flat28);
  assert.equal(result.rawResaleLow, 205000);
  assert.equal(result.resaleLow, 194750);
  assert.equal(result.repairLow, 28000);
  close(result.repairWithContingencyHigh, 33600);
  assert.equal(result.monthlyCarry, 750);
  assert.equal(result.holding, 4500);
  assert.equal(result.financingCost, 7360);
  // Purchase115000 + buying3450 + repair33600 + carrying4500 + selling15580 + finance7360.
  close(result.totalCostLow, 179490);
  close(result.profitLow, 15260);
  close(result.roiLow, 15260 / 179490 * 100);
  assert.equal(result.meetsTargets, false);
  assert.equal(result.offerLow, 99279.40);
  assert.equal(ceiling(205000, 28000, settings), 99279.40);
  const atCeiling = analyze(property(), settings, 'custom', 99279.40, flat28);
  assert.ok(atCeiling.profitLow >= 30000);
  assert.ok(atCeiling.roiLow >= 20);
  const above = analyze(property(), settings, 'custom', 99279.41, flat28);
  assert.ok(above.profitLow < 30000 || above.roiLow < 20);
});

test('valuation haircut applies once to resale, selling costs and offer ceilings while preserving raw evidence', () => {
  const p = property({ resale_low: 190000, resale_base: 205000, resale_high: 220000 }),before = structuredClone(p);
  const settings = { ...defaults, resaleDiscountPct: 10 };
  const range = analyze(p, settings, 'custom', 115000, flat28);
  assert.deepEqual([range.rawResaleLow,range.rawResaleBase,range.rawResaleHigh], [190000,205000,220000]);
  assert.deepEqual([range.resaleLow,range.resaleBase,range.resaleHigh], [171000,184500,198000]);
  const result = analyze(property(), settings, 'custom', 115000, flat28);
  assert.equal(result.resaleLow, 184500);
  close(result.costDownside, 172610);
  close(result.profitLow, 11890);
  assert.equal(result.offerLow, 97417.47);
  assert.equal(ceiling(205000, 28000, settings), result.offerLow);
  assert.deepEqual(p, before);
});

test('invalid finance or partial carrying assumptions suppress offer calculations instead of silently substituting zeros', () => {
  const invalid = [
    {financingMode:'unknown'}, {loanPct:-1}, {loanPct:101}, {loanPct:'80'},
    {annualInterestPct:-1}, {annualInterestPct:'12'}, {loanPointsPct:-1}, {loanPointsPct:NaN},
    {resaleDiscountPct:-1}, {resaleDiscountPct:100}, {resaleDiscountPct:'5'},
    {monthlyTax:200}, {monthlyTax:200,monthlyInsurance:200,monthlyUtilities:250},
    {monthlyTax:200,monthlyInsurance:200,monthlyUtilities:250,monthlyMaintenance:null},
    {monthlyTax:200,monthlyInsurance:200,monthlyUtilities:250,monthlyMaintenance:-1},
  ];
  for (const changed of invalid) {
    const settings = { ...defaults, ...changed };
    assert.equal(validSettings(settings), false, JSON.stringify(changed));
    const result = analyze(property(), settings, 'custom', 115000, flat28);
    assert.equal(result.available, false, JSON.stringify(changed));
    assert.equal(result.offerLow, null);
    assert.equal(result.profitLow, null);
    assert.equal(ceiling(205000, 28000, settings), null);
  }
});

console.log(`Estimate model: ${checks} financial scenario checks passed.`);
