import { Router } from "express";
import { authenticateToken } from "../middlewares/authMiddleware.js";
import { getParticipantsSnapshot } from "../services/miniGameService.js";

const router = Router();

router.use(authenticateToken);

// 取得當前員工參與者清單（用於顯示頭像）
router.get("/participants", async (_req, res) => {
  try {
    const snapshot = await getParticipantsSnapshot({ persist: false, maxAgeMs: 5000 });
    res.json({ participants: snapshot.participants, packets: snapshot.packets });
  } catch (error: any) {
    console.error(`${new Date().toISOString()} [MiniGame] 取得參與者失敗:`, error?.message || error);
    res.status(500).json({ error: "取得參與者失敗" });
  }
});

export default router;
