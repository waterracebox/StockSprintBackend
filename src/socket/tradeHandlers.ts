// 處理現貨交易的 WebSocket 事件

import { Server, Socket } from 'socket.io';
import { prisma } from '../db.js';
import { getCurrentStockData, getGameState } from '../services/gameService.js';
import type { TradeRequest, TradeResponse, TradeError } from '../types/events.js';

/**
 * 註冊交易相關的 WebSocket 事件監聽器
 * @param io - Socket.io Server 實例
 * @param socket - 客戶端連線
 */
export function registerTradeHandlers(io: Server, socket: Socket): void {
  const { userId } = socket.data;

  // 監聽買入事件
  socket.on('BUY_STOCK', async (payload: TradeRequest) => {
    try {
      // 驗證請求參數
      if (!Number.isInteger(payload.quantity) || payload.quantity <= 0) {
        const error: TradeError = { message: '交易張數必須為正整數' };
        socket.emit('TRADE_ERROR', error);
        return;
      }

      // 取得當前股價
      const gameState = await getGameState();
      const currentData = getCurrentStockData(gameState.currentDay);
      const currentPrice = currentData ? currentData.price : gameState.initialPrice;

      // 計算交易成本
      const cost = currentPrice * payload.quantity;

      // 使用 Prisma Transaction 確保原子性
      const updatedUser = await prisma.$transaction(async (tx) => {
        // 查詢使用者資料
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { cash: true, stocks: true },
        });

        if (!user) {
          throw new Error('使用者不存在');
        }

        // 檢查餘額是否足夠
        if (user.cash < cost) {
          throw new Error('餘額不足');
        }

        // 更新使用者資產
        return await tx.user.update({
          where: { id: userId },
          data: {
            cash: user.cash - cost,
            stocks: user.stocks + payload.quantity,
          },
          select: { cash: true, stocks: true },
        });
      });

      // 建構成功回應
      const response: TradeResponse = {
        action: 'BUY',
        price: currentPrice,
        amount: payload.quantity,
        newCash: updatedUser.cash,
        newStocks: updatedUser.stocks,
      };

      // 推送成功訊息給客戶端
      socket.emit('TRADE_SUCCESS', response);

      // 記錄日誌
      console.log(
        `[${new Date().toISOString()}] [Trade] 使用者 ${userId} 買入 ${payload.quantity} 張 @ $${currentPrice.toFixed(2)}`
      );
    } catch (error: any) {
      // 處理錯誤
      const errorResponse: TradeError = { message: error.message || '交易失敗' };
      socket.emit('TRADE_ERROR', errorResponse);

      console.error(
        `[${new Date().toISOString()}] [Trade] 使用者 ${userId} 買入失敗:`,
        error.message
      );
    }
  });

  // 監聽賣出事件
  socket.on('SELL_STOCK', async (payload: TradeRequest) => {
    try {
      // 驗證請求參數
      if (!Number.isInteger(payload.quantity) || payload.quantity <= 0) {
        const error: TradeError = { message: '交易張數必須為正整數' };
        socket.emit('TRADE_ERROR', error);
        return;
      }

      // 取得當前股價
      const gameState = await getGameState();
      const currentData = getCurrentStockData(gameState.currentDay);
      const currentPrice = currentData ? currentData.price : gameState.initialPrice;

      // 計算交易收入
      const income = currentPrice * payload.quantity;

      // 使用 Prisma Transaction 確保原子性
      const updatedUser = await prisma.$transaction(async (tx) => {
        // 查詢使用者資料
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { cash: true, stocks: true },
        });

        if (!user) {
          throw new Error('使用者不存在');
        }

        // 檢查持股是否足夠
        if (user.stocks < payload.quantity) {
          throw new Error('持股不足');
        }

        // 更新使用者資產
        return await tx.user.update({
          where: { id: userId },
          data: {
            cash: user.cash + income,
            stocks: user.stocks - payload.quantity,
          },
          select: { cash: true, stocks: true },
        });
      });

      // 建構成功回應
      const response: TradeResponse = {
        action: 'SELL',
        price: currentPrice,
        amount: payload.quantity,
        newCash: updatedUser.cash,
        newStocks: updatedUser.stocks,
      };

      // 推送成功訊息給客戶端
      socket.emit('TRADE_SUCCESS', response);

      // 記錄日誌
      console.log(
        `[${new Date().toISOString()}] [Trade] 使用者 ${userId} 賣出 ${payload.quantity} 張 @ $${currentPrice.toFixed(2)}`
      );
    } catch (error: any) {
      // 處理錯誤
      const errorResponse: TradeError = { message: error.message || '交易失敗' };
      socket.emit('TRADE_ERROR', errorResponse);

      console.error(
        `[${new Date().toISOString()}] [Trade] 使用者 ${userId} 賣出失敗:`,
        error.message
      );
    }
  });
}
