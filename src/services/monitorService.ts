import { Server } from 'socket.io';

const onlineHistory: { timestamp: number; count: number }[] = [];

/**
 * 初始化監控服務（每 10 秒記錄一次）
 */
export function initializeMonitor(io: Server): void {
  setInterval(() => {
    const count = io.engine.clientsCount;
    const timestamp = Date.now();

    onlineHistory.push({ timestamp, count });

    // 僅保留最近 1 小時的資料（360 筆）
    if (onlineHistory.length > 360) {
      onlineHistory.shift();
    }

    // 廣播給所有 Admin
    io.sockets.sockets.forEach((socket) => {
      if (socket.data.role === 'ADMIN') {
        socket.emit('ONLINE_USERS_UPDATE', { count });
      }
    });
  }, 10000); // 每 10 秒
}

/**
 * 取得歷史線上人數（供 API 查詢）
 */
export function getOnlineHistory() {
  return onlineHistory;
}
