// server.ts
// 伺服器主程式，提供健康檢查與 Socket.io 基本設定

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
// 驗證路由
import authRoutes from "./src/routes/authRoutes.js";
// Socket 認證中介軟體
import { socketAuthMiddleware } from "./src/middlewares/socketAuthMiddleware.js";
// 遊戲迴圈
import { initializeGameLoop } from './src/gameLoop.js';
// 遊戲服務
import { startGame, stopGame, loadScriptData, getGameState, getCurrentStockData, getPriceHistory, getLeaderboard, getPastNews } from './src/services/gameService.js';
// 交易處理器
import { registerTradeHandlers } from './src/socket/tradeHandlers.js';
// 共享資料庫連線
import { prisma, pool } from "./src/db.js";
// 型別定義
import type { FullSyncPayload } from './src/types/events.js';

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// 掛載驗證路由
app.use("/api/auth", authRoutes);

// Admin 測試路由 (開發用)
app.get("/api/admin/start-test", async (req, res) => {
    try {
        await startGame();
        res.json({ message: "遊戲已開始" });
    } catch (error: any) {
        console.error(`[${new Date().toISOString()}] [Admin] 啟動遊戲失敗:`, error.message);
        res.status(500).json({ error: "啟動遊戲失敗" });
    }
});

app.get("/api/admin/stop-test", async (req, res) => {
    try {
        await stopGame();
        res.json({ message: "遊戲已結束" });
    } catch (error: any) {
        console.error(`[${new Date().toISOString()}] [Admin] 結束遊戲失敗:`, error.message);
        res.status(500).json({ error: "結束遊戲失敗" });
    }
});

// Admin 劇本重新載入路由 (開發用)
app.post("/api/admin/script/reload", async (req, res) => {
    try {
        await loadScriptData();
        res.json({ message: "劇本資料已重新載入" });
    } catch (error: any) {
        console.error(`[${new Date().toISOString()}] [Admin] 重新載入劇本失敗:`, error.message);
        res.status(500).json({ error: "重新載入劇本失敗" });
    }
});

// 【新增】Admin 快進遊戲天數 (開發用)
app.post("/api/admin/fast-forward", async (req, res) => {
    try {
        const { targetDay } = req.body;

        if (!targetDay || targetDay < 1 || targetDay > 120) {
            return res.status(400).json({ error: "targetDay 必須介於 1-120 之間" });
        }

        // 取得當前遊戲狀態
        const gameStatus = await prisma.gameStatus.findUnique({ where: { id: 1 } });

        if (!gameStatus || !gameStatus.isGameStarted) {
            return res.status(400).json({ error: "遊戲尚未開始" });
        }

        // 計算需要調整的秒數：(targetDay - 1) * timeRatio
        const elapsedSeconds = (targetDay - 1) * gameStatus.timeRatio;

        // 計算新的 gameStartTime（往前調整）
        const newGameStartTime = new Date(Date.now() - elapsedSeconds * 1000);

        // 更新資料庫
        await prisma.gameStatus.update({
            where: { id: 1 },
            data: { gameStartTime: newGameStartTime },
        });

        console.log(`[${new Date().toISOString()}] [Admin] 快進至第 ${targetDay} 天`);
        res.json({ 
            message: `已快進至第 ${targetDay} 天`,
            newGameStartTime: newGameStartTime.toISOString(),
        });
    } catch (error: any) {
        console.error(`[${new Date().toISOString()}] [Admin] 快進遊戲失敗:`, error.message);
        res.status(500).json({ error: "快進遊戲失敗" });
    }
});

// 健康檢查 API，檢測伺服器與資料庫連線狀態
app.get("/health", async (req, res) => {
    try {
        // 嘗試執行簡單的資料庫查詢以驗證連線
        await prisma.$queryRaw`SELECT 1`;
        res.json({ 
            status: "ok", 
            env: process.env.NODE_ENV || "development",
            database: "connected"
        });
    } catch (error: any) {
        console.error("資料庫連線失敗:", error.message);
        res.status(503).json({ 
            status: "error", 
            env: process.env.NODE_ENV || "development",
            database: "disconnected",
            error: error.message
        });
    }
});

// 建立 HTTP 伺服器並整合 Socket.io
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
    cors: {
        origin: process.env.CORS_ORIGIN || "*", // 使用環境變數或允許所有來源
        methods: ["GET", "POST"],
        credentials: true,
    },
});

// 套用 Socket.io 認證中介軟體
socketAuthMiddleware(io);

