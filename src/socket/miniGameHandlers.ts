import type { Server, Socket } from "socket.io";
import { defaultMiniGameState, initRedEnvelopeGame, saveMiniGameState, withLatestParticipants } from "../services/miniGameService.js";
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
          const allowGuest = Boolean(payload?.allowGuest);
          const consolation = {
            name: String(payload?.consolation?.name || "參加獎"),
            type: (payload?.consolation?.type === "CASH" ? "CASH" : "PHYSICAL") as "PHYSICAL" | "CASH",
            value: Number.isFinite(Number(payload?.consolation?.value)) ? Number(payload?.consolation?.value) : 0,
          };

          const nextState = await initRedEnvelopeGame({ allowGuest, consolation });
          io.emit("MINIGAME_SYNC", nextState);
          console.log(
            `${new Date().toISOString()} ${LOG_PREFIX} Admin ${socket.data?.userId} 觸發 INIT_GAME，已載入獎項與安慰獎並廣播 (allowGuest=${allowGuest}, consolation=${consolation.name}/${consolation.type}/${consolation.value})`
          );
          break;
        }

        case "START_SHUFFLE": {
          const current = global.currentMiniGame ?? { ...defaultMiniGameState };
          if (current.gameType !== "RED_ENVELOPE") {
            console.warn(`${new Date().toISOString()} ${LOG_PREFIX} START_SHUFFLE 被忽略，當前 gameType=${current.gameType}`);
            break;
          }

          const updatedWithParticipants = await withLatestParticipants(current);
          const nextState: MiniGameState = {
            ...updatedWithParticipants,
            phase: "SHUFFLE",
            startTime: Date.now(),
          };

          global.currentMiniGame = nextState;
          await saveMiniGameState(nextState);
          io.emit("MINIGAME_SYNC", nextState);
          console.log(`${new Date().toISOString()} ${LOG_PREFIX} Admin ${socket.data?.userId} 觸發 START_SHUFFLE，狀態 SHUFFLE 已廣播並更新參與者`);
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
