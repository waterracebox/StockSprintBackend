import { Router } from "express";
import { authenticateToken } from "../middlewares/authMiddleware.js";
import { requireAdmin } from "../middlewares/adminAuth.js";
import * as minorityController from "../controllers/minorityController.js";

const router = Router();

// 套用雙重驗證：先驗證 JWT，再驗證 Admin 角色
router.use(authenticateToken);
router.use(requireAdmin);

router.get("/", minorityController.getQuestions);
router.post("/", minorityController.createQuestion);
router.put("/:id", minorityController.updateQuestion);
router.delete("/:id", minorityController.deleteQuestion);
router.patch("/reorder", minorityController.reorderQuestions);

export default router;
