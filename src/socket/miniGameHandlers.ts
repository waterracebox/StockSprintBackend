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

    try {
      const action = payload?.type as string | undefined;

      switch (action) {
        case "RESET_GAME": {
          const nextState: MiniGameState = { ...defaultMiniGameState };
          global.currentMiniGame = nextState;
          await saveMiniGameState(nextState);

          io.emit("MINIGAME_SYNC", nextState);
          console.log(`${new Date().toISOString()} ${LOG_PREFIX} Admin ${socket.data?.userId} 觸發 RESET_GAME，已重置並廣播`);
          break;
        }

        case "INIT_GAME": {
          const nextState: MiniGameState = {
            gameType: "RED_ENVELOPE",
            phase: "IDLE",
            startTime: Date.now(),
            endTime: 0,
            data: {},
          };

          global.currentMiniGame = nextState;
          await saveMiniGameState(nextState);

          io.emit("MINIGAME_SYNC", nextState);
          console.log(`${new Date().toISOString()} ${LOG_PREFIX} Admin ${socket.data?.userId} 觸發 INIT_GAME，狀態已設定為 RED_ENVELOPE/IDLE 並廣播`);
          break;
        }

        default: {
          console.warn(`${new Date().toISOString()} ${LOG_PREFIX} 收到未支援的 ADMIN_MINIGAME_ACTION: ${String(action)}`);
          break;
        }
      }
    } catch (error) {
      console.error(`${new Date().toISOString()} ${LOG_PREFIX} ADMIN_MINIGAME_ACTION 處理失敗:`, error);
    }
  });
}
