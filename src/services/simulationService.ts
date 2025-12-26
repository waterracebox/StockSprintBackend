import { prisma } from '../db.js';
import type { ScriptDay } from '@prisma/client';

/**
 * 模擬結果統計資料結構
 */
interface BotStats {
  name: string;
  runs: number[];
  stats: {
    min: number;
    max: number;
    avg: number;
    q1: number;
    q2: number;
    q3: number;
  };
}

/**
 * 遊戲參數介面
 */
interface GameParams {
  initialCash: number;
  maxLeverage: number;
  dailyInterestRate: number;
  maxLoanAmount: number;
}

/**
 * 計算統計數據（最小值、最大值、平均值、四分位數）
 */
function calcStats(values: number[]): BotStats['stats'] {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const pick = (p: number) => sorted[Math.floor((n - 1) * p)];
  const sum = sorted.reduce((acc, cur) => acc + cur, 0);

  return {
    min: Number(sorted[0].toFixed(2)),
    max: Number(sorted[n - 1].toFixed(2)),
    avg: Number((sum / n).toFixed(2)),
    q1: Number(pick(0.25).toFixed(2)),
    q2: Number(pick(0.5).toFixed(2)),
    q3: Number(pick(0.75).toFixed(2)),
  };
}

/**
 * 幸運機器人（高勝率策略）：90% 機率預測正確，10% 機率預測錯誤
 * - Day 1 立即借滿
 * - 每天有 90% 機率做出最佳決策，10% 機率做出錯誤決策
 */
function luckyBotRun(prices: number[], params: GameParams): number {
  let cash = params.initialCash;
  let stocks = 0;
  let debt = 0;
  let activeContracts: Array<{ type: 'LONG' | 'SHORT'; margin: number; entryPrice: number; leverage: number }> = [];

  // Day 1: 立即借滿
  cash += params.maxLoanAmount;
  debt += params.maxLoanAmount;

  for (let day = 0; day < prices.length; day++) {
    const currentPrice = prices[day];
    const nextPrice = day < prices.length - 1 ? prices[day + 1] : currentPrice;

    // 1. 每日利息（複利）
    if (debt > 0) {
      debt *= 1 + params.dailyInterestRate;
    }

    // 2. 結算昨日合約
    if (activeContracts.length > 0) {
      for (const contract of activeContracts) {
        const pnlPerStock = contract.type === 'LONG'
          ? currentPrice - contract.entryPrice
          : contract.entryPrice - currentPrice;
        const totalPnL = pnlPerStock * contract.leverage; // 簡化：1 單位槓桿合約的損益
        const payout = contract.margin + totalPnL;

        if (payout >= 0) {
          cash += payout;
        } else {
          debt += Math.abs(payout); // 虧損轉負債
        }
      }
      activeContracts = []; // 清空合約
    }

    // 3. 高勝率預測（90% 正確，10% 錯誤）
    if (day < prices.length - 1) {
      const isCorrectPrediction = Math.random() < 0.9; // 90% 機率預測正確
      
      let shouldGoLong = false;
      let shouldGoShort = false;

      if (isCorrectPrediction) {
        // 90% 情況：正確預測
        if (nextPrice > currentPrice) {
          shouldGoLong = true;
        } else if (nextPrice < currentPrice) {
          shouldGoShort = true;
        }
      } else {
        // 10% 情況：預測錯誤（反向操作）
        if (nextPrice > currentPrice) {
          shouldGoShort = true; // 明天漲但做空（錯誤）
        } else if (nextPrice < currentPrice) {
          shouldGoLong = true; // 明天跌但做多（錯誤）
        }
      }

      // 執行決策
      const margin = cash;
      if (margin > 0) {
        if (shouldGoLong) {
          activeContracts.push({
            type: 'LONG',
            margin,
            entryPrice: currentPrice,
            leverage: params.maxLeverage,
          });
          cash = 0;
        } else if (shouldGoShort) {
          activeContracts.push({
            type: 'SHORT',
            margin,
            entryPrice: currentPrice,
            leverage: params.maxLeverage,
          });
          cash = 0;
        }
      }
    }
  }

  // 最後清算持股
  const finalAsset = cash + stocks * prices[prices.length - 1] - debt;
  return Number(finalAsset.toFixed(2));
}

/**
 * 倒楣機器人（高敗率策略）：90% 機率預測錯誤，10% 機率意外預測正確
 * - Day 1 立即借滿
 * - 每天有 90% 機率做出錯誤決策，10% 機率意外做對
 */
