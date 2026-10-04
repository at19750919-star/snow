# 手機首頁事件卡片慢：2026-10-04 診斷

狀態：原因尚未確認；未修改或部署預約功能。使用者描述手機 Chrome 的表格先出現，事件卡片很久才出；昨天正常，今天才變慢。這個時間線很重要，不能直接把既有的快取設計當成突發故障原因。

## 已查證

- 正式首頁是 `https://at19750919-star.github.io/snow/`。GitHub Pages 最近一次建置是 2026-09-29 04:56:03 UTC、commit `4e4e4d9`；10/3 至 10/4 沒有首頁新部署（主線 GitHub 查證）。
- 正式 GAS deployment `AKfycbyICaHAciRLstbnMvKLxkCopi7oxblP4goUSD8yj2CI6SmugltRcQOwTeBBiHS99VzW2Q` 目前指向 v254。`clasp versions --json` 顯示 v252 是首頁快取改善、v253 是報表加速、v254 是傳「已約滿」原因給 LINE；該指令不提供版本建立時間。Google Drive 的「預約管理後端」檔案 metadata 最後修改於 2026-10-02 15:14:23 UTC（台灣 10/2 23:14），不能據此確定 deployment 更新時間。
- 拉取不可變 v254 對照本機 `.gas-line-fix/程式碼.js`：`getEvents`、15 秒 CacheService 分塊快取、失效後主表 `getDataRange().getValues()` 的路徑相同。v254 在報表與日期時區處理有其他修改，不能直接拿本機較舊檔案覆蓋線上。
- 正式 `getEvents` 整月查詢（2026-09-24 至 11-08）以 `curl -L -o NUL` 量測：7.04 秒、10.57 秒，約 233 KB；緊接同一範圍重試 1.85 秒。單日查詢約 5.98 秒、15 KB。這些是桌面網路端到端耗時；快慢與快取命中相符，但沒有 GAS 內部快取命中遙測，也不能代表手機耗時。先前 PowerShell `Invoke-WebRequest` 兩次 55 秒逾時，不能證明 GAS 各執行了 55 秒。
- Google Drive 唯讀 metadata：預約分頁配置為 6,292 列、26 欄；表頭有 19 個欄位，最後 5 列均有內容。因此主表至少使用到第 6,292 列；26 欄是配置量，不等於 `getLastColumn()` 或 `getDataRange()` 的實際寬度。未讀取或保存顧客資料。
- 程式路徑：快取失效後先由 `monitorApptHeadersChange_` 另讀第一列表頭並寫 Script Properties，接著 `getDataRange().getValues()` 再讀整表；日期查詢起點晚於 `archiveCutoffYmd_()` 時不讀歷史分頁。v254 的時區查詢有執行內記憶體快取。這些操作可能增加耗時，但目前沒有 Apps Script 分段計時，無法斷定哪一步最慢。
- 首頁 `index.html` 的事件來源先查記憶體與 12 小時 `localStorage`，沒有有效快取時才等待 GAS。桌面與手機的快取各自獨立；尚未取得手機快取、Network 或 `?diagnostic=1` 的結果，因此不能把手機與桌面的差異判定為快取所致。

## 下一步與修正邊界

先看手機 Chrome 正式頁 `?diagnostic=1` 的只讀結果，分清是事件請求本身變慢、逾時，還是請求完成後渲染慢；再比對同一手機的 Wi-Fi 與行動網路。診斷資料回報時只保留耗時、狀態與筆數，不記顧客內容。

若確認冷查本身是瓶頸，可做一個小修：`getEvents` 讀整表後，拿已取得的表頭交給 `monitorApptHeadersChange_`，省掉獨立的表頭讀取；當表頭未變時不重寫 Script Properties。其他 `doPost` 呼叫維持原邏輯。這能去除已確認的重複工作，但尚未實測效益，不能承諾秒開。正式修正須以 v254 為基準，補表頭變更稽核測試，再部署既有 GAS deployment；目前沒有足夠證據值得在手機診斷前先上線。

目前不延長 15 秒後端快取，也不延長 12 小時瀏覽器快取；這會改變預約資料新鮮度，且外部 LINE 寫入對本部署快取的失效尚未證實。
