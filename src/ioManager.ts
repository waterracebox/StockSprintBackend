// 全域 Socket.io 實例管理器
import { Server } from 'socket.io';

let globalIO: Server | null = null;

/**
 * 設置全域 Socket.io 實例
 */
export function setGlobalIO(io: Server): void {
  globalIO = io;
}

/**
 * 取得全域 Socket.io 實例
 */
export function getGlobalIO(): Server {
  if (!globalIO) {
    throw new Error('[IO] Socket.io 實例尚未初始化');
  }
  return globalIO;
}