function unluckyBotRun(prices: number[], params: GameParams): number {
  let cash = params.initialCash;
  let stocks = 0;
  let debt = 0;
  let activeContracts: Array<{ type: 'LONG' | 'SHORT'; margin: number; entryPrice: number; leverage: number }> = [];

  // Day 1: 立即借滿
  cash += params.maxLoanAmount;
  debt += params.maxLoanAmount;

  for (let day = 0; day < prices.length; day++) {
    const currentPrice = prices[day];
    const nextPrice = day < prices.length - 1 ? prices[day + 1] : currentPrice;

    // 1. 每日利息
    if (debt > 0) {
      debt *= 1 + params.dailyInterestRate;
    }

    // 2. 結算昨日合約
    if (activeContracts.length > 0) {
      for (const contract of activeContracts) {
        const pnlPerStock = contract.type === 'LONG'
          ? currentPrice - contract.entryPrice
          : contract.entryPrice - currentPrice;
        const totalPnL = pnlPerStock * contract.leverage;
        const payout = contract.margin + totalPnL;

        if (payout >= 0) {
          cash += payout;
        } else {
          debt += Math.abs(payout);
        }
      }
      activeContracts = [];
    }

    // 3. 高敗率預測（90% 錯誤，10% 正確）
    if (day < prices.length - 1) {
      const isWrongPrediction = Math.random() < 0.9; // 90% 機率預測錯誤
      
      let shouldGoLong = false;
      let shouldGoShort = false;

      if (isWrongPrediction) {
        // 90% 情況：預測錯誤（反向操作）
        if (nextPrice > currentPrice) {
          shouldGoShort = true; // 明天漲但做空（錯誤）
        } else if (nextPrice < currentPrice) {
          shouldGoLong = true; // 明天跌但做多（錯誤）
        }
      } else {
        // 10% 情況：意外預測正確
        if (nextPrice > currentPrice) {
          shouldGoLong = true;
        } else if (nextPrice < currentPrice) {
          shouldGoShort = true;
        }
      }

      // 執行決策
      const margin = cash;
      if (margin > 0) {
        if (shouldGoLong) {
          activeContracts.push({
            type: 'LONG',
            margin,
            entryPrice: currentPrice,
            leverage: params.maxLeverage,
          });
          cash = 0;
        } else if (shouldGoShort) {
          activeContracts.push({
            type: 'SHORT',
            margin,
            entryPrice: currentPrice,
            leverage: params.maxLeverage,
          });
          cash = 0;
        }
      }
    }
  }

  const finalAsset = cash + stocks * prices[prices.length - 1] - debt;
  return Number(finalAsset.toFixed(2));
}

/**
 * 隨機機器人（基準線）：模擬真實玩家的隨機行為
 * - 隨機借款/還款
 * - 隨機現貨/合約交易/Hold
 */
