(function (root) {
  'use strict';
  const types = new Set(['signals', 'code_case', 'foreclosure', 'tax_bill', 'parcel']);
  const defaults = { query: '', scope: '27260', type: 'signals', page: 0 };
  const keys = ['records_q', 'records_scope', 'records_type', 'records_page'];
  function readState(query) {
    const params = new URLSearchParams(query || '');
    const page = Number(params.get('records_page'));
    return {
      query: (params.get('records_q') || '').slice(0, 200),
      scope: params.get('records_scope') === 'all' ? 'all' : defaults.scope,
      type: types.has(params.get('records_type')) ? params.get('records_type') : defaults.type,
      page: Number.isSafeInteger(page) && page > 0 ? page - 1 : 0
    };
  }
  function params(state, original = '') {
    const result = new URLSearchParams(original);
    keys.forEach(key => result.delete(key));
    if (state.query) result.set('records_q', state.query.slice(0, 200));
    if (state.scope === 'all') result.set('records_scope', 'all');
    if (types.has(state.type) && state.type !== defaults.type) result.set('records_type', state.type);
    if (Number.isSafeInteger(state.page) && state.page > 0) result.set('records_page', state.page + 1);
    return result;
  }
  function filterRecords(records, state) {
    const query = state.query.trim().toLowerCase();
    return records.filter(record => (state.scope !== '27260' || record.zip === '27260')
      && (state.type === 'signals' ? record.record_type !== 'parcel' : record.record_type === state.type)
      && (!query || [record.address, record.parcel_id, record.pin, record.case_id, record.status].some(value => String(value ?? '').toLowerCase().includes(query))))
      .sort((a, b) => String(b.event_date || '').localeCompare(String(a.event_date || '')) || String(a.address).localeCompare(String(b.address)));
  }
  function pageInfo(length, requested, size = 30) {
    const page = Math.max(0, Math.min(requested, Math.max(0, Math.ceil(length / size) - 1)));
    return { page, start: page * size, end: Math.min((page + 1) * size, length) };
  }
  function backUrl(query) {
    const search = params(readState(query)).toString();
    return './index.html' + (search ? '?' + search : '') + '#public-records';
  }
  const api = { defaults, readState, params, filterRecords, pageInfo, backUrl };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RecordViewModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
