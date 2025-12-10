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

## 授權

MIT License

## 產生測試資料

npx prisma db seed

## 簡單測試結束開始

Start-Process test-websocket.html
