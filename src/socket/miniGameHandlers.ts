import type { Server, Socket } from "socket.io";
import { prisma } from "../db.js";
import {
  TOTAL_PREP_TIME,
  defaultMiniGameState,
  initRedEnvelopeGame,
  saveMiniGameState,
  withLatestParticipants,
} from "../services/miniGameService.js";
import type { MiniGameState } from "../types/miniGame.js";

const LOG_PREFIX = "[MiniGame]";
let grabTimer: NodeJS.Timeout | null = null;

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
          if (grabTimer) {
            clearTimeout(grabTimer);
            grabTimer = null;
          }
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

        case "START_GRAB": {
          const current = global.currentMiniGame ?? { ...defaultMiniGameState };
          if (current.gameType !== "RED_ENVELOPE" || current.phase !== "SHUFFLE") {
            console.warn(
              `${new Date().toISOString()} ${LOG_PREFIX} START_GRAB 被忽略，phase=${current.phase}, gameType=${current.gameType}`
            );
            break;
          }

          if (grabTimer) {
            clearTimeout(grabTimer);
            grabTimer = null;
          }

          const startTime = Date.now() + TOTAL_PREP_TIME;
          const nextState: MiniGameState = {
            ...current,
            phase: "COUNTDOWN",
            startTime,
          };

          global.currentMiniGame = nextState;
          await saveMiniGameState(nextState);
          io.emit("MINIGAME_SYNC", nextState);
          console.log(
            `${new Date().toISOString()} ${LOG_PREFIX} Admin ${socket.data?.userId} 觸發 START_GRAB，進入 COUNTDOWN，startTime=${startTime}`
          );

          grabTimer = setTimeout(async () => {
            try {
              const running = global.currentMiniGame ?? nextState;
              if (running.gameType !== "RED_ENVELOPE") return;

              const gamingState: MiniGameState = { ...running, phase: "GAMING" };
              global.currentMiniGame = gamingState;
              await saveMiniGameState(gamingState);
              io.emit("MINIGAME_SYNC", gamingState);
              console.log(`${new Date().toISOString()} ${LOG_PREFIX} COUNTDOWN 完成，已進入 GAMING`);
            } catch (err) {
              console.error(`${new Date().toISOString()} ${LOG_PREFIX} START_GRAB timer 執行錯誤:`, err);
            } finally {
              grabTimer = null;
            }
          }, TOTAL_PREP_TIME);
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

  socket.on("MINIGAME_ACTION", async (payload: any, callback?: Function) => {
    const action = payload?.type as string | undefined;
    if (action !== "GRAB_PACKET") return;

    try {
      const userId = socket.data?.userId;
      if (!userId) throw new Error("缺少使用者身分");

      const state = global.currentMiniGame;
      if (!state || state.gameType !== "RED_ENVELOPE" || state.phase !== "GAMING") {
        throw new Error("尚未開放搶紅包");
      }

      const packets = state.data?.packets || [];
      const packetIndex = Number(payload?.packetIndex);
      if (!Number.isInteger(packetIndex) || packetIndex < 0 || packetIndex >= packets.length) {
        throw new Error("無效的紅包編號");
      }

      const alreadyTaken = packets.some((p) => p.ownerId === String(userId));
      if (alreadyTaken) {
        throw new Error("每人限搶一包");
      }

      const target = packets[packetIndex];
      if (target.isTaken) {
        throw new Error("手慢了，已被搶走");
      }

      const updatedPackets = packets.map((p) => (p.index === packetIndex ? { ...p, isTaken: true, ownerId: String(userId) } : p));
      const nextState: MiniGameState = {
        ...state,
        data: {
          ...state.data,
          packets: updatedPackets,
        },
      };

      global.currentMiniGame = nextState;

      const prizeValue = target.type === "CASH" ? Number(target.prizeValue ?? 0) : 0;

      await prisma.$transaction(async (tx) => {
        await tx.miniGameRuntime.update({
          where: { key: "CURRENT_GAME" },
          data: {
            gameType: nextState.gameType,
            phase: nextState.phase,
            startTime: BigInt(nextState.startTime || 0),
            endTime: BigInt(nextState.endTime || 0),
            payload: nextState.data ?? {},
          },
        });

        if (prizeValue > 0) {
          await tx.user.update({
            where: { id: userId },
            data: { cash: { increment: prizeValue } },
          });
        }
      });

      io.emit("MINIGAME_EVENT", { type: "PACKET_TAKEN", index: packetIndex, ownerId: String(userId) });
      // 追加同步，確保所有端狀態一致（避免漏掉事件）
      io.emit("MINIGAME_SYNC", nextState);
      console.log(
        `${new Date().toISOString()} ${LOG_PREFIX} User ${userId} 搶得紅包 #${packetIndex} (${target.name}) prize=${target.type}/${prizeValue}`
      );

      const successResp = {
        status: "SUCCESS",
        index: packetIndex,
        prize: { name: target.name, type: target.type, prizeValue, ownerId: String(userId) },
      };

      if (typeof callback === "function") {
        callback(successResp);
      } else {
        socket.emit("MINIGAME_ACTION_RESULT", successResp);
      }
    } catch (error: any) {
      console.error(`${new Date().toISOString()} ${LOG_PREFIX} GRAB_PACKET 失敗:`, error?.message || error);
      const failResp = { status: "FAIL", message: error?.message || "搶紅包失敗" };
      if (typeof callback === "function") {
        callback(failResp);
      } else {
        socket.emit("MINIGAME_ACTION_RESULT", failResp);
      }
    }
  });
}
