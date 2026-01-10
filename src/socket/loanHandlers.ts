// socket/loanHandlers.ts
// 地下錢莊：借款與還款的 WebSocket 事件處理器

import { Server, Socket } from 'socket.io';
import { prisma } from '../db.js';
import { getGameState } from '../services/gameService.js';
import type { TradeResponse, TradeError } from '../types/events.js';

/**
 * 註冊地下錢莊相關的 WebSocket 事件監聽器
 * @param io - Socket.io Server 實例
 * @param socket - 客戶端連線
 */
export function registerLoanHandlers(io: Server, socket: Socket): void {
  const { userId } = socket.data;

  const isPositiveAmount = (amount: number) => Number.isFinite(amount) && amount > 0;
  const roundToCents = (amount: number) => Math.round(amount * 100) / 100;

  /**
   * 【Phase 4】追蹤地下錢莊訪問次數
   * 前端開啟 Modal 或點擊頭像時觸發此事件
   */
  socket.on('VISIT_LOAN_SHARK', async () => {
    try {
      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { loanSharkVisitCount: { increment: 1 } },
        select: { loanSharkVisitCount: true },
      });

      console.log(
        `[${new Date().toISOString()}] [LoanShark] 使用者 ${userId} 訪問地下錢莊，累計 ${updatedUser.loanSharkVisitCount} 次`
      );

      // 【新增】立即推送更新後的訪問次數給前端
      socket.emit('LOAN_SHARK_VISIT_UPDATE', {
        loanSharkVisitCount: updatedUser.loanSharkVisitCount,
      });
    } catch (error: any) {
      console.error(
        `[${new Date().toISOString()}] [LoanShark] 追蹤訪問失敗:`,
        error.message
      );
    }
  });

  /**
   * 借款事件
   * Payload: { amount: number }
   */
  socket.on('BORROW_MONEY', async (payload: { amount: number }) => {
    try {
      console.log(`[${new Date().toISOString()}] [Loan] 使用者 ${userId} 借款請求: $${payload.amount}`);

      // 1. 驗證請求參數（允許小數，取到小數點後兩位）
      if (!isPositiveAmount(payload.amount)) {
        const error: TradeError = { message: '借款金額必須大於 0' };
        socket.emit('TRADE_ERROR', error);
        return;
      }

      const normalizedAmount = roundToCents(payload.amount);

      // 2. 【新增】檢查遊戲狀態
      const gameState = await getGameState();
      if (!gameState.isGameStarted) {
        const error: TradeError = { message: '遊戲未開始，無法借款' };
        socket.emit('TRADE_ERROR', error);
        return;
      }

      // 3. 使用 Transaction 確保原子性
      const result = await prisma.$transaction(async (tx) => {
        // 查詢使用者資料
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { cash: true, debt: true, dailyBorrowed: true },
        });

        if (!user) {
          throw new Error('使用者不存在');
        }

        // 檢查每日額度
        if (user.dailyBorrowed + normalizedAmount > gameState.maxLoanAmount) {
          throw new Error(`今日借款額度不足 (已借 ${user.dailyBorrowed} / ${gameState.maxLoanAmount})`);
        }

        // 更新使用者資產
        const updatedUser = await tx.user.update({
          where: { id: userId },
          data: {
            cash: { increment: normalizedAmount },
            debt: { increment: normalizedAmount },
            dailyBorrowed: { increment: normalizedAmount },
          },
          select: { cash: true, debt: true, dailyBorrowed: true },
        });

        return updatedUser;
      });

      // 4. 回傳成功訊息
      const response: TradeResponse = {
        action: 'BORROW',
        price: 0, // 不涉及股價
        amount: normalizedAmount,
        newCash: result.cash,
        newDebt: result.debt,
        dailyBorrowed: result.dailyBorrowed, // 【新增】當日已借金額
      };

      socket.emit('TRADE_SUCCESS', response);

      console.log(
        `[${new Date().toISOString()}] [Loan] 使用者 ${userId} 成功借款 $${normalizedAmount}，當日已借 ${result.dailyBorrowed}`
      );
    } catch (error: any) {
      const errorResponse: TradeError = { message: error.message || '借款失敗' };
      socket.emit('TRADE_ERROR', errorResponse);

      console.error(
        `[${new Date().toISOString()}] [Loan] 使用者 ${userId} 借款失敗:`,
        error.message
      );
    }
  });

  /**
   * 還款事件
   * Payload: { amount: number }
   */
  socket.on('REPAY_MONEY', async (payload: { amount: number }) => {
    try {
      console.log(`[${new Date().toISOString()}] [Loan] 使用者 ${userId} 還款請求: $${payload.amount}`);

      // 1. 驗證請求參數（允許小數，取到小數點後兩位）
      if (!isPositiveAmount(payload.amount)) {
        const error: TradeError = { message: '還款金額必須大於 0' };
        socket.emit('TRADE_ERROR', error);
        return;
      }

      const normalizedAmount = roundToCents(payload.amount);

      // 2. 【新增】檢查遊戲狀態
      const gameState = await getGameState();
      if (!gameState.isGameStarted) {
        const error: TradeError = { message: '遊戲未開始，無法還款' };
        socket.emit('TRADE_ERROR', error);
        return;
      }

      // 3. 使用 Transaction 確保原子性
      const result = await prisma.$transaction(async (tx) => {
        // 查詢使用者資料
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { cash: true, debt: true },
        });

        if (!user) {
          throw new Error('使用者不存在');
        }

        // 檢查現金是否足夠
        if (user.cash < normalizedAmount) {
          throw new Error('現金不足');
        }

        // 計算實際還款金額（不超過負債總額）
        const actualRepayAmount = Math.min(normalizedAmount, user.debt);

        // 更新使用者資產
        const updatedUser = await tx.user.update({
          where: { id: userId },
          data: {
            cash: { decrement: actualRepayAmount },
            debt: { decrement: actualRepayAmount },
          },
          select: { cash: true, debt: true },
        });

        return { ...updatedUser, actualRepayAmount };
      });

      // 3. 回傳成功訊息（使用實際還款金額）
      const response: TradeResponse = {
        action: 'REPAY',
        price: 0, // 不涉及股價
        amount: result.actualRepayAmount,
        newCash: result.cash,
        newDebt: result.debt,
      };

      socket.emit('TRADE_SUCCESS', response);

      console.log(
        `[${new Date().toISOString()}] [Loan] 使用者 ${userId} 成功還款 $${result.actualRepayAmount} (請求金額: $${payload.amount})`
      );
    } catch (error: any) {
      const errorResponse: TradeError = { message: error.message || '還款失敗' };
      socket.emit('TRADE_ERROR', errorResponse);

      console.error(
        `[${new Date().toISOString()}] [Loan] 使用者 ${userId} 還款失敗:`,
        error.message
      );
    }
  });
}
