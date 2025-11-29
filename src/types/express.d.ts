// 擴充 Express Request 介面，新增使用者驗證資訊
import { Role } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: number;
        role: Role;
      };
    }
  }
}

export {};
