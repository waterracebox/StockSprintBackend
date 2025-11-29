// 驗證 JWT Token 並將使用者資訊附加至請求物件

import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { Role } from "@prisma/client";

// JWT Payload 型別定義
interface JwtPayload {
  userId: number;
  role: Role;
}

/**
 * 驗證 JWT Token 中介軟體
 * 檢查 Authorization header 並驗證 token 有效性
 */
export function authenticateToken(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // 從 header 取得 Bearer token
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // 格式: "Bearer <token>"

  if (!token) {
    res.status(401).json({ error: "缺少驗證 Token" });
    return;
  }

  try {
    // 驗證 token 並解碼 payload
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error("JWT_SECRET 未設定於環境變數");
    }

    const decoded = jwt.verify(token, secret) as JwtPayload;
    
    // 將使用者資訊附加至請求物件
    req.user = {
      userId: decoded.userId,
      role: decoded.role,
    };

    next();
  } catch (error: any) {
    console.error("Token 驗證失敗:", error.message);
    res.status(401).json({ error: "無效的 Token" });
    return;
  }
}

/**
 * 檢查管理員權限中介軟體
 * 必須在 authenticateToken 之後使用
 */
export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({ error: "未驗證" });
    return;
  }

  if (req.user.role !== "ADMIN") {
    res.status(403).json({ error: "需要管理員權限" });
    return;
  }

  next();
}
