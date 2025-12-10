// Seed Script - 產生測試用戶以測試排行榜功能
import bcryptjs from 'bcryptjs';
import * as dotenv from 'dotenv';
import { prisma } from '../src/db.js';

// 載入環境變數
dotenv.config();

/**
 * 隨機產生現金（10,000 ~ 50,000）
 */
function randomCash(): number {
  return Math.floor(Math.random() * 40000) + 10000;
}

/**
 * 隨機產生持股數量（0 ~ 100）
 */
function randomStocks(): number {
  return Math.floor(Math.random() * 101);
}

/**
 * 測試用戶名稱清單
 */
const testUserNames = [
  '投資達人',
  '股市新手',
  '穩健投資者',
  '短線高手',
  '價值投資人',
  '技術分析師',
  '股神學徒',
  '小資族',
  '退休老手',
  '菜鳥交易員',
  '散戶代表',
  '波段操作者',
  '當沖客',
  '套牢大師',
  '解套達人',
  '漲停板獵人',
  '抄底王',
  '追高達人',
  '停損專家',
  '獲利高手',
];

async function main() {
  console.log('開始產生測試用戶...');

  // 統一的測試密碼（hash 過）
  const hashedPassword = await bcryptjs.hash('test1234', 10);

  const createdUsers = [];

  for (let i = 0; i < testUserNames.length; i++) {
    const username = `testuser${i + 1}`;
    const displayName = testUserNames[i];
    const cash = randomCash();
    const stocks = randomStocks();

    try {
      // 檢查是否已存在
      const existingUser = await prisma.user.findUnique({
        where: { username },
      });

      if (existingUser) {
        console.log(`⚠️  用戶 ${username} 已存在，跳過`);
        continue;
      }

      // 隨機選擇頭像（avatar_00.webp ~ avatar_08.webp）
      const avatarIndex = Math.floor(Math.random() * 9);
      const avatar = `avatar_0${avatarIndex}.webp`;

      // 建立測試用戶
      const user = await prisma.user.create({
        data: {
          username,
          displayName,
          password: hashedPassword,
          role: 'USER',
          cash,
          stocks,
          debt: 0,
          avatar,
        },
      });

      createdUsers.push(user);
      console.log(`✅ 建立用戶: ${displayName} (${username}) - 現金: $${cash}, 持股: ${stocks}`);
    } catch (error: any) {
      console.error(`❌ 建立用戶 ${username} 失敗:`, error.message);
    }
  }

  console.log(`\n✅ 完成！共建立 ${createdUsers.length} 個測試用戶`);
  console.log(`📝 測試用戶登入資訊：`);
  console.log(`   帳號: testuser1 ~ testuser${testUserNames.length}`);
  console.log(`   密碼: test1234`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error('Seed 執行失敗:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
