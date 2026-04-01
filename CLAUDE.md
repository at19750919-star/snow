# CLAUDE.md

此檔案提供 Claude Code (claude.ai/code) 在本專案中的開發指引。

## 專案概述

世紀髮廊景美店的預約排班系統。前端為單頁應用（FullCalendar Scheduler + Vanilla JS），後端為 Google Apps Script Web App，資料存於 Google Sheets。

## 開發環境

- **開發伺服器**：VS Code LiveServer，port 5502
- **樣式快取**：`styles.css?v=N` — 改 CSS 後要遞增 `index.html` 中的版號
- **GAS 端點**：API URL 寫死在 `index.html` 頂部的 `APPS_SCRIPT_WEB_APP_URL`
- **無建置步驟**：純靜態檔案，直接 serve
- **CSS 檢查**：`npm run lint`（stylelint）

## 程式碼風格

### CSS（styles.css）
- 依章節組織（檔案頂部有目錄註解），新增樣式放到對應章節
- 禁止新增重複 CSS，若需新增要附註解說明用途
- 使用 CSS Variables (`--*`) 管理顏色、間距、字型

### JavaScript（index.html）
- Vanilla JS + ES6 async/await，無框架
- DOM 操作用 `querySelector` / `getElementById`
- 動態插入 HTML 必須用 `escapeHtml()` 防 XSS
- API 呼叫統一用 fetch + JSON

## 編碼安全（重要）

- 禁止變更任何檔案的編碼、BOM、換行格式
- 禁止整檔重寫含中文的檔案（ReadAll → Replace → WriteAll）
- 優先使用最小差異編輯，僅改必要區塊
- 偵測到編碼不明或亂碼：停止修改，先回報

## UX 變更

任何會改 UX 的改動，先用一句話確認想要的效果，再動手改。

## 專案結構

- `index.html` — 主要 SPA（HTML + 內嵌 JS，~1850 行）
- `styles.css` — 全站樣式（~3000 行，含 CSS 變數與章節目錄）
- `AGENTS.md` / `AI_GUIDE.md` — AI 協作規範（助教風格回覆格式）
