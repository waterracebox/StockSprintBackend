// 小遊戲相關型別定義，依據 MiniGame Backend Design Spec
export type MiniGamePayload = RedEnvelopePayload | QuizPayload | MinorityPayload | null;

export interface MiniGameState {
  gameType: "NONE" | "RED_ENVELOPE" | "QUIZ" | "MINORITY";
  phase: "IDLE" | "SHUFFLE" | "COUNTDOWN" | "PREPARE" | "GAMING" | "REVEAL" | "RESULT";
  startTime: number;
  endTime: number;
  data: {
    allowGuest?: boolean;
    consolationConfig?: { name: string; type: "PHYSICAL" | "CASH"; value: number };
    participants?: { userId: number; displayName: string; avatar: string | null }[];
    packets?: {
      index: number;
      name: string;
      isTaken: boolean;
      ownerId: string | null;
      type?: string;
      prizeValue?: number;
      isScratched?: boolean;
      displayOrder?: number;
    }[];
    nextCandidateId?: number; // Quiz: Admin Dropdown 預選的題目 ID
    currentQuizId?: number;
    question?: {
      title: string;
      options: string[];
      correctAnswer: string;
      rewards: any;
      duration?: number;
    };
    answers?: Record<string, { answer: string; timestamp: number }>; // Quiz 作答記錄
    winners?: Array<{ userId: number; displayName: string; avatar: string | null; reward: number; rank: number }>; // Quiz 結算結果
    quizAnswers?: { userId: string; answerIndex: string; timestamp: number }[];
    currentMinorityId?: number;
    minorityBets?: { userId: string; optionIndex: string; amount: number; timestamp: number }[];
    settlementResult?: { 
      status: string; 
      winnerOptions?: string[]; 
      loserOptions?: string[]; 
      optionStats?: Record<string, { count: number; totalBet: number; userIds: number[] }>; // 【修复】改为对象格式
      results?: any[];
      message?: string;
    }; // Minority 結算結果
  };
}

export interface RedEnvelopePayload {
  packets: {
    index: number;
    name: string;
    isTaken: boolean;
    ownerId: string | null;
    type?: string;
    prizeValue?: number;
    isScratched?: boolean;
    displayOrder?: number;
  }[];
  allowGuest: boolean;
  participants?: { userId: number; displayName: string; avatar: string | null }[];
  consolationConfig?: { name: string; type: "PHYSICAL" | "CASH"; value: number };
}

export interface QuizPayload {
  currentQuestionId?: number; // 已發布的題目 ID（phase=PREPARE/GAMING 時才有值）
  nextCandidateId?: number;   // Admin Dropdown 預選的題目 ID（phase=IDLE 時有效）
  question?: {
    title: string;
    options: string[];
    correctAnswer: string;
    rewards: any;
    duration?: number;
  };
  answers?: Record<string, { answer: string; timestamp: number }>;
}

export interface MinorityPayload {
  currentQuestionId?: number; // 已發布的題目 ID（phase=GAMING 時才有值）
  nextCandidateId?: number;   // Admin Dropdown 預選的題目 ID（phase=IDLE 時有效）
  question?: {
    title: string;
    options: string[];
    duration: number;
  };
  bets?: Record<string, { option: string; amount: number; timestamp: number }>;
}
