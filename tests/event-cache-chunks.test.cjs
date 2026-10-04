const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../.gas-line-fix/程式碼.js'),'utf8');
function setup() {
  const data=new Map();let uuid=0,now=0;
  const cache={
    get:k=>{const v=data.get(k);return v && v.expires>now?v.text:null;},
    put:(k,text,ttl)=>{assert.ok(Buffer.byteLength(text,'utf8')<100000);data.set(k,{text,expires:now+ttl});},
    getAll:keys=>Object.fromEntries(keys.map(k=>[k,cache.get(k)]).filter(([,v])=>v!==null)),
    putAll:(entries,ttl)=>Object.entries(entries).forEach(([k,v])=>cache.put(k,v,ttl))
  };
  const ctx=vm.createContext({CacheService:{getScriptCache:()=>cache},Utilities:{getUuid:()=>`write-${++uuid}`},
    EVENTS_CACHE_TTL_SEC:15,EVENTS_CACHE_KEY:'events',Date:{now:()=>++now},notifyAvailabilityChanged_:()=>{}});
  vm.runInContext(source.slice(source.indexOf('function getEventsCache()'),source.indexOf('/**',source.indexOf('function clearEventsCache()'))),ctx);
  return {ctx,data,cache,advance:n=>{now+=n;}};
}
const payload=()=>JSON.stringify(Array.from({length:1361},(_,i)=>({id:i,name:'測試客人',notes:'染髮😀'.repeat(40)})));

test('大筆中文預約完整往返，每塊依 UTF-8 位元組大小低於上限',()=>{
  const e=setup(),json=payload();assert.ok(json.length>95000);
  e.ctx.setCachedEventsJson('key',json);
  assert.equal(e.ctx.getCachedEventsJson('key'),json);
  assert.ok(e.data.size>2);
  assert.deepEqual(JSON.parse(e.ctx.getCachedEventsJson('key')),JSON.parse(json));
});
test('分塊不切斷 emoji 的代理字元',()=>{
  const e=setup(),json='a'.repeat(19999)+'😀'+'b'.repeat(20000);
  e.ctx.setCachedEventsJson('key',json);
  for(const [k,v] of e.data) if(k!=='key') assert.equal(Buffer.from(v.text).toString('utf8'),v.text);
  assert.equal(e.ctx.getCachedEventsJson('key'),json);
});
test('缺塊、損毀及到期皆視為未命中，不回傳部分預約',()=>{
  const e=setup();e.ctx.setCachedEventsJson('key',payload());
  const key=[...e.data.keys()].find(k=>k!=='key');e.data.delete(key);
  assert.equal(e.ctx.getCachedEventsJson('key'),null);
  e.ctx.setCachedEventsJson('key',payload());
  const newKey=[...e.data.keys()].find(k=>k.includes('write-2'));
  e.data.get(newKey).text='broken';assert.equal(e.ctx.getCachedEventsJson('key'),null);
  e.ctx.setCachedEventsJson('key',payload());e.advance(16);
  assert.equal(e.ctx.getCachedEventsJson('key'),null);
});
test('清單發布前及不同寫入之間不會讀到混合分塊',()=>{
  const e=setup(),old=payload(),fresh=old.replace('測試客人','更新客人');
  e.ctx.setCachedEventsJson('key',old);
  const putAll=e.cache.putAll;
  e.cache.putAll=(parts,ttl)=>{putAll(parts,ttl);assert.equal(e.ctx.getCachedEventsJson('key'),old);};
  e.ctx.setCachedEventsJson('key',fresh);
  assert.equal(e.ctx.getCachedEventsJson('key'),fresh);
});
test('小筆及舊格式維持相容，寫入失敗可回退正式讀取',()=>{
  const e=setup();e.ctx.setCachedEventsJson('small','[]');
  assert.equal(e.ctx.getCachedEventsJson('small'),'[]');
  e.cache.putAll=()=>{throw new Error('unavailable');};
  assert.doesNotThrow(()=>e.ctx.setCachedEventsJson('key',payload()));
  assert.equal(e.ctx.getCachedEventsJson('key'),null);
});
test('預約變更後的新版本鍵不會使用舊分塊',()=>{
  const e=setup(),key=e.ctx.eventsCacheKey_('2026-09-01','2026-10-08');
  e.ctx.setCachedEventsJson(key,payload());e.ctx.clearEventsCache();
  const next=e.ctx.eventsCacheKey_('2026-09-01','2026-10-08');
  assert.notEqual(next,key);assert.equal(e.ctx.getCachedEventsJson(next),null);
});
