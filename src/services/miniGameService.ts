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

// 紅包洗牌→開搶的固定節奏時間（毫秒）
export const ANIMATION_DURATION = 3000;
export const COUNTDOWN_DURATION = 3000;
export const TOTAL_PREP_TIME = ANIMATION_DURATION + COUNTDOWN_DURATION;

export interface RedEnvelopeInitOptions {
  allowGuest: boolean;
  consolation: { name: string; type: "PHYSICAL" | "CASH"; value: number };
}

export type Participant = { userId: number; displayName: string; avatar: string | null };

type ParticipantsSnapshot = {
  participants: Participant[];
  packets: NonNullable<MiniGameState["data"]["packets"]>;
  updatedAt: number;
};

const participantsCache: ParticipantsSnapshot = {
  participants: [],
  packets: [],
  updatedAt: 0,
};

function shuffle<T>(arr: T[]): T[] {
  const cloned = [...arr];
  for (let i = cloned.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cloned[i], cloned[j]] = [cloned[j], cloned[i]];
  }
  return cloned;
}

function balancePacketsWithConsolation(
  packets: NonNullable<MiniGameState["data"]["packets"]>,
  participantsCount: number,
  consolation?: { name: string; type: "PHYSICAL" | "CASH"; value: number }
): NonNullable<MiniGameState["data"]["packets"]> {
  // 若人數變少，先裁切多餘的紅包數量（保持索引連續）
  if (participantsCount < packets.length) {
    return packets
      .slice(0, participantsCount)
      .map((p, idx) => ({ ...p, index: idx }));
  }

  if (!consolation) return packets;

  const deficit = Math.max(participantsCount - packets.length, 0);
  if (deficit === 0) return packets;

  const result = [...packets];
  for (let i = 0; i < deficit; i++) {
    result.push({
      index: result.length,
      name: consolation.name,
      isTaken: false,
      ownerId: null,
      type: consolation.type,
      prizeValue: consolation.type === "CASH" ? consolation.value : undefined,
    });
  }

  return result.map((p, idx) => ({ ...p, index: idx }));
}

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

export async function fetchParticipants(): Promise<Participant[]> {
  const employees = await prisma.user.findMany({
    where: { isEmployee: true },
    select: { id: true, displayName: true, username: true, avatar: true },
  });

  return employees.map((u) => ({
    userId: u.id,
    displayName: u.displayName || u.username || `User${u.id}`,
    avatar: u.avatar ?? null,
  }));
}

/**
 * 取得參與者與紅包的快取快照；在 maxAgeMs 內重複呼叫會直接返回快取，避免大量 DB 查詢與頻繁日誌。
 */
export async function getParticipantsSnapshot(options?: { force?: boolean; persist?: boolean; maxAgeMs?: number }): Promise<ParticipantsSnapshot> {
  const now = Date.now();
  const maxAgeMs = options?.maxAgeMs ?? 5000;

  if (!options?.force && participantsCache.participants.length > 0 && now - participantsCache.updatedAt < maxAgeMs) {
    return participantsCache;
  }

  if (global.currentMiniGame && global.currentMiniGame.gameType !== "NONE") {
    const state = await withLatestParticipants(global.currentMiniGame, { persist: options?.persist ?? false });
    const snapshot: ParticipantsSnapshot = {
      participants: state.data?.participants || [],
      packets: state.data?.packets || [],
      updatedAt: now,
    };
    Object.assign(participantsCache, snapshot);
    return participantsCache;
  }

  const participants = await fetchParticipants();
  const snapshot: ParticipantsSnapshot = { participants, packets: [], updatedAt: now };
  Object.assign(participantsCache, snapshot);
  return participantsCache;
}

export async function initRedEnvelopeGame(options: RedEnvelopeInitOptions): Promise<MiniGameState> {
  const participants = await fetchParticipants();

  // 取得啟用中的獎項配置
  const configured = await prisma.redEnvelopeItem.findMany({
    where: { isActive: true },
    orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
  });

  const packets: NonNullable<MiniGameState["data"]["packets"]> = [];

  configured.forEach((item) => {
    for (let i = 0; i < item.amount; i++) {
      packets.push({
        index: packets.length,
        name: item.name,
        isTaken: false,
        ownerId: null,
        type: item.type,
        prizeValue: item.type === "CASH" ? item.prizeValue : undefined,
      });
    }
  });

  const totalParticipants = participants.length;
  const padded = balancePacketsWithConsolation(packets, totalParticipants, options.consolation);

  // 先洗牌，再重新賦予連續 index，避免前端看到未混排的排列
  const shuffledPackets = shuffle(padded).map((p, idx) => ({ ...p, index: idx }));

  const nextState: MiniGameState = {
    gameType: "RED_ENVELOPE",
    phase: "IDLE",
    startTime: Date.now(),
    endTime: 0,
    data: {
      allowGuest: options.allowGuest,
      consolationConfig: options.consolation,
      participants,
      packets: shuffledPackets,
    },
  };

  global.currentMiniGame = nextState;
  await saveMiniGameState(nextState);

  console.log(
    `${new Date().toISOString()} ${LOG_PREFIX} INIT_GAME 建立紅包陣列: participants=${participants.length}, packets=${shuffledPackets.length}, allowGuest=${options.allowGuest}`
  );

  return nextState;
}

export async function withLatestParticipants(
  state: MiniGameState,
  options?: { persist?: boolean }
): Promise<MiniGameState> {
  const shouldPersist = options?.persist !== false;

  const participants = await fetchParticipants();
  const paddedPackets = balancePacketsWithConsolation(
    state.data?.packets || [],
    participants.length,
    state.data?.consolationConfig
  );

  const nextState: MiniGameState = {
    ...state,
    data: {
      ...state.data,
      participants,
      packets: paddedPackets,
    },
  };

  global.currentMiniGame = nextState;

  if (shouldPersist) {
    await saveMiniGameState(nextState);
  }

  return nextState;
}

export { defaultMiniGameState };