function randomBotRun(prices: number[], params: GameParams): number {
  let cash = params.initialCash;
  let stocks = 0;
  let debt = 0;
  let activeContracts: Array<{ type: 'LONG' | 'SHORT'; margin: number; entryPrice: number; leverage: number }> = [];
  let dailyBorrowed = 0;

  for (let day = 0; day < prices.length; day++) {
    const currentPrice = prices[day];

    // 1. 每日利息
    if (debt > 0) {
      debt *= 1 + params.dailyInterestRate;
    }

    // 2. 重置每日借款額度
    dailyBorrowed = 0;

    // 3. 結算昨日合約
    if (activeContracts.length > 0) {
      for (const contract of activeContracts) {
        const pnlPerStock = contract.type === 'LONG'
          ? currentPrice - contract.entryPrice
          : contract.entryPrice - currentPrice;
        const totalPnL = pnlPerStock * contract.leverage;
        const payout = contract.margin + totalPnL;

        if (payout >= 0) {
          cash += payout;
        } else {
          debt += Math.abs(payout);
        }
      }
      activeContracts = [];
    }

    // 4. 隨機借款/還款邏輯
    if (cash >= 0) {
      // 10% 機率借款
      if (Math.random() < 0.1) {
        const remainingLimit = params.maxLoanAmount - dailyBorrowed;
        if (remainingLimit > 0) {
          const borrowAmount = Math.random() * remainingLimit;
          cash += borrowAmount;
          debt += borrowAmount;
          dailyBorrowed += borrowAmount;
        }
      }

      // 10% 機率還款
      if (Math.random() < 0.1 && debt > 0) {
        const repayAmount = Math.min(cash, debt) * Math.random();
        cash -= repayAmount;
        debt -= repayAmount;
      }
    }

    // 5. 隨機交易邏輯（33% 現貨 / 33% 合約 / 34% Hold）
    const action = Math.random();

    if (action < 0.33) {
      // 現貨交易
      if (Math.random() < 0.5 && cash >= currentPrice) {
        // 買入
        const buyQuantity = Math.floor(cash / currentPrice);
        if (buyQuantity > 0) {
          cash -= buyQuantity * currentPrice;
          stocks += buyQuantity;
        }
      } else if (stocks > 0) {
        // 賣出
        const sellQuantity = Math.ceil(stocks * Math.random());
        cash += sellQuantity * currentPrice;
        stocks -= sellQuantity;
      }
    } else if (action < 0.66) {
      // 合約交易
      const isLong = Math.random() < 0.5;
      const leverage = Math.ceil(Math.random() * params.maxLeverage);
      const margin = cash * 0.5 * Math.random(); // 隨機投入 0-50% 現金

      if (margin > 0) {
        activeContracts.push({
          type: isLong ? 'LONG' : 'SHORT',
          margin,
          entryPrice: currentPrice,
          leverage,
        });
        cash -= margin;
      }
    }
    // else: Hold (34%)
  }

  // 最後清算持股
  const finalAsset = cash + stocks * prices[prices.length - 1] - debt;
  return Number(finalAsset.toFixed(2));
}

/**
 * 主模擬函式：執行 10,000 次迭代（支援分批處理避免阻塞）
 * @param iterations - 迭代次數（預設 10,000）
 * @returns 三個機器人的統計結果
 */
export async function runSimulation(iterations = 10000): Promise<BotStats[]> {
  console.log(`[${new Date().toISOString()}] [Sim] 開始蒙地卡羅模擬 (${iterations} 次迭代)`);

  // 1. 取得遊戲參數
  const gameStatus = await prisma.gameStatus.findUnique({ where: { id: 1 } });
  if (!gameStatus) throw new Error('遊戲狀態不存在');

  const params: GameParams = {
    initialCash: gameStatus.initialCash,
    maxLeverage: gameStatus.maxLeverage,
    dailyInterestRate: gameStatus.dailyInterestRate,
    maxLoanAmount: gameStatus.maxLoanAmount,
  };

  // 2. 取得劇本資料
  const script = await prisma.scriptDay.findMany({ orderBy: { day: 'asc' } });
  if (script.length === 0) throw new Error('尚未生成劇本');

  const prices = script.map((d) => d.price);

  // 3. 初始化結果陣列
  const luckyRuns: number[] = [];
  const unluckyRuns: number[] = [];
  const randomRuns: number[] = [];

  // 4. 分批執行（每批 1000 次，避免阻塞 Event Loop）
  const chunkSize = 1000;
  const totalChunks = Math.ceil(iterations / chunkSize);

  for (let chunk = 0; chunk < totalChunks; chunk++) {
    await new Promise<void>((resolve) => {
      setImmediate(() => {
        const start = chunk * chunkSize;
        const end = Math.min(start + chunkSize, iterations);

        for (let i = start; i < end; i++) {
          luckyRuns.push(luckyBotRun(prices, params));
          unluckyRuns.push(unluckyBotRun(prices, params));
          randomRuns.push(randomBotRun(prices, params));
        }

        console.log(`[${new Date().toISOString()}] [Sim] 進度: ${end}/${iterations} (${((end / iterations) * 100).toFixed(1)}%)`);
        resolve();
      });
    });
  }

  // 5. 計算統計數據
  const results: BotStats[] = [
    { name: 'Lucky', runs: luckyRuns, stats: calcStats(luckyRuns) },
    { name: 'Unlucky', runs: unluckyRuns, stats: calcStats(unluckyRuns) },
    { name: 'Random', runs: randomRuns, stats: calcStats(randomRuns) },
  ];

  console.log(`[${new Date().toISOString()}] [Sim] 模擬完成！結果:`);
  results.forEach((bot) => {
    console.log(`  ${bot.name}: Min=${bot.stats.min}, Avg=${bot.stats.avg}, Max=${bot.stats.max}`);
  });

  return results;
}
