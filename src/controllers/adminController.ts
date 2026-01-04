import { Request, Response } from 'express';
import {
  startGame,
  stopGame,
  resumeGame,
  restartGame,
  resetGame,
  updateGameParams,
  getGameState,
} from '../services/gameService.js';
import { getOnlineHistory } from '../services/monitorService.js';
import { getGlobalIO } from '../ioManager.js';

/**
 * 開始遊戲
 * POST /api/admin/game/start
 */
export async function startGameHandler(req: Request, res: Response): Promise<void> {
  try {
    await startGame();
    
    // 【新增】廣播清空新聞事件
    const io = getGlobalIO();
    io.emit('CLEAR_NEWS');
    console.log(`[${new Date().toISOString()}] [Admin] 已廣播清空新聞事件`);
    
    res.json({ message: '遊戲已開始' });
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] [Admin] 開始遊戲失敗:`, error.message);
    res.status(400).json({ error: error.message });
  }
}

/**
 * 停止遊戲（暫停）
 * POST /api/admin/game/stop
 */
export async function stopGameHandler(req: Request, res: Response): Promise<void> {
  try {
    await stopGame();
    res.json({ message: '遊戲已暫停' });
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] [Admin] 停止遊戲失敗:`, error.message);
    res.status(400).json({ error: error.message });
  }
}

/**
 * 恢復遊戲
 * POST /api/admin/game/resume
 */
export async function resumeGameHandler(req: Request, res: Response): Promise<void> {
  try {
    await resumeGame();
    res.json({ message: '遊戲已恢復' });
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] [Admin] 恢復遊戲失敗:`, error.message);
    res.status(400).json({ error: error.message });
  }
}

/**
 * 重啟遊戲（重置玩家進度）
 * POST /api/admin/game/restart
 */
export async function restartGameHandler(req: Request, res: Response): Promise<void> {
  try {
    await restartGame();
    
    // 【新增】廣播資產更新給所有連線的用戶
    const io = getGlobalIO();
    const gameState = await getGameState();
    
    // 取得所有連線的 socket，廣播資產重置
    io.sockets.sockets.forEach((socket) => {
      socket.emit('ASSETS_UPDATE', {
        cash: gameState.initialCash,
        stocks: 0,
        debt: 0,
        dailyBorrowed: 0,
      });
    });
    
    // 同時廣播遊戲狀態更新
    io.emit('GAME_STATE_UPDATE', {
      currentDay: 0,
      isGameStarted: false,
      countdown: 0,
      totalDays: gameState.totalDays,
      maxLeverage: gameState.maxLeverage,
      dailyInterestRate: gameState.dailyInterestRate,
      maxLoanAmount: gameState.maxLoanAmount,
    });
    
    console.log(`[${new Date().toISOString()}] [Admin] 已廣播資產重置給 ${io.sockets.sockets.size} 個連線`);
    
    res.json({ message: '遊戲已重啟' });
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] [Admin] 重啟遊戲失敗:`, error.message);
    res.status(400).json({ error: error.message });
  }
}

/**
 * 重置遊戲（工廠設定）
 * POST /api/admin/game/reset
 */
export async function resetGameHandler(req: Request, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: '未驗證' });
      return;
    }

    await resetGame(req.user.userId);
    
    // 【新增】廣播強制登出給所有非 Admin 用戶
    const io = getGlobalIO();
    io.sockets.sockets.forEach((socket) => {
      if (socket.data.role !== 'ADMIN') {
        socket.emit('FORCE_LOGOUT', { reason: '遊戲已重置，請重新登入' });
        socket.disconnect();
      }
    });
    
    console.log(`[${new Date().toISOString()}] [Admin] 已強制登出所有非 Admin 用戶`);
    
    res.json({ message: '遊戲已重置（工廠設定）' });
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] [Admin] 重置遊戲失敗:`, error.message);
    res.status(400).json({ error: error.message });
  }
}

/**
 * 更新遊戲參數
 * PUT /api/admin/params
 */
export async function updateParamsHandler(req: Request, res: Response): Promise<void> {
  try {
    const {
      timeRatio,
      totalDays,
      initialPrice,
      initialCash,
      maxLeverage,
      dailyInterestRate,
      maxLoanAmount,
    } = req.body;

    await updateGameParams({
      timeRatio,
      totalDays,
      initialPrice,
      initialCash,
      maxLeverage,
      dailyInterestRate,
      maxLoanAmount,
    });

    // 【新增】廣播參數更新給所有連線客戶端
    const io = getGlobalIO();
    const updatedState = await getGameState();
    io.emit('GAME_STATE_UPDATE', {
      currentDay: updatedState.currentDay,
      isGameStarted: updatedState.isGameStarted,
      countdown: updatedState.countdown,
      totalDays: updatedState.totalDays,
      maxLeverage: updatedState.maxLeverage,
    });

    // 【新增】廣播地下錢莊參數更新
    io.emit('LOAN_CONFIG_UPDATE', {
      dailyInterestRate: updatedState.dailyInterestRate,
      maxLoanAmount: updatedState.maxLoanAmount,
    });

    res.json({ message: '遊戲參數已更新' });
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] [Admin] 更新參數失敗:`, error.message);
    res.status(400).json({ error: error.message });
  }
}

