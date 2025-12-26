import type { Server, Socket } from "socket.io";
import { defaultMiniGameState, saveMiniGameState } from "../services/miniGameService.js";
import type { MiniGameState } from "../types/miniGame.js";

const LOG_PREFIX = "[MiniGame]";

export function registerMiniGameHandlers(io: Server, socket: Socket): void {
  socket.on("ADMIN_MINIGAME_ACTION", async (payload: any) => {
    if (socket.data?.role !== "ADMIN") {
      console.warn(`${new Date().toISOString()} ${LOG_PREFIX} 非管理員嘗試觸發 ADMIN_MINIGAME_ACTION，userId=${socket.data?.userId ?? "unknown"}`);
      return;
    }

    const action = payload?.type;
    if (action !== "RESET_GAME") {
      return;
    }

    try {
      const nextState: MiniGameState = { ...defaultMiniGameState };
      global.currentMiniGame = nextState;
      await saveMiniGameState(nextState);

      io.emit("MINIGAME_SYNC", nextState);
      console.log(`${new Date().toISOString()} ${LOG_PREFIX} Admin ${socket.data?.userId} 觸發 RESET_GAME，已重置並廣播`);
    } catch (error) {
      console.error(`${new Date().toISOString()} ${LOG_PREFIX} RESET_GAME 處理失敗:`, (error as Error).message);
    }
  });
}
