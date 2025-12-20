import { Trend } from '@prisma/client';
import { prisma } from '../db.js';

interface GenerateConfig {
  targetDailyChange?: number;
  bullMarketDrift?: number;
  decayRate?: number;
}

// 趨勢對應強度，確保趨勢是主體、隨機波動只是微調
const TREND_STRENGTH_RATIO: Record<Trend, number> = {
  CHAO_LI_DUO: 1.0,
  LI_DUO: 0.5,
  PAN_ZHENG: 0.0,
  LI_KONG: -0.5,
  CHAO_LI_KONG: -1.0,
  BU_YING_XIANG: 0.0,
};

// 依照企劃書演算法產生 120 天劇本
export async function runScriptGeneration(config: GenerateConfig = {}): Promise<void> {
  const { targetDailyChange = 0.05, bullMarketDrift = 0.1, decayRate = 0.9 } = config;

  const gameStatus = await prisma.gameStatus.findUnique({ where: { id: 1 } });
  if (!gameStatus) throw new Error('遊戲狀態不存在');

  const events = await prisma.event.findMany({ orderBy: { day: 'asc' } });
  const eventMap = new Map<number, { title: string; news: string | null; trend: Trend }>();
  events.forEach((event) => {
    eventMap.set(event.day, {
      title: event.title,
      news: event.news ?? null,
      trend: event.trend,
    });
  });

  const priceHistory: Array<{
    day: number;
    price: number;
    title: string | null;
    news: string | null;
    effectiveTrend: string;
    publishTimeOffset: number | null;
    isNewsBroadcasted: boolean;
  }> = [];

  let price = gameStatus.initialPrice;
  const totalDays = gameStatus.totalDays;
  let currentTrendRatio = 0.0;
  let currentTrendName: Trend = Trend.PAN_ZHENG;

  for (let day = 1; day <= totalDays; day++) {
    let todayNewsTitle: string | null = null;
    let todayNewsContent: string | null = null;

    // 預先計算隔天趨勢（含衰退）
    let nextDayTrendRatio = currentTrendRatio * decayRate;
    let nextDayTrendName: Trend = currentTrendName;

    // 今日事件會決定「明天」的趨勢
    if (eventMap.has(day)) {
      const todayEvent = eventMap.get(day)!;
      todayNewsTitle = todayEvent.title;
      todayNewsContent = todayEvent.news;

      if (todayEvent.trend !== Trend.BU_YING_XIANG) {
        nextDayTrendName = todayEvent.trend;
        nextDayTrendRatio = TREND_STRENGTH_RATIO[nextDayTrendName] ?? 0;
      }
    }

    // 隨機波動：確保趨勢是主體、隨機為配角
    const volatilityRange = targetDailyChange * 0.4;
    const randomPercent = (Math.random() - 0.5) * 2 * volatilityRange;

    // 當前趨勢的漲跌幅
    const trendPercent = targetDailyChange * currentTrendRatio;
    const totalChangePercent = trendPercent + randomPercent;

    // 計算新價格並加上牛市漂移
    price = price * (1 + totalChangePercent) + bullMarketDrift;

    // 保底，避免價格跌為 0
    if (price < 1.0) price = 1.0;

    priceHistory.push({
      day,
      price: parseFloat(price.toFixed(2)),
      title: todayNewsTitle,
      news: todayNewsContent,
      effectiveTrend: currentTrendName,
      publishTimeOffset: Math.floor(Math.random() * (gameStatus.timeRatio || 60)),
      isNewsBroadcasted: false,
    });

    // 將今日準備好的趨勢傳遞給明天
    currentTrendRatio = nextDayTrendRatio;
    currentTrendName = nextDayTrendName;
  }

  await prisma.$transaction(async (tx) => {
    await tx.scriptDay.deleteMany({});
    await tx.scriptDay.createMany({ data: priceHistory });
  });

  console.log(`[${new Date().toISOString()}] [Script] 劇本已生成 ${priceHistory.length} 天`);
}
