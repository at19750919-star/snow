const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
function section(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a);
  return source.slice(a, b);
}
function setup() {
  const store = new Map(), requests = [], refetches = [];
  let time = Date.now();
  class Clock extends Date { static now() { return time; } }
  const ctx = vm.createContext({
    Date: Clock, JSON, URL, URLSearchParams, console, setTimeout, clearTimeout,
    APPS_SCRIPT_WEB_APP_URL: 'https://gas.example/exec',
    ymd: d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,
    localStorage: { get length() { return store.size; }, key: i => [...store.keys()][i],
      getItem: k => store.get(k) || null, setItem: (k,v) => store.set(k,v), removeItem: k => store.delete(k) },
    fetch: url => new Promise(resolve => requests.push({ url, resolve: data => resolve({ ok:true, text:async()=>JSON.stringify(data) }) })),
    window: { setTimeout, setInterval() {}, addEventListener() {} },
    document: { hidden:false, getElementById() {}, createElement:()=>({style:{}}), body:{appendChild() {}}, addEventListener() {} },
    calendar: { view: {}, refetchEvents:()=>refetches.push(1) }
  });
  vm.runInContext(section('        /* 簡易快取：key', '        /* ===== 新版預覽入口') + '\n' +
    section('          function buildEventsUrl(', '          function formatLocalDateTime(') + '\nvar eventsSource = { ' +
    section('events: function (info, successCallback, failureCallback) {', '\n              views: {') + ' };', ctx);
  const seed = (url, data, age=0, persistent=false) => {
    ctx.seedUrl=url; ctx.seedData=data; ctx.seedTs=time-age;
    if (persistent) store.set('sj_api_cache_v1:'+encodeURIComponent(url),JSON.stringify({data,ts:time-age}));
    else vm.runInContext('_apiCache[seedUrl] = {data:seedData,ts:seedTs}',ctx);
  };
  const show = (start, end) => {
    ctx.calendar.view = { activeStart:start, activeEnd:end };
    return new Promise(resolve => ctx.eventsSource.events({start,end},resolve,assert.fail));
  };
  return {ctx,store,requests,refetches,seed,show,advance:ms=>{time+=ms;}};
}
const day = (month, date) => new Date(2026,month-1,date);
const event = (id,date) => ({id,start:`2026-${date}T12:00:00`,end:`2026-${date}T13:00:00`,resourceId:'1'});
const tick = () => new Promise(r=>setTimeout(r,15));

test('月底、跨年及月視圖使用不含 end 的最後一天，月底切日不重抓', async()=>{
  const e=setup();
  const url=e.ctx.buildEventsUrl(day(9,29),day(9,30));
  assert.equal(e.ctx.buildEventsUrl(day(9,30),day(10,1)),url);
  assert.equal(e.ctx.buildEventsUrl(day(9,1),day(10,1)),url);
  assert.equal(e.ctx.buildEventsUrl(day(12,31),day(13,1)),e.ctx.buildEventsUrl(day(12,30),day(12,31)));
  e.seed(url,[event('29','09-29'),event('30','09-30')]);
  assert.deepEqual((await e.show(day(9,30),day(10,1))).map(x=>x.id),['30']);
  assert.equal(e.requests.length,0);
});

test('跨月重用涵蓋畫面的快取，但背景取得完整新範圍，不把局部資料冒充整月',async()=>{
  const e=setup(), old=e.ctx.buildEventsUrl(day(9,29),day(9,30));
  const next=e.ctx.buildEventsUrl(day(10,1),day(10,2));
  e.seed(old,[event('cached','10-01')]);
  assert.deepEqual((await e.show(day(10,1),day(10,2))).map(x=>x.id),['cached']);
  assert.equal(e.requests.length,1);
  assert.equal(e.requests[0].url,next);
  assert.equal(e.ctx.getFreshMemoryCache(next),null);
  e.requests[0].resolve([event('updated','10-01'),event('later','10-20')]);
  await tick();
  assert.equal(e.refetches.length,1);
  assert.deepEqual((await e.show(day(10,20),day(10,21))).map(x=>x.id),['later']);
});

test('持久快取涵蓋整週才可使用；過期、不同端點或查詢選項不可混用',()=>{
  const e=setup(), url=e.ctx.buildEventsUrl(day(10,1),day(10,8));
  const prior='https://gas.example/exec?action=getEvents&start=2026-09-01&end=2026-10-08';
  e.seed(prior,[],0,true);
  assert.ok(e.ctx.findCoveringEventCache(url,day(10,1),day(10,8)));
  assert.equal(e.ctx.findCoveringEventCache(url,day(10,1),day(10,10)),null);
  assert.equal(e.ctx.findCoveringEventCache(url+'&view=availability',day(10,1),day(10,8)),null);
  assert.equal(e.ctx.findCoveringEventCache(url.replace('gas.example','other.example'),day(10,1),day(10,8)),null);
  e.advance(12*60*60*1000);
  assert.equal(e.ctx.findCoveringEventCache(url,day(10,1),day(10,8)),null);
});

test('單筆持久快取毀損不妨礙其他候選，採用較新的涵蓋快取',()=>{
  const e=setup(),url=e.ctx.buildEventsUrl(day(10,1),day(10,2));
  const a='https://gas.example/exec?action=getEvents&start=2026-09-01&end=2026-10-08';
  e.store.set('sj_api_cache_v1:bad','{');
  e.seed(a,[event('old','10-01')],1000);
  e.seed(a,[event('new','10-01')],0,true);
  assert.equal(e.ctx.findCoveringEventCache(url,day(10,1),day(10,2)).data[0].id,'new');
});

test('失效時清除所有日期快取，避免更新後跨日取回舊資料',()=>{
  const e=setup(),url=e.ctx.buildEventsUrl(day(9,29),day(9,30));
  e.seed(url,[event('old','10-01')]);e.seed(url,[event('old','10-01')],0,true);
  e.ctx.invalidateCache('getEvents');
  assert.equal(e.ctx.findCoveringEventCache(url,day(10,1),day(10,2)),null);
  assert.equal(e.store.size,0);
});

test('背景更新反映外部新增、修改及刪除，不累積已刪除卡片',async()=>{
  const e=setup(),url=e.ctx.buildEventsUrl(day(9,29),day(9,30));
  e.seed(url,[event('deleted','09-29'),event('changed','09-29')],21000);
  await e.show(day(9,29),day(9,30));
  const changed={...event('changed','09-29'),title:'new title'};
  e.requests[0].resolve([changed,event('added','09-29')]);await tick();
  const cards=await e.show(day(9,29),day(9,30));
  assert.deepEqual(cards.map(e=>e.id),['changed','added']);
  assert.equal(cards[0].title,'new title');
});
