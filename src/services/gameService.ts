// 遊戲邏輯服務 - 管理遊戲狀態並計算當前天數

import { prisma } from '../db.js';

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