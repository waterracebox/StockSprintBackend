// 定義身份驗證相關的 API 路由

import { Router } from "express";
import { register, login, getMe, registerAdmin, updateAvatar, updateAccount } from "../controllers/authController.js";
import { authenticateToken } from "../middlewares/authMiddleware.js";

const router = Router();

// POST /api/auth/register - 使用者註冊
router.post("/register", register);

// POST /api/auth/register-admin - 管理員註冊（需要管理員金鑰）
router.post("/register-admin", registerAdmin);

// POST /api/auth/login - 使用者登入
router.post("/login", login);

// GET /api/auth/me - 取得當前使用者資訊（需驗證）
router.get("/me", authenticateToken, getMe);

// PATCH /api/auth/avatar - 更新使用者頭像（需驗證）
router.patch("/avatar", authenticateToken, updateAvatar);

// PATCH /api/auth/account - 更新帳號設定（需驗證）
router.patch("/account", authenticateToken, updateAccount);

export default router;
