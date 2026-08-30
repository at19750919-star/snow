/* preview 事件快取回歸測試：LINE 從外部新增預約後，preview 不可因舊快取長時間看不到。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const previewPath = path.join(__dirname, 'preview', 'index.html');

function slice(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `找不到 ${label} 起點`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `找不到 ${label} 結尾`);
  return source.slice(start, end);
}

function loadEventsSource() {
  const source = fs.readFileSync(previewPath, 'utf8');
  const cacheBlock = slice(source, '/* 簡易快取：key', '/* 主題已統一為單一預設樣式', '快取區塊');
  const eventsBlock = slice(source, 'events: function (info, successCallback, failureCallback) {', '\n              views: {', 'events 來源');
  const helperBlock = slice(source, '          function buildEventsUrl(startDate, endDate) {', '          function formatLocalDateTime(date) {', 'buildEventsUrl 到 isCalendarViewingEventsUrl');

  const store = new Map();
  const fetched = [];
  const refetches = [];
  let responder = () => [];
  const context = {
    console,
    APPS_SCRIPT_WEB_APP_URL: 'https://gas.example/exec',
    localStorage: {
      get length() { return store.size; },
      key: i => Array.from(store.keys())[i],
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k)
    },
    ymd: d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    fetch: async url => {
      fetched.push(String(url));
      return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, events: responder() }) };
    },
    setTimeout,
    clearTimeout,
    window: { setTimeout },
    document: { addEventListener() {} },
    calendar: null,
    Promise, JSON, Array, Number, String, Object, Set, Error, encodeURIComponent, decodeURIComponent
  };
  /* 可控時鐘：快取新舊是用 Date.now() 判斷的，測試要能把時間往前推 */
  let offset = 0;
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [Date.now() + offset])); }
    static now() { return Date.now() + offset; }
  }
  context.Date = FakeDate;
  context.advance = ms => { offset += ms; };
  vm.createContext(context);
  vm.runInContext(`${cacheBlock}\n${helperBlock}\nvar eventsSource = { ${eventsBlock} };`, context);
  return { context, fetched, refetches, advance: ms => context.advance(ms), setResponder: fn => { responder = fn; } };
}

const viewStart = new Date(2026, 8, 3);
const viewEnd = new Date(2026, 8, 4);

function runEventsSource(env) {
  return new Promise((resolve, reject) => {
    env.context.eventsSource.events({ start: viewStart, end: viewEnd }, resolve, reject);
  });
}

test('記憶體快取尚新時仍會在背景重新抓取並更新日曆', async () => {
  const env = loadEventsSource();
  const newEvent = { id: 'LINE-1', resourceId: '3', start: '2026-09-03T15:30:00+08:00', end: '2026-09-03T16:30:00+08:00' };
  env.setResponder(() => []);
  env.context.calendar = { view: { activeStart: viewStart, activeEnd: viewEnd }, refetchEvents() { env.refetches.push(1); } };

  const first = await runEventsSource(env);
  assert.deepEqual(first, [], '第一次應該拿到空的正式資料');
  assert.equal(env.fetched.length, 1);

  // 快取剛寫入時不重抓，避免每次切日都打 API。
  await runEventsSource(env);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(env.fetched.length, 1, '快取剛寫入時不應重複打 API');

  // LINE 從外部新增預約後，preview 不重新整理也要在快取仍「新鮮」的期間內看到它。
  env.setResponder(() => [newEvent]);
  env.advance(61 * 1000);
  await runEventsSource(env);
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.equal(env.fetched.length, 2, '記憶體快取命中時仍應在背景重新抓取');
  assert.ok(env.refetches.length >= 1, '背景取得新資料後必須呼叫 refetchEvents 更新日曆');

  const third = await runEventsSource(env);
  assert.deepEqual(third.map(e => e.id), ['LINE-1'], '日曆最終必須顯示 LINE 新增的預約');
});
