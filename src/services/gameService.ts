// 遊戲邏輯服務 - 管理遊戲狀態並計算當前天數

import { prisma } from '../db.js';
import type { ScriptDay } from '@prisma/client';
import type { NewsItem } from '../types/events.js';

/**
 * 遊戲狀態回傳型別
 */
export interface GameState {
  isGameStarted: boolean;
  currentDay: number;
  countdown: number; // 距離下一天的秒數
  totalDays: number;
  timeRatio: number;
  initialPrice: number;
  initialCash: number;
  maxLeverage: number;
  dailyInterestRate: number; // 【新增】日利率
  maxLoanAmount: number;     // 【新增】每日最高借款額度
}

/**
 * 劇本資料快取（記憶體中）
 * 避免每次 Tick 都查詢資料庫
 */
let scriptData: ScriptDay[] = [];

/**
 * 載入劇本資料到記憶體
 * 應在伺服器啟動時呼叫一次
 */
export async function loadScriptData(): Promise<void> {
  try {
    scriptData = await prisma.scriptDay.findMany({
      orderBy: { day: 'asc' },
    });
    console.log(`[${new Date().toISOString()}] [Script] 劇本資料已載入: ${scriptData.length} 筆記錄`);
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] [Script] 載入劇本資料失敗:`, error.message);
    throw error;
  }
}

/**
 * 取得指定天數的劇本資料
 * @param day - 遊戲天數（0 表示遊戲未開始，1~120 為正常範圍）
 * @returns 該天的劇本資料（包含股價、新聞等）
 */
export function getCurrentStockData(day: number): ScriptDay | null {
  // Day 0: 遊戲未開始，返回初始價格（需從 GameStatus 取得）
  if (day === 0) {
    return null; // 呼叫方需自行處理 initialPrice
  }

  // Day 1~120: 正常範圍
  const data = scriptData.find(d => d.day === day);
  if (data) {
    return data;
  }

  // Day > 120: 遊戲已結束，返回最後一天的資料
  if (day > scriptData.length) {
    return scriptData[scriptData.length - 1] || null;
  }

  return null;
}

/**
 * 取得股價歷史資料（從 Day 1 到當前天）
 * @param currentDay - 當前遊戲天數
 * @returns 歷史股價陣列（依天數排序）
 */
export function getPriceHistory(currentDay: number): ScriptDay[] {
  if (currentDay <= 0) {
    return []; // 遊戲未開始，無歷史資料
  }
  return scriptData.filter(d => d.day <= currentDay);
}

/**
 * 取得遊戲狀態 (Source of Truth)
 * 使用 upsert 確保 ID=1 永遠存在
 */
export async function getGameState(): Promise<GameState> {
  // 確保 GameStatus 表中永遠只有一筆 ID=1 的資料
  const gameStatus = await prisma.gameStatus.upsert({
    where: { id: 1 },
    update: {}, // 不更新，僅讀取
    create: {
      id: 1,
      isGameStarted: false,
      currentDay: 0,
      timeRatio: 60,
      totalDays: 120,
      initialPrice: 50.0,
      initialCash: 50.0,
      maxLeverage: 100.0,
      dailyInterestRate: 0.0001,
      maxLoanAmount: 1000,
    },
  });

  // 若遊戲未開始，直接返回 Day 0
  if (!gameStatus.isGameStarted || !gameStatus.gameStartTime) {
    return {
      isGameStarted: false,
      currentDay: 0,
      countdown: 0,
      totalDays: gameStatus.totalDays,
      timeRatio: gameStatus.timeRatio,
      initialPrice: gameStatus.initialPrice,
      initialCash: gameStatus.initialCash,
      maxLeverage: gameStatus.maxLeverage,
      dailyInterestRate: gameStatus.dailyInterestRate,
      maxLoanAmount: gameStatus.maxLoanAmount,
    };
  }

  // 計算經過時間 (毫秒)
  const elapsedTime = Date.now() - gameStatus.gameStartTime.getTime();
  
  // 計算當前天數 (公式：經過秒數 / 每天秒數 + 1)
  const calculatedDay = Math.floor(elapsedTime / (gameStatus.timeRatio * 1000)) + 1;
  
  // 計算倒數秒數 (距離下一天的剩餘秒數)
  const countdown = gameStatus.timeRatio - Math.floor((elapsedTime / 1000) % gameStatus.timeRatio);

  // 動態檢查：若超過總天數，則鎖定在最後一天
  const currentDay = calculatedDay > gameStatus.totalDays ? gameStatus.totalDays : calculatedDay;
  const finalCountdown = calculatedDay > gameStatus.totalDays ? 0 : countdown;

  return {
    isGameStarted: true,
    currentDay,
    countdown: finalCountdown,
    totalDays: gameStatus.totalDays,
    timeRatio: gameStatus.timeRatio,
    initialPrice: gameStatus.initialPrice,
    initialCash: gameStatus.initialCash,
    maxLeverage: gameStatus.maxLeverage,
    dailyInterestRate: gameStatus.dailyInterestRate,
    maxLoanAmount: gameStatus.maxLoanAmount,
  };
}

/**
 * 開始遊戲
 * 設定 isGameStarted=true 並記錄遊戲開始時間
 */
export async function startGame(): Promise<void> {
  await prisma.gameStatus.update({
    where: { id: 1 },
    data: {
      isGameStarted: true,
      gameStartTime: new Date(),
      currentDay: 0, // 重置天數
    },
  });
  console.log(`[${new Date().toISOString()}] [Game] 遊戲已開始`);
}

/**
 * 結束遊戲
 * 設定 isGameStarted=false
 */
export async function stopGame(): Promise<void> {
  await prisma.gameStatus.update({
    where: { id: 1 },
    data: {
      isGameStarted: false,
    },
  });
  console.log(`[${new Date().toISOString()}] [Game] 遊戲已結束`);
}

/**
 * 取得排行榜資料
 * @param currentPrice - 當前股價（用於計算股票現值）
 * @returns 排行榜陣列（前 100 名，依總資產降冪排序）
 */
export async function getLeaderboard(currentPrice: number): Promise<Array<{
  userId: number;
  displayName: string;
  avatar: string | null;
  totalAssets: number;
  rank: number;
}>> {
  try {
    // 取得當前遊戲天數
    const gameState = await getGameState();
    
    // 僅查詢必要欄位，避免拉取密碼等敏感資料
    const users = await prisma.user.findMany({
      select: {
        id: true,
        displayName: true,
        avatar: true,
        cash: true,
        stocks: true,
        debt: true,
      },
    });

    // 查詢所有用戶的活躍合約保證金
    const activeContracts = await prisma.contractOrder.findMany({
      where: {
        day: gameState.currentDay,
        isSettled: false,
        isCancelled: false,
      },
      select: {
        userId: true,
        margin: true,
      },
    });

    // 計算每個用戶的總保證金
    const userMargins = new Map<number, number>();
    activeContracts.forEach(contract => {
      const current = userMargins.get(contract.userId) || 0;
      userMargins.set(contract.userId, current + contract.margin);
    });

    // 計算每位使用者的總資產（現金 + 股票現值 + 合約保證金 - 負債）
    const leaderboard = users.map((user) => {
      const contractMargin = userMargins.get(user.id) || 0;
      return {
        userId: user.id,
        displayName: user.displayName,
        avatar: user.avatar,
        totalAssets: user.cash + (user.stocks * currentPrice) + contractMargin - user.debt,
        rank: 0,
      };
    });

    // 按總資產降冪排序
    leaderboard.sort((a, b) => b.totalAssets - a.totalAssets);

    // 賦予排名（index + 1）
    leaderboard.forEach((item, index) => {
      item.rank = index + 1;
    });

    // 返回前 100 名（可選限制）
    return leaderboard.slice(0, 100);
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] [Leaderboard] 取得排行榜失敗:`, error.message);
    return []; // 發生錯誤時返回空陣列
  }
}

/**
 * 【新增】取得歷史新聞資料（從 Day 1 到當前天）
 * @param currentDay - 當前遊戲天數
 * @returns 歷史新聞陣列（依天數排序，僅包含有新聞的日子）
 */
export function getPastNews(currentDay: number): NewsItem[] {
  // 篩選出有新聞的天數（title 不為 null）
  const newsData = scriptData.filter(d => d.day <= currentDay && d.title !== null);

  // 轉換格式並返回
  return newsData.map(d => ({
    day: d.day,
    title: d.title!,
    content: d.news || '', // 若 news 為 null，回傳空字串
  }));
}
