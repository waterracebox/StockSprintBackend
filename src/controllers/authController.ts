// 處理使用者註冊、登入與取得個人資訊的 API 邏輯

import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../db.js";
import { getGameState } from "../services/gameService.js";

/**
 * 使用者註冊
 * POST /api/auth/register
 */
export async function register(req: Request, res: Response): Promise<void> {
  try {
    const { username, password, displayName, isEmployee } = req.body;

    // 去除前後空白
    const trimmedUsername = username?.trim();
    const trimmedDisplayName = displayName?.trim();

    // 驗證必填欄位
    if (!trimmedUsername || !password) {
      res.status(400).json({ error: "使用者名稱與密碼為必填" });
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

    // 取得當前的初始現金設定（若不存在則使用預設 50）
    const gameState = await getGameState();
    const initialCash = Number.isFinite(gameState.initialCash) ? gameState.initialCash : 50;

    // 加密密碼（使用 bcrypt，加密強度為 10）
    const hashedPassword = await bcrypt.hash(password, 10);

    // 建立新使用者（依據目前遊戲設定的初始現金）
    const newUser = await prisma.user.create({
      data: {
        username: trimmedUsername,
        password: hashedPassword,
        displayName: trimmedDisplayName || trimmedUsername, // 若未提供顯示名稱則使用 username
        cash: initialCash,
        stocks: 0,
        isEmployee: Boolean(isEmployee),
        role: "USER",
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        cash: true,
        stocks: true,
        isEmployee: true,
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
        avatar: true,
        cash: true,
        stocks: true,
        debt: true,
        role: true,
        firstSignIn: true,
        isEmployee: true,
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
 * 更新使用者頭像
 * PATCH /api/auth/avatar
 * 需要驗證 (Protected Route)
 */
export async function updateAvatar(req: Request, res: Response): Promise<void> {
  try {
    // 驗證使用者身份（由 authenticateToken 中介軟體提供）
    if (!req.user) {
      res.status(401).json({ error: "未驗證" });
      return;
    }

    const { avatar } = req.body;

    // 驗證必填欄位
    if (!avatar || typeof avatar !== 'string') {
      res.status(400).json({ error: "頭像路徑為必填且必須為字串" });
      return;
    }

    // 簡單驗證頭像格式（可根據需求擴充）
    const validExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
    const isValidFormat = validExtensions.some(ext => avatar.toLowerCase().endsWith(ext));
    
    if (!isValidFormat) {
      res.status(400).json({ 
        error: "不支援的頭像格式，請使用 PNG、JPG、JPEG、GIF 或 WEBP" 
      });
      return;
    }

    // 更新使用者頭像並遞增計數器（Phase 4：用於結束儀式統計）
    const updatedUser = await prisma.user.update({
      where: { id: req.user.userId },
      data: { 
        avatar: avatar.trim(),
        avatarUpdateCount: { increment: 1 } // 累加更換次數
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatar: true,
        cash: true,
        stocks: true,
        debt: true,
        role: true,
        isEmployee: true,
        avatarUpdateCount: true, // 回傳更新後的計數
        updatedAt: true,
      },
    });

    console.log(
      `[${new Date().toISOString()}] [Auth] 使用者 ${req.user.userId} 更新頭像: ${avatar}，累計 ${updatedUser.avatarUpdateCount} 次`
    );

    res.status(200).json({
      message: "頭像更新成功",
      user: updatedUser,
    });
  } catch (error: any) {
    console.error(
      `[${new Date().toISOString()}] [Auth] 更新頭像失敗:`,
      error.message
    );
    res.status(500).json({ error: "伺服器錯誤" });
  }
}

/**
 * 更新帳號設定（目前僅允許 isEmployee）
 * PATCH /api/auth/account
 * 需要驗證 (Protected Route)
 */
export async function updateAccount(req: Request, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "未驗證" });
      return;
    }

    const { isEmployee } = req.body;
    if (typeof isEmployee !== 'boolean') {
      res.status(400).json({ error: "isEmployee 必須為布林值" });
      return;
    }

    const updatedUser = await prisma.user.update({
      where: { id: req.user.userId },
      data: { isEmployee },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatar: true,
        cash: true,
        stocks: true,
        debt: true,
        role: true,
        firstSignIn: true,
        isEmployee: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.status(200).json({ message: "帳號設定已更新", user: updatedUser });
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] [Auth] 更新帳號設定失敗:`, error.message);
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
    const { username, password, displayName, adminSecret, isEmployee } = req.body;

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

    // 檢查使用者名稱是否已存在
    const existingUser = await prisma.user.findUnique({
      where: { username },
    });

    if (existingUser) {
      res.status(409).json({ error: "使用者名稱已被使用" });
      return;
    }

    // 取得當前的初始現金設定（若不存在則使用預設 50）
    const gameState = await getGameState();
    const initialCash = Number.isFinite(gameState.initialCash) ? gameState.initialCash : 50;

    // 加密密碼
    const hashedPassword = await bcrypt.hash(password, 10);

    // 建立管理員使用者
    const newAdmin = await prisma.user.create({
      data: {
        username,
        password: hashedPassword,
        displayName: displayName || username,
        cash: initialCash,
        stocks: 0,
        isEmployee: Boolean(isEmployee),
        role: "ADMIN", // 設定為管理員角色
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        cash: true,
        stocks: true,
        isEmployee: true,
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
