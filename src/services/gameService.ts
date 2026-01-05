// 遊戲邏輯服務 - 管理遊戲狀態並計算當前天數

import { prisma } from '../db.js';
import type { ScriptDay } from '@prisma/client';
import type { NewsItem } from '../types/events.js';

/**
 * 遊戲狀態回傳型別
 */
export interface GameState {
  isGameStarted: boolean;
  pausedAt: Date | null;
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
 * 【新增】更新記憶體中的新聞廣播狀態
 * @param scriptId - ScriptDay 記錄的 ID
 */
export function markNewsAsBroadcasted(scriptId: number): void {
  const record = scriptData.find(d => d.id === scriptId);
  if (record) {
    record.isNewsBroadcasted = true;
    console.log(`[記憶體] ScriptDay ${scriptId} (Day ${record.day}) 新聞狀態已更新`);
  }
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
  
  // 返回歷史資料，但對於未廣播的新聞，隱藏 title 和 news
  return scriptData
    .filter(d => d.day <= currentDay)
    .map(d => ({
      ...d,
      // 若新聞尚未廣播，隱藏 title 和 news
      title: d.isNewsBroadcasted ? d.title : null,
      news: d.isNewsBroadcasted ? d.news : null,
    }));
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
      initialCash: 200.0,
      maxLeverage: 100.0,
      dailyInterestRate: 0.0001,
      maxLoanAmount: 1000,
    },
  });

  // 【修正】若遊戲未開始且沒有 pausedAt（從未啟動過），直接返回 Day 0
  if (!gameStatus.isGameStarted && !gameStatus.pausedAt && !gameStatus.gameStartTime) {
    return {
      isGameStarted: false,
      pausedAt: null,
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

  // 【修正】若遊戲暫停，使用 pausedAt 時間計算天數（凍結狀態）
  const referenceTime = gameStatus.pausedAt 
    ? gameStatus.pausedAt.getTime() 
    : Date.now();

  // 計算經過時間 (毫秒)
  const elapsedTime = referenceTime - (gameStatus.gameStartTime?.getTime() || 0);
  
  // 計算當前天數 (公式：經過秒數 / 每天秒數 + 1)
  const calculatedDay = Math.floor(elapsedTime / (gameStatus.timeRatio * 1000)) + 1;
  
  // 計算倒數秒數 (距離下一天的剩餘秒數)
  const countdown = gameStatus.timeRatio - Math.floor((elapsedTime / 1000) % gameStatus.timeRatio);

  // 動態檢查：若超過總天數，則鎖定在最後一天
  const currentDay = calculatedDay > gameStatus.totalDays ? gameStatus.totalDays : calculatedDay;
  const finalCountdown = calculatedDay > gameStatus.totalDays ? 0 : countdown;

  return {
    isGameStarted: gameStatus.isGameStarted,
    pausedAt: gameStatus.pausedAt,
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
 * 【Phase 4】重置所有使用者的行為追蹤計數器
 */
export async function startGame(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // 【Phase 4】重置所有使用者的行為追蹤計數器
    await tx.user.updateMany({
      data: {
        avatarUpdateCount: 0,
        loanSharkVisitCount: 0,
      },
    });

    // 更新遊戲狀態
    await tx.gameStatus.update({
      where: { id: 1 },
      data: {
        isGameStarted: true,
        gameStartTime: new Date(),
        pausedAt: null, // 【修正】清除暫停狀態
        currentDay: 0, // 重置天數
      },
    });

    // 【新增】重置所有新聞的廣播狀態
    await tx.scriptDay.updateMany({
      data: { isNewsBroadcasted: false },
    });
  });

  // 【新增】重新載入記憶體中的劇本資料，確保狀態一致
  await loadScriptData();

  console.log(`[${new Date().toISOString()}] [Game] 遊戲已開始（記憶體已同步，行為追蹤已重置）`);
}

/**
 * 結束遊戲（暫停）
 * 設定 isGameStarted=false 並記錄 pausedAt
 */
export async function stopGame(): Promise<void> {
  await prisma.gameStatus.update({
    where: { id: 1 },
    data: {
      isGameStarted: false,
      pausedAt: new Date(), // 【新增】記錄暫停時間
    },
  });
  console.log(`[${new Date().toISOString()}] [Game] 遊戲已暫停`);
}

/**
 * 恢復遊戲（從暫停狀態繼續）
 * 修正 gameStartTime 以補償暫停期間
 */
export async function resumeGame(): Promise<void> {
  const gameStatus = await prisma.gameStatus.findUnique({ where: { id: 1 } });

  if (!gameStatus) {
    throw new Error('遊戲狀態不存在');
  }

  if (gameStatus.isGameStarted) {
    throw new Error('遊戲已在運行中');
  }

  if (!gameStatus.pausedAt) {
    throw new Error('遊戲未處於暫停狀態');
  }

  // 計算暫停期間
  const pauseDuration = Date.now() - gameStatus.pausedAt.getTime();

  // 修正 gameStartTime（向後推移暫停時長）
  const newGameStartTime = new Date(
    (gameStatus.gameStartTime?.getTime() || 0) + pauseDuration
  );

  await prisma.gameStatus.update({
    where: { id: 1 },
    data: {
      isGameStarted: true,
      gameStartTime: newGameStartTime,
      pausedAt: null,
    },
  });

  console.log(`[${new Date().toISOString()}] [Game] 遊戲已恢復`);
}

/**
 * 重新開始遊戲（重置玩家進度但保留劇本）
 * 前提：遊戲必須處於停止狀態
 */
export async function restartGame(): Promise<void> {
  const gameStatus = await prisma.gameStatus.findUnique({ where: { id: 1 } });

  if (gameStatus?.isGameStarted) {
    throw new Error('請先停止遊戲再執行重啟');
  }

  await prisma.$transaction(async (tx) => {
    // 重置遊戲狀態
    await tx.gameStatus.update({
      where: { id: 1 },
      data: {
        currentDay: 0,
        gameStartTime: null,
        pausedAt: null,
        isGameStarted: false,
      },
    });

    // 重置所有玩家資產
    await tx.user.updateMany({
      data: {
        cash: gameStatus?.initialCash || 50,
        stocks: 0,
        debt: 0,
        dailyBorrowed: 0,
        firstSignIn: false,
      },
    });

    // 刪除所有合約
    await tx.contractOrder.deleteMany({});

    // 【新增】重置所有新聞的廣播狀態
    await tx.scriptDay.updateMany({
      data: { isNewsBroadcasted: false },
    });
  });

  // 【新增】重新載入記憶體中的劇本資料，確保狀態一致
  await loadScriptData();

  console.log(`[${new Date().toISOString()}] [Game] 遊戲已重啟（記憶體已同步）`);
}

/**
 * 重置遊戲（工廠設定，清除所有資料）
 * 前提：遊戲必須處於停止狀態
 */
export async function resetGame(currentUserId: number): Promise<void> {
  const gameStatus = await prisma.gameStatus.findUnique({ where: { id: 1 } });

  if (gameStatus?.isGameStarted) {
    throw new Error('請先停止遊戲再執行重置');
  }

  await prisma.$transaction(async (tx) => {
    // 刪除合約、劇本、事件
    await tx.contractOrder.deleteMany({});
    await tx.scriptDay.deleteMany({}); // 刪除劇本（包含新聞狀態）
    await tx.event.deleteMany({});

    // 刪除非 Admin 和非當前使用者的所有使用者
    await tx.user.deleteMany({
      where: {
        AND: [
          { role: { not: 'ADMIN' } },
          { id: { not: currentUserId } },
        ],
      },
    });

    // 重置遊戲狀態為預設值
    await tx.gameStatus.update({
      where: { id: 1 },
      data: {
        isGameStarted: false,
        gameStartTime: null,
        pausedAt: null,
        currentDay: 0,
        timeRatio: 60,
        totalDays: 120,
        initialPrice: 50.0,
        initialCash: 200.0,
        maxLeverage: 10.0,
        dailyInterestRate: 0.0001,
        maxLoanAmount: 1000,
      },
    });
  });

  console.log(`[${new Date().toISOString()}] [Game] 遊戲已重置（工廠設定）`);
}

/**
 * 更新遊戲參數
 * 當 timeRatio 改變時，重新計算 gameStartTime 以保持遊戲進度
 */
export async function updateGameParams(params: {
  timeRatio?: number;
  totalDays?: number;
  initialPrice?: number;
  initialCash?: number;
  maxLeverage?: number;
  dailyInterestRate?: number;
  maxLoanAmount?: number;
}): Promise<void> {
  const gameStatus = await prisma.gameStatus.findUnique({ where: { id: 1 } });

  if (!gameStatus) {
    throw new Error('遊戲狀態不存在');
  }

  let newGameStartTime = gameStatus.gameStartTime;

  // 【修正】若 timeRatio 改變且遊戲已啟動過，需重新計算 gameStartTime
  if (params.timeRatio && gameStatus.gameStartTime) {
    // 使用 pausedAt 或當前時間作為參考點
    const now = gameStatus.pausedAt ? gameStatus.pausedAt.getTime() : Date.now();
    const oldElapsed = now - gameStatus.gameStartTime.getTime();
    const oldRatioMs = gameStatus.timeRatio * 1000;
    
    // 計算已完成天數（不含當前天）
    const completedDays = Math.floor(oldElapsed / oldRatioMs);
    
    // 當前天已經過的秒數（passedSeconds）
    const passedMs = oldElapsed % oldRatioMs;
    const passedSeconds = Math.floor(passedMs / 1000);
    
    // 當前天剩餘秒數
    const oldRemainingSeconds = gameStatus.timeRatio - passedSeconds;
    
    const newRatio = params.timeRatio;
    let newRemainingSeconds;

    // 【新邏輯】根據新舊比例決定剩餘秒數
    if (newRatio < oldRemainingSeconds) {
      // Case A: 新週期比剩餘秒數還短，設為 newRatio - 1（即將換日）
      newRemainingSeconds = newRatio - 1;
    } else {
      // Case B: 新週期足夠容納剩餘秒數，保持不變
      newRemainingSeconds = oldRemainingSeconds;
    }

    // 反推 newPassedSeconds
    const newPassedSeconds = newRatio - newRemainingSeconds;
    
    // 重新計算 newElapsed（毫秒）
    const newElapsed = completedDays * newRatio * 1000 + newPassedSeconds * 1000;
    
    // 反推 newGameStartTime
    newGameStartTime = new Date(now - newElapsed);

    console.log(`[${new Date().toISOString()}] [Param] timeRatio 更新: ${gameStatus.timeRatio}s → ${newRatio}s`);
    console.log(`[${new Date().toISOString()}] [Param] 當前天數: Day ${completedDays + 1}, 剩餘: ${oldRemainingSeconds}s → ${newRemainingSeconds}s`);
  }

  await prisma.gameStatus.update({
    where: { id: 1 },
    data: {
      ...params,
      gameStartTime: newGameStartTime,
    },
  });

  console.log(`[${new Date().toISOString()}] [Game] 遊戲參數已更新`);
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
 * 【修正】僅返回已廣播的新聞
 */
export function getPastNews(currentDay: number): NewsItem[] {
  // 篩選出有新聞且已廣播的天數
  const newsData = scriptData.filter(d => 
    d.day <= currentDay && 
    d.title !== null && 
    d.isNewsBroadcasted === true  // 【新增】僅返回已廣播的新聞
  );

  // 轉換格式並返回
  return newsData.map(d => ({
    day: d.day,
    title: d.title!,
    content: d.news || '', // 若 news 為 null，回傳空字串
  }));
}
