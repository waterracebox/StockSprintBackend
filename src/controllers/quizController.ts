import { Request, Response } from "express";
import { prisma } from "../db.js";

const LOG_PREFIX = "[Admin][Quiz]";

/** 取得題庫列表 */
export async function getQuestions(req: Request, res: Response): Promise<void> {
  try {
    const questions = await prisma.quizQuestion.findMany({
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
    const { question, optionA, optionB, optionC, optionD, correctAnswer, rewards, duration } = req.body;

    // 驗證必填欄位
    if (!question || !optionA || !optionB || !optionC || !optionD || !correctAnswer) {
      res.status(400).json({ error: "題目與選項為必填" });
      return;
    }

    // 驗證答案格式
    if (!["A", "B", "C", "D"].includes(correctAnswer)) {
      res.status(400).json({ error: "正確答案必須為 A, B, C, D 其中之一" });
      return;
    }

    const created = await prisma.quizQuestion.create({
      data: {
        question,
        optionA,
        optionB,
        optionC,
        optionD,
        correctAnswer,
        rewards: rewards || { first: 20, second: 15, third: 10, others: 5 },
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

    const { question, optionA, optionB, optionC, optionD, correctAnswer, rewards, duration } = req.body;

    // 驗證答案格式（如果有提供）
    if (correctAnswer && !["A", "B", "C", "D"].includes(correctAnswer)) {
      res.status(400).json({ error: "正確答案必須為 A, B, C, D 其中之一" });
      return;
    }

    const updated = await prisma.quizQuestion.update({
      where: { id },
      data: {
        ...(question && { question }),
        ...(optionA && { optionA }),
        ...(optionB && { optionB }),
        ...(optionC && { optionC }),
        ...(optionD && { optionD }),
        ...(correctAnswer && { correctAnswer }),
        ...(rewards && { rewards }),
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

    await prisma.quizQuestion.delete({ where: { id } });

    console.log(`${new Date().toISOString()} ${LOG_PREFIX} 刪除題目 #${id}`);
    res.json({ success: true });
  } catch (error: any) {
    console.error(`${new Date().toISOString()} ${LOG_PREFIX} 刪除題目失敗:`, error);
    res.status(400).json({ error: error.message || "刪除題目失敗" });
  }
}
