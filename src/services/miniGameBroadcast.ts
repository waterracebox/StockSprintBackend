import { getGlobalIO } from "../ioManager.js";
import { getParticipantsSnapshot } from "./miniGameService.js";
import type { MiniGameState } from "../types/miniGame.js";

let participantsTimer: NodeJS.Timeout | null = null;

// 僅在紅包遊戲進行時才廣播
function shouldBroadcast(state?: MiniGameState | null): boolean {
  if (!state) return false;
  return state.gameType === "RED_ENVELOPE" && state.phase === "IDLE";
}

/**
 * 每 5 秒廣播一次參與者與紅包快照，避免前端大量輪詢。
 */
export function startMiniGameParticipantBroadcast(intervalMs = 5000): void {
  if (participantsTimer) return;
  const io = getGlobalIO();

  const tick = async () => {
    try {
      const state: MiniGameState | undefined = global.currentMiniGame;
      if (!shouldBroadcast(state)) {
        return;
      }

      const snapshot = await getParticipantsSnapshot({ force: true, persist: false });
      io.emit("MINIGAME_PARTICIPANTS", {
        participants: snapshot.participants,
        packets: snapshot.packets,
        updatedAt: snapshot.updatedAt,
      });

      console.log(
        `[${new Date().toISOString()}] [MiniGame] 廣播參與者快照: participants=${snapshot.participants.length}, packets=${snapshot.packets.length}`
      );
    } catch (error) {
      console.error(`${new Date().toISOString()} [MiniGame] 廣播參與者快照失敗:`, error);
    }
  };

  // 立即執行一次，之後固定間隔
  tick();
  participantsTimer = setInterval(tick, intervalMs);
  console.log(`${new Date().toISOString()} [MiniGame] 已啟動參與者廣播 (每 ${intervalMs}ms)`);
}

export function stopMiniGameParticipantBroadcast(): void {
  if (participantsTimer) {
    clearInterval(participantsTimer);
    participantsTimer = null;
    console.log(`${new Date().toISOString()} [MiniGame] 已停止參與者廣播`);
  }
}
