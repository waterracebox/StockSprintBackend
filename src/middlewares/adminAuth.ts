import { Request, Response, NextFunction } from 'express';

/**
 * Admin 權限驗證中間件
 * 必須在 authenticateToken 之後使用
 */
export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({ error: '未驗證' });
    return;
  }

  if (req.user.role !== 'ADMIN') {
    res.status(403).json({ error: '需要管理員權限' });
    return;
  }

  next();
}
