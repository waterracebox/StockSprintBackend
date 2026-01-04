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

// 【新增】用於存儲 Quiz 自動推進的 Timer
let quizPrepareTimer: NodeJS.Timeout | null = null;
let quizCountdownTimer: NodeJS.Timeout | null = null;
let quizSettleTimer: NodeJS.Timeout | null = null;

// 【新增】Minority 自動推進的 Timer
let minorityPrepareTimer: NodeJS.Timeout | null = null;
let minorityCountdownTimer: NodeJS.Timeout | null = null;
let minoritySettleTimer: NodeJS.Timeout | null = null;

// 【新增】清理所有 Quiz Timer 的函數
function clearQuizTimers() {
  if (quizPrepareTimer) {
    clearTimeout(quizPrepareTimer);
    quizPrepareTimer = null;
  }
  if (quizCountdownTimer) {
    clearTimeout(quizCountdownTimer);
    quizCountdownTimer = null;
  }
  if (quizSettleTimer) {
    clearTimeout(quizSettleTimer);
    quizSettleTimer = null;
  }
  // 【新增】清理 Minority Timer
  if (minorityPrepareTimer) {
    clearTimeout(minorityPrepareTimer);
    minorityPrepareTimer = null;
  }
  if (minorityCountdownTimer) {
    clearTimeout(minorityCountdownTimer);
    minorityCountdownTimer = null;
  }
  if (minoritySettleTimer) {
    clearTimeout(minoritySettleTimer);
    minoritySettleTimer = null;
  }
}

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
          // 【新增】清理 Quiz Timer
          clearQuizTimers();
          
          const nextState: MiniGameState = { ...defaultMiniGameState };
          global.currentMiniGame = nextState;
          await saveMiniGameState(nextState);

          io.emit("MINIGAME_SYNC", nextState);
          console.log(`${new Date().toISOString()} ${LOG_PREFIX} Admin ${socket.data?.userId} 觸發 RESET_GAME，已重置並廣播`);
          break;
        }

        case "INIT_GAME": {
          // 判斷是 Quiz、Red Envelope 還是 Minority
          const gameType = payload?.gameType as "QUIZ" | "RED_ENVELOPE" | "MINORITY" | undefined;

          if (gameType === "MINORITY") {
            const questionId = payload?.questionId as number | undefined;

            if (questionId) {
              // 【發布模式】：啟動三階段自動流程
              const selectedQuestion = await prisma.minorityQuestion.findUnique({
                where: { id: questionId },
              });

              if (!selectedQuestion) {
                console.warn(
                  `${new Date().toISOString()} ${LOG_PREFIX} Minority 發布失敗：題目 #${questionId} 不存在`
                );
                socket.emit("ERROR", { message: `題目 #${questionId} 不存在` });
                break;
              }

              // 【清理舊 Timer】
              clearQuizTimers();

              // 查詢下一題（根據 sortOrder）
              const nextQuestion = await prisma.minorityQuestion.findFirst({
                where: { sortOrder: { gt: selectedQuestion.sortOrder } },
                orderBy: [
                  { sortOrder: "asc" },
                  { id: "asc" }, // Tie-breaker
                ],
              });

              // ========== Step A: PREPARE (讀題階段) ==========
              const prepareEndTime = Date.now() + 5000; // 5 秒讀題
              const prepareState: MiniGameState = {
                gameType: "MINORITY",
                phase: "PREPARE",
                startTime: Date.now(),
                endTime: prepareEndTime,
                data: {
                  currentMinorityId: questionId,
                  question: {
                    title: selectedQuestion.question,
                    options: [
                      selectedQuestion.optionA,
                      selectedQuestion.optionB,
                      selectedQuestion.optionC,
                      selectedQuestion.optionD,
                    ],
                    correctAnswer: "", // Minority 不需要正確答案
                    rewards: null, // Minority 不需要獎勵配置
                    duration: selectedQuestion.duration,
                  },
                  nextCandidateId: nextQuestion ? nextQuestion.id : undefined,
                },
              };

              global.currentMiniGame = prepareState;
              await saveMiniGameState(prepareState);
              io.emit("MINIGAME_SYNC", prepareState);

              console.log(
                `${new Date().toISOString()} ${LOG_PREFIX} [Auto-Flow] Step A: PREPARE 開始 (5s 讀題)`
              );

              // ========== 設定 Timer：5 秒後進入 Step B ==========
              minorityPrepareTimer = setTimeout(async () => {
                try {
                  // Step B: COUNTDOWN (倒數階段)
                  const countdownEndTime = Date.now() + 3000; // 3 秒倒數
                  const countdownState: MiniGameState = {
                    ...prepareState,
                    phase: "COUNTDOWN",
                    startTime: Date.now(),
                    endTime: countdownEndTime,
                  };

                  global.currentMiniGame = countdownState;
                  await saveMiniGameState(countdownState);
                  io.emit("MINIGAME_SYNC", countdownState);

                  console.log(
                    `${new Date().toISOString()} ${LOG_PREFIX} [Auto-Flow] Step B: COUNTDOWN 開始 (3s 倒數)`
                  );

                  // 【新增】立即廣播第一次（t=0ms）
                  io.emit('MINIGAME_COUNTDOWN', { countdown: 3 });
                  console.log(`${new Date().toISOString()} ${LOG_PREFIX} 廣播倒數: 3`);

                  // 然後每秒廣播剩餘數字
                  let countdown = 2; // 從 2 開始
                  const countdownInterval = setInterval(() => {
                    io.emit('MINIGAME_COUNTDOWN', { countdown });
                    console.log(`${new Date().toISOString()} ${LOG_PREFIX} 廣播倒數: ${countdown}`);
                    if (countdown <= 0) {
                      clearInterval(countdownInterval);
                    }
                    countdown--;
                  }, 1000);

                  // ========== 設定 Timer：3 秒後進入 Step C ==========
                  minorityCountdownTimer = setTimeout(async () => {
                    try {
                      // Step C: GAMING (下注階段)
                      const duration = selectedQuestion.duration || 10;
                      const gamingEndTime = Date.now() + duration * 1000;
                      const gamingState: MiniGameState = {
                        ...countdownState,
                        phase: "GAMING",
                        startTime: Date.now(),
                        endTime: gamingEndTime,
                        data: {
                          ...countdownState.data,
                          minorityBets: [], // 初始化下注記錄
                        },
                      };

                      global.currentMiniGame = gamingState;
                      await saveMiniGameState(gamingState);
                      io.emit("MINIGAME_SYNC", gamingState);

                      console.log(
                        `${new Date().toISOString()} ${LOG_PREFIX} [Auto-Flow] Step C: GAMING 開始 (${duration}s 下注)`
                      );

                      // 【新增】========== 設定自動結算 Timer ==========
                      minoritySettleTimer = setTimeout(async () => {
                        await settleMinorityRound(io, selectedQuestion);
                      }, (duration + 1) * 1000); // 多 1 秒緩衝
                    } catch (error) {
                      console.error(
                        `${new Date().toISOString()} ${LOG_PREFIX} [Auto-Flow] Step C 失敗:`,
                        error
                      );
                    }
                  }, 3000);
                } catch (error) {
                  console.error(
                    `${new Date().toISOString()} ${LOG_PREFIX} [Auto-Flow] Step B 失敗:`,
                    error
                  );
                }
              }, 5000);

              console.log(
                `${new Date().toISOString()} ${LOG_PREFIX} Admin ${socket.data?.userId} 發布題目 #${questionId}，啟動自動流程`
              );
            } else {
              // 【初始化模式】：選擇第一題作為 nextCandidateId
              const firstQuestion = await prisma.minorityQuestion.findFirst({
                orderBy: [
                  { sortOrder: "asc" },
                  { id: "asc" }, // Tie-breaker
                ],
              });

              if (!firstQuestion) {
                console.warn(`${new Date().toISOString()} ${LOG_PREFIX} Minority 初始化失敗：題庫為空`);
                socket.emit("ERROR", { message: "題庫為空，請先新增題目" });
                break;
              }

              const nextState: MiniGameState = {
                gameType: "MINORITY",
                phase: "IDLE",
                startTime: Date.now(),
                endTime: 0,
                data: {
                  nextCandidateId: firstQuestion.id,
                },
              };

              global.currentMiniGame = nextState;
              await saveMiniGameState(nextState);

              io.emit("MINIGAME_SYNC", nextState);
              console.log(
                `${new Date().toISOString()} ${LOG_PREFIX} Admin ${socket.data?.userId} 初始化 Minority，預選題目 #${firstQuestion.id}`
              );
            }
          } else if (gameType === "QUIZ") {
            // 【修改】檢查是否提供 questionId (發布模式)
            const questionId = payload?.questionId as number | undefined;

            if (questionId) {
              // 【發布模式】：啟動三階段自動流程
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

              // 【新增】清理舊的 Timer（防止重複觸發）
              clearQuizTimers();

              // 查詢下一題（根據 sortOrder）
              const nextQuestion = await prisma.quizQuestion.findFirst({
                where: { sortOrder: { gt: selectedQuestion.sortOrder } },
                orderBy: [
                  { sortOrder: "asc" },
                  { id: "asc" }, // Tie-breaker
                ],
              });

              // ========== Step A: PREPARE (讀題階段) ==========
              const prepareEndTime = Date.now() + 5000; // 5 秒讀題
              const prepareState: MiniGameState = {
                gameType: "QUIZ",
                phase: "PREPARE",
                startTime: Date.now(),
                endTime: prepareEndTime,
                data: {
                  currentQuizId: questionId,
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
                  nextCandidateId: nextQuestion ? nextQuestion.id : undefined,
                },
              };

              global.currentMiniGame = prepareState;
              await saveMiniGameState(prepareState);
              io.emit("MINIGAME_SYNC", prepareState);

              console.log(
                `${new Date().toISOString()} ${LOG_PREFIX} [Auto-Flow] Step A: PREPARE 開始 (5s 讀題)`
              );

              // ========== 設定 Timer：5 秒後進入 Step B ==========
              quizPrepareTimer = setTimeout(async () => {
                try {
                  // Step B: COUNTDOWN (倒數階段)
                  const countdownEndTime = Date.now() + 3000; // 3 秒倒數
                  const countdownState: MiniGameState = {
                    ...prepareState,
                    phase: "COUNTDOWN",
                    startTime: Date.now(),
                    endTime: countdownEndTime,
                  };

                  global.currentMiniGame = countdownState;
                  await saveMiniGameState(countdownState);
                  io.emit("MINIGAME_SYNC", countdownState);

                  console.log(
                    `${new Date().toISOString()} ${LOG_PREFIX} [Auto-Flow] Step B: COUNTDOWN 開始 (3s 倒數)`
                  );

                  // 【新增】立即廣播第一次（t=0ms）
                  io.emit('MINIGAME_COUNTDOWN', { countdown: 3 });
                  console.log(`${new Date().toISOString()} ${LOG_PREFIX} 廣播倒數: 3`);

                  // 然後每秒廣播剩餘數字
                  let countdown = 2; // 從 2 開始
                  const countdownInterval = setInterval(() => {
                    io.emit('MINIGAME_COUNTDOWN', { countdown });
                    console.log(`${new Date().toISOString()} ${LOG_PREFIX} 廣播倒數: ${countdown}`);
                    if (countdown <= 0) {
                      clearInterval(countdownInterval);
                    }
                    countdown--;
                  }, 1000);

                  // ========== 設定 Timer：3 秒後進入 Step C ==========
                  quizCountdownTimer = setTimeout(async () => {
                    try {
                      // Step C: GAMING (作答階段)
                      const duration = selectedQuestion.duration || 10;
                      const gamingEndTime = Date.now() + duration * 1000;
                      const gamingState: MiniGameState = {
                        ...countdownState,
                        phase: "GAMING",
                        startTime: Date.now(),
                        endTime: gamingEndTime,
                        data: {
                          ...countdownState.data,
                          answers: {}, // 初始化作答記錄
                        },
                      };

                      global.currentMiniGame = gamingState;
                      await saveMiniGameState(gamingState);
                      io.emit("MINIGAME_SYNC", gamingState);

                      console.log(
                        `${new Date().toISOString()} ${LOG_PREFIX} [Auto-Flow] Step C: GAMING 開始 (${duration}s 作答)`
                      );

                      // 【新增】========== 設定自動結算 Timer ==========
                      quizSettleTimer = setTimeout(async () => {
                        await settleQuizRound(io, selectedQuestion);
                      }, (duration + 1) * 1000); // 多 1 秒緩衝
                    } catch (error) {
                      console.error(
                        `${new Date().toISOString()} ${LOG_PREFIX} [Auto-Flow] Step C 失敗:`,
                        error
                      );
                    }
                  }, 3000);
                } catch (error) {
                  console.error(
                    `${new Date().toISOString()} ${LOG_PREFIX} [Auto-Flow] Step B 失敗:`,
                    error
                  );
                }
              }, 5000);

              console.log(
                `${new Date().toISOString()} ${LOG_PREFIX} Admin ${socket.data?.userId} 發布題目 #${questionId}，啟動自動流程`
              );
            } else {
              // 【初始化模式】：選擇第一題作為 nextCandidateId
              const firstQuestion = await prisma.quizQuestion.findFirst({
                orderBy: [
                  { sortOrder: "asc" },
                  { id: "asc" }, // Tie-breaker
                ],
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
    
    // 【新增】處理 Minority 下注
    if (action === "PLACE_BET") {
      try {
        const userId = socket.data?.userId;
        if (!userId) {
          console.warn(`${new Date().toISOString()} ${LOG_PREFIX} PLACE_BET 收到但 userId 缺失`);
          return;
        }

        const state = global.currentMiniGame;
        if (!state || state.gameType !== "MINORITY" || state.phase !== "GAMING") {
          console.warn(
            `${new Date().toISOString()} ${LOG_PREFIX} PLACE_BET 被忽略，當前狀態不符 (gameType=${state?.gameType}, phase=${state?.phase})`
          );
          return;
        }

        const option = payload?.option as string | undefined;
        const amount = Number(payload?.amount);

        // 驗證選項格式
        if (!option || !["A", "B", "C", "D"].includes(option)) {
          console.warn(`${new Date().toISOString()} ${LOG_PREFIX} User ${userId} 提交無效選項: ${option}`);
          return;
        }

        // 驗證金額格式（允許 0，因為用戶可能先選選項再調金額）
        if (!Number.isFinite(amount) || amount < 0) {
          console.warn(`${new Date().toISOString()} ${LOG_PREFIX} User ${userId} 提交無效金額: ${amount}`);
          return;
        }

        // 【餘額檢查】查詢使用者現金（只在金額 > 0 時檢查）
        if (amount > 0) {
          const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { cash: true },
          });

          if (!user) {
            console.warn(`${new Date().toISOString()} ${LOG_PREFIX} User ${userId} 不存在`);
            socket.emit("GAME_ERROR", { message: "使用者不存在" });
            return;
          }

          if (user.cash < amount) {
            console.warn(
              `${new Date().toISOString()} ${LOG_PREFIX} User ${userId} 餘額不足 (cash=${user.cash}, bet=${amount})`
            );
            socket.emit("GAME_ERROR", { message: "現金不足，無法下注" });
            return;
          }
        }

        // 【記憶體更新】記錄下注（不扣款）
        if (!state.data.minorityBets) {
          state.data.minorityBets = [];
        }

        // 移除該使用者之前的下注記錄（覆蓋機制）
        state.data.minorityBets = state.data.minorityBets.filter(
          (bet: any) => bet.userId !== String(userId)
        );

        // 新增下注記錄
        state.data.minorityBets.push({
          userId: String(userId),
          optionIndex: option,
          amount,
          timestamp: Date.now(),
        });

        console.log(
          `${new Date().toISOString()} ${LOG_PREFIX} User ${userId} 下注 $${amount} 於選項 ${option}`
        );

        // 同步更新到 DB（非阻塞）
        saveMiniGameState(state).catch((err) =>
          console.error(`${new Date().toISOString()} ${LOG_PREFIX} 備份下注失敗:`, err)
        );

        // 【關鍵】廣播狀態更新，確保所有端（包括刷新頁面）都能看到最新下注
        io.emit("MINIGAME_SYNC", state);
      } catch (error: any) {
        console.error(`${new Date().toISOString()} ${LOG_PREFIX} PLACE_BET 處理失敗:`, error?.message || error);
      }
      return;
    }
    
    // 【新增】處理 Quiz 作答
    if (action === "SUBMIT_ANSWER") {
      try {
        const userId = socket.data?.userId;
        if (!userId) {
          console.warn(`${new Date().toISOString()} ${LOG_PREFIX} SUBMIT_ANSWER 收到但 userId 缺失`);
          return;
        }

        const state = global.currentMiniGame;
        if (!state || state.gameType !== "QUIZ" || state.phase !== "GAMING") {
          console.warn(
            `${new Date().toISOString()} ${LOG_PREFIX} SUBMIT_ANSWER 被忽略，當前狀態不符 (gameType=${state?.gameType}, phase=${state?.phase})`
          );
          return;
        }

        const answer = payload?.answer as string | undefined;
        if (!answer || !["A", "B", "C", "D"].includes(answer)) {
          console.warn(`${new Date().toISOString()} ${LOG_PREFIX} User ${userId} 提交無效答案: ${answer}`);
          return;
        }

        // 檢查是否已作答
        const answers = (state.data?.answers || {}) as Record<string, { answer: string; timestamp: number }>;
        if (answers[String(userId)]) {
          console.warn(`${new Date().toISOString()} ${LOG_PREFIX} User ${userId} 重複作答，忽略`);
          return;
        }

        // 記錄答案
        answers[String(userId)] = {
          answer,
          timestamp: Date.now(),
        };

        state.data = {
          ...state.data,
          answers,
        };

        // 同步更新（非阻塞）
        saveMiniGameState(state).catch((err) =>
          console.error(`${new Date().toISOString()} ${LOG_PREFIX} 備份答案失敗:`, err)
        );

        console.log(
          `${new Date().toISOString()} ${LOG_PREFIX} User ${userId} 提交答案: ${answer} (timestamp: ${answers[String(userId)].timestamp})`
        );

        // 廣播更新（讓其他端知道有人作答了）
        io.emit("MINIGAME_SYNC", state);
      } catch (error: any) {
        console.error(`${new Date().toISOString()} ${LOG_PREFIX} SUBMIT_ANSWER 處理失敗:`, error?.message || error);
      }
      return;
    }
    
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

// 【新增】========== Quiz 結算函數 ==========
async function settleQuizRound(io: Server, question: any): Promise<void> {
  const LOG_PREFIX = "[MiniGame][Quiz][Settle]";
  
  try {
    const current = global.currentMiniGame ?? { ...defaultMiniGameState };
    
    if (current.gameType !== "QUIZ" || current.phase !== "GAMING") {
      console.warn(
        `${new Date().toISOString()} ${LOG_PREFIX} 狀態異常，跳過結算 (phase=${current.phase})`
      );
      return;
    }

    // 1. 取得所有作答記錄（從記憶體）
    const answers = (current.data?.answers || {}) as Record<string, { answer: string; timestamp: number }>;
    const correctAnswer = question.correctAnswer; // "A", "B", "C", "D"
    const rewards = question.rewards as { first: number; second: number; third: number; others: number };
    const duration = (question.duration || 10) * 1000; // 毫秒
    const gamingEndTime = current.endTime || 0;

    console.log(
      `${new Date().toISOString()} ${LOG_PREFIX} 開始結算：題目 #${question.id}，正確答案 ${correctAnswer}，共 ${Object.keys(answers).length} 人作答`
    );

    // 2. 篩選答對的人並依時間排序
    const correctUsers = Object.entries(answers)
      .filter(([_, data]) => data.answer === correctAnswer)
      .map(([userId, data]) => ({
        userId: Number(userId),
        timestamp: data.timestamp,
      }))
      .sort((a, b) => a.timestamp - b.timestamp); // 最快的在前

    console.log(
      `${new Date().toISOString()} ${LOG_PREFIX} 答對人數：${correctUsers.length}`
    );

    if (correctUsers.length === 0) {
      console.log(`${new Date().toISOString()} ${LOG_PREFIX} 無人答對，跳過發錢`);
      
      // 廣播 RESULT 狀態（無得主）
      const resultState: MiniGameState = {
        ...current,
        phase: "RESULT",
        data: {
          ...current.data,
          winners: [],
        },
      };
      global.currentMiniGame = resultState;
      await saveMiniGameState(resultState);
      io.emit("MINIGAME_SYNC", resultState);
      return;
    }

    // 3. 計算每個人的獎金
    const winnerData: Array<{ userId: number; displayName: string; avatar: string | null; reward: number; rank: number }> = [];
    const cashUpdates: Array<{ userId: number; reward: number }> = [];

    for (let i = 0; i < correctUsers.length; i++) {
      const { userId, timestamp } = correctUsers[i];
      let reward = 0;

      if (i === 0) {
        reward = rewards.first; // 第一名
      } else if (i === 1) {
        reward = rewards.second; // 第二名
      } else if (i === 2) {
        reward = rewards.third; // 第三名
      } else {
        // 第四名以後：線性速度獎金
        const remainingTime = gamingEndTime - timestamp; // 剩餘時間（毫秒）
        const ratio = Math.max(0, Math.min(1, remainingTime / duration)); // 0~1
        reward = Math.round(rewards.others + (rewards.third - rewards.others) * ratio);
      }

      cashUpdates.push({ userId, reward });
      
      // 查詢使用者資料（用於榜單顯示）
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { displayName: true, avatar: true },
      });

      winnerData.push({
        userId,
        displayName: user?.displayName || `User${userId}`,
        avatar: user?.avatar || null,
        reward,
        rank: i + 1,
      });

      console.log(
        `${new Date().toISOString()} ${LOG_PREFIX} Rank ${i + 1}: User ${userId} -> $${reward}`
      );
    }

    // 4. 批次更新資料庫（Transaction）
    await prisma.$transaction(async (tx) => {
      for (const { userId, reward } of cashUpdates) {
        await tx.user.update({
          where: { id: userId },
          data: { cash: { increment: reward } },
        });
      }
    });

    console.log(
      `${new Date().toISOString()} ${LOG_PREFIX} 資料庫更新完成，共發放 $${cashUpdates.reduce((sum, u) => sum + u.reward, 0)}`
    );

    // 5. 廣播結算狀態
    const resultState: MiniGameState = {
      ...current,
      phase: "RESULT",
      data: {
        ...current.data,
        winners: winnerData, // 前三名 + 獎金資訊
      },
    };

    global.currentMiniGame = resultState;
    await saveMiniGameState(resultState);
    io.emit("MINIGAME_SYNC", resultState);

    // 6. 推送個別使用者的資產更新
    for (const { userId, reward } of cashUpdates) {
      const updatedUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { cash: true, stocks: true, debt: true, dailyBorrowed: true },
      });

      if (updatedUser) {
        const userSockets = await io.in(`user:${userId}`).fetchSockets();
        for (const userSocket of userSockets) {
          userSocket.emit("ASSETS_UPDATE", {
            cash: updatedUser.cash,
            stocks: updatedUser.stocks,
            debt: updatedUser.debt,
            dailyBorrowed: updatedUser.dailyBorrowed,
          });
        }
        console.log(
          `${new Date().toISOString()} ${LOG_PREFIX} 已推送資產更新給 User ${userId} (Cash: ${updatedUser.cash})`
        );
      }
    }

    // 7. 更新排行榜
    const { getLeaderboard } = await import("../services/gameService.js");
    const gameStatus = await prisma.gameStatus.findUnique({ where: { id: 1 } });
    if (gameStatus) {
      const currentPrice = (
        await prisma.scriptDay.findFirst({
          where: { day: gameStatus.currentDay },
          select: { price: true },
        })
      )?.price || 50;

      const leaderboard = await getLeaderboard(currentPrice);
      io.emit("LEADERBOARD_UPDATE", { data: leaderboard });

      console.log(
        `${new Date().toISOString()} ${LOG_PREFIX} 排行榜已更新`
      );
    }

    console.log(
      `${new Date().toISOString()} ${LOG_PREFIX} 結算完成，進入 RESULT 階段`
    );

  } catch (error: any) {
    console.error(
      `${new Date().toISOString()} ${LOG_PREFIX} 結算失敗:`,
      error?.message || error
    );
  }
}

