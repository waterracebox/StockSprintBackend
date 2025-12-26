import { prisma } from "../db.js";
import type { MiniGameState } from "../types/miniGame.js";

const defaultMiniGameState: MiniGameState = {
  gameType: "NONE",
  phase: "IDLE",
  startTime: 0,
  endTime: 0,
  data: {},
};

const LOG_PREFIX = "[MiniGame]";

function mapRuntimeToState(row: any): MiniGameState {
  return {
    gameType: row.gameType,
    phase: row.phase,
    startTime: row.startTime ? Number(row.startTime) : 0,
    endTime: row.endTime ? Number(row.endTime) : 0,
    data: row.payload ?? {},
  };
}

export async function initializeMiniGame(): Promise<MiniGameState> {
  if (global.currentMiniGame) {
    return global.currentMiniGame;
  }

  const existing = await prisma.miniGameRuntime.findUnique({ where: { key: "CURRENT_GAME" } });
  if (!existing) {
    global.currentMiniGame = { ...defaultMiniGameState };
    await saveMiniGameState();
    console.log(`${new Date().toISOString()} ${LOG_PREFIX} 初始化為預設狀態 (NONE)`);
    return global.currentMiniGame;
  }

  global.currentMiniGame = mapRuntimeToState(existing);
  console.log(`${new Date().toISOString()} ${LOG_PREFIX} 由資料庫恢復狀態: ${existing.gameType} / ${existing.phase}`);
  return global.currentMiniGame;
}

export async function saveMiniGameState(stateOverride?: MiniGameState): Promise<void> {
  const state = stateOverride ?? global.currentMiniGame ?? { ...defaultMiniGameState };
  global.currentMiniGame = state;

  await prisma.miniGameRuntime.upsert({
    where: { key: "CURRENT_GAME" },
    create: {
      key: "CURRENT_GAME",
      gameType: state.gameType,
      phase: state.phase,
      startTime: BigInt(state.startTime || 0),
      endTime: BigInt(state.endTime || 0),
      payload: state.data ?? {},
    },
    update: {
      gameType: state.gameType,
      phase: state.phase,
      startTime: BigInt(state.startTime || 0),
      endTime: BigInt(state.endTime || 0),
      payload: state.data ?? {},
    },
  });

  console.log(`${new Date().toISOString()} ${LOG_PREFIX} 狀態已寫入 DB: ${state.gameType} / ${state.phase}`);
}

export { defaultMiniGameState };
