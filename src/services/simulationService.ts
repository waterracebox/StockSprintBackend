import { prisma } from '../db.js';

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

function calcStats(values: number[]): BotStats['stats'] {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const pick = (p: number) => sorted[Math.floor((n - 1) * p)];
  const sum = sorted.reduce((acc, cur) => acc + cur, 0);

  return {
    min: sorted[0],
    max: sorted[n - 1],
    avg: Number((sum / n).toFixed(2)),
    q1: pick(0.25),
    q2: pick(0.5),
    q3: pick(0.75),
  };
}

export async function runSimulation(iterations = 1000): Promise<BotStats[]> {
  const gameStatus = await prisma.gameStatus.findUnique({ where: { id: 1 } });
  if (!gameStatus) throw new Error('遊戲狀態不存在');

  const script = await prisma.scriptDay.findMany({ orderBy: { day: 'asc' } });
  if (script.length === 0) throw new Error('尚未生成劇本');

  const prices = script.map((d) => d.price);
  const trends = script.map((d) => d.effectiveTrend);

  // 完美玩家：單次最佳買低賣高
  const perfectRun = (): number => {
    let minPrice = prices[0];
    let maxProfit = 0;
    for (const p of prices) {
      if (p < minPrice) minPrice = p;
      maxProfit = Math.max(maxProfit, p - minPrice);
    }
    return Number((gameStatus.initialCash + maxProfit).toFixed(2));
  };

  // 倒楣玩家：買在最高、賣在最低
  const unluckyRun = (): number => {
    let maxPrice = prices[0];
    let worstLoss = 0;
    for (const p of prices) {
      if (p > maxPrice) maxPrice = p;
      worstLoss = Math.min(worstLoss, p - maxPrice);
    }
    return Number((gameStatus.initialCash + worstLoss).toFixed(2));
  };

  // 聰明玩家：看趨勢進出
  const smartRun = (): number => {
    let cash = gameStatus.initialCash;
    let holding = 0;
    for (let i = 0; i < prices.length; i++) {
      const trend = trends[i];
      const isBull = trend === 'CHAO_LI_DUO' || trend === 'LI_DUO';
      const isBear = trend === 'CHAO_LI_KONG' || trend === 'LI_KONG';

      if (isBull && holding === 0) {
        holding = 1;
        cash -= prices[i];
      } else if (isBear && holding === 1) {
        cash += prices[i];
        holding = 0;
      }
    }

    if (holding === 1) {
      cash += prices[prices.length - 1];
    }
    return Number(cash.toFixed(2));
  };

  // 隨機玩家：每日 50% 機率買或賣
  const randomRun = (): number => {
    let cash = gameStatus.initialCash;
    let holding = 0;
    for (let i = 0; i < prices.length; i++) {
      const action = Math.random() < 0.5 ? 'BUY' : 'SELL';
      if (action === 'BUY' && holding === 0) {
        holding = 1;
        cash -= prices[i];
      } else if (action === 'SELL' && holding === 1) {
        cash += prices[i];
        holding = 0;
      }
    }
    if (holding === 1) cash += prices[prices.length - 1];
    return Number(cash.toFixed(2));
  };

  const perfectRuns: number[] = [];
  const smartRuns: number[] = [];
  const randomRuns: number[] = [];
  const unluckyRuns: number[] = [];

  for (let i = 0; i < iterations; i++) {
    perfectRuns.push(perfectRun());
    smartRuns.push(smartRun());
    randomRuns.push(randomRun());
    unluckyRuns.push(unluckyRun());
  }

  const results: BotStats[] = [
    { name: 'Perfect', runs: perfectRuns, stats: calcStats(perfectRuns) },
    { name: 'Smart', runs: smartRuns, stats: calcStats(smartRuns) },
    { name: 'Random', runs: randomRuns, stats: calcStats(randomRuns) },
    { name: 'Unlucky', runs: unluckyRuns, stats: calcStats(unluckyRuns) },
  ];

  console.log(`[${new Date().toISOString()}] [Sim] 蒙地卡羅完成 ${iterations} 次`);
  return results;
}