// 【新增】========== Minority 結算函數 ==========
async function settleMinorityRound(io: Server, question: any): Promise<void> {
  const LOG_PREFIX = "[MiniGame][Minority][Settle]";
  
  try {
    const current = global.currentMiniGame ?? { ...defaultMiniGameState };
    
    if (current.gameType !== "MINORITY" || current.phase !== "GAMING") {
      console.warn(
        `${new Date().toISOString()} ${LOG_PREFIX} 狀態異常，跳過結算 (phase=${current.phase})`
      );
      return;
    }

    // ========== Step A: 聚合資料 ==========
    const bets = (current.data?.minorityBets || []) as Array<{
      userId: string;
      optionIndex: string;
      amount: number;
      timestamp: number;
    }>;

    console.log(
      `${new Date().toISOString()} ${LOG_PREFIX} 開始結算：題目 #${question.id}，共 ${bets.length} 人下注`
    );

    if (bets.length === 0) {
      console.log(`${new Date().toISOString()} ${LOG_PREFIX} 無人下注，進入 RESULT 狀態`);
      
      const resultState: MiniGameState = {
        ...current,
        phase: "RESULT",
        data: {
          ...current.data,
          settlementResult: { status: "REFUND", message: "無人下注" },
        },
      };
      global.currentMiniGame = resultState;
      await saveMiniGameState(resultState);
      io.emit("MINIGAME_SYNC", resultState);
      return;
    }

    // 統計各選項的人數與總金額
    const optionStats: Record<string, { count: number; totalBet: number; userIds: number[] }> = {
      A: { count: 0, totalBet: 0, userIds: [] },
      B: { count: 0, totalBet: 0, userIds: [] },
      C: { count: 0, totalBet: 0, userIds: [] },
      D: { count: 0, totalBet: 0, userIds: [] },
    };

    for (const bet of bets) {
      const opt = bet.optionIndex.toUpperCase();
      if (!optionStats[opt]) continue;
      optionStats[opt].count += 1;
      optionStats[opt].totalBet += bet.amount;
      optionStats[opt].userIds.push(Number(bet.userId));
    }

    console.log(`${new Date().toISOString()} ${LOG_PREFIX} 選項統計:`, JSON.stringify(optionStats));

    // 過濾出有人選的選項
    const votedOptions = Object.entries(optionStats).filter(([_, stats]) => stats.count > 0);

    // ========== Step B: 判定邊界情況 ==========
    let status: "REFUND" | "HOUSE_WINS" | "STANDARD";
    let winnerOptions: string[] = [];
    let loserOptions: string[] = [];

    // Case 1: 所有人選同一個選項 (平局退款)
    if (votedOptions.length === 1) {
      status = "REFUND";
      console.log(`${new Date().toISOString()} ${LOG_PREFIX} Case 1: 所有人選擇 ${votedOptions[0][0]}，平局退款`);
    }
    // Case 2: 所有選項人數相同 (莊家通殺)
    else {
      const counts = votedOptions.map(([_, stats]) => stats.count);
      const allSameCount = counts.every((c) => c === counts[0]);
      
      if (allSameCount) {
        status = "HOUSE_WINS";
        loserOptions = votedOptions.map(([opt]) => opt);
        console.log(`${new Date().toISOString()} ${LOG_PREFIX} Case 2: 所有選項人數相同 (${counts[0]}人)，莊家通殺`);
      }
      // Case 3: 標準模式 (最少人數獲勝)
      else {
        status = "STANDARD";
        const minCount = Math.min(...counts);
        winnerOptions = votedOptions.filter(([_, stats]) => stats.count === minCount).map(([opt]) => opt);
        loserOptions = votedOptions.filter(([_, stats]) => stats.count > minCount).map(([opt]) => opt);
        console.log(
          `${new Date().toISOString()} ${LOG_PREFIX} Case 3: 最少人數 ${minCount}，贏家: ${winnerOptions.join(", ")}，輸家: ${loserOptions.join(", ")}`
        );
      }
    }

    // ========== Step C: 計算變數 ==========
    let loserPool = 0;
    let totalWinnerBets = 0;

    if (status === "STANDARD") {
      for (const opt of loserOptions) {
        loserPool += optionStats[opt].totalBet;
      }
      for (const opt of winnerOptions) {
        totalWinnerBets += optionStats[opt].totalBet;
      }
      console.log(`${new Date().toISOString()} ${LOG_PREFIX} 獎池: $${loserPool}, 贏家總下注: $${totalWinnerBets}`);
    }

    // ========== Step D: Transaction 處理 ==========
    const settlementResults: Array<{
      userId: number;
      displayName: string;
      option: string;
      betAmount: number;
      status: "WINNER" | "LOSER" | "REFUND";
      profit: number;
      newCash: number;
      newDebt: number;
    }> = [];

    await prisma.$transaction(async (tx) => {
      for (const bet of bets) {
        const userId = Number(bet.userId);
        const option = bet.optionIndex.toUpperCase();
        const betAmount = bet.amount;

        // 【重新讀取最新餘額】避免 Race Condition
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { displayName: true, cash: true, debt: true },
        });

        if (!user) {
          console.warn(`${new Date().toISOString()} ${LOG_PREFIX} User ${userId} 不存在，跳過`);
          continue;
        }

        let newCash = user.cash;
        let newDebt = user.debt;
        let profit = 0;
        let betStatus: "WINNER" | "LOSER" | "REFUND" = "REFUND";

        // Case 1: 平局退款
        if (status === "REFUND") {
          betStatus = "REFUND";
          // 不修改任何餘額
        }
        // Case 2 & Case 3: 計算輸贏
        else {
          const isWinner = winnerOptions.includes(option);
          
          if (isWinner && status === "STANDARD") {
            // 贏家：計算獲利 (按比例分配獎池)
            betStatus = "WINNER";
            // 處理邊界情況：如果贏家押注為0或總押注為0，獲利也是0
            if (totalWinnerBets > 0 && betAmount > 0) {
              profit = Math.round((betAmount / totalWinnerBets) * loserPool);
              newCash += profit;
            } else {
              profit = 0;
              // 押注為0的贏家不獲利，餘額不變
            }
          } else {
            // 輸家 (包含 HOUSE_WINS)
            betStatus = "LOSER";
            if (user.cash >= betAmount) {
              // 有足夠現金扣除
              newCash -= betAmount;
            } else {
              // 餘額不足，產生負債
              const diff = betAmount - user.cash;
              newCash = 0;
              newDebt += diff;
            }
          }
        }

        // 【更新資料庫】
        await tx.user.update({
          where: { id: userId },
          data: { cash: newCash, debt: newDebt },
        });

        settlementResults.push({
          userId,
          displayName: user.displayName,
          option,
          betAmount,
          status: betStatus,
          profit,
          newCash,
          newDebt,
        });

        console.log(
          `${new Date().toISOString()} ${LOG_PREFIX} User ${user.displayName} (${option}): ${betStatus}, 獲利 ${profit >= 0 ? '+' : ''}${profit}, 新餘額 Cash=${newCash}, Debt=${newDebt}`
        );
      }
    });

    console.log(
      `${new Date().toISOString()} ${LOG_PREFIX} 資料庫更新完成，共處理 ${settlementResults.length} 筆`
    );

    // ========== Step E: 廣播結算狀態 ==========
    const resultState: MiniGameState = {
      ...current,
      phase: "RESULT",
      data: {
        ...current.data,
        settlementResult: {
          status,
          winnerOptions,
          loserOptions,
          optionStats: Object.entries(optionStats).map(([option, stats]) => ({
            option,
            count: stats.count,
            totalBet: stats.totalBet,
          })),
          results: settlementResults,
        },
      },
    };

    global.currentMiniGame = resultState;
    await saveMiniGameState(resultState);
    io.emit("MINIGAME_SYNC", resultState);

    console.log(
      `${new Date().toISOString()} ${LOG_PREFIX} 結算完成，進入 RESULT 階段`
    );

    // 推送個別使用者的資產更新
    for (const result of settlementResults) {
      const updatedUser = await prisma.user.findUnique({
        where: { id: result.userId },
        select: { cash: true, stocks: true, debt: true, dailyBorrowed: true },
      });

      if (updatedUser) {
        const userSockets = await io.in(`user:${result.userId}`).fetchSockets();
        for (const userSocket of userSockets) {
          userSocket.emit("ASSETS_UPDATE", {
            cash: updatedUser.cash,
            stocks: updatedUser.stocks,
            debt: updatedUser.debt,
            dailyBorrowed: updatedUser.dailyBorrowed,
          });
        }
        console.log(
          `${new Date().toISOString()} ${LOG_PREFIX} 已推送資產更新給 User ${result.userId} (Cash: ${updatedUser.cash})`
        );
      }
    }

    // 更新排行榜
    const { getLeaderboard } = await import("../services/gameService.js");
    const gameStatus = await prisma.gameStatus.findUnique({ where: { id: 1 } });
    if (gameStatus) {
      const currentPrice = (
        await prisma.scriptDay.findFirst({
          where: { day: gameStatus.currentDay },
          select: { price: true },
        })
      )?.price || 50;

      const leaderboard = await getLeaderboard(currentPrice);
      io.emit("LEADERBOARD_UPDATE", { data: leaderboard });

      console.log(
        `${new Date().toISOString()} ${LOG_PREFIX} 排行榜已更新`
      );
    }

  } catch (error: any) {
    console.error(
      `${new Date().toISOString()} ${LOG_PREFIX} 結算失敗:`,
      error?.message || error
    );
  }
}
