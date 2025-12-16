// 遊戲主迴圈 - 每秒執行一次 Tick，廣播遊戲狀態與股價更新

import { Server } from 'socket.io';
import { prisma } from './db.js';
import { getGameState, getCurrentStockData, getPriceHistory, getLeaderboard } from './services/gameService.js';
import type { PriceUpdatePayload, LeaderboardUpdatePayload, NewsUpdatePayload } from './types/events.js';

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
      maxLeverage: gameState.maxLeverage, // 新增：最大槓桿倍數
    });

    // ==================== 【新增】檢查新聞發布時機 ====================
    if (gameState.isGameStarted && gameState.currentDay > 0) {
      const currentData = getCurrentStockData(gameState.currentDay);
      
      if (currentData && currentData.title && currentData.publishTimeOffset !== null) {
        // 計算當日經過的秒數
        const gameStatusRecord = await prisma.gameStatus.findUnique({ where: { id: 1 } });
        if (gameStatusRecord && gameStatusRecord.gameStartTime) {
          const elapsedTime = Date.now() - gameStatusRecord.gameStartTime.getTime();
          const currentSecondInDay = Math.floor((elapsedTime / 1000) % gameState.timeRatio);

          // 若當前秒數等於新聞發布時間偏移量，則廣播新聞
          if (currentSecondInDay === currentData.publishTimeOffset) {
            const newsPayload: NewsUpdatePayload = {
              day: currentData.day,
              title: currentData.title,
              content: currentData.news || '',
            };

            io.emit('NEWS_UPDATE', newsPayload);

            console.log(
              `[${new Date().toISOString()}] [News] Day ${currentData.day} 新聞已廣播: ${currentData.title}`
            );
          }
        }
      }
    }

    // 檢查是否發生「換日」事件
    if (gameState.isGameStarted && gameState.currentDay > previousDay) {
      console.log(
        `[${new Date().toISOString()}] [DayChange] 偵測到換日: Day ${previousDay} -> Day ${gameState.currentDay}`
      );

      // 更新追蹤變數
      updatePreviousDay(gameState.currentDay);

      // ==================== 【新增】利息計算 & 每日額度重置 ====================
      await applyDailyInterest(gameState.dailyInterestRate);
      await resetDailyBorrowedLimit();

      // ==================== 合約結算（CRITICAL: 必須在 PRICE_UPDATE 前執行）====================
      await settleContracts(gameState.currentDay, io);

      // ==================== 廣播股價更新 ====================
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

      // ==================== 廣播排行榜更新 ====================
      const leaderboard = await getLeaderboard(currentPrice);
      const leaderboardPayload: LeaderboardUpdatePayload = {
        data: leaderboard,
      };

      io.emit('LEADERBOARD_UPDATE', leaderboardPayload);

      console.log(
        `[${new Date().toISOString()}] [Leaderboard] 排行榜已廣播，共 ${leaderboard.length} 名玩家`
      );

      // ==================== 【新增】廣播資產更新給所有連線用戶 ====================
      await broadcastAssetsUpdate(io);
    }
  } catch (error: any) {
    console.error(
      `[${new Date().toISOString()}] [Tick] 遊戲迴圈錯誤:`,
      error.message
    );
  }
}
/**
 * 【新增】每日利息計算 (複利)
 * 公式: newDebt = oldDebt * (1 + dailyInterestRate)
 * @param dailyInterestRate - 日利率
 */
async function applyDailyInterest(dailyInterestRate: number): Promise<void> {
  try {
    console.log(`[${new Date().toISOString()}] [Interest] 開始計算每日利息 (利率: ${(dailyInterestRate * 100).toFixed(4)}%)`);

    // 查詢所有有負債的使用者
    const usersWithDebt = await prisma.user.findMany({
      where: { debt: { gt: 0 } },
      select: { id: true, displayName: true, debt: true },
    });

    if (usersWithDebt.length === 0) {
      console.log(`[${new Date().toISOString()}] [Interest] 無使用者有負債，跳過利息計算`);
      return;
    }

    // 批次更新負債
    const updates = usersWithDebt.map(async (user) => {
      const newDebt = user.debt * (1 + dailyInterestRate);
      await prisma.user.update({
        where: { id: user.id },
        data: { debt: newDebt },
      });

      console.log(
        `[${new Date().toISOString()}] [Interest] 使用者 ${user.displayName} (${user.id}): ` +
        `負債 $${user.debt.toFixed(2)} → $${newDebt.toFixed(2)} (利息 +$${(newDebt - user.debt).toFixed(2)})`
      );
    });

    await Promise.all(updates);

    console.log(`[${new Date().toISOString()}] [Interest] 利息計算完成，共更新 ${usersWithDebt.length} 位使用者`);
  } catch (error: any) {
    console.error(
      `[${new Date().toISOString()}] [Interest] 利息計算錯誤:`,
      error.message
    );
  }
}

/**
 * 【新增】每日額度重置
 * 將所有使用者的 dailyBorrowed 重置為 0
 */
async function resetDailyBorrowedLimit(): Promise<void> {
  try {
    console.log(`[${new Date().toISOString()}] [Limit] 開始重置每日借款額度`);

    await prisma.user.updateMany({
      data: { dailyBorrowed: 0 },
    });

    console.log(`[${new Date().toISOString()}] [Limit] 每日借款額度已重置`);
  } catch (error: any) {
    console.error(
      `[${new Date().toISOString()}] [Limit] 重置額度錯誤:`,
      error.message
    );
  }
}

