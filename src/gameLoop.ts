// 遊戲主迴圈 - 每秒執行一次 Tick，廣播遊戲狀態

import { Server } from 'socket.io';
import { getGameState } from './services/gameService.js';

/**
 * 初始化遊戲迴圈
 * 每 1 秒執行一次 tick() 並廣播遊戲狀態
 */
export function initializeGameLoop(io: Server): void {
  console.log(`[${new Date().toISOString()}] [GameLoop] 遊戲迴圈已啟動`);

  setInterval(async () => {
    await tick(io);
  }, 1000); // 每 1 秒執行一次
}

/**
 * 遊戲迴圈的核心邏輯
 * 取得遊戲狀態並廣播給所有連線的客戶端
 */
async function tick(io: Server): Promise<void> {
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
  } catch (error: any) {
    console.error(
      `[${new Date().toISOString()}] [Tick] 遊戲迴圈錯誤:`,
      error.message
    );
  }
}