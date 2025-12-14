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
          select: { cash: true, stocks: true, debt: true },
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
          select: { cash: true, stocks: true, debt: true },
        });
      });

      // 建構成功回應
      const response: TradeResponse = {
        action: 'BUY',
        price: currentPrice,
        amount: payload.quantity,
        newCash: updatedUser.cash,
        newStocks: updatedUser.stocks,
        newDebt: updatedUser.debt,
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
          select: { cash: true, stocks: true, debt: true },
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
          select: { cash: true, stocks: true, debt: true },
        });
      });

      // 建構成功回應
      const response: TradeResponse = {
        action: 'SELL',
        price: currentPrice,
        amount: payload.quantity,
        newCash: updatedUser.cash,
        newStocks: updatedUser.stocks,
        newDebt: updatedUser.debt,
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

  // ==================== 合約交易 ====================
  
  /**
   * 買入合約（做多/做空）
   * Payload: { type: 'LONG' | 'SHORT', leverage: number, quantity: number }
   */
  socket.on('BUY_CONTRACT', async (payload: { type: 'LONG' | 'SHORT'; leverage: number; quantity: number }) => {
    try {
      console.log(`[${new Date().toISOString()}] [Contract] 使用者 ${userId} 下單合約:`, payload);

      // 1. 取得當前遊戲狀態（包含動態 maxLeverage）
      const gameState = await getGameState();

      // 2. 驗證請求參數
      if (!['LONG', 'SHORT'].includes(payload.type)) {
        socket.emit('TRADE_ERROR', { message: '無效的合約類型' });
        return;
      }

      if (!Number.isInteger(payload.quantity) || payload.quantity <= 0) {
        socket.emit('TRADE_ERROR', { message: '張數必須為正整數' });
        return;
      }

      // CRITICAL: 使用動態 maxLeverage 進行驗證
      if (typeof payload.leverage !== 'number' || payload.leverage < 1.0 || payload.leverage > gameState.maxLeverage) {
        socket.emit('TRADE_ERROR', { 
          message: `槓桿倍數必須在 1.0 ~ ${gameState.maxLeverage} 之間` 
        });
        return;
      }

      // 3. 取得當前股價
      const currentData = getCurrentStockData(gameState.currentDay);
      const currentPrice = currentData ? currentData.price : gameState.initialPrice;

      // 3. 計算所需保證金
      const requiredMargin = (currentPrice * payload.quantity) / payload.leverage;

      // 4. 使用 Transaction 確保原子性
      const result = await prisma.$transaction(async (tx) => {
        // 查詢使用者資料
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { cash: true },
        });

        if (!user) {
          throw new Error('使用者不存在');
        }

        // 檢查餘額是否足夠
        if (user.cash < requiredMargin) {
          throw new Error('保證金不足');
        }

        // 扣除保證金
        const updatedUser = await tx.user.update({
          where: { id: userId },
          data: { cash: user.cash - requiredMargin },
          select: { cash: true },
        });

        // 建立合約訂單
        const contractOrder = await tx.contractOrder.create({
          data: {
            userId,
            day: gameState.currentDay,
            type: payload.type,
            leverage: payload.leverage,
            quantity: payload.quantity,
            margin: requiredMargin,
            entryPrice: currentPrice,
          },
        });

        return { updatedUser, contractOrder };
      });

      // 5. 回傳成功訊息（包含新訂單資料）
      socket.emit('TRADE_SUCCESS', {
        action: 'BUY_CONTRACT',
        type: payload.type,
        leverage: payload.leverage,
        quantity: payload.quantity,
        margin: requiredMargin,
        entryPrice: currentPrice,
        newCash: result.updatedUser.cash,
        contractOrder: result.contractOrder, // 前端需要此資料更新狀態
      });

      console.log(
        `[${new Date().toISOString()}] [Contract] 使用者 ${userId} 成功下單: ${payload.type} ${payload.quantity} 張 @ 槓桿 ${payload.leverage}x`
      );

    } catch (error: any) {
      socket.emit('TRADE_ERROR', { message: error.message || '下單失敗' });
      console.error(
        `[${new Date().toISOString()}] [Contract] 使用者 ${userId} 下單失敗:`,
        error.message
      );
    }
  });

  /**
   * 撤銷今日所有合約訂單
   * Payload: {} (無參數)
   */
  socket.on('CANCEL_CONTRACT', async () => {
    try {
      console.log(`[${new Date().toISOString()}] [Contract] 使用者 ${userId} 撤銷今日合約`);

      // 1. 取得當前遊戲天數
      const gameState = await getGameState();

      // 2. 使用 Transaction 確保原子性
      const result = await prisma.$transaction(async (tx) => {
        // 查詢今日未結算且未撤銷的合約
        const activeOrders = await tx.contractOrder.findMany({
          where: {
            userId,
            day: gameState.currentDay,
            isSettled: false,
            isCancelled: false,
          },
        });

        if (activeOrders.length === 0) {
          throw new Error('今日沒有待撤銷的合約');
        }

        // 計算總退款金額
        const totalRefund = activeOrders.reduce((sum, order) => sum + order.margin, 0);

        // 更新訂單狀態為已撤銷
        await tx.contractOrder.updateMany({
          where: {
            userId,
            day: gameState.currentDay,
            isSettled: false,
            isCancelled: false,
          },
          data: { isCancelled: true },
        });

        // 退還保證金
        const updatedUser = await tx.user.update({
          where: { id: userId },
          data: { cash: { increment: totalRefund } },
          select: { cash: true },
        });

        return { updatedUser, cancelledCount: activeOrders.length };
      });

      // 3. 回傳成功訊息
      socket.emit('TRADE_SUCCESS', {
        action: 'CANCEL_CONTRACT',
        message: `已撤銷 ${result.cancelledCount} 筆合約`,
        newCash: result.updatedUser.cash,
      });

      console.log(
        `[${new Date().toISOString()}] [Contract] 使用者 ${userId} 成功撤銷 ${result.cancelledCount} 筆合約`
      );

    } catch (error: any) {
      socket.emit('TRADE_ERROR', { message: error.message || '撤銷失敗' });
      console.error(
        `[${new Date().toISOString()}] [Contract] 使用者 ${userId} 撤銷失敗:`,
        error.message
      );
    }
  });
}