/**
 * 【新增】廣播資產更新給所有連線用戶
 * 在換日後通知每個用戶其最新的資產狀態（特別是負債）
 */
async function broadcastAssetsUpdate(io: Server): Promise<void> {
  try {
    console.log(`[${new Date().toISOString()}] [AssetsUpdate] 開始廣播資產更新`);

    // 獲取所有連線的 socket
    const sockets = await io.fetchSockets();

    for (const socket of sockets) {
      const userId = (socket.data as any).userId;
      
      if (!userId) continue;

      // 查詢該用戶的最新資產
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { cash: true, stocks: true, debt: true, dailyBorrowed: true },
      });

      if (user) {
        // 向該用戶推送資產更新
        socket.emit('ASSETS_UPDATE', {
          cash: user.cash,
          stocks: user.stocks,
          debt: user.debt,
          dailyBorrowed: user.dailyBorrowed,
        });
      }
    }

    console.log(`[${new Date().toISOString()}] [AssetsUpdate] 資產更新已廣播給 ${sockets.length} 位用戶`);
  } catch (error: any) {
    console.error(
      `[${new Date().toISOString()}] [AssetsUpdate] 廣播資產更新錯誤:`,
      error.message
    );
  }
}
/**
 * 合約結算函式（換日時觸發）
 * @param newDay - 新的遊戲天數
 * @param io - Socket.io Server 實例（用於推送結算結果）
 */
async function settleContracts(newDay: number, io: Server): Promise<void> {
  try {
    console.log(`[${new Date().toISOString()}] [Settlement] 開始結算 Day ${newDay - 1} 的合約`);

    // 1. 取得新一天的股價
    const currentData = getCurrentStockData(newDay);
    if (!currentData) {
      console.warn(`[${new Date().toISOString()}] [Settlement] Day ${newDay} 無股價資料，跳過結算`);
      return;
    }
    const newPrice = currentData.price;

    // 2. 查詢昨日所有未結算且未撤銷的合約
    const pendingOrders = await prisma.contractOrder.findMany({
      where: {
        day: newDay - 1,
        isSettled: false,
        isCancelled: false,
      },
      include: {
        user: {
          select: { id: true, displayName: true },
        },
      },
    });

    if (pendingOrders.length === 0) {
      console.log(`[${new Date().toISOString()}] [Settlement] 無待結算合約`);
      return;
    }

    console.log(`[${new Date().toISOString()}] [Settlement] 找到 ${pendingOrders.length} 筆待結算合約`);

    // 3. 批次結算（使用 Transaction 確保一致性）
    const settlementResults: Array<{
      userId: number;
      displayName: string;
      type: string;
      quantity: number;
      entryPrice: number;
      exitPrice: number;
      pnl: number;
      payout: number;
      newCash: number;
      newDebt: number;
    }> = [];

    for (const order of pendingOrders) {
      try {
        const result = await prisma.$transaction(async (tx) => {
          // 計算損益
          const pnlPerStock =
            order.type === 'LONG'
              ? newPrice - order.entryPrice
              : order.entryPrice - newPrice;

          const totalPnL = pnlPerStock * order.quantity;
          const payout = order.margin + totalPnL;

          let updatedUser;

          if (payout >= 0) {
            // Case 1: 使用者獲利或虧損小於保證金 -> 返還資金
            updatedUser = await tx.user.update({
              where: { id: order.userId },
              data: { cash: { increment: payout } },
              select: { cash: true, debt: true },
            });
          } else {
            // Case 2: 虧損超過保證金 -> 轉為負債
            const debtAmount = Math.abs(payout);
            updatedUser = await tx.user.update({
              where: { id: order.userId },
              data: { debt: { increment: debtAmount } },
              select: { cash: true, debt: true },
            });
          }

          // 標記訂單為已結算
          await tx.contractOrder.update({
            where: { id: order.id },
            data: { isSettled: true },
          });

          return {
            userId: order.userId,
            displayName: order.user.displayName,
            type: order.type,
            quantity: order.quantity,
            entryPrice: order.entryPrice,
            exitPrice: newPrice,
            pnl: totalPnL,
            payout,
            newCash: updatedUser.cash,
            newDebt: updatedUser.debt,
          };
        });

        settlementResults.push(result);

        console.log(
          `[${new Date().toISOString()}] [Settlement] 使用者 ${result.displayName} (${result.userId}): ` +
          `${result.type} ${result.quantity} 張 @ ${result.entryPrice.toFixed(2)} -> ${result.exitPrice.toFixed(2)}, ` +
          `損益: ${result.pnl >= 0 ? '+' : ''}${result.pnl.toFixed(2)}, 返還: ${result.payout.toFixed(2)}`
        );

        // 推送結算結果給該使用者（若在線）
        io.sockets.sockets.forEach((userSocket) => {
          if (userSocket.data.userId === order.userId) {
            userSocket.emit('CONTRACT_SETTLED', {
              type: result.type,
              quantity: result.quantity,
              entryPrice: result.entryPrice,
              exitPrice: result.exitPrice,
              pnl: result.pnl,
              newCash: result.newCash,
              newDebt: result.newDebt,
            });
          }
        });

      } catch (error: any) {
        console.error(
          `[${new Date().toISOString()}] [Settlement] 結算訂單 ${order.id} 失敗:`,
          error.message
        );
      }
    }

    console.log(`[${new Date().toISOString()}] [Settlement] 結算完成，共處理 ${settlementResults.length} 筆`);

  } catch (error: any) {
    console.error(
      `[${new Date().toISOString()}] [Settlement] 合約結算錯誤:`,
      error.message
    );
  }
}