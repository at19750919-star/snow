// 正式 GAS：單一發號點（allocateId）＋編輯／刪除前驗明身分（#19542 同號兩列，陳翎改／刪自己那列卻動到 LINE 客人 Jack 的列）。
// 執行：node tests/formal-id-guard.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const H = ['編號', '設計師ID', '開始時間', '結束時間', '顧客姓名', '顧客電話', '服務項目', '備註', '預約類型', '金額', '助理ID', '剪髮金額', '總金額', '染髮顏色', '輸入人', '人數', '來源', 'LINE使用者ID', 'Webhook事件ID'];
const COL = Object.fromEntries(H.map((h, i) => [h, i]));
const source = fs.readFileSync(path.join(__dirname, '..', '.gas-line-fix', '程式碼.js'), 'utf8');

function makeSheet(name, values) {
  return {
    values,
    getName: () => name,
    getLastRow: () => values.length,
    getLastColumn: () => Math.max(...values.map(r => r.length)),
    getDataRange() {
      const w = this.getLastColumn();
      return { getValues: () => values.map(r => Array.from({ length: w }, (_, j) => r[j] ?? '')) };
    },
    getRange: (r, c, nr = 1, nc = 1) => ({
      getValues: () => values.slice(r - 1, r - 1 + nr).map(x => Array.from({ length: nc }, (_, j) => x[c - 1 + j] ?? '')),
      setValues: inc => inc.forEach((row, i) => { const t = values[r - 1 + i] || (values[r - 1 + i] = []); row.forEach((x, j) => { t[c - 1 + j] = x; }); }),
      setValue: v => { (values[r - 1] || (values[r - 1] = []))[c - 1] = v; }
    }),
    appendRow: r => values.push(r),
    deleteRow: i => values.splice(i - 1, 1)
  };
}

// 台北牆鐘格式化（測試只用到這幾種樣式）
function formatTaipei(d, fmt) {
  const iso = new Date(d.getTime() + 8 * 3600e3).toISOString();
  return fmt.replace('yyyy', iso.slice(0, 4)).replace('MM', iso.slice(5, 7)).replace('dd', iso.slice(8, 10))
    .replace('HH', iso.slice(11, 13)).replace('mm', iso.slice(14, 16)).replace('ss', iso.slice(17, 19));
}

function setup(mainRows = [], archiveRows = null, props = {}) {
  const main = makeSheet('預約', [H.slice()].concat(mainRows.map(r => r.slice())));
  const arch = archiveRows ? makeSheet('歷史預約', [H.slice()].concat(archiveRows.map(r => r.slice()))) : null;
  const store = Object.assign({}, props);
  const cache = {};
  const audits = [];
  const lockStats = { waits: 0, held: false, maxWaitMs: 0 };
  const ss = {
    getSpreadsheetTimeZone: () => 'Asia/Taipei',
    getSheetByName: n => (n === '預約' ? main : n === '歷史預約' ? arch : null)
  };
  const ctx = {
    console: { log() {}, error() {} },
    Utilities: { formatDate: formatTaipei, getUuid: () => 'uuid' },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, getActive: () => ss, flush() {} },
    LockService: { getScriptLock: () => ({
      waitLock(ms) {
        if (lockStats.held) throw new Error('script lock 重入');
        lockStats.held = true; lockStats.waits += 1; lockStats.maxWaitMs = Math.max(lockStats.maxWaitMs, ms);
      },
      releaseLock() { lockStats.held = false; }
    }) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in store ? store[k] : null), setProperty: (k, v) => { store[k] = String(v); }, deleteProperty: k => { delete store[k]; }
    }) },
    ContentService: { createTextOutput: t => ({ setMimeType: () => t }), MimeType: { JSON: 'json' } }
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  ctx.clearEventsCache = () => {};
  ctx.auditLog_ = (type, action, detail) => audits.push({ type, action, detail });
  const post = payload => {
    const out = JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(payload) } }));
    assert.equal(lockStats.held, false, '請求結束後鎖要放掉');
    return out;
  };
  return { ctx, main, arch, store, audits, lockStats, post };
}

function row(id, emp, start, name, extra = {}) {
  const r = H.map(() => '');
  r[COL['編號']] = id; r[COL['設計師ID']] = emp; r[COL['開始時間']] = start; r[COL['結束時間']] = '';
  r[COL['顧客姓名']] = name; r[COL['預約類型']] = 'normal'; r[COL['人數']] = 1;
  Object.entries(extra).forEach(([k, v]) => { r[COL[k]] = v; });
  return r;
}
const jack = () => row(19542, 1, '2026-10-27 17:00', 'Jack', { '來源': 'LINE', 'LINE使用者ID': 'U-jack', 'Webhook事件ID': 'W-jack', '輸入人': 'LINE' });
const liao = () => row(19542, 2, '2026-10-25 15:10', '廖', { '顧客電話': "'0912-000111", '輸入人': '陳翎' });
const liaoIdent = { orig_start: '2026-10-25 15:10', orig_employee_id: '2', orig_line_user_id: '' };
const editBody = (extra = {}) => Object.assign({
  action: 'edit', id: '19542', operator_name: '陳翎', employee_id: '2', start: '2026-10-25T16:00:00',
  appointment_type: 'normal', customer_name: '廖', customer_phone: '0912000111', service_id: '剪髮', duration: 15, pax: 1
}, extra);
const names = sheet => sheet.values.slice(1).map(r => r[COL['顧客姓名']]);

