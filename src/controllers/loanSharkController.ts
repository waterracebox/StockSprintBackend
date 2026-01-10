import type { Request, Response } from 'express';
import { prisma } from '../db.js';
import { getGameState } from '../services/gameService.js';

/**
 * 地下錢莊最大好感度門檻
 * 達到此數值後，玩家可獲得「明日股市預測」
 * 測試環境：10 次
 * 正式環境：300 次
 */
export const MAX_LOAN_SHARK_AFFINITY = 299;

/**
 * 取得明日股市走勢預測
 * GET /api/game/script/prediction
 * 
 * 權限檢查：使用者必須累積足夠的訪問次數（loanSharkVisitCount >= MAX_LOAN_SHARK_AFFINITY）
 * 
 * 回傳格式：
 * - { trend: "RISE" }   - 明天股價 > 今天
 * - { trend: "FALL" }   - 明天股價 < 今天
 * - { trend: "UNCERTAIN" } - 明天不存在或相等
 */
export async function getPredictionHandler(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user.userId; // 由 authenticateToken 注入到 req.user

    // 1. 檢查使用者權限
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { loanSharkVisitCount: true },
    });

    if (!user) {
      res.status(404).json({ error: '使用者不存在' });
      return;
    }

    if (user.loanSharkVisitCount < MAX_LOAN_SHARK_AFFINITY) {
      res.status(403).json({ 
        error: '權限不足',
        message: `需要訪問地下錢莊 ${MAX_LOAN_SHARK_AFFINITY} 次才能獲得預測`,
        currentCount: user.loanSharkVisitCount,
      });
      return;
    }

    // 2. 取得當前天數（使用 getGameState 而非直接讀 DB）
    const gameState = await getGameState();
    const currentDay = gameState.currentDay;

    // 3. 查詢今日與明日股價
    const [todayScript, tomorrowScript] = await Promise.all([
      prisma.scriptDay.findFirst({ where: { day: currentDay }, select: { price: true } }),
      prisma.scriptDay.findFirst({ where: { day: currentDay + 1 }, select: { price: true } }),
    ]);

    // 4. 判斷走勢
    let trend: 'RISE' | 'FALL' | 'UNCERTAIN';

    if (!todayScript || !tomorrowScript) {
      // 遊戲結束或明日資料不存在
      trend = 'UNCERTAIN';
    } else if (tomorrowScript.price > todayScript.price) {
      trend = 'RISE';
    } else if (tomorrowScript.price < todayScript.price) {
      trend = 'FALL';
    } else {
      trend = 'UNCERTAIN';
    }

    console.log(
      `[${new Date().toISOString()}] [Prediction] User ${userId} (Day ${currentDay}): ` +
      `Today=${todayScript?.price.toFixed(2)}, Tomorrow=${tomorrowScript?.price.toFixed(2)}, Trend=${trend}`
    );

    res.json({ trend });
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] [Prediction] 錯誤:`, error.message);
    res.status(500).json({ error: '伺服器錯誤' });
  }
}
