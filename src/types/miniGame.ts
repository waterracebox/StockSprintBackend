// 小遊戲相關型別定義，依據 MiniGame Backend Design Spec
export type MiniGamePayload = RedEnvelopePayload | QuizPayload | MinorityPayload | null;

export interface MiniGameState {
  gameType: "NONE" | "RED_ENVELOPE" | "QUIZ" | "MINORITY";
  phase: "IDLE" | "SHUFFLE" | "PREPARE" | "GAMING" | "REVEAL" | "RESULT";
  startTime: number;
  endTime: number;
  data: {
    packets?: {
      id: number;
      name: string;
      isTaken: boolean;
      ownerId: string | null;
    }[];
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
  }[];
  allowGuest: boolean;
}

export interface QuizPayload {
  currentQuestionId: number;
  question: {
    title: string;
    options: string[];
    correctAnswer: string;
    rewards: any;
  };
  answers: Record<string, { answer: string; timestamp: number }>;
}

export interface MinorityPayload {
  currentQuestionId: number;
  question: {
    title: string;
    options: string[];
  };
  bets: Record<string, { option: string; amount: number; timestamp: number }>;
}
