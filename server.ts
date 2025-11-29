// server.ts
// 伺服器主程式，提供健康檢查與 Socket.io 基本設定

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
// 驗證路由
import authRoutes from "./src/routes/authRoutes.js";
// 共享資料庫連線
import { prisma, pool } from "./src/db.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// 掛載驗證路由
app.use("/api/auth", authRoutes);

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
        origin: "*", // 測試階段允許所有來源
    },
});

// Socket.io 基本連線事件（暫無邏輯）
io.on("connection", (socket) => {
    // 連線成功
    // console.log("使用者已連線", socket.id);
});

const PORT = parseInt(process.env.PORT || "8000", 10);
// 生產環境綁定 0.0.0.0，本地開發綁定 127.0.0.1
const HOST = process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1";
httpServer.listen(PORT, HOST, () => {
    console.log(`伺服器已啟動，監聽於 http://${HOST}:${PORT}`);
});

// 優雅關閉
async function gracefulShutdown(signal: string) {
    console.log(`接收到 ${signal}，開始優雅關閉...`);
    try {
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