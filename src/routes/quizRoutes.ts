import { Router } from "express";
import { authenticateToken } from "../middlewares/authMiddleware.js";
import { requireAdmin } from "../middlewares/adminAuth.js";
import { getQuestions, createQuestion, updateQuestion, deleteQuestion, reorderQuestions } from "../controllers/quizController.js";

const router = Router();

// 套用雙重驗證：先驗證 JWT，再驗證 Admin 角色
router.use(authenticateToken);
router.use(requireAdmin);

router.get("/", getQuestions);
router.post("/", createQuestion);
router.put("/:id", updateQuestion);
router.delete("/:id", deleteQuestion);
router.patch("/reorder", reorderQuestions);

export default router;
