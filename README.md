# StockSprint Backend

即時股市模擬遊戲後端 API 與 WebSocket 服務

## 技術棧

- **Runtime**: Node.js 20+
- **Framework**: Express 5
- **Database**: PostgreSQL 17
- **ORM**: Prisma 7 (with PG Adapter)
- **WebSocket**: Socket.io
- **Language**: TypeScript

---

## 本地開發設定

### 1. 環境需求

- Node.js 20+
- Docker Desktop (用於本地 PostgreSQL)
- npm 或 yarn

### 2. 安裝依賴

```powershell
npm install
```

### 3. 啟動本地資料庫

```powershell
docker-compose up -d
```

### 4. 配置環境變數

複製 `.env.example` 為 `.env`：

```powershell
Copy-Item .env.example .env
```

預設本地配置已可直接使用。

### 5. 初始化資料庫 Schema

```powershell
npx prisma generate
npx prisma db push
```

### 6. 啟動開發伺服器

```powershell
npm run dev
```

伺服器將於 `http://127.0.0.1:8000` 啟動。

### 7. 驗證健康狀態

瀏覽器開啟或使用 curl：

```powershell
curl http://127.0.0.1:8000/health
```

預期回應：

```json
{
  "status": "ok",
  "env": "development",
  "database": "connected"
}
```

---

## 部署至 Render

### 前置作業

1. 註冊 [Render](https://render.com) 帳號
2. 連結 GitHub 儲存庫
3. 確保 `render.yaml` 已提交至 repository

### 部署步驟

1. **建立 Blueprint**  
   在 Render Dashboard 選擇 "New" → "Blueprint"，選擇此儲存庫

2. **自動建立服務**  
   Render 會根據 `render.yaml` 自動建立：

   - PostgreSQL 資料庫 (`stock-sprint-db`)
   - Web 服務 (`stock-sprint-backend`)

3. **環境變數**  
   `DATABASE_URL` 會自動從資料庫注入，無需手動設定

4. **部署完成**  
   服務會自動執行：

   ```bash
   npm install
   npx prisma generate
   npm start
   ```

5. **驗證部署**  
   存取 Render 提供的 URL，如：  
   `https://stock-sprint-backend.onrender.com/health`

---

## 資料庫 Schema 更新

### 本地開發

```powershell
npx prisma db push
```

### 生產環境

Render 會在每次部署時自動執行 `prisma generate`。若需執行 migration：

```powershell
npx prisma migrate deploy
```

---

## 目錄結構

```
backend/
├── prisma/
│   ├── schema.prisma       # Prisma schema 定義
│   └── prisma.config.ts    # Prisma 7 連線配置
├── server.ts               # Express 主程式
├── docker-compose.yml      # 本地 PostgreSQL 容器
├── render.yaml             # Render 部署設定
├── .env.example            # 環境變數範例
├── .gitignore              # Git 忽略檔案
├── package.json
├── tsconfig.json
└── README.md
```

---

## 常見問題

### Q1: Docker 容器無法啟動？

```powershell
# 檢查容器狀態
docker ps -a

# 重啟容器
docker-compose down
docker-compose up -d
```

### Q2: Prisma 連線失敗？

確認 `.env` 中的 `DATABASE_URL` 正確，並檢查：

```powershell
# 測試資料庫連線
npx prisma db push
```

### Q3: 埠口被佔用？

修改 `.env` 中的 `PORT` 或檢查佔用：

```powershell
netstat -ano | findstr ":8000"
```

---

## 測試與開發工具

### 產生測試資料

初始化遊戲資料（120 天股價劇本）：

```powershell
npx prisma db seed
```

### 建立測試用戶

產生 20 個測試用戶，用於測試排行榜功能：

```powershell
npx tsx prisma/seed-test-users.ts
```

**測試用戶資訊：**

- **帳號**：`testuser1` ~ `testuser20`
- **密碼**：`test1234`
- **資產**：隨機現金（$10,000 ~ $50,000）和持股（0 ~ 100 張）
- **頭像**：隨機分配（`avatar_00.webp` ~ `avatar_08.webp`）

### 隨機調整用戶資產

用於測試排行榜動態變化和排名上升動畫：

```powershell
npx tsx prisma/randomize-assets.ts
```

此腳本會：

- 隨機調整每位用戶的現金（±$5,000）
- 隨機調整每位用戶的持股（±20 張）
- 顯示每位用戶的資產變化

**測試排行榜流程：**

1. 執行 `randomize-assets.ts` 調整資產
2. 等待遊戲換日（倒數計時歸零）
3. 觀察排行榜重新排序和綠色閃爍動畫

### WebSocket 連線測試

開啟測試頁面進行 WebSocket 連線測試：

```powershell
Start-Process test-websocket.html
```

### 啟動遠端測試（Render）

啟動 Render 上的測試遊戲：

```powershell
Invoke-RestMethod -Uri "https://stock-sprint-backend.onrender.com/api/admin/start-test"
```

### Admin API 開發工具

**重要提醒：** 以下舊版 Admin API 已被棄用。請使用前端 Admin Dashboard (`/admin` 路由) 進行遊戲管理，或使用以下帶認證的 API。

**快進遊戲天數（需認證）：**

首先需要獲取 Admin JWT Token：

```powershell
# 1. 登入取得 Token
$loginResponse = Invoke-RestMethod -Method POST -Uri "https://stock-sprint-backend.onrender.com/api/auth/login" -ContentType "application/json" -Body '{"username":"admin","password":"your_admin_password"}'
$token = $loginResponse.token

# 2. 使用 Token 調用 Admin API（示例：獲取遊戲參數）
Invoke-RestMethod -Method GET -Uri "https://stock-sprint-backend.onrender.com/api/admin/params" -Headers @{Authorization="Bearer $token"}
```

**可用的 Admin API 端點：**

```powershell
# 遊戲控制
POST /api/admin/game/start     # 開始遊戲
POST /api/admin/game/stop      # 暫停遊戲
POST /api/admin/game/resume    # 恢復遊戲
POST /api/admin/game/restart   # 重啟遊戲（重置玩家進度）
POST /api/admin/game/reset     # 工廠重置

# 參數管理
GET  /api/admin/params         # 獲取遊戲參數
PUT  /api/admin/params         # 更新遊戲參數

# 監控服務
GET  /api/admin/monitor/history # 獲取線上人數歷史
```

**舊版開發工具（無需認證，僅用於除錯）：**

用於開發測試，快速跳轉到指定天數（例如第 80 天）：

```powershell
# 本地環境
Invoke-WebRequest -Method POST -Uri "http://localhost:8000/api/admin/fast-forward" -ContentType "application/json" -Body '{"targetDay": 80}'

# 遠端環境（已棄用）
# Invoke-WebRequest -Method POST -Uri "https://stock-sprint-backend.onrender.com/api/admin/fast-forward" -ContentType "application/json" -Body '{"targetDay": 80}'
```

**重新載入劇本資料（無需認證，僅用於除錯）：**

當直接修改資料庫的 `ScriptDay` 資料後，可透過此 API 重新載入到記憶體（無需重啟伺服器）：

```powershell
# 本地環境
Invoke-WebRequest -Method POST -Uri "http://localhost:8000/api/admin/script/reload"

# 遠端環境（已棄用）
# Invoke-WebRequest -Method POST -Uri "https://stock-sprint-backend.onrender.com/api/admin/script/reload"
```
