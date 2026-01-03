import { Request, Response } from "express";
import { prisma } from "../db.js";

const LOG_PREFIX = "[Admin][Minority]";

/** 取得題庫列表 */
export async function getQuestions(req: Request, res: Response): Promise<void> {
  try {
    const questions = await prisma.minorityQuestion.findMany({
      orderBy: { id: "asc" },
    });
    res.json(questions);
  } catch (error: any) {
    console.error(`${new Date().toISOString()} ${LOG_PREFIX} 取得題庫失敗:`, error);
    res.status(500).json({ error: "取得題庫失敗" });
  }
}

/** 新增題目 */
export async function createQuestion(req: Request, res: Response): Promise<void> {
  try {
    const { question, optionA, optionB, optionC, optionD, duration } = req.body;

    // 驗證必填欄位
    if (!question || !optionA || !optionB || !optionC || !optionD) {
      res.status(400).json({ error: "題目與選項為必填" });
      return;
    }

    const created = await prisma.minorityQuestion.create({
      data: {
        question,
        optionA,
        optionB,
        optionC,
        optionD,
        duration: duration ? Number(duration) : 10,
      },
    });

    console.log(`${new Date().toISOString()} ${LOG_PREFIX} 新增題目 #${created.id}: ${created.question}`);
    res.status(201).json(created);
  } catch (error: any) {
    console.error(`${new Date().toISOString()} ${LOG_PREFIX} 新增題目失敗:`, error);
    res.status(400).json({ error: error.message || "新增題目失敗" });
  }
}

/** 更新題目 */
export async function updateQuestion(req: Request, res: Response): Promise<void> {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "無效的題目 ID" });
      return;
    }

    const { question, optionA, optionB, optionC, optionD, duration } = req.body;

    const updated = await prisma.minorityQuestion.update({
      where: { id },
      data: {
        ...(question && { question }),
        ...(optionA && { optionA }),
        ...(optionB && { optionB }),
        ...(optionC && { optionC }),
        ...(optionD && { optionD }),
        ...(duration !== undefined && { duration: Number(duration) }),
      },
    });

    console.log(`${new Date().toISOString()} ${LOG_PREFIX} 更新題目 #${id}`);
    res.json(updated);
  } catch (error: any) {
    console.error(`${new Date().toISOString()} ${LOG_PREFIX} 更新題目失敗:`, error);
    res.status(400).json({ error: error.message || "更新題目失敗" });
  }
}

/** 刪除題目 */
export async function deleteQuestion(req: Request, res: Response): Promise<void> {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "無效的題目 ID" });
      return;
    }

    await prisma.minorityQuestion.delete({ where: { id } });

    console.log(`${new Date().toISOString()} ${LOG_PREFIX} 刪除題目 #${id}`);
    res.json({ success: true });
  } catch (error: any) {
    console.error(`${new Date().toISOString()} ${LOG_PREFIX} 刪除題目失敗:`, error);
    res.status(400).json({ error: error.message || "刪除題目失敗" });
  }
}
