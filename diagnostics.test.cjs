const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = __dirname;
const diagnosticsPath = path.join(projectRoot, 'diagnostics.js');

function loadDiagnostics() {
  assert.equal(fs.existsSync(diagnosticsPath), true, 'diagnostics.js 尚未建立');
  delete require.cache[require.resolve(diagnosticsPath)];
  return require(diagnosticsPath);
}

test('API 成功時只回報狀態、耗時與筆數，不洩漏預約內容', async () => {
  const diagnostics = loadDiagnostics();
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify([
      { title: '王小明', extendedProps: { customer_phone: '0912345678' } },
      { title: '陳小美', extendedProps: { customer_phone: '0987654321' } }
    ])
  });
  const times = [1000, 1350];

  const result = await diagnostics.runApiDiagnostic({
    apiUrl: 'https://example.test/exec',
    fetchImpl,
    now: () => times.shift(),
    timeoutMs: 1000
  });

  assert.deepEqual(result, {
    ok: true,
    status: 200,
    elapsedMs: 350,
    count: 2,
    error: ''
  });
  assert.doesNotMatch(JSON.stringify(result), /王小明|0912345678|陳小美|0987654321/);
});

test('API 回傳錯誤狀態時提供可讀的失敗結果', async () => {
  const diagnostics = loadDiagnostics();
  const fetchImpl = async () => ({ ok: false, status: 503, text: async () => 'Service unavailable' });
  const times = [2000, 2450];

  const result = await diagnostics.runApiDiagnostic({
    apiUrl: 'https://example.test/exec',
    fetchImpl,
    now: () => times.shift(),
    timeoutMs: 1000
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
  assert.equal(result.elapsedMs, 450);
  assert.match(result.error, /HTTP 503/);
});

test('主頁只在診斷網址啟動隱藏面板', () => {
  loadDiagnostics();
  const html = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
  assert.match(html, /diagnostics\.js\?v=1/);
  assert.match(html, /CenturyDiagnostics\.install/);
  assert.match(html, /diagnostic=1/);
  assert.match(html, /if \(window\.CenturyDiagnosticsActive\) return;/);
});
