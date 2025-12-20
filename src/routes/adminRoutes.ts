import { Router } from 'express';
import { authenticateToken } from '../middlewares/authMiddleware.js';
import { requireAdmin } from '../middlewares/adminAuth.js';
import {
  startGameHandler,
  stopGameHandler,
  resumeGameHandler,
  restartGameHandler,
  resetGameHandler,
  updateParamsHandler,
  getParamsHandler,
  getMonitorHistoryHandler,
  getUsersHandler,         // 新增
  updateUserHandler,       // 新增
  deleteUserHandler,       // 新增
} from '../controllers/adminController.js';
import {
  batchImportEvents,
  createEvent,
  deleteEvent,
  generateScript,
  getEvents,
  previewScript,
  runValidation,
  updateEvent,
  updateScriptDay,
} from '../controllers/scriptController.js';

const router = Router();

// 套用雙重驗證：先驗證 JWT，再驗證 Admin 角色
router.use(authenticateToken);
router.use(requireAdmin);

// 遊戲控制
router.post('/game/start', startGameHandler);
router.post('/game/stop', stopGameHandler);
router.post('/game/resume', resumeGameHandler);
router.post('/game/restart', restartGameHandler);
router.post('/game/reset', resetGameHandler);

// 參數管理
router.get('/params', getParamsHandler);
router.put('/params', updateParamsHandler);

// 使用者管理（新增）
router.get('/users', getUsersHandler);
router.put('/users/:id', updateUserHandler);
router.delete('/users/:id', deleteUserHandler);

// 監控服務
router.get('/monitor/history', getMonitorHistoryHandler);

// 劇本事件 CRUD
router.get('/events', getEvents);
router.post('/events', createEvent);
router.put('/events/:id', updateEvent);
router.delete('/events/:id', deleteEvent);
router.post('/events/batch', batchImportEvents);

// 劇本生成與預覽
router.post('/script/generate', generateScript);
router.get('/script/preview', previewScript);
router.put('/script/day/:day', updateScriptDay);

// 蒙地卡羅模擬驗證
router.post('/validate/run', runValidation);

export default router;
