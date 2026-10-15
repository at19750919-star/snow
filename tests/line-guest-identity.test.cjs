// 結帳視窗：LINE 回流客電話空白時，用上次預約的姓名／電話填入（index.html applyLineGuestIdentity）
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function grab(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} missing`);
  let i = html.indexOf('{', start), depth = 0;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}' && --depth === 0) break; }
  return html.slice(start, i + 1);
}
function setup(name, phone) {
  const els = { customer_name: { value: name }, customer_phone: { value: phone } };
  const document = { getElementById: id => els[id] || null };
  const fn = new Function('document', `${grab('normalizePhone')}\n${grab('applyLineGuestIdentity')}\nreturn applyLineGuestIdentity;`)(document);
  return { els, fn };
}
let t = setup('Derek', '');
assert.strictEqual(t.fn({ customer_name: '林致緯1', customer_phone: '0970-151515', start: '2026-09-24 15:45' }), true);
assert.strictEqual(t.els.customer_name.value, '林致緯1');
assert.strictEqual(t.els.customer_phone.value, '0970-151515');
t = setup('王小明', '0912345678');
assert.strictEqual(t.fn({ customer_name: '林致緯1', customer_phone: '0970-151515' }), false);
assert.strictEqual(t.els.customer_name.value, '王小明');
t = setup('Derek', '');
assert.strictEqual(t.fn({ customer_name: 'Derek', customer_phone: '' }), false);
assert.strictEqual(t.els.customer_name.value, 'Derek');
assert.strictEqual(t.els.customer_phone.value, '');
t = setup('Derek', '');
assert.strictEqual(t.fn({ customer_name: '', customer_phone: '0970151515' }), true);
assert.strictEqual(t.els.customer_name.value, 'Derek');
assert.ok(/lineApplied = true;\s*applyPriceSuggestion\(history\);\s*applyLineGuestIdentity\(history\);/.test(html), 'LINE 查詢回來要套用姓名電話');
console.log('line-guest-identity: 5 checks passed');