/**
 * 取得遊戲參數
 * GET /api/admin/params
 */
export async function getParamsHandler(req: Request, res: Response): Promise<void> {
  try {
    const gameState = await getGameState();
    res.json({
      isGameStarted: gameState.isGameStarted,
      pausedAt: gameState.pausedAt,
      currentDay: gameState.currentDay,
      timeRatio: gameState.timeRatio,
      totalDays: gameState.totalDays,
      initialPrice: gameState.initialPrice,
      initialCash: gameState.initialCash,
      maxLeverage: gameState.maxLeverage,
      dailyInterestRate: gameState.dailyInterestRate,
      maxLoanAmount: gameState.maxLoanAmount,
    });
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] [Admin] 取得參數失敗:`, error.message);
    res.status(500).json({ error: '取得參數失敗' });
  }
}

/**
 * 取得在線人數歷史
 * GET /api/admin/monitor/history
 */
export async function getMonitorHistoryHandler(req: Request, res: Response): Promise<void> {
  try {
    const history = getOnlineHistory();
    res.json({ history });
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] [Admin] 取得監控歷史失敗:`, error.message);
    res.status(500).json({ error: '取得監控歷史失敗' });
  }
}

/**
 * 取得使用者列表（含搜尋與分頁）
 * GET /api/admin/users
 */
