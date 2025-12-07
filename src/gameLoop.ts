// 遊戲主迴圈 - 每秒執行一次 Tick，廣播遊戲狀態與股價更新

import { Server } from 'socket.io';
import { getGameState, getCurrentStockData, getPriceHistory } from './services/gameService.js';
import type { PriceUpdatePayload } from './types/events.js';

/**
 * 初始化遊戲迴圈
 * 每 1 秒執行一次 tick() 並廣播遊戲狀態
 */
export function initializeGameLoop(io: Server): void {
  console.log(`[${new Date().toISOString()}] [GameLoop] 遊戲迴圈已啟動`);

  // 追蹤上一次的遊戲天數，用於偵測「換日」事件
  let previousDay = -1;
  let wasGameStarted = false; // 追蹤上一次的遊戲狀態

  setInterval(async () => {
    const gameState = await getGameState();
    
    // 偵測遊戲重新啟動：從 false → true
    if (!wasGameStarted && gameState.isGameStarted) {
      console.log(`[${new Date().toISOString()}] [GameLoop] 遊戲已重新啟動，重置 previousDay`);
      previousDay = -1; // 重置為 -1，讓 Day 1 能正常觸發 PRICE_UPDATE
    }
    
    wasGameStarted = gameState.isGameStarted;
    
    await tick(io, previousDay, (newDay) => {
      previousDay = newDay; // 更新 previousDay
    });
  }, 1000); // 每 1 秒執行一次
}

/**
 * 遊戲迴圈的核心邏輯
 * 取得當前遊戲狀態並廣播給所有連線的客戶端
 */
async function tick(io: Server, previousDay: number, updatePreviousDay: (newDay: number) => void): Promise<void> {
  try {
    // 取得當前遊戲狀態 (Source of Truth)
    const gameState = await getGameState();

    // 結構化日誌 (CRITICAL: 用於除錯時序問題)
    console.log(
      `[${new Date().toISOString()}] [Tick] Day ${gameState.currentDay} - Countdown: ${gameState.countdown}s`
    );

    // 廣播遊戲狀態給所有客戶端
    io.emit('GAME_STATE_UPDATE', {
      currentDay: gameState.currentDay,
      isGameStarted: gameState.isGameStarted,
      countdown: gameState.countdown,
      totalDays: gameState.totalDays,
    });

    // 檢查是否發生「換日」事件
    if (gameState.isGameStarted && gameState.currentDay > previousDay) {
      console.log(
        `[${new Date().toISOString()}] [DayChange] 偵測到換日: Day ${previousDay} -> Day ${gameState.currentDay}`
      );

      // 更新追蹤變數
      updatePreviousDay(gameState.currentDay);

      // 取得當前天數的股價資料
      const currentData = getCurrentStockData(gameState.currentDay);
      
      // 取得歷史股價資料（從 Day 1 到當前天）
      const history = getPriceHistory(gameState.currentDay);

      // 處理 Day 0（遊戲未開始）的情況
      const currentPrice = currentData ? currentData.price : gameState.initialPrice;

      // 建構 Payload
      const pricePayload: PriceUpdatePayload = {
        day: gameState.currentDay,
        price: currentPrice,
        history: history.map(d => ({
          day: d.day,
          price: d.price,
          title: d.title,
          news: d.news,
          effectiveTrend: d.effectiveTrend,
        })),
      };

      // 廣播股價更新給所有客戶端
      io.emit('PRICE_UPDATE', pricePayload);

      console.log(
        `[${new Date().toISOString()}] [Price] Day ${gameState.currentDay} 股價已廣播: $${currentPrice.toFixed(2)}`
      );
    }
  } catch (error: any) {
    console.error(
      `[${new Date().toISOString()}] [Tick] 遊戲迴圈錯誤:`,
      error.message
    );
  }
}