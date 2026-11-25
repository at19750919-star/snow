const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
function section(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `找不到測試區段：${start}`);
  return source.slice(a, b);
}

function setup() {
  const cards = new Map(), requests = [], alerts = [], refetches = [];
  function addCard(input) {
    const card = {
      id: String(input.id), title: input.title || '', start: new Date(input.start), end: new Date(input.end),
      extendedProps: { ...(input.extendedProps || {}) },
      getResources: () => [{ id: String(input.resourceId) }],
      remove() { cards.delete(this.id); }
    };
    cards.set(card.id, card);
    return card;
  }
  const calendar = {
    view: { activeStart: new Date(2026, 10, 25), activeEnd: new Date(2026, 10, 26) },
    addEvent: input => addCard(input), getEventById: id => cards.get(String(id)) || null,
    getEvents: () => [...cards.values()], refetchEvents: () => refetches.push(1)
  };
  const ctx = vm.createContext({
    Date, JSON, console, calendar,
    APPS_SCRIPT_WEB_APP_URL: 'https://gas.example/exec',
    fetch: (_url, options) => new Promise((resolve, reject) => requests.push({ options, resolve, reject })),
    alert: message => alerts.push(message),
    stashEventsCacheBeforeInvalidate() {}, invalidateCache() {}, saveCurrentEventsToCache() {},
    beginEventsSave() {}, finishEventsSave() {}
  });
  vm.runInContext(section('          function makeAppointmentCalendarEvent(', '          function bindEventListeners()'), ctx);
  return { ctx, cards, requests, alerts, refetches, addCard };
}

const payload = () => ({
  action: 'create', employee_id: '2', start: '2026-11-25T15:10:00', duration: '15',
  appointment_type: 'normal', customer_name: '新客', customer_phone: '0912000111',
  service_id: '', notes: '', assignment_type: '', amount: '', cut_price: '', total_amount: '',
  assistant_id: '', dye_color: '', pax: '1', operator_name: '陳翎'
});

test('新增點儲存後 POST 尚未完成就先出現暫存卡，成功後只留正式編號', async () => {
  const e = setup();
  const saving = e.ctx.saveAppointmentOptimistically(payload(), false);
  assert.equal(e.cards.size, 1);
  assert.match([...e.cards.keys()][0], /^_temp_/);
  e.requests[0].resolve({ ok: true, json: async () => ({ status: 'success', id: 20001, line_user_id: 'U-test' }) });
  assert.equal(await saving, true);
  assert.deepEqual([...e.cards.keys()], ['20001']);
  assert.equal(e.cards.get('20001').extendedProps.line_user_id, 'U-test');
});

test('新增失敗會移除暫存卡、顯示錯誤並重新抓取', async () => {
  const e = setup();
  const saving = e.ctx.saveAppointmentOptimistically(payload(), false);
  assert.equal(e.cards.size, 1);
  e.requests[0].resolve({ ok: false, json: async () => ({ status: 'error', message: '後端拒絕' }) });
  assert.equal(await saving, false);
  assert.equal(e.cards.size, 0);
  assert.equal(e.alerts.length, 1);
  assert.match(e.alerts[0], /後端拒絕/);
  assert.equal(e.refetches.length, 1);
});

test('編輯成功以同一正式編號替換，不留下兩張卡', async () => {
  const e = setup(), p = payload();
  p.action = 'edit'; p.id = '77'; p.customer_name = '改名';
  e.addCard({ id: '77', resourceId: '1', start: p.start, end: '2026-11-25T15:25:00', title: '舊名', extendedProps: { entered_by: '原輸入人' } });
  const saving = e.ctx.saveAppointmentOptimistically(p, true);
  assert.equal(e.cards.size, 1);
  e.requests[0].resolve({ ok: true, json: async () => ({ status: 'success', id: 77 }) });
  assert.equal(await saving, true);
  assert.deepEqual([...e.cards.keys()], ['77']);
  assert.equal(e.cards.get('77').title, '改名');
});
