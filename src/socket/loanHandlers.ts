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

  /**
   * 借款事件
   * Payload: { amount: number }
   */
  socket.on('BORROW_MONEY', async (payload: { amount: number }) => {
    try {
      console.log(`[${new Date().toISOString()}] [Loan] 使用者 ${userId} 借款請求: $${payload.amount}`);

      // 1. 驗證請求參數
      if (!Number.isInteger(payload.amount) || payload.amount <= 0) {
        const error: TradeError = { message: '借款金額必須為正整數' };
        socket.emit('TRADE_ERROR', error);
        return;
      }

      // 2. 取得遊戲參數
      const gameState = await getGameState();

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
        if (user.dailyBorrowed + payload.amount > gameState.maxLoanAmount) {
          throw new Error(`今日借款額度不足 (已借 ${user.dailyBorrowed} / ${gameState.maxLoanAmount})`);
        }

        // 更新使用者資產
        const updatedUser = await tx.user.update({
          where: { id: userId },
          data: {
            cash: { increment: payload.amount },
            debt: { increment: payload.amount },
            dailyBorrowed: { increment: payload.amount },
          },
          select: { cash: true, debt: true, dailyBorrowed: true },
        });

        return updatedUser;
      });

      // 4. 回傳成功訊息
      const response: TradeResponse = {
        action: 'BORROW',
        price: 0, // 不涉及股價
        amount: payload.amount,
        newCash: result.cash,
        newDebt: result.debt,
        dailyBorrowed: result.dailyBorrowed, // 【新增】當日已借金額
      };

      socket.emit('TRADE_SUCCESS', response);

      console.log(
        `[${new Date().toISOString()}] [Loan] 使用者 ${userId} 成功借款 $${payload.amount}，當日已借 ${result.dailyBorrowed}`
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

      // 1. 驗證請求參數
      if (!Number.isInteger(payload.amount) || payload.amount <= 0) {
        const error: TradeError = { message: '還款金額必須為正整數' };
        socket.emit('TRADE_ERROR', error);
        return;
      }

      // 2. 使用 Transaction 確保原子性
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
        if (user.cash < payload.amount) {
          throw new Error('現金不足');
        }

        // 計算實際還款金額（不超過負債總額）
        const actualRepayAmount = Math.min(payload.amount, user.debt);

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