test('同號兩列：陳翎用自己的 orig_* 編輯只改到她那列，Jack 那列不動', () => {
  for (const order of [[jack(), liao()], [liao(), jack()]]) {
    const s = setup(order);
    const res = s.post(editBody(liaoIdent));
    assert.equal(res.status, 'success');
    const j = s.main.values.find(r => r[COL['顧客姓名']] === 'Jack');
    assert.deepEqual([j[COL['開始時間']], j[COL['設計師ID']], j[COL['LINE使用者ID']]], ['2026-10-27 17:00', 1, 'U-jack']);
    const l = s.main.values.find(r => r[COL['顧客姓名']] === '廖');
    assert.equal(l[COL['開始時間']], '2026-10-25 16:00');
    assert.equal(s.main.values.length, 3);
  }
});

test('同號兩列：陳翎用自己的 orig_* 刪除只刪她那列', () => {
  const s = setup([jack(), liao()]);
  const res = s.post(Object.assign({ action: 'delete', id: '19542' }, liaoIdent));
  assert.equal(res.status, 'success');
  assert.deepEqual(names(s.main), ['Jack']);
});

test('同號兩列：沒帶 orig_* 刪除 → duplicate_id，一列都不刪', () => {
  const s = setup([jack(), liao()]);
  const res = s.post({ action: 'delete', id: '19542' });
  assert.deepEqual(res, { status: 'error', code: 'duplicate_id', message: '這個編號有重複，請重新整理後再試，或請管理員處理' });
  assert.deepEqual(names(s.main), ['Jack', '廖']);
  assert.ok(s.audits.some(a => a.action === 'delete_rejected' && JSON.parse(a.detail).code === 'duplicate_id'));
});

test('同號兩列：舊做法的 start/employee_id（新時間）不能當身分 → duplicate_id，不寫', () => {
  const s = setup([jack(), liao()]);
  const before = JSON.stringify(s.main.values);
  const res = s.post(editBody({ start: '2026-10-27T17:00:00', employee_id: '1' }));
  assert.equal(res.code, 'duplicate_id');
  assert.equal(JSON.stringify(s.main.values), before);
});

test('同號兩列且身分仍對到兩列 → duplicate_id', () => {
  const twin = liao(); twin[COL['顧客姓名']] = '廖2';
  const s = setup([liao(), twin]);
  assert.equal(s.post(Object.assign({ action: 'delete', id: '19542' }, liaoIdent)).code, 'duplicate_id');
  assert.equal(s.main.values.length, 3);
});

test('LINE 單列、沒帶 orig_*（舊版快取網頁）編輯 → need_refresh，不寫', () => {
  const s = setup([jack()]);
  const before = JSON.stringify(s.main.values);
  const res = s.post(editBody({ employee_id: '1' }));
  assert.equal(res.status, 'error');
  assert.equal(res.code, 'need_refresh');
  assert.equal(JSON.stringify(s.main.values), before);
  assert.equal(s.post({ action: 'delete', id: '19542' }).code, 'need_refresh');
  assert.equal(s.main.values.length, 2);
});

test('單列、orig_* 與該列不符 → row_changed，不寫不刪', () => {
  const s = setup([liao()]);
  const before = JSON.stringify(s.main.values);
  const wrong = [
    { orig_start: '2026-10-25 15:20', orig_employee_id: '2', orig_line_user_id: '' },
    { orig_start: '2026-10-25 15:10', orig_employee_id: '3', orig_line_user_id: '' },
    { orig_start: '2026-10-25 15:10', orig_employee_id: '2', orig_line_user_id: 'U-x' }
  ];
  for (const ident of wrong) {
    const res = s.post(editBody(ident));
    assert.deepEqual(res, { status: 'error', code: 'row_changed', message: '這筆預約已被其他人更動，請重新整理後再試' });
    assert.equal(s.post(Object.assign({ action: 'delete', id: '19542' }, ident)).code, 'row_changed');
  }
  assert.equal(JSON.stringify(s.main.values), before);
});

test('非 LINE 單列沒帶 orig_* 維持舊行為（相容）', () => {
  const s = setup([liao()]);
  assert.equal(s.post(editBody()).status, 'success');
  assert.equal(s.main.values[1][COL['開始時間']], '2026-10-25 16:00');
  assert.equal(s.post({ action: 'delete', id: '19542' }).status, 'success');
  assert.equal(s.main.values.length, 1);
});

test('LINE 單列帶對的 orig_* 可以編輯，LINE 欄位保留', () => {
  const s = setup([jack()]);
  const res = s.post(editBody({ employee_id: '1', customer_name: 'Jack', orig_start: '2026-10-27 17:00', orig_employee_id: '1', orig_line_user_id: 'U-jack' }));
  assert.equal(res.status, 'success');
  assert.equal(s.main.values[1][COL['LINE使用者ID']], 'U-jack');
  assert.equal(s.main.values[1][COL['來源']], 'LINE');
});

