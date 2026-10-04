# 預約主頁快取改善 A

狀態：已部署首頁與 GAS v252，部署後獨立驗收 PASS。

## 部署紀錄

- 部署獨立驗收：Codex Luna /root/home_cache_a_deploy_review 最終 PASS。初驗因工具查詢 404 / browser eval 引號錯誤而證據不足；同一驗收官聚焦複驗成功，未重新部署或修改程式。
- 獨立確認 Pages built 與 commit、clasp 正式 deployment @252、release 與 v252 拉取檔案一致；正式頁有覆蓋範圍快取程式，9/30 顯示 44 張（290ms）、10/1 顯示 20 張（273ms）。9/30 未重新請求事件；10/1 事件背景請求尚未完成時已顯示卡片。時段間隔的另一支 LINE 請求不屬於事件重抓。

- 使用者明確要求部署；首頁 GitHub Pages commit：275bc92b66c4d205206e8f7a398db1f33d482218，建置 built。
- 正式頁 https://at19750919-star.github.io/snow/ HTTP 200，回應正規化 LF 後 SHA256 為 159b5d656389f1cd6eb5c7480a5c51514ca7261047f75cf30b0c34f24a76b170，與發布檔相同。
- GAS 維持同一 deployment AKfycbyICaHAciRLstbnMvKLxkCopi7oxblP4goUSD8yj2CI6SmugltRcQOwTeBBiHS99VzW2Q，從 v251 升至 v252。
- 先拉取線上 7 個檔案，確認程式碼.js 與修改前基準相符，只替換已驗收的快取程式；其餘 6 檔保留。重新拉取不可變 v252，比對 7 檔全部與 release 相同。
- 正式 GET 8/25–10/8：兩次均 1,362 筆、519,930 bytes、476,604 字元，回應 SHA256 相同；耗時約 5.198/1.647 秒。只是單次取樣，不是固定速度保證或快取命中的直接遙測。
- 正式頁 9/29→9/30：222ms 取樣時已有 44 張卡片，未新增 getEvents；切 10/1：220ms 時已有 20 張卡片，9/24–11/8 的背景請求尚未完成。
- 無正式預約寫入。量測只留筆數、時間及雜湊，見 home-cache-plan-a-deployment-evidence.json。
- 部署備份 C:/Users/at197/AppData/Local/Temp/snow-cache-A-deploy-20260928。因原 repo 有損壞的 refs/codex 暫存參照，本次從乾淨 clone 發布，未修復或重設原 repo；原工作目錄仍保留修改。
- 如需回復：首頁還原本次 commit 的 index.html 差異（前版 fe9a71f），GAS 原 deployment 指回 v251；不回到更舊 v250，保留先前 LINE availability 改善。

## 範圍

使用者要求先做方案 A：修正月底查詢邊界、重用涵蓋目前畫面的快取、讓大型事件 JSON 可以使用 GAS 快取。目標頁為根目錄 index.html；preview 使用另一個 GAS 端點，本次未修改。

## 已確認的問題

- 原 buildEventsUrl 把 FullCalendar 不包含在範圍內的 end 當成可見日期。9/30 的 end 是 10/1，造成查詢從 8/25–10/8 擴大成 8/25–11/8。
- 9/30 的 44 筆事件原本已在快取，仍須重新等待。
- 本次線上觀察首頁 1,361 筆快取約 476,294 字元；GAS 舊程式只快取少於 95,000 字元的回應。首次 getEvents 約 110 秒，之後波動到數秒，僅為此次觀察，不是基準平均或改善承諾。

## 修改

- index.html / buildEventsUrl：以 end 減 1 毫秒計算最後可見月份。
- index.html / findCoveringEventCache、events：精確鍵未命中時，挑選同端點、同查詢選項且涵蓋整個畫面日期的最新有效快取；先顯示，再抓正式新範圍。不可將只有畫面日期的資料存成完整月窗。
- .gas-line-fix/程式碼.js / getCachedEventsJson、setCachedEventsJson：20,000 UTF-16 字元分塊，不切斷代理字元；每次寫入採 UUID，全部分塊寫完才發布清單。缺塊、到期或長度不符時回退試算表。小資料及既有單鍵 JSON 相容。
- clearEventsCache 的版本失效與 LINE availability 通知保留；快取 TTL 保持 15 秒，沒有延長資料新鮮度上限。
- 保留原始 UTF-8、無 BOM、CRLF；只改必要區塊。原檔備份在 C:/Users/at197/AppData/Local/Temp/snow-cache-A-hajp73zd。

## 驗證

```powershell
node --test tests/home-events-cache.test.cjs tests/event-cache-chunks.test.cjs tests/availability-cache.test.cjs preview-events-cache.test.cjs appointment-delete.test.cjs diagnostics.test.cjs
```

涵蓋月底、跨年、日/月相同範圍、跨月先顯示後更新、涵蓋完整週、過期/異端點/異查詢/壞快取排除、更新與刪除、大型中文/emoji、分塊缺失與併發發布、快取失效。完整 doGet 的 1,361 筆測試確認第二次請求不讀試算表，失效後重讀並反映刪除。

可重現瀏覽器檢查：`node tests/home-cache-browser-server.cjs`。終端輸出實際本機網址；只在 localhost 提供實際首頁與合成 GET 資料，拒絕所有 POST。切 9/29 → 9/30 → 10/1，檢查卡片與 window.cacheQA.requests；可調 cacheQA.delay 模擬慢網路。此測試不代表正式 GAS 執行耗時。

## 可調參數與部署邊界

獨立驗收：Codex Luna /root/home_cache_a_review（不同模型與獨立工作階段）重跑指定套件 31/31 通過。實際瀏覽器確認 9/29 載入 8/25–10/8、9/30 不新增 getEvents、10/1 新範圍請求仍 done:false 時已顯示舊範圍涵蓋的卡片；合成資料背景變更後正常更新卡片。驗收未修改檔案或正式資料，測試分頁已關閉。本次 PASS 僅涵蓋本機修改，無正式部署或正式效能改善宣稱。

- 前端沿用 API_CACHE_TTL（5 分鐘）、PERSISTENT_EVENT_CACHE_TTL（12 小時）、EVENT_REVALIDATE_AFTER（20 秒）、AUTO_REFRESH_INTERVAL（30 秒）。畫面可先呈現舊資料，背景更新保持啟用。
- 後端 chunkSize 為 20,000 字元、最大約 198 萬字元；超過範圍或快取服務失敗仍正常回傳正式讀取結果。
- GAS .gas-line-fix 被 gitignore 排除，不能只推 GitHub 就宣稱後端已上線。正式部署需分別發布首頁與現有 GAS deployment。
- 沒有變更客戶欄位、排休/留言邏輯、UI 外觀或正式預約。首次無任何快取仍需等 Google 後端；未承諾冷啟動秒數。
- 回復方式：還原 index.html 的本次差異；還原 GAS 兩個快取函式至備份並重新發布舊版部署。新分塊鍵隨原 15 秒 TTL 自動過期。