export async function getUsersHandler(req: Request, res: Response): Promise<void> {
  try {
    const { prisma } = await import('../db.js');
    
    // 取得查詢參數
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = (req.query.search as string)?.trim() || '';

    // 計算跳過的筆數
    const skip = (page - 1) * limit;

    // 建立搜尋條件（大小寫不敏感）
    const whereClause = search
      ? {
          OR: [
            { username: { contains: search, mode: 'insensitive' as const } },
            { displayName: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    // 查詢使用者列表
    const [users, totalCount] = await Promise.all([
      prisma.user.findMany({
        where: whereClause,
        select: {
          id: true,
          username: true,
          displayName: true,
          cash: true,
          stocks: true,
          debt: true,
          firstSignIn: true,
          isEmployee: true,
          role: true,
        },
        skip,
        take: limit,
        orderBy: { id: 'asc' },
      }),
      prisma.user.count({ where: whereClause }),
    ]);

    // 計算總頁數
    const totalPages = Math.ceil(totalCount / limit);

    res.json({
      users,
      currentPage: page,
      totalPages,
      totalCount,
    });

    console.log(`[${new Date().toISOString()}] [Admin] 取得使用者列表: 第 ${page} 頁，共 ${totalCount} 筆`);
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] [Admin] 取得使用者列表失敗:`, error.message);
    res.status(500).json({ error: '取得使用者列表失敗' });
  }
}

/**
 * 更新使用者資料
 * PUT /api/admin/users/:id
 */
export async function updateUserHandler(req: Request, res: Response): Promise<void> {
  try {
    const { prisma } = await import('../db.js');
    const userId = parseInt(req.params.id);
    const { displayName, cash, stocks, debt, firstSignIn, password, isEmployee } = req.body;

    // 驗證 userId
    if (isNaN(userId)) {
      res.status(400).json({ error: '無效的使用者 ID' });
      return;
    }

    // 檢查使用者是否存在
    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true },
    });

    if (!existingUser) {
      res.status(404).json({ error: '使用者不存在' });
      return;
    }

    // 建立更新資料物件
    const updateData: any = {
      displayName: displayName?.trim(),
      cash: parseFloat(cash),
      stocks: parseInt(stocks),
      debt: parseFloat(debt),
      firstSignIn: firstSignIn === true || firstSignIn === 'true',
      isEmployee: isEmployee === true || isEmployee === 'true',
    };

    // 若提供密碼且非空，則雜湊後更新
    if (password && password.trim() !== '') {
      const bcrypt = (await import('bcryptjs')).default;
      updateData.password = await bcrypt.hash(password.trim(), 10);
      console.log(`[${new Date().toISOString()}] [Admin] 使用者 ${userId} 密碼已重設`);
    }

    // 更新使用者
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        username: true,
        displayName: true,
        cash: true,
        stocks: true,
        debt: true,
        firstSignIn: true,
        isEmployee: true,
      },
    });

    // 廣播更新給該使用者（如果正在線上）
    const io = getGlobalIO();
    io.emit('USER_DATA_UPDATED', {
      userId: updatedUser.id,
      displayName: updatedUser.displayName,
      cash: updatedUser.cash,
      stocks: updatedUser.stocks,
      debt: updatedUser.debt,
      firstSignIn: updatedUser.firstSignIn,
      isEmployee: updatedUser.isEmployee,
    });

    res.json({ message: '使用者資料已更新', user: updatedUser });

    console.log(`[${new Date().toISOString()}] [Admin] 使用者 ${userId} (${existingUser.username}) 資料已更新`);
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] [Admin] 更新使用者失敗:`, error.message);
    res.status(500).json({ error: '更新使用者失敗' });
  }
}

/**
 * 刪除使用者
 * DELETE /api/admin/users/:id
 */
export async function deleteUserHandler(req: Request, res: Response): Promise<void> {
  try {
    const { prisma } = await import('../db.js');
    const userId = parseInt(req.params.id);

    // 驗證 userId
    if (isNaN(userId)) {
      res.status(400).json({ error: '無效的使用者 ID' });
      return;
    }

    // 防止管理員刪除自己的帳號
    if (req.user && req.user.userId === userId) {
      res.status(403).json({ error: '無法刪除自己的帳號' });
      return;
    }

    // 檢查使用者是否存在
    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, role: true },
    });

    if (!existingUser) {
      res.status(404).json({ error: '使用者不存在' });
      return;
    }

    // 使用 Transaction 確保資料一致性
    await prisma.$transaction(async (tx) => {
      // 1. 刪除該使用者的所有合約
      await tx.contractOrder.deleteMany({
        where: { userId },
      });

      // 2. 刪除使用者
      await tx.user.delete({
        where: { id: userId },
      });
    });

    // 廣播強制登出事件給該使用者（如果正在線上）
    const io = getGlobalIO();
    io.emit('FORCE_LOGOUT', {
      userId,
      reason: '您的帳號已被管理員刪除',
    });

    res.json({ message: '使用者已刪除' });

    console.log(`[${new Date().toISOString()}] [Admin] 使用者 ${userId} (${existingUser.username}) 已刪除`);
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] [Admin] 刪除使用者失敗:`, error.message);
    res.status(500).json({ error: '刪除使用者失敗' });
  }
}

/**
 * 批量刪除所有非管理員玩家
 * DELETE /api/admin/users/batch
 */
export async function batchDeleteUsersHandler(req: Request, res: Response): Promise<void> {
  try {
    const { prisma } = await import('../db.js');
    const io = getGlobalIO();

    // 1. 查詢所有非管理員玩家
    const nonAdminUsers = await prisma.user.findMany({
      where: { role: { not: 'ADMIN' } },
      select: { id: true, username: true },
    });

    if (nonAdminUsers.length === 0) {
      res.json({ message: '目前沒有非管理員玩家', deletedCount: 0 });
      return;
    }

    const userIds = nonAdminUsers.map((u) => u.id);

    // 2. 使用 Transaction 刪除
    await prisma.$transaction(async (tx) => {
      // 刪除這些玩家的所有合約
      await tx.contractOrder.deleteMany({
        where: { userId: { in: userIds } },
      });

      // 刪除這些玩家
      await tx.user.deleteMany({
        where: { id: { in: userIds } },
      });
    });

    // 3. 廣播強制登出給這些玩家
    userIds.forEach((userId) => {
      io.emit('FORCE_LOGOUT', {
        userId,
        reason: '您的帳號已被管理員批量刪除',
      });
    });

    res.json({ 
      message: `已刪除 ${nonAdminUsers.length} 位非管理員玩家`,
      deletedCount: nonAdminUsers.length,
      deletedUsers: nonAdminUsers.map((u) => u.username),
    });

    console.log(`[${new Date().toISOString()}] [Admin] 批量刪除 ${nonAdminUsers.length} 位非管理員玩家`);
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] [Admin] 批量刪除玩家失敗:`, error.message);
    res.status(500).json({ error: '批量刪除失敗' });
  }
}

/**
 * 系統暖機 - 保持資料庫連線池活躍
 * GET /api/admin/system/warmup
 */
export async function systemWarmupHandler(req: Request, res: Response): Promise<void> {
  const start = performance.now();
  
  try {
    // 執行簡單的資料庫查詢以保持連線池活躍
    const { prisma } = await import('../db.js');
    await prisma.$queryRaw`SELECT 1`;
    
    const end = performance.now();
    const duration = Math.round(end - start);
    
    console.log(`[${new Date().toISOString()}] [Admin] 系統暖機完成，延遲: ${duration}ms`);
    
    res.json({ 
      status: 'WARM', 
      duration 
    });
  } catch (error: any) {
    const end = performance.now();
    const duration = Math.round(end - start);
    
    console.error(`[${new Date().toISOString()}] [Admin] 系統暖機失敗:`, error.message);
    
    res.status(500).json({ 
      status: 'ERROR', 
      duration,
      error: error.message 
    });
  }
}
