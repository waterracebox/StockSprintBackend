import express from 'express';
import { authenticateToken } from '../middlewares/authMiddleware.js';
import { getPredictionHandler } from '../controllers/loanSharkController.js';

const router = express.Router();

/**
 * 地下錢莊相關 API
 * 所有路由皆需要登入驗證
 */

/**
 * GET /api/game/script/prediction
 * 取得明日股市走勢預測
 * 
 * 需求：使用者的 loanSharkVisitCount >= MAX_LOAN_SHARK_AFFINITY
 */
router.get('/prediction', authenticateToken, getPredictionHandler);

export default router;
