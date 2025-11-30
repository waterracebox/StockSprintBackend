// 處理使用者註冊、登入與取得個人資訊的 API 邏輯

import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../db.js";

/**
 * 使用者註冊
 * POST /api/auth/register
 */
export async function register(req: Request, res: Response): Promise<void> {
  try {
    const { username, password, displayName } = req.body;

    // 去除前後空白
    const trimmedUsername = username?.trim();
    const trimmedDisplayName = displayName?.trim();

    // 驗證必填欄位
    if (!trimmedUsername || !password) {
      res.status(400).json({ error: "使用者名稱與密碼為必填" });
      return;
    }

    // 驗證密碼強度：至少8碼，包含大小寫英文及數字
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(password)) {
      res.status(400).json({ 
        error: "密碼至少8碼，需包含大小寫英文及數字" 
      });
      return;
    }

    // 檢查使用者名稱是否已存在
    const existingUser = await prisma.user.findUnique({
      where: { username: trimmedUsername },
    });

    if (existingUser) {
      res.status(409).json({ error: "使用者名稱已被使用" });
      return;
    }

    // 加密密碼（使用 bcrypt，加密強度為 10）
    const hashedPassword = await bcrypt.hash(password, 10);

    // 建立新使用者（預設 cash=50, stocks=0, role=USER）
    const newUser = await prisma.user.create({
      data: {
        username: trimmedUsername,
        password: hashedPassword,
        displayName: trimmedDisplayName || trimmedUsername, // 若未提供顯示名稱則使用 username
        cash: 50,
        stocks: 0,
        role: "USER",
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        cash: true,
        stocks: true,
        role: true,
        createdAt: true,
      },
    });

    res.status(201).json({
      message: "註冊成功",
      user: newUser,
    });
  } catch (error: any) {
    console.error("註冊失敗:", error.message);
    res.status(500).json({ error: "伺服器錯誤" });
  }
}

/**
 * 使用者登入
 * POST /api/auth/login
 */
export async function login(req: Request, res: Response): Promise<void> {
  try {
    const { username, password } = req.body;

    // 去除前後空白
    const trimmedUsername = username?.trim();

    // 驗證必填欄位
    if (!trimmedUsername || !password) {
      res.status(400).json({ error: "使用者名稱與密碼為必填" });
      return;
    }

    // 查詢使用者
    const user = await prisma.user.findUnique({
      where: { username: trimmedUsername },
    });

    if (!user) {
      res.status(401).json({ error: "使用者名稱或密碼錯誤" });
      return;
    }

    // 驗證密碼
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      res.status(401).json({ error: "使用者名稱或密碼錯誤" });
      return;
    }

    // 產生 JWT Token（有效期 3 小時）
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error("JWT_SECRET 未設定於環境變數");
    }

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      secret,
      { expiresIn: "3h" }
    );

    res.status(200).json({
      message: "登入成功",
      token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
      },
    });
  } catch (error: any) {
    console.error("登入失敗:", error.message);
    res.status(500).json({ error: "伺服器錯誤" });
  }
}

/**
 * 取得當前使用者資訊
 * GET /api/auth/me
 * 需要驗證 (Protected Route)
 */
export async function getMe(req: Request, res: Response): Promise<void> {
  try {
    // req.user 由 authenticateToken 中介軟體提供
    if (!req.user) {
      res.status(401).json({ error: "未驗證" });
      return;
    }

    // 查詢使用者資料（排除密碼欄位）
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: {
        id: true,
        username: true,
        displayName: true,
        cash: true,
        stocks: true,
        debt: true,
        role: true,
        firstSignIn: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      res.status(404).json({ error: "使用者不存在" });
      return;
    }

    res.status(200).json({ user });
  } catch (error: any) {
    console.error("取得使用者資料失敗:", error.message);
    res.status(500).json({ error: "伺服器錯誤" });
  }
}

/**
 * 管理員註冊（需要管理員金鑰）
 * POST /api/auth/register-admin
 * 僅供初始化或特殊情況使用
 */
export async function registerAdmin(req: Request, res: Response): Promise<void> {
  try {
    const { username, password, displayName, adminSecret } = req.body;

    // 驗證管理員金鑰
    const expectedSecret = process.env.ADMIN_SECRET;
    if (!expectedSecret) {
      res.status(500).json({ error: "系統未設定管理員金鑰" });
      return;
    }

    if (adminSecret !== expectedSecret) {
      res.status(403).json({ error: "管理員金鑰錯誤" });
      return;
    }

    // 驗證必填欄位
    if (!username || !password) {
      res.status(400).json({ error: "使用者名稱與密碼為必填" });
      return;
    }

    // 驗證密碼強度：至少8碼，包含大小寫英文及數字
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(password)) {
      res.status(400).json({ 
        error: "密碼至少8碼，需包含大小寫英文及數字" 
      });
      return;
    }

    // 檢查使用者名稱是否已存在
    const existingUser = await prisma.user.findUnique({
      where: { username },
    });

    if (existingUser) {
      res.status(409).json({ error: "使用者名稱已被使用" });
      return;
    }

    // 加密密碼
    const hashedPassword = await bcrypt.hash(password, 10);

    // 建立管理員使用者
    const newAdmin = await prisma.user.create({
      data: {
        username,
        password: hashedPassword,
        displayName: displayName || username,
        cash: 50,
        stocks: 0,
        role: "ADMIN", // 設定為管理員角色
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        cash: true,
        stocks: true,
        role: true,
        createdAt: true,
      },
    });

    res.status(201).json({
      message: "管理員註冊成功",
      user: newAdmin,
    });
  } catch (error: any) {
    console.error("管理員註冊失敗:", error.message);
    res.status(500).json({ error: "伺服器錯誤" });
  }
}
