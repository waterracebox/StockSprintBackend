import { Request, Response } from 'express';
import { prisma } from '../db.js';

/**
 * 標記使用者已完成新手教學
 * POST /api/user/tutorial/complete
 */
export const markTutorialComplete = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = req.user?.userId;

        if (!userId) {
            res.status(401).json({ error: '未授權' });
            return;
        }

        await prisma.user.update({
            where: { id: userId },
            data: { firstSignIn: false },
        });

        console.log(`[Tutorial] 使用者 ${userId} 完成新手教學`);
        res.json({ success: true });
    } catch (error: any) {
        console.error('[Tutorial] 標記完成失敗:', error);
        res.status(500).json({ error: '伺服器錯誤' });
    }
};
