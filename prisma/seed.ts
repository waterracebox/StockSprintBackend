// Prisma Seed Script - 重置遊戲狀態並產生 120 天股價資料

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import dotenv from 'dotenv';

// 載入環境變數
dotenv.config();

// 建立 PostgreSQL 連線池（加入 SSL 設定）
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // Render 需要此設定
  },
});

// 建立 Prisma Adapter
const adapter = new PrismaPg(pool);

// 建立 PrismaClient 實例
const prisma = new PrismaClient({ adapter });

/**
 * 主要 Seed 函式
 * 1. 重置 GameStatus (ID=1)
 * 2. 清空並重新產生 120 天 ScriptDay 資料
 */
async function main() {
  console.log('🌱 開始資料庫初始化...');

  // ==================== 步驟 1: 重置 GameStatus ====================
  console.log('📊 重置遊戲狀態 (GameStatus)...');

  const gameStatus = await prisma.gameStatus.upsert({
    where: { id: 1 },
    update: {
      isGameStarted: false,
      gameStartTime: null,
      currentDay: 0,
      timeRatio: 60,
      totalDays: 120,
      initialPrice: 50.0,
      initialCash: 50.0,
    },
    create: {
      id: 1,
      isGameStarted: false,
      gameStartTime: null,
      currentDay: 0,
      timeRatio: 60,
      totalDays: 120,
      initialPrice: 50.0,
      initialCash: 50.0,
    },
  });

  console.log(`✅ 遊戲狀態已重置: 總天數=${gameStatus.totalDays}, 初始股價=${gameStatus.initialPrice}`);

  // ==================== 步驟 2: 清空並產生 ScriptDay ====================
  console.log('🗑️  清空舊的股價資料...');
  await prisma.scriptDay.deleteMany({});

  console.log('📈 產生 120 天股價資料 (Random Walk 演算法)...');

  // 演算法參數
  const INITIAL_PRICE = gameStatus.initialPrice;
  const TOTAL_DAYS = gameStatus.totalDays;
  const VOLATILITY = 2.0; // 每日波動幅度
  const MIN_PRICE = 1.0; // 最低價格限制

  let currentPrice = INITIAL_PRICE;
  const scriptDays = [];

  for (let day = 1; day <= TOTAL_DAYS; day++) {
    // 隨機波動 (Random Walk)
    const change = (Math.random() - 0.5) * VOLATILITY;
    currentPrice += change;

    // 限制最低價格
    if (currentPrice < MIN_PRICE) {
      currentPrice = MIN_PRICE;
    }

    // 四捨五入至小數點後 2 位
    currentPrice = parseFloat(currentPrice.toFixed(2));

    // 隨機產生新聞發布時間偏移 (5~55 秒)
    const publishTimeOffset = Math.floor(Math.random() * 51) + 5;

    // 每 10 天產生一則系統新聞
    const title = day % 10 === 0 ? '系統新聞' : null;
    const news = day % 10 === 0 ? `第 ${day} 天的系統資訊` : null;

    scriptDays.push({
      day,
      price: currentPrice,
      title,
      news,
      effectiveTrend: 'PAN_ZHENG', // 預設為盤整
      publishTimeOffset,
    });
  }

  // 批次寫入資料庫
  await prisma.scriptDay.createMany({
    data: scriptDays,
  });

  console.log(`✅ 已成功產生 ${scriptDays.length} 天的股價資料`);
  console.log(`📊 價格範圍: ${Math.min(...scriptDays.map(d => d.price)).toFixed(2)} ~ ${Math.max(...scriptDays.map(d => d.price)).toFixed(2)}`);
  console.log('🎉 資料庫初始化完成！');
}

// 執行 Seed 並處理錯誤
main()
  .catch((error) => {
    console.error('❌ Seed 執行失敗:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end(); // 關閉連線池
  });