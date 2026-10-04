const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../.gas-line-fix');
const source = fs.readFileSync(path.join(root, '程式碼.js'), 'utf8');
const helper = fs.readFileSync(path.join(root, 'AvailabilityCache.js'), 'utf8');
const headers = ['編號', '設計師ID', '開始時間', '結束時間', '顧客姓名', '顧客電話', '服務項目', '備註', '預約類型', '金額', '剪髮金額', '助理ID', '總金額', '染髮顏色', '輸入人', '人數'];
function sheet(data, name = '預約') {
  const reads = [];
  return { data, reads, getName: () => name, getLastRow: () => data.length,
    getLastColumn: () => data[0]?.length || 0,
    getDataRange() { return this.getRange(1, 1, data.length, data[0].length); },
    getRange(r, c, rows = 1, cols = 1) { return {
      getValues() { reads.push([r, c, rows, cols]); return data.slice(r - 1, r - 1 + rows).map(row => Array.from({ length: cols }, (_, i) => row[c - 1 + i] ?? '')); },
      setValues(values) { values.forEach((row, i) => row.forEach((value, j) => { data[r - 1 + i][c - 1 + j] = value; })); }
    }; },
    appendRow(row) { data.push(row); }, deleteRow(row) { data.splice(row - 1, 1); }
  };
}
function setup(rows, archiveRows, header = headers) {
  const main = sheet([header, ...rows]), archive = archiveRows ? sheet([header, ...archiveRows], '歷史預約') : null;
  const leave = sheet([['id', 'date', 'resourceId', 'reason']], '排休資料');
  const cache = new Map(), properties = new Map(), calls = [];
  const sheets = { '預約': main, '歷史預約': archive, '排休資料': leave };
  const ctx = vm.createContext({
    console: { log() {}, error(...args) { calls.push(['error', ...args]); } },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput(text) { return { text, setMimeType() { return this; } }; } },
    CacheService: { getScriptCache: () => ({ get: key => cache.get(key), put: (key, value) => cache.set(key, value),
      getAll: keys => Object.fromEntries(keys.filter(key => cache.has(key)).map(key => [key, cache.get(key)])),
      putAll: values => Object.entries(values).forEach(([key, value]) => cache.set(key, value)) }) },
    Utilities: { getUuid: () => crypto.randomUUID() },
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties.get(key), setProperty: (key, value) => properties.set(key, value) }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: name => sheets[name] }), flush: () => calls.push(['flush']) },
    UrlFetchApp: { fetch(url, options) { calls.push(['fetch', url, options]); return { getResponseCode: () => 202 }; } }
  });
  vm.runInContext(source + '\n' + helper, ctx);
  ctx.archiveCutoffYmd_ = () => '2026-07-01';
  ctx.getArchiveSheet_ = () => archive;
  ctx.monitorApptHeadersChange_ = () => {};
  ctx.ensureSheet = name => sheets[name];
  ctx.toYmd = value => String(value).slice(0, 10);
  ctx.setup = () => {};
  ctx.auditLog_ = () => {};
  const get = (view, start = '2026-09-28', end = '2026-09-28', action = 'getEvents') => JSON.parse(ctx.doGet({ parameter: { action, start, end, view } }).text);
  return { ctx, main, leave, archive, properties, calls, get };
}
const row = (id, start, end, type = 'normal') => [id, 1, start, end, 'Private name', '0912345678', 'service', 'notes', type];

test('large full-calendar response hits chunk cache and re-reads sheet after invalidation', () => {
  const s = setup(Array.from({ length: 1361 }, (_, i) => row(i + 1, '2026-09-28T10:00:00+08:00', '2026-09-28T11:00:00+08:00')));
  const initial = s.get('');
  assert.equal(initial.length, 1361);
  assert.ok(JSON.stringify(initial).length > 95000);
  s.main.reads.length = 0;
  assert.deepEqual(s.get(''), initial);
  assert.equal(s.main.reads.length, 0, 'warm request must avoid spreadsheet reads');
  s.main.data.pop();
  s.ctx.clearEventsCache();
  assert.equal(s.get('').length, 1360);
  assert.ok(s.main.reads.length > 0, 'invalidated cache must reload authoritative data');
});

test('compact projection preserves full-path date overlap, blocked and fallback-end behavior', () => {
  const s = setup([
    row(1, '2026-09-27T23:55:00+08:00', '2026-09-28T00:10:00+08:00'),
    row(2, '2026-09-28T10:00:00+08:00', '', 'blocked'),
    row(3, '2026-09-28T11:00:00+08:00', 'invalid'),
    row(4, '2026-09-28T23:55:00+08:00', '2026-09-29T00:10:00+08:00'),
    row(5, '2026-09-29T00:00:00+08:00', '2026-09-29T00:15:00+08:00'),
    row(6, '2026-09-27T23:45:00+08:00', '2026-09-28T00:00:00+08:00'),
    row('', '2026-09-28T10:00:00+08:00', ''), row(7, 'invalid', '')
  ]);
  const full = s.get(''); s.main.reads.length = 0;
  const compact = s.get('availability');
  assert.deepEqual(compact, full.map(({ resourceId, start, end }) => ({ resourceId, start, end })));
  assert.equal(compact.length, 4);
  assert.deepEqual(s.main.reads, [[1, 1, 1, 16], [2, 1, 8, 4]]);
  assert.ok(Buffer.byteLength(JSON.stringify(compact)) < Buffer.byteLength(JSON.stringify(full)));
  assert.ok(!JSON.stringify(compact).includes('Private'));
});