test('歷史分頁同樣套用身分驗證', () => {
  const s = setup([], [jack(), liao()]);
  assert.equal(s.post({ action: 'delete', id: '19542' }).code, 'duplicate_id');
  assert.equal(s.arch.values.length, 3);
  assert.equal(s.post(Object.assign({ action: 'delete', id: '19542' }, liaoIdent)).status, 'success');
  assert.deepEqual(names(s.arch), ['Jack']);
});

test('allocateId：未設定金鑰、金鑰錯一律拒絕，不發號', () => {
  const s = setup([row(100, 1, '2026-10-01 10:00', 'A')]);
  assert.equal(s.post({ action: 'allocateId', key: '' }).code, 'forbidden');
  assert.equal(s.post({ action: 'allocateId', key: 'anything' }).code, 'forbidden');
  s.store.ID_ALLOC_KEY = 'secret';
  const wrong = s.post({ action: 'allocateId', key: 'wrong' });
  assert.equal(wrong.status, 'error');
  assert.equal(wrong.code, 'forbidden');
  assert.equal(wrong.id, undefined);
  assert.equal(s.post({ action: 'allocateId' }).code, 'forbidden');
  assert.equal(s.store.LAST_ID, '0');
});

test('allocateId：金鑰對就發號，取 LAST_ID／主表／歷史分頁最大值 +1 並寫回，在鎖內', () => {
  const s = setup([row(100, 1, '2026-10-01 10:00', 'A')], [row(250, 1, '2026-08-01 10:00', 'old')], { ID_ALLOC_KEY: 'secret', LAST_ID: '120' });
  const waits = s.lockStats.waits;
  assert.deepEqual(s.post({ action: 'allocateId', key: 'secret' }), { status: 'success', id: 251 });
  assert.equal(s.store.LAST_ID, '251');
  assert.equal(s.lockStats.waits, waits + 1);
  assert.equal(s.lockStats.maxWaitMs, 20000);
  assert.deepEqual(s.post({ action: 'allocateId', key: 'secret' }), { status: 'success', id: 252 });
});

test('連續 create（與 allocateId 交錯）編號遞增且唯一，create 在鎖內', () => {
  const s = setup([row(19000, 1, '2026-10-01 10:00', 'A')], null, { ID_ALLOC_KEY: 'secret' });
  const got = [];
  for (let i = 0; i < 20; i += 1) {
    const waits = s.lockStats.waits;
    const res = s.post({ action: 'create', operator_name: '陳翎', employee_id: '2', start: `2099-01-${String(1 + i).padStart(2, '0')}T10:00:00`, appointment_type: 'normal', customer_name: 'C' + i, customer_phone: '', duration: 15 });
    assert.equal(res.status, 'success');
    assert.equal(s.lockStats.waits, waits + 1);
    got.push(res.id);
    if (i % 3 === 0) got.push(s.post({ action: 'allocateId', key: 'secret' }).id);
  }
  for (let i = 1; i < got.length; i += 1) assert.ok(got[i] > got[i - 1], '編號要遞增：' + got.join(','));
  assert.equal(new Set(got).size, got.length);
  const ids = s.main.values.slice(1).map(r => String(r[0]));
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(s.audits.filter(a => a.action === 'duplicate_id_detected').length, 0);
});

test('寫後檢查：剛寫入的編號表上已有別列 → 記 duplicate_id_detected，不改資料', () => {
  const s = setup([jack()]);
  s.ctx.allocateNextAppointmentId_ = () => 19542; // 模擬撞號
  const res = s.post({ action: 'create', operator_name: '陳翎', employee_id: '2', start: '2026-10-25T15:10:00', appointment_type: 'normal', customer_name: '廖', customer_phone: '0912000111', duration: 15 });
  assert.equal(res.status, 'success');
  assert.equal(s.main.values.length, 3);
  const hit = s.audits.filter(a => a.action === 'duplicate_id_detected');
  assert.equal(hit.length, 1);
  const detail = JSON.parse(hit[0].detail);
  assert.equal(String(detail.id), '19542');
  assert.deepEqual(detail.rows.map(r => [r.start, String(r.employee_id), r.source]), [['2026-10-27 17:00', '1', 'LINE'], ['2026-10-25 15:10', '2', '陳翎']]);
});

test('getEvents 回傳 line_user_id 與來源，前端才帶得出原本身分', () => {
  const s = setup([jack(), row(5, 2, '2026-10-26 11:00', '店內客')]);
  const events = JSON.parse(s.ctx.doGet({ parameter: { action: 'getEvents' } }));
  const byName = Object.fromEntries(events.map(e => [e.extendedProps.customer_name, e.extendedProps]));
  assert.equal(byName.Jack.line_user_id, 'U-jack');
  assert.equal(byName.Jack.source, 'LINE');
  assert.equal(byName['店內客'].line_user_id, '');
});
