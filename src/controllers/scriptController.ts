import { Request, Response } from 'express';
import { Trend } from '@prisma/client';
import { prisma } from '../db.js';
import { loadScriptData } from '../services/gameService.js';
import { runScriptGeneration } from '../services/scriptGenerator.js';
import { runSimulation } from '../services/simulationService.js';

// 取得全部事件（依 day 排序）
export async function getEvents(req: Request, res: Response): Promise<void> {
  try {
    const events = await prisma.event.findMany({ orderBy: { day: 'asc' } });
    res.json(events);
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] [Admin] 取得事件失敗:`, error.message);
    res.status(500).json({ error: '取得事件失敗' });
  }
}

// 新增事件
export async function createEvent(req: Request, res: Response): Promise<void> {
  try {
    const { day, title, news, trend } = req.body;

    if (!Object.values(Trend).includes(trend as Trend)) {
      res.status(400).json({ error: 'trend 不合法' });
      return;
    }

    const created = await prisma.event.create({
      data: {
        day: Number(day),
        title: String(title),
        news: news ?? null,
        trend: trend as Trend,
      },
    });

    res.status(201).json({ message: '事件已新增', event: created });
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] [Admin] 新增事件失敗:`, error.message);
    res.status(500).json({ error: '新增事件失敗' });
  }
}

// 更新事件
export async function updateEvent(req: Request, res: Response): Promise<void> {
  try {
    const eventId = Number(req.params.id);
    const { day, title, news, trend } = req.body;

    if (!Object.values(Trend).includes(trend as Trend)) {
      res.status(400).json({ error: 'trend 不合法' });
      return;
    }

    const updated = await prisma.event.update({
      where: { id: eventId },
      data: {
        day: Number(day),
        title: String(title),
        news: news ?? null,
        trend: trend as Trend,
      },
    });

    res.json({ message: '事件已更新', event: updated });
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] [Admin] 更新事件失敗:`, error.message);
    res.status(500).json({ error: '更新事件失敗' });
  }
}

// 刪除事件
export async function deleteEvent(req: Request, res: Response): Promise<void> {
  try {
    const eventId = Number(req.params.id);
    await prisma.event.delete({ where: { id: eventId } });
    res.json({ message: '事件已刪除' });
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] [Admin] 刪除事件失敗:`, error.message);
    res.status(500).json({ error: '刪除事件失敗' });
  }
}

// 批次匯入（先清空再建立）
export async function batchImportEvents(req: Request, res: Response): Promise<void> {
  try {
    const events = req.body as Array<{ day: number; title: string; news?: string; trend: Trend }>;

    if (!Array.isArray(events)) {
      res.status(400).json({ error: 'payload 必須為陣列' });
      return;
    }

    for (const ev of events) {
      if (!Object.values(Trend).includes(ev.trend)) {
        res.status(400).json({ error: `trend 不合法: ${ev.trend}` });
        return;
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.event.deleteMany({});
      if (events.length > 0) {
        await tx.event.createMany({
          data: events.map((ev) => ({
            day: Number(ev.day),
            title: String(ev.title),
            news: ev.news ?? null,
            trend: ev.trend,
          })),
        });
      }
    });

    res.status(201).json({ message: 'JSON 劇本已儲存' });
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] [Admin] 批次匯入事件失敗:`, error.message);
    res.status(500).json({ error: '批次匯入事件失敗' });
  }
}

// 產生劇本
export async function generateScript(req: Request, res: Response): Promise<void> {
  try {
    const { targetDailyChange = 0.05, bullMarketDrift = 0.1, decayRate = 0.9 } = req.body;
    await runScriptGeneration({ targetDailyChange: Number(targetDailyChange), bullMarketDrift: Number(bullMarketDrift), decayRate: Number(decayRate) });
    res.json({ message: '120 天劇本已產生' });
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] [Admin] 劇本生成失敗:`, error.message);
    res.status(500).json({ error: '劇本生成失敗' });
  }
}

// 劇本預覽
export async function previewScript(req: Request, res: Response): Promise<void> {
  try {
    const days = await prisma.scriptDay.findMany({ orderBy: { day: 'asc' } });
    res.json(days);
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] [Admin] 劇本預覽失敗:`, error.message);
    res.status(500).json({ error: '取得劇本失敗' });
  }
}

// 微調單日
export async function updateScriptDay(req: Request, res: Response): Promise<void> {
  try {
    const day = Number(req.params.day);
    const { price, title, news, publishTimeOffset, isNewsBroadcasted } = req.body;

    // 驗證 publishTimeOffset：允許 null / undefined / 數字
    let parsedOffset: number | null | undefined = undefined;
    if (publishTimeOffset === '' || publishTimeOffset === null || publishTimeOffset === undefined) {
      parsedOffset = null;
    } else {
      const offsetNumber = Number(publishTimeOffset);
      if (Number.isNaN(offsetNumber)) {
        res.status(400).json({ error: 'publishTimeOffset 必須為數字或留空' });
        return;
      }
      parsedOffset = offsetNumber;
    }

    // 驗證 isNewsBroadcasted：允許 boolean 或字串 true/false
    let parsedBroadcast: boolean | undefined = undefined;
    if (typeof isNewsBroadcasted === 'boolean') {
      parsedBroadcast = isNewsBroadcasted;
    } else if (isNewsBroadcasted === 'true') {
      parsedBroadcast = true;
    } else if (isNewsBroadcasted === 'false') {
      parsedBroadcast = false;
    }

    const result = await prisma.scriptDay.updateMany({
      where: { day },
      data: {
        price: price !== undefined ? Number(price) : undefined,
        title: title ?? null,
        news: news ?? null,
        publishTimeOffset: parsedOffset,
        isNewsBroadcasted: parsedBroadcast,
      },
    });

    // 更新記憶體中的劇本快取，確保遊戲迴圈同步最新設定
    await loadScriptData();

    res.json({ message: `第 ${day} 天數據已更新`, affected: result.count });
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] [Admin] 微調劇本失敗:`, error.message);
    res.status(500).json({ error: '更新劇本失敗' });
  }
}

// 蒙地卡羅驗證
export async function runValidation(req: Request, res: Response): Promise<void> {
  try {
    const result = await runSimulation();
    res.json(result);
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] [Admin] 驗證劇本失敗:`, error.message);
    res.status(500).json({ error: '驗證劇本失敗' });
  }
}
