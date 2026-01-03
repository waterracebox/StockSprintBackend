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
 * 新聞標題範本（擬真股市新聞）
 */
const NEWS_HEADLINES = [
  { title: '科技股大漲', content: '半導體產業迎來新一波成長動能，市場樂觀情緒高漲。' },
  { title: 'CEO 突然請辭', content: '公司執行長因個人因素請辭，市場震驚，股價下跌。' },
  { title: '市場崩盤警訊', content: '經濟數據不佳，投資人恐慌性拋售，股市重挫。' },
  { title: '財報超乎預期', content: '本季營收創歷史新高，獲利遠超市場預期。' },
  { title: '新產品發表', content: '公司發表革命性新產品，市場反應熱烈。' },
  { title: '政府新法規', content: '政府宣布新的產業監管政策，市場擔憂成本上升。' },
  { title: '併購傳聞', content: '市場傳出公司即將被大型企業併購，股價應聲上漲。' },
  { title: '市場傳聞', content: '據傳公司內部發生重大變革，詳情尚待確認。' },
  { title: '供應鏈危機', content: '原物料短缺影響生產，預計將衝擊下季營收。' },
  { title: '國際擴張', content: '公司宣布進軍海外市場，投資人看好長期成長。' },
];

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
      initialPrice: 200.0,
      initialCash: 50.0,
      maxLeverage: 10.0,
      dailyInterestRate: 0.0001,
      maxLoanAmount: 1000,
    },
    create: {
      id: 1,
      isGameStarted: false,
      gameStartTime: null,
      currentDay: 0,
      timeRatio: 60,
      totalDays: 120,
      initialPrice: 200.0,
      initialCash: 50.0,
      maxLeverage: 10.0,
      dailyInterestRate: 0.0001,
      maxLoanAmount: 1000,
    },
  });

  console.log(`✅ 遊戲狀態已重置: 總天數=${gameStatus.totalDays}, 初始股價=${gameStatus.initialPrice}`);

  // ==================== 步驟 2: 清空並產生 ScriptDay ====================
  console.log('🗑️  清空舊的股價資料...');
  await prisma.scriptDay.deleteMany({});

  console.log('📈 產生 120 天股價資料 (Random Walk 演算法 + 隨機新聞)...');

  // 演算法參數
  const INITIAL_PRICE = gameStatus.initialPrice;
  const TOTAL_DAYS = gameStatus.totalDays;
  const TIME_RATIO = gameStatus.timeRatio;
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

    // 【關鍵變更】隨機產生新聞發布時間偏移 (5 ~ timeRatio-5 秒)
    const publishTimeOffset = Math.floor(Math.random() * (TIME_RATIO - 10)) + 5;

    // 【關鍵變更】隨機決定是否發布新聞（20% 機率）
    const hasNews = Math.random() < 0.2;
    let title: string | null = null;
    let news: string | null = null;

    if (hasNews) {
      const randomNews = NEWS_HEADLINES[Math.floor(Math.random() * NEWS_HEADLINES.length)];
      title = randomNews.title;
      news = randomNews.content;
    }

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
  console.log(`📰 新聞產生數量: ${scriptDays.filter(d => d.title !== null).length} 則`);
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