test('reordered columns and historical queries use the correct fields and archive', () => {
  const header = ['顧客姓名', '開始時間', '編號', '顧客電話', '設計師ID', '結束時間'];
  const s = setup([], [['private', '2026-06-01T10:00:00+08:00', 1, 'private', 2, '']], header);
  const result = s.get('availability', '2026-06-01', '2026-06-01');
  assert.equal(result[0].resourceId, '2');
  assert.deepEqual(s.archive.reads, [[1, 1, 1, 6], [2, 2, 1, 2], [2, 5, 1, 2]]);
  assert.equal(s.get('availability').length, 0);
});

test('compact reads bypass a populated stale full-calendar cache', () => {
  const s = setup([row(1, '2026-09-28T10:00:00+08:00', '')]);
  assert.equal(s.get('').length, 1);
  s.main.appendRow(row(2, '2026-09-28T11:00:00+08:00', ''));
  assert.equal(s.get('').length, 1);
  assert.equal(s.get('availability').length, 2);
});

test('leave availability keeps 已約滿 and drops every other reason', () => {
  const s = setup([]);
  s.leave.appendRow(['id', '2026-12-01', '2', 'private reason']);
  s.leave.appendRow(['id', '2026-12-02', '1', '已約滿']);
  assert.deepEqual(s.get('availability', '', '', 'getLeave'), [
    { date: '2026-12-01', resourceId: '2' },
    { date: '2026-12-02', resourceId: '1', reason: '已約滿' }
  ]);
  assert.deepEqual(s.leave.reads, [[2, 2, 2, 3]]);
  assert.equal(s.get('', '', '', 'getLeave')[0].reason, 'private reason');
});

test('write notifications flush first and use authenticated POST with no customer data', () => {
  const s = setup([]);
  s.properties.set('AVAILABILITY_REFRESH_URL', 'https://worker.example/availability/changed');
  s.properties.set('AVAILABILITY_REFRESH_SECRET', 'test-secret');
  for (const action of ['saveLeave', 'deleteLeave']) {
    const result = JSON.parse(s.ctx.doPost({ postData: { contents: JSON.stringify({ action, date: '2026-09-28', resourceId: '1', reason: 'private' }) } }).text);
    assert.equal(result.status, 'success');
  }
  assert.deepEqual(s.calls.map(call => call[0]), ['flush', 'fetch', 'flush', 'fetch']);
  const options = s.calls[1][2];
  assert.equal(options.headers.Authorization, 'Bearer test-secret');
  assert.equal(options.payload, '{}');
  assert.equal(options.followRedirects, false);
});

test('calendar create/edit/delete notify after actual changes and notification failure does not undo success', () => {
  const s = setup([]);
  s.properties.set('AVAILABILITY_REFRESH_URL', 'https://worker.example/availability/changed');
  s.properties.set('AVAILABILITY_REFRESH_SECRET', 'test-secret');
  s.ctx.allocateNextAppointmentId_ = () => 99;
  s.ctx.requireOperatorName_ = () => 'staff';
  s.ctx.normalizeOperatorName_ = () => 'staff';
  s.ctx.computeEndTextFromIso = () => '2026-09-28 10:15';
  s.ctx.getRowById = () => ({ rowIndex: 2, rowData: { id: 99 }, sheetHeaders: headers });
  s.ctx.UrlFetchApp.fetch = () => { s.calls.push(['failed-notification']); throw new Error('offline'); };
  const data = { id: 99, employee_id: 1, start: '2026-09-28T10:00:00+08:00', appointment_type: 'blocked' };
  assert.equal(s.ctx.doCreate(data, s.main).status, 'success');
  assert.equal(s.main.data.length, 2);
  assert.equal(s.ctx.doEdit(data, s.main).status, 'success');
  assert.equal(s.ctx.doDelete(data, s.main).status, 'success');
  assert.equal(s.main.data.length, 1);
  assert.equal(s.calls.filter(call => call[0] === 'failed-notification').length, 3);
});

test('manual edit hook ignores unrelated sheets and empty events', () => {
  const s = setup([]); let changes = 0;
  s.ctx.clearEventsCache = () => { changes++; };
  s.ctx.availabilityCacheOnEdit();
  for (const name of ['預約', '歷史預約', '排休資料', '每日留言']) {
    s.ctx.availabilityCacheOnEdit({ range: { getSheet: () => ({ getName: () => name }) } });
  }
  assert.equal(changes, 3);
});

test('existing GAS bytes and CRLF remain unchanged outside availability hooks and chunk cache', () => {
  assert.equal(source.replace(/\r\n/g, '').includes('\n'), false);
  const legacyCacheBlock = [
    'function getCachedEventsJson(cacheKey) {',
    '  try {', '    return getEventsCache().get(cacheKey);',
    '  } catch (e) {', '    return null;', '  }', '}', '',
    'function setCachedEventsJson(cacheKey, json) {', '  try {',
    '    if (json && json.length < 95000) getEventsCache().put(cacheKey, json, EVENTS_CACHE_TTL_SEC);',
    '  } catch (e) {}', '}', '', ''
  ].join('\r\n');
  const original = source
    .replace(/function getCachedEventsJson\([\s\S]*?(?=function clearEventsCache\()/, legacyCacheBlock)
    .replace('  notifyAvailabilityChanged_();\r\n', '')
    .replace("  if (e && e.parameter && e.parameter.view === 'availability') {\r\n    if (action === 'getEvents' || action === 'get' || !action) return getAvailabilityEvents_(e);\r\n    if (action === 'getLeave') return getAvailabilityLeaves_();\r\n  }\r\n", '')
    .replace('      clearEventsCache();\r\n\r\n', '')
    .replace('      clearEventsCache();\r\n', '');
  assert.equal(crypto.createHash('sha256').update(original).digest('hex'), '7e881cf74ace4548ec1ab96b66f4eb95ce3b162db0e511d7c10463885b8beba2');
});
