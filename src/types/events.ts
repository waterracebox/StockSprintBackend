// WebSocket 事件的 Payload 型別定義

/**
 * 股價歷史資料單筆記錄
 */
export interface PriceHistoryItem {
  day: number;
  price: number;
  title: string | null; // 新聞標題（可能為空）
  news: string | null; // 新聞內容（可能為空）
  effectiveTrend: string; // 生效中的趨勢（例如：盤整、利多）
}

/**
 * PRICE_UPDATE 事件的 Payload
 * 當遊戲天數改變時廣播給所有客戶端
 */
export interface PriceUpdatePayload {
  day: number; // 當前天數
  price: number; // 當前股價
  history: PriceHistoryItem[]; // 歷史股價資料（從 Day 1 到當前天）
}

/**
 * 個人資產資訊
 */
export interface PersonalAssets {
  cash: number; // 現金
  stocks: number; // 持股數量
  debt: number; // 負債金額
}

/**
 * FULL_SYNC_STATE 事件的 Payload
 * 當客戶端連線或重連時，伺服器推送完整狀態
 */
export interface FullSyncPayload {
  gameStatus: {
    currentDay: number;
    countdown: number;
    isGameStarted: boolean;
    totalDays: number;
  };
  price: {
    current: number; // 當前股價
    history: PriceHistoryItem[]; // 股價歷史
  };
  personal: PersonalAssets; // 個人資產
  leaderboard: LeaderboardItem[]; // 排行榜資料
}

/**
 * 交易請求 Payload
 */
export interface TradeRequest {
  quantity: number; // 交易張數
}

/**
 * 交易成功回應 Payload
 */
export interface TradeResponse {
  action: 'BUY' | 'SELL'; // 交易動作
  price: number; // 成交價格
  amount: number; // 交易張數
  newCash: number; // 更新後的現金
  newStocks: number; // 更新後的持股數量
}

/**
 * 交易失敗回應 Payload
 */
export interface TradeError {
  message: string; // 錯誤訊息
}

/**
 * 排行榜單筆記錄
 */
export interface LeaderboardItem {
  userId: number;
  displayName: string;
  avatar: string | null; // 使用者頭像
  totalAssets: number; // 總資產：現金 + 股票現值
  rank: number; // 排名（1-based）
}

/**
 * LEADERBOARD_UPDATE 事件的 Payload
 * 當遊戲迴圈每秒廣播時，推送最新排行榜
 */
export interface LeaderboardUpdatePayload {
  data: LeaderboardItem[]; // 排行榜資料（前 100 名）
}