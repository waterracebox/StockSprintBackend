import { Request, Response } from "express";
import { prisma } from "../db.js";

const LOG_PREFIX = "[Admin][RedEnvelope]";

/** 取得紅包獎項列表 */
export async function getStats(req: Request, res: Response): Promise<void> {
  try {
    const items = await prisma.redEnvelopeItem.findMany({
      orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
    });
    res.json(items);
  } catch (error: any) {
    console.error(`${new Date().toISOString()} ${LOG_PREFIX} 取得列表失敗:`, error);
    res.status(500).json({ error: "取得紅包獎項失敗" });
  }
}

/** 新增紅包獎項 */
export async function createItem(req: Request, res: Response): Promise<void> {
  try {
    const { name, type = "PHYSICAL", prizeValue = 0, amount, displayOrder = 0, isActive = true } = req.body;

    if (!name || typeof name !== "string") throw new Error("name 必填");
    if (!["PHYSICAL", "CASH"].includes(type)) throw new Error("type 必須為 PHYSICAL 或 CASH");

    const parsedAmount = Number.parseInt(amount, 10);
    if (!Number.isInteger(parsedAmount) || parsedAmount < 0) throw new Error("amount 必須為非負整數");

    const parsedPrizeValue = Number.parseInt(prizeValue, 10);
    if (type === "CASH" && (!Number.isInteger(parsedPrizeValue) || parsedPrizeValue < 0)) {
      throw new Error("prizeValue 必須為非負整數");
    }

    const parsedDisplayOrder = Number.parseInt(displayOrder, 10);

    const created = await prisma.redEnvelopeItem.create({
      data: {
        name,
        type,
        prizeValue: Number.isInteger(parsedPrizeValue) ? parsedPrizeValue : 0,
        amount: parsedAmount,
        displayOrder: Number.isInteger(parsedDisplayOrder) ? parsedDisplayOrder : 0,
        isActive: Boolean(isActive),
      },
    });

    console.log(`${new Date().toISOString()} ${LOG_PREFIX} 新增獎項 #${created.id} ${created.name}`);
    res.status(201).json(created);
  } catch (error: any) {
    console.error(`${new Date().toISOString()} ${LOG_PREFIX} 新增失敗:`, error);
    res.status(400).json({ error: error.message || "新增紅包獎項失敗" });
  }
}

/** 更新紅包獎項 */
export async function updateItem(req: Request, res: Response): Promise<void> {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) throw new Error("無效的 id");

    const { name, type, prizeValue, amount, displayOrder, isActive } = req.body;

    if (type && !["PHYSICAL", "CASH"].includes(type)) throw new Error("type 必須為 PHYSICAL 或 CASH");

    const payload: Record<string, unknown> = {};

    if (name !== undefined) payload.name = String(name);
    if (type !== undefined) payload.type = type;

    if (amount !== undefined) {
      const parsedAmount = Number.parseInt(amount, 10);
      if (!Number.isInteger(parsedAmount) || parsedAmount < 0) throw new Error("amount 必須為非負整數");
      payload.amount = parsedAmount;
    }

    if (prizeValue !== undefined) {
      const parsedPrizeValue = Number.parseInt(prizeValue, 10);
      if (!Number.isInteger(parsedPrizeValue) || parsedPrizeValue < 0) throw new Error("prizeValue 必須為非負整數");
      payload.prizeValue = parsedPrizeValue;
    }

    if (displayOrder !== undefined) {
      const parsedDisplayOrder = Number.parseInt(displayOrder, 10);
      if (!Number.isInteger(parsedDisplayOrder)) throw new Error("displayOrder 必須為整數");
      payload.displayOrder = parsedDisplayOrder;
    }

    if (isActive !== undefined) payload.isActive = Boolean(isActive);

    await prisma.redEnvelopeItem.update({ where: { id }, data: payload });

    console.log(`${new Date().toISOString()} ${LOG_PREFIX} 更新獎項 #${id}`);
    res.json({ success: true });
  } catch (error: any) {
    console.error(`${new Date().toISOString()} ${LOG_PREFIX} 更新失敗:`, error);
    res.status(400).json({ error: error.message || "更新紅包獎項失敗" });
  }
}

/** 刪除紅包獎項 */
export async function deleteItem(req: Request, res: Response): Promise<void> {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) throw new Error("無效的 id");

    await prisma.redEnvelopeItem.delete({ where: { id } });

    console.log(`${new Date().toISOString()} ${LOG_PREFIX} 刪除獎項 #${id}`);
    res.json({ success: true });
  } catch (error: any) {
    console.error(`${new Date().toISOString()} ${LOG_PREFIX} 刪除失敗:`, error);
    res.status(400).json({ error: error.message || "刪除紅包獎項失敗" });
  }
}
