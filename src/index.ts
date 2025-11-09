import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3001; // Render 會自動設定 PORT

// 中間件
app.use(cors()); // 允許跨域請求 (非常重要！)
app.use(express.json()); // 解析 JSON 請求體

// API 路由
// 1. GET /users - 取得所有使用者
app.get('/users', async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: '無法取得使用者' });
  }
});

// 2. POST /users - 建立新使用者
app.post('/users', async (req, res) => {
  try {
    const { email, name } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email 是必要的' });
    }

    const newUser = await prisma.user.create({
      data: {
        email,
        name,
      },
    });
    res.status(201).json(newUser);
  } catch (error) {
    res.status(500).json({ error: '無法建立使用者' });
  }
});

// 啟動伺服器
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});