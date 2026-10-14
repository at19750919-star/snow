const vm=require('vm'),fs=require('fs');
const H=['編號','設計師ID','開始時間','結束時間','顧客姓名','顧客電話','服務項目','備註','預約類型','金額','助理ID','剪髮金額','總金額','染髮顏色','輸入人','人數','來源','LINE使用者ID','Webhook事件ID'];
function sheet(name,v){return {name,v,getName:()=>name,getLastRow:()=>v.length,getLastColumn:()=>Math.max(...v.map(r=>r.length)),getMaxRows:()=>v.length+5,
 getDataRange:()=>({getValues:()=>{const w=Math.max(...v.map(r=>r.length));return v.map(r=>{const o=r.slice();while(o.length<w)o.push('');return o;})}}),
 getRange:(r,c,nr=1,nc=1)=>({getValues:()=>v.slice(r-1,r-1+nr).map(x=>{const o=x.slice(c-1,c-1+nc);while(o.length<nc)o.push('');return o;}),
   setValues:inc=>inc.forEach((row,i)=>{const t=v[r-1+i]||(v[r-1+i]=[]);row.forEach((x,j)=>t[c-1+j]=x)}),clearContent:()=>{for(let i=0;i<nr;i++)if(v[r-1+i])for(let j=0;j<nc;j++)v[r-1+i][c-1+j]=''}}),
 appendRow:r=>v.push(r),deleteRow:i=>v.splice(i-1,1),deleteRows:(i,n)=>v.splice(i-1,n),insertSheet:()=>null}}
const main=sheet('預約',[H,['18167','2','2026-09-24 16:20','2026-09-24 16:35','Derek','','剪髮','','normal','','','','','','LINE','1','LINE','U-abc','W1']]);
const arch=sheet('歷史預約',[H.slice(0,16),['17000','2','2026-08-01 10:00','2026-08-01 10:15','王','\'0912-000111','剪髮','','normal','300','','300','300','','LINE','1','LINE','U-old','W0']]);
const cache={};const ss={getSpreadsheetTimeZone:()=>'Asia/Taipei',getSheetByName:n=>n==='預約'?main:n==='歷史預約'?arch:sheet(n,[['a']]),insertSheet:n=>sheet(n,[])};
const ctx={console,Utilities:{formatDate:(d,tz,f)=>new Date(d.getTime()+8*3600e3).toISOString().slice(0,16).replace('T',' ')},CacheService:{getScriptCache:()=>({get:k=>cache[k]||null,put:(k,v)=>cache[k]=v,remove:k=>delete cache[k],removeAll:()=>{}})},
 SpreadsheetApp:{getActiveSpreadsheet:()=>ss,flush:()=>{}},LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
 PropertiesService:{getScriptProperties:()=>({getProperty:()=>null,setProperty(){},deleteProperty(){}})},ContentService:{createTextOutput:t=>({setMimeType:()=>t}),MimeType:{JSON:1}}};
vm.createContext(ctx);vm.runInContext(fs.readFileSync(require('path').join(__dirname,'..','.gas-line-fix','程式碼.js'),'utf8'),ctx);
ctx.auditLog_=()=>{};ctx.clearEventsCache=()=>{};ctx.allocateNextAppointmentId_=()=>18167;
const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)process.exitCode=1};
// 1 delete+recreate same slot
ctx.doDelete({id:'18167',start:'2026-09-24T16:20:00',employee_id:'2'},main);
ok(main.v.length===1,'deleted');
ctx.doCreate({start:'2026-09-24T16:20:00',employee_id:'2',operator_name:'店長',customer_name:'林致緯1',customer_phone:'0970151515',service_id:'剪髮',duration:15},main);
let r=main.v[1];ok(r[16]==='LINE'&&r[17]==='U-abc'&&r[18]==='','recreate keeps 來源/LINE ID, no webhook: '+JSON.stringify(r.slice(14)));
// 2 phone match in archive (no header, positional)
ctx.allocateNextAppointmentId_=()=>19000;
ctx.doCreate({start:'2026-10-20T10:00:00',employee_id:'1',operator_name:'店長',customer_name:'王',customer_phone:'0912000111',service_id:'剪髮',duration:15},main);
r=main.v[2];ok(r[17]==='U-old','phone match from archive: '+r[17]);
// 3 phone without LINE -> blank
ctx.allocateNextAppointmentId_=()=>19001;
ctx.doCreate({start:'2026-10-20T11:00:00',employee_id:'1',operator_name:'店長',customer_name:'X',customer_phone:'0999999999',duration:15},main);
ok(main.v[3][17]==='','no match stays blank');
// 4 edit keeps LINE
ctx.doEdit({id:'18167',start:'2026-09-24T16:20:00',employee_id:'2',operator_name:'店長',customer_name:'林致緯1',customer_phone:'0970151515',service_id:'剪髮',amount:'450',duration:15},main);
ok(main.v[1][17]==='U-abc'&&main.v[1][16]==='LINE','edit keeps LINE');
// 5 getLastVisit via phone from archive
const out=ctx.doGet?JSON.parse(ctx.doGet({parameter:{action:'getLastVisit',phone:'0912000111',before:'2026-10-01'}})):null;
ok(out&&out.customer_name==='王','phone getLastVisit reads 歷史預約: '+JSON.stringify(out&&{n:out.customer_name,cut:out.cut_price}));
// 6 archive by header + headers ensured
ctx.archiveCutoffYmd_=()=>'2026-10-01';
const res=ctx.archiveOldAppointments_();
ok(JSON.stringify(arch.v[0])===JSON.stringify(H),'archive headers ensured');
const moved=arch.v.find(x=>x[0]==18167);ok(moved&&moved[17]==='U-abc','archived row keeps LINE ID');
