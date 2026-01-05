// controllers/finalStatsController.ts
// 【Phase 4】結束儀式統計資料計算 API

import { Request, Response } from 'express';
import { prisma } from '../db.js';
import { getGameState } from '../services/gameService.js';

/**
 * 計算並回傳遊戲結束儀式所需的統計資料
 * GET /api/admin/final-stats
 * 
 * 【重要】排除規則：
 * - 所有統計資料 **必須排除 ADMIN 角色**
 * - Top 3 之外的獎項（Cash King, Stock Tycoon）需排除 Top 3 玩家
 * 
 * 回傳結構：
 * {
 *   top3: [{ userId, displayName, avatar, totalAssets }],
 *   cashKing: { userId, displayName, avatar, cash },
 *   stockTycoon: { userId, displayName, avatar, stockValue },
 *   debtKing: { userId, displayName, avatar, debt },
 *   fashionista: { userId, displayName, avatar, avatarUpdateCount },
 *   loanSharkLover: { userId, displayName, avatar, loanSharkVisitCount }
 * }
 */
export async function getFinalStatsHandler(req: Request, res: Response): Promise<void> {
  try {
    // 1. 取得當前股價（用於計算總資產）
    const gameState = await getGameState();
    const currentDay = gameState.currentDay;

    const scriptDay = await prisma.scriptDay.findFirst({
      where: { day: currentDay },
      select: { price: true },
    });
    const currentPrice = scriptDay?.price || 50;

    // 2. 查詢所有非 Admin 使用者資料
    const users = await prisma.user.findMany({
      where: { role: { not: 'ADMIN' } }, // 【關鍵】排除 Admin
      select: {
        id: true,
        displayName: true,
        avatar: true,
        cash: true,
        stocks: true,
        debt: true,
        avatarUpdateCount: true,
        loanSharkVisitCount: true,
      },
    });

    // 3. 查詢所有活躍合約（計算保證金）
    const activeContracts = await prisma.contractOrder.findMany({
      where: {
        day: currentDay,
        isSettled: false,
        isCancelled: false,
      },
      select: {
        userId: true,
        margin: true,
      },
    });

    // 累加每位使用者的保證金
    const userMargins = new Map<number, number>();
    activeContracts.forEach((contract) => {
      const current = userMargins.get(contract.userId) || 0;
      userMargins.set(contract.userId, current + contract.margin);
    });

    // 4. 計算總資產並排序（找出 Top 3）
    const usersWithAssets = users.map((user) => {
      const stockValue = user.stocks * currentPrice;
      const margin = userMargins.get(user.id) || 0;
      const totalAssets = user.cash + stockValue + margin - user.debt;

      return {
        userId: user.id,
        displayName: user.displayName,
        avatar: user.avatar,
        cash: user.cash,
        stockValue,
        debt: user.debt,
        totalAssets,
        avatarUpdateCount: user.avatarUpdateCount,
        loanSharkVisitCount: user.loanSharkVisitCount,
      };
    });

    // 按總資產降序排序
    usersWithAssets.sort((a, b) => b.totalAssets - a.totalAssets);

    // 5. 取出 Top 3
    const top3 = usersWithAssets.slice(0, 3).map((user) => ({
      userId: user.userId,
      displayName: user.displayName,
      avatar: user.avatar,
      totalAssets: user.totalAssets,
    }));

    // 6. 從剩餘玩家中選出 Cash King 與 Stock Tycoon（排除 Top 3）
    const top3Ids = new Set(top3.map((u) => u.userId));
    const remainingUsers = usersWithAssets.filter((u) => !top3Ids.has(u.userId));

    const cashKing =
      remainingUsers.length > 0
        ? remainingUsers.reduce((max, user) => (user.cash > max.cash ? user : max))
        : null;

    const stockTycoon =
      remainingUsers.length > 0
        ? remainingUsers.reduce((max, user) => (user.stockValue > max.stockValue ? user : max))
        : null;

    // 7. 從所有玩家（排除 Admin）中選出 Debt King、Fashionista、Loan Shark Lover
    const debtKing =
      usersWithAssets.length > 0
        ? usersWithAssets.reduce((max, user) => (user.debt > max.debt ? user : max))
        : null;

    const fashionista =
      usersWithAssets.length > 0
        ? usersWithAssets.reduce((max, user) =>
            user.avatarUpdateCount > max.avatarUpdateCount ? user : max
          )
        : null;

    const loanSharkLover =
      usersWithAssets.length > 0
        ? usersWithAssets.reduce((max, user) =>
            user.loanSharkVisitCount > max.loanSharkVisitCount ? user : max
          )
        : null;

    // 8. 組裝回傳資料
    const result = {
      top3,
      cashKing: cashKing
        ? { 
            userId: cashKing.userId, 
            displayName: cashKing.displayName, 
            avatar: cashKing.avatar, 
            cash: cashKing.cash 
          }
        : null,
      stockTycoon: stockTycoon
        ? {
            userId: stockTycoon.userId,
            displayName: stockTycoon.displayName,
            avatar: stockTycoon.avatar,
            stockValue: stockTycoon.stockValue,
          }
        : null,
      debtKing: debtKing
        ? { 
            userId: debtKing.userId, 
            displayName: debtKing.displayName, 
            avatar: debtKing.avatar, 
            debt: debtKing.debt 
          }
        : null,
      fashionista: fashionista
        ? {
            userId: fashionista.userId,
            displayName: fashionista.displayName,
            avatar: fashionista.avatar,
            avatarUpdateCount: fashionista.avatarUpdateCount,
          }
        : null,
      loanSharkLover: loanSharkLover
        ? {
            userId: loanSharkLover.userId,
            displayName: loanSharkLover.displayName,
            avatar: loanSharkLover.avatar,
            loanSharkVisitCount: loanSharkLover.loanSharkVisitCount,
          }
        : null,
    };

    console.log(`[${new Date().toISOString()}] [FinalStats] 統計資料計算完成`);
    res.json(result);
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] [FinalStats] 計算失敗:`, error.message);
    res.status(500).json({ error: '計算結束儀式統計失敗' });
  }
}
