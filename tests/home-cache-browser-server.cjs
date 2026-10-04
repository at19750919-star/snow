// Local-only browser fixture: runs the real homepage with synthetic read-only API data.
// Usage: node tests/home-cache-browser-server.cjs
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const fixture = `<script>
(() => {
  localStorage.clear();
  const RealDate = Date;
  let offset = 0;
  const base = new RealDate(2026,8,29,12).getTime();
  window.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [base + offset])); }
    static now() { return base + offset; }
  };
  const make = (id,date,name) => ({id,resourceId:'1',start:date+'T12:00:00+08:00',end:date+'T13:00:00+08:00',title:name,
    extendedProps:{customer_name:name,customer_phone:'',service_id:'剪',notes:'',appointment_type:'normal'}});
  window.cacheQA = {requests:[],delay:2000,advance:ms=>{offset+=ms;},events:[
    make('qa29','2026-09-29','測試二十九'),make('qa30','2026-09-30','測試三十'),make('qa01','2026-10-01','測試十月')
  ]};
  window.fetch = async (input,options={}) => {
    const url=new URL(String(input),location.href);
    if(options.method && options.method!=='GET') throw Error('QA: writes disabled');
    if(!url.hostname.endsWith('google.com')) throw Error('QA: unexpected fetch blocked');
    const action=url.searchParams.get('action');
    const entry={action,start:url.searchParams.get('start'),end:url.searchParams.get('end'),done:false};
    cacheQA.requests.push(entry);
    const data=action==='getEvents'?JSON.parse(JSON.stringify(cacheQA.events)):
      action==='getNotes'?{content:''}:action==='getSlotIntervals'?{ok:true,intervals:[]} : [];
    await new Promise(r=>setTimeout(r,action==='getEvents'?cacheQA.delay:10));
    entry.done=true;
    return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
  };
})();
</script>`;
const server=http.createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+path.sep) || pathname.includes('/.')) {res.writeHead(403);res.end();return;}
  if(!['.html','.js','.css','.png','.woff2','.svg','.ico'].includes(path.extname(file))) {res.writeHead(404);res.end();return;}
  try {
    const type={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.woff2':'font/woff2'};
    res.setHeader('Content-Type',type[path.extname(file)]||'application/octet-stream');
    res.setHeader('Cache-Control','no-store');
    res.end(file===path.join(root,'index.html')?fs.readFileSync(file,'utf8').replace('<head>','<head>'+fixture):fs.readFileSync(file));
  } catch {res.writeHead(404);res.end();}
});
server.listen(0,'127.0.0.1',()=>console.log('Browser fixture: http://127.0.0.1:'+server.address().port));
