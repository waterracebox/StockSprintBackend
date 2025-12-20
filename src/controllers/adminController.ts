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
