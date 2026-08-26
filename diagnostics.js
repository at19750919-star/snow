(function (root, factory) {
  const diagnostics = factory();
  if (typeof module === 'object' && module.exports) module.exports = diagnostics;
  if (root) root.CenturyDiagnostics = diagnostics;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  async function runApiDiagnostic(options) {
    const apiUrl = options.apiUrl;
    const fetchImpl = options.fetchImpl || fetch;
    const now = options.now || Date.now;
    const timeoutMs = options.timeoutMs || 30000;
    const startedAt = now();
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    let status = 0;

    try {
      const response = await fetchImpl(apiUrl, {
        method: 'GET', mode: 'cors', cache: 'no-store',
        signal: controller ? controller.signal : undefined
      });
      status = response.status;
      const text = await response.text();
      const elapsedMs = Math.max(0, Math.round(now() - startedAt));
      if (!response.ok) return { ok: false, status, elapsedMs, count: 0, error: `HTTP ${status}` };

      let data;
      try {
        data = JSON.parse(text);
      } catch (error) {
        return { ok: false, status, elapsedMs, count: 0, error: '回傳內容不是 JSON' };
      }
      if (!Array.isArray(data)) {
        return { ok: false, status, elapsedMs, count: 0, error: '回傳格式不是預約陣列' };
      }
      return { ok: true, status, elapsedMs, count: data.length, error: '' };
    } catch (error) {
      const elapsedMs = Math.max(0, Math.round(now() - startedAt));
      const message = error && error.name === 'AbortError'
        ? `連線超過 ${Math.round(timeoutMs / 1000)} 秒`
        : String(error && error.message ? error.message : error || '未知錯誤');
      return { ok: false, status, elapsedMs, count: 0, error: message };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function install(options) {
    if (typeof window === 'undefined' || typeof document === 'undefined') return false;
    if (new URLSearchParams(window.location.search).get('diagnostic') !== '1') return false;
    window.CenturyDiagnosticsActive = true;

    const mount = async () => {
      const panel = document.createElement('section');
      panel.id = 'connection-diagnostic';
      panel.setAttribute('aria-live', 'polite');
      panel.innerHTML = `
        <style>
          #connection-diagnostic{position:fixed;inset:0;z-index:2147483647;overflow:auto;background:#f4f6f8;color:#18212b;font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:24px 18px;box-sizing:border-box}
          #connection-diagnostic *{box-sizing:border-box}
          #connection-diagnostic .diag-card{max-width:620px;margin:0 auto;background:#fff;border:1px solid #d9e0e7;border-radius:16px;padding:22px;box-shadow:0 12px 36px rgba(21,34,50,.12)}
          #connection-diagnostic h1{font-size:24px;margin:0 0 8px}
          #connection-diagnostic p{margin:8px 0;color:#536170}
          #connection-diagnostic dl{margin:20px 0;padding:0}
          #connection-diagnostic .diag-row{display:grid;grid-template-columns:116px 1fr;gap:10px;padding:11px 0;border-bottom:1px solid #e8edf2}
          #connection-diagnostic dt{font-weight:700;color:#394858}
          #connection-diagnostic dd{margin:0;overflow-wrap:anywhere}
          #connection-diagnostic .diag-ok{color:#087f5b;font-weight:700}
          #connection-diagnostic .diag-error{color:#c92a2a;font-weight:700}
          #connection-diagnostic .diag-running{color:#9c6500;font-weight:700}
          #connection-diagnostic .diag-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}
          #connection-diagnostic button{appearance:none;border:0;border-radius:10px;padding:12px 16px;background:#1f6feb;color:#fff;font:inherit;font-weight:700}
          #connection-diagnostic button+button{background:#5c6773}
          #connection-diagnostic .diag-note{font-size:13px;margin-top:18px}
        </style>
        <div class="diag-card">
          <h1>預約系統連線診斷</h1>
          <p>這裡只顯示連線狀態與筆數，不會顯示顧客資料。</p>
          <dl>
            <div class="diag-row"><dt>網頁程式</dt><dd class="diag-ok">已載入</dd></div>
            <div class="diag-row"><dt>日曆套件</dt><dd id="diag-calendar"></dd></div>
            <div class="diag-row"><dt>預約 API</dt><dd id="diag-api" class="diag-running">測試中…</dd></div>
            <div class="diag-row"><dt>HTTP 狀態</dt><dd id="diag-status">—</dd></div>
            <div class="diag-row"><dt>回應時間</dt><dd id="diag-time">—</dd></div>
            <div class="diag-row"><dt>資料筆數</dt><dd id="diag-count">—</dd></div>
            <div class="diag-row"><dt>錯誤內容</dt><dd id="diag-error">—</dd></div>
            <div class="diag-row"><dt>測試時間</dt><dd id="diag-tested-at">—</dd></div>
          </dl>
          <div class="diag-actions">
            <button type="button" id="diag-retry">重新測試</button>
            <button type="button" id="diag-copy">複製結果</button>
          </div>
          <p class="diag-note">請將這個畫面截圖，或按「複製結果」後傳回。</p>
        </div>`;
      document.body.appendChild(panel);

      const calendarEl = panel.querySelector('#diag-calendar');
      calendarEl.textContent = typeof window.FullCalendar !== 'undefined' ? '已載入' : '載入失敗';
      calendarEl.className = typeof window.FullCalendar !== 'undefined' ? 'diag-ok' : 'diag-error';

      const run = async () => {
        const apiEl = panel.querySelector('#diag-api');
        apiEl.textContent = '測試中…';
        apiEl.className = 'diag-running';
        panel.querySelector('#diag-status').textContent = '—';
        panel.querySelector('#diag-time').textContent = '—';
        panel.querySelector('#diag-count').textContent = '—';
        panel.querySelector('#diag-error').textContent = '—';

        const start = new Date();
        const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
        const ymd = value => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
        const url = new URL(options.apiUrl);
        url.searchParams.set('action', 'getEvents');
        url.searchParams.set('start', ymd(start));
        url.searchParams.set('end', ymd(end));
        url.searchParams.set('_diagnostic', String(Date.now()));
        const result = await runApiDiagnostic({ apiUrl: url.toString(), timeoutMs: 30000 });

        apiEl.textContent = result.ok ? '連線成功' : '連線失敗';
        apiEl.className = result.ok ? 'diag-ok' : 'diag-error';
        panel.querySelector('#diag-status').textContent = result.status || '沒有收到回應';
        panel.querySelector('#diag-time').textContent = `${result.elapsedMs} 毫秒`;
        panel.querySelector('#diag-count').textContent = result.ok ? `${result.count} 筆` : '—';
        panel.querySelector('#diag-error').textContent = result.error || '無';
        panel.querySelector('#diag-tested-at').textContent = new Date().toLocaleString('zh-TW');
      };

      panel.querySelector('#diag-retry').addEventListener('click', run);
      panel.querySelector('#diag-copy').addEventListener('click', async () => {
        const text = panel.querySelector('.diag-card').innerText;
        try {
          await navigator.clipboard.writeText(text);
          panel.querySelector('#diag-copy').textContent = '已複製';
        } catch (error) {
          panel.querySelector('#diag-copy').textContent = '無法複製，請截圖';
        }
      });
      await run();
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
    else mount();
    return true;
  }

  return { runApiDiagnostic, install };
});
