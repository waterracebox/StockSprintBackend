import { Router } from "express";
import { authenticateToken } from "../middlewares/authMiddleware.js";
import { requireAdmin } from "../middlewares/adminAuth.js";
import { createItem, deleteItem, getStats, updateItem } from "../controllers/redEnvelopeController.js";

const router = Router();

// 需先通過 JWT 與 Admin 驗證
router.use(authenticateToken);
router.use(requireAdmin);

router.get("/", getStats);
router.post("/", createItem);
router.put("/:id", updateItem);
router.delete("/:id", deleteItem);

export default router;
