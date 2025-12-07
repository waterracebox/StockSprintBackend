// 資料庫連線配置 - 使用 Prisma 7 的 Adapter 模式
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import dotenv from "dotenv";

// 載入環境變數
dotenv.config();

// 建立 PostgreSQL 連線池（生產環境需要 SSL）
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

// 建立 Prisma Adapter
const adapter = new PrismaPg(pool);

// 建立並匯出共享的 PrismaClient 實例
export const prisma = new PrismaClient({ adapter });

// 匯出連線池供伺服器關閉時使用
export { pool };
