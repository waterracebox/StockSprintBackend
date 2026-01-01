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
          // 判斷是 Quiz 還是 Red Envelope
          const gameType = payload?.gameType as "QUIZ" | "RED_ENVELOPE" | undefined;

          if (gameType === "QUIZ") {
            // 【修改】檢查是否提供 questionId (發布模式)
            const questionId = payload?.questionId as number | undefined;

            if (questionId) {
              // 【發布模式】：從指定題目開始
              const selectedQuestion = await prisma.quizQuestion.findUnique({
                where: { id: questionId },
              });

              if (!selectedQuestion) {
                console.warn(
                  `${new Date().toISOString()} ${LOG_PREFIX} Quiz 發布失敗：題目 #${questionId} 不存在`
                );
                socket.emit("ERROR", { message: `題目 #${questionId} 不存在` });
                break;
              }

              // 【關鍵】自動推進邏輯：查詢下一題
              const nextQuestion = await prisma.quizQuestion.findFirst({
                where: { id: { gt: questionId } }, // id 大於當前題目
                orderBy: { id: "asc" },
              });

              const nextState: MiniGameState = {
                gameType: "QUIZ",
                phase: "PREPARE", // 【階段】進入預覽模式
                startTime: Date.now(),
                endTime: 0,
                data: {
                  currentQuizId: questionId, // 當前發布的題目 ID
                  question: {
                    title: selectedQuestion.question,
                    options: [
                      selectedQuestion.optionA,
                      selectedQuestion.optionB,
                      selectedQuestion.optionC,
                      selectedQuestion.optionD,
                    ],
                    correctAnswer: selectedQuestion.correctAnswer,
                    rewards: selectedQuestion.rewards,
                    duration: selectedQuestion.duration,
                  },
                  nextCandidateId: nextQuestion ? nextQuestion.id : undefined, // 【自動推進】下一題 ID
                },
              };

              global.currentMiniGame = nextState;
              await saveMiniGameState(nextState);

              io.emit("MINIGAME_SYNC", nextState);
              console.log(
                `${new Date().toISOString()} ${LOG_PREFIX} Admin ${socket.data?.userId} 發布題目 #${questionId}，下一題預選 #${nextQuestion?.id || "null"}`
              );
            } else {
              // 【初始化模式】：選擇第一題作為 nextCandidateId
              const firstQuestion = await prisma.quizQuestion.findFirst({
                orderBy: { id: "asc" },
              });

              if (!firstQuestion) {
                console.warn(`${new Date().toISOString()} ${LOG_PREFIX} Quiz 初始化失敗：題庫為空`);
                socket.emit("ERROR", { message: "題庫為空，請先新增題目" });
                break;
              }

              const nextState: MiniGameState = {
                gameType: "QUIZ",
                phase: "IDLE",
                startTime: Date.now(),
                endTime: 0,
                data: {
                  nextCandidateId: firstQuestion.id, // 預選第一題
                },
              };

              global.currentMiniGame = nextState;
              await saveMiniGameState(nextState);

              io.emit("MINIGAME_SYNC", nextState);
              console.log(
                `${new Date().toISOString()} ${LOG_PREFIX} Admin ${socket.data?.userId} 初始化 Quiz，預選題目 #${firstQuestion.id}`
              );
            }
          } else {
            // Red Envelope 初始化邏輯（保留原有邏輯）
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
          }
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

        case "REVEAL_RESULT": {
          const current = global.currentMiniGame ?? { ...defaultMiniGameState };
          if (current.gameType !== "RED_ENVELOPE" || current.phase !== "GAMING") {
            console.warn(
              `${new Date().toISOString()} ${LOG_PREFIX} REVEAL_RESULT 被忽略，phase=${current.phase}, gameType=${current.gameType}`
            );
            break;
          }

          // 【新增】現金獎項發放邏輯
          const packets = current.data?.packets || [];
          const cashWinners = packets.filter((p) => p.isTaken && p.type === "CASH" && p.prizeValue && p.prizeValue > 0);

          if (cashWinners.length > 0) {
            console.log(`${new Date().toISOString()} ${LOG_PREFIX} 開始發放現金獎項，共 ${cashWinners.length} 位得主`);

            try {
              // 批次發放現金
              await prisma.$transaction(async (tx) => {
                let totalDistributed = 0;

                for (const packet of cashWinners) {
                  if (!packet.ownerId || !packet.prizeValue) continue;

                  const userId = Number(packet.ownerId);
                  const amount = packet.prizeValue;

                  await tx.user.update({
                    where: { id: userId },
                    data: { cash: { increment: amount } },
                  });

                  totalDistributed += amount;
                  console.log(
                    `${new Date().toISOString()} ${LOG_PREFIX} 發放現金：User ${userId} +$${amount} (${packet.name})`
                  );
                }

                console.log(
                  `${new Date().toISOString()} ${LOG_PREFIX} 現金發放完成：總計 $${totalDistributed}，${cashWinners.length} 位得主`
                );
              });

              // 【新增】廣播資產更新給所有得主
              for (const packet of cashWinners) {
                if (!packet.ownerId) continue;

                const userId = Number(packet.ownerId);
                const updatedUser = await prisma.user.findUnique({
                  where: { id: userId },
                  select: { cash: true, stocks: true, debt: true, dailyBorrowed: true },
                });

                if (updatedUser) {
                  // 找到該用戶的 socket 並發送資產更新
                  const userSockets = await io.in(`user:${userId}`).fetchSockets();
                  for (const userSocket of userSockets) {
                    userSocket.emit('ASSETS_UPDATE', {
                      cash: updatedUser.cash,
                      stocks: updatedUser.stocks,
                      debt: updatedUser.debt,
                      dailyBorrowed: updatedUser.dailyBorrowed,
                    });
                  }
                  console.log(
                    `${new Date().toISOString()} ${LOG_PREFIX} 已通知 User ${userId} 資產更新 (cash=${updatedUser.cash})`
                  );
                }
              }
            } catch (error: any) {
              console.error(
                `${new Date().toISOString()} ${LOG_PREFIX} 現金發放失敗:`,
                error?.message || error
              );
            }
          }

          const nextState: MiniGameState = {
            ...current,
            phase: "REVEAL",
            startTime: Date.now(),
          };

          global.currentMiniGame = nextState;
          await saveMiniGameState(nextState);
          io.emit("MINIGAME_SYNC", nextState);
          console.log(
            `${new Date().toISOString()} ${LOG_PREFIX} Admin ${socket.data?.userId} 觸發 REVEAL_RESULT，phase=REVEAL 已廣播`
          );
          break;
        }

        case "FORCE_REVEAL": {
          const current = global.currentMiniGame ?? { ...defaultMiniGameState };
          if (current.gameType !== "RED_ENVELOPE" || current.phase !== "REVEAL") {
            console.warn(
              `${new Date().toISOString()} ${LOG_PREFIX} FORCE_REVEAL 被忽略，phase=${current.phase}, gameType=${current.gameType}`
            );
            break;
          }

          console.log(
            `${new Date().toISOString()} ${LOG_PREFIX} Admin ${socket.data?.userId} 觸發 FORCE_REVEAL，強制開始揭曉動畫`
          );

          // 直接廣播 ALL_SCRATCHED 事件，繞過刮刮樂完成檢查
          io.emit("MINIGAME_EVENT", { type: "ALL_SCRATCHED" });
          console.log(
            `${new Date().toISOString()} ${LOG_PREFIX} 已廣播 ALL_SCRATCHED 事件，Display 將開始揭曉動畫`
          );
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
    
    // 【新增】處理刮刮樂完成
    if (action === "SCRATCH_COMPLETE") {
      try {
        const userId = socket.data?.userId;
        if (!userId) {
          console.warn(`${new Date().toISOString()} ${LOG_PREFIX} SCRATCH_COMPLETE 收到但 userId 缺失`);
          return;
        }

        const state = global.currentMiniGame;
        if (!state || state.gameType !== "RED_ENVELOPE" || state.phase !== "REVEAL") {
          console.warn(
            `${new Date().toISOString()} ${LOG_PREFIX} SCRATCH_COMPLETE 被忽略，當前狀態不符 (gameType=${state?.gameType}, phase=${state?.phase})`
          );
          return;
        }

        const packets = state.data?.packets || [];
        const userPacketIndex = packets.findIndex((p) => String(p.ownerId) === String(userId));

        if (userPacketIndex === -1) {
          console.warn(`${new Date().toISOString()} ${LOG_PREFIX} User ${userId} 沒有紅包，無法標記 isScratched`);
          return;
        }

        packets[userPacketIndex].isScratched = true;

        const takenCount = packets.filter((p) => p.isTaken).length;
        const scratchedCount = packets.filter((p) => p.isScratched).length;

        console.log(
          `${new Date().toISOString()} ${LOG_PREFIX} User ${userId} 完成刮刮樂。進度: ${scratchedCount}/${takenCount}`
        );

        saveMiniGameState(state).catch((err) =>
          console.error(`${new Date().toISOString()} ${LOG_PREFIX} 備份狀態失敗:`, err)
        );

        if (scratchedCount === takenCount) {
          console.log(
            `${new Date().toISOString()} ${LOG_PREFIX} 所有玩家刮刮樂完成，廣播 ALL_SCRATCHED 事件`
          );
          io.emit("MINIGAME_EVENT", { type: "ALL_SCRATCHED" });
        }
      } catch (error: any) {
        console.error(`${new Date().toISOString()} ${LOG_PREFIX} SCRATCH_COMPLETE 處理失敗:`, error?.message || error);
      }
      return;
    }
    
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

      // 【移除】不在搶紅包時發放現金，改為揭曉時才發放
      // const prizeValue = target.type === "CASH" ? Number(target.prizeValue ?? 0) : 0;

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

        // 【移除】不在此時發放現金
        // if (prizeValue > 0) {
        //   await tx.user.update({
        //     where: { id: userId },
        //     data: { cash: { increment: prizeValue } },
        //   });
        // }
      });

      io.emit("MINIGAME_EVENT", { type: "PACKET_TAKEN", index: packetIndex, ownerId: String(userId) });
      // 追加同步，確保所有端狀態一致（避免漏掉事件）
      io.emit("MINIGAME_SYNC", nextState);
      console.log(
        `${new Date().toISOString()} ${LOG_PREFIX} User ${userId} 搶得紅包 #${packetIndex} (${target.name}) type=${target.type}`
      );

      const successResp = {
        status: "SUCCESS",
        index: packetIndex,
        prize: { name: target.name, type: target.type, prizeValue: target.prizeValue || 0, ownerId: String(userId) },
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