// Socket.io 連線事件
io.on("connection", async (socket) => {
    const { userId, role } = socket.data;
    console.log(`[${new Date().toISOString()}] [WebSocket] 使用者 ${userId} (${role}) 已連線 (Socket ID: ${socket.id})`);

    try {
        // 取得使用者的最新資產資料
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { cash: true, stocks: true, debt: true },
        });

        if (!user) {
            console.error(`[${new Date().toISOString()}] [Sync] 使用者 ${userId} 不存在，無法同步狀態`);
            socket.disconnect(true);
            return;
        }

        // 取得遊戲狀態
        const gameState = await getGameState();

        // 取得使用者的活躍合約（當日未結算且未撤銷的合約）
        const activeContracts = await prisma.contractOrder.findMany({
            where: {
                userId,
                day: gameState.currentDay,
                isSettled: false,
                isCancelled: false,
            },
            select: {
                id: true,
                type: true,
                leverage: true,
                quantity: true,
                margin: true,
                entryPrice: true,
                day: true,
            },
        });

        // 取得當前股價（若遊戲未開始則使用初始價格）
        const currentData = getCurrentStockData(gameState.currentDay);
        const currentPrice = currentData ? currentData.price : gameState.initialPrice;

        // 取得股價歷史（若遊戲未開始則為空陣列）
        const priceHistory = getPriceHistory(gameState.currentDay);

        // 取得排行榜資料
        const leaderboard = await getLeaderboard(currentPrice);

        // 【新增】取得歷史新聞
        const newsHistory = getPastNews(gameState.currentDay);

        console.log(
            `[${new Date().toISOString()}] [Sync] 新聞歷史數量: ${newsHistory.length} 則`
        );

        // 建構 FULL_SYNC_STATE Payload
        const syncPayload: FullSyncPayload = {
            gameStatus: {
                currentDay: gameState.currentDay,
                countdown: gameState.countdown,
                isGameStarted: gameState.isGameStarted,
                totalDays: gameState.totalDays,
                maxLeverage: gameState.maxLeverage, // 新增：最大槓桿倍數
            },
            price: {
                current: currentPrice,
                history: priceHistory.map(d => ({
                    day: d.day,
                    price: d.price,
                    title: d.title,
                    news: d.news,
                    effectiveTrend: d.effectiveTrend,
                })),
            },
            personal: {
                cash: user.cash,
                stocks: user.stocks,
                debt: user.debt,
            },
            activeContracts: activeContracts, // 新增：活躍合約列表
            newsHistory: newsHistory, // 【新增】新聞歷史
            leaderboard: leaderboard,
        };

        // 推送完整狀態給該使用者
        socket.emit('FULL_SYNC_STATE', syncPayload);

        console.log(
            `[${new Date().toISOString()}] [Sync] 使用者 ${userId} 已接收完整狀態同步 (Day ${gameState.currentDay})`
        );
    } catch (error: any) {
        console.error(`[${new Date().toISOString()}] [Sync] 狀態同步失敗:`, error.message);
    }

    // 註冊交易處理器 (CRITICAL: 必須在此處呼叫)
    registerTradeHandlers(io, socket);

    // 處理斷線事件
    socket.on("disconnect", (reason) => {
        console.log(`[${new Date().toISOString()}] [WebSocket] 使用者 ${userId} 已斷線 (原因: ${reason})`);
    });
});

// 啟動前先載入劇本資料
(async () => {
    try {
        console.log(`[${new Date().toISOString()}] [Init] 正在載入劇本資料...`);
        await loadScriptData();
        console.log(`[${new Date().toISOString()}] [Init] 劇本資料載入完成`);
    } catch (error: any) {
        console.error(`[${new Date().toISOString()}] [Init] 劇本資料載入失敗:`, error.message);
        process.exit(1); // 若劇本載入失敗，停止啟動
    }

    // 啟動遊戲迴圈 (在 Socket.io 設定後)
    initializeGameLoop(io);

    const PORT = parseInt(process.env.PORT || "8000", 10);
    // 生產環境綁定 0.0.0.0，本地開發綁定 127.0.0.1
    const HOST = process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1";
    httpServer.listen(PORT, HOST, () => {
        console.log(`伺服器已啟動，監聽於 http://${HOST}:${PORT}`);
    });
})();

// 優雅關閉
async function gracefulShutdown(signal: string) {
    console.log(`接收到 ${signal}，開始優雅關閉...`);
    try {
        io.close(); // 關閉 Socket.io 伺服器
        await prisma.$disconnect();
        await pool.end();
        httpServer.close(() => {
            console.log("HTTP 伺服器已關閉");
            process.exit(0);
        });
    } catch (e) {
        console.error("關閉時發生錯誤", (e as any).message);
        process.exit(1);
    }
}

['SIGINT','SIGTERM'].forEach(sig => {
    process.on(sig, () => gracefulShutdown(sig));
});