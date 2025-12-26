// 擴充 Express Request 與全域狀態
import { Role } from "@prisma/client";
import type { MiniGameState } from "./miniGame";

declare global {
  // 供遊戲伺服器保存當前小遊戲狀態
  // eslint-disable-next-line no-var
  var currentMiniGame: MiniGameState | undefined;

  namespace Express {
    interface Request {
      user?: {
        userId: number;
        role: Role;
      };
    }
  }
}
