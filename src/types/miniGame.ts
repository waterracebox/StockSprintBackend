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
    quizAnswers?: { userId: string; answerIndex: string; timestamp: number }[];
    currentMinorityId?: number;
    minorityBets?: { userId: string; optionIndex: string; amount: number }[];
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
  currentQuestionId: number;
  question: {
    title: string;
    options: string[];
  };
  bets: Record<string, { option: string; amount: number; timestamp: number }>;
}
