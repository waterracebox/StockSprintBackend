// 測試腳本 - 隨機調整所有用戶的資產，用於測試排行榜變化
import * as dotenv from 'dotenv';
import { prisma } from '../src/db.js';

// 載入環境變數
dotenv.config();

/**
 * 隨機產生現金變化（-5000 ~ +5000）
 */
function randomCashChange(): number {
  return Math.floor(Math.random() * 10000) - 5000;
}

/**
 * 隨機產生持股變化（-20 ~ +20）
 */
function randomStocksChange(): number {
  return Math.floor(Math.random() * 41) - 20;
}

async function main() {
  console.log('開始隨機調整用戶資產...\n');

  // 取得所有用戶
  const users = await prisma.user.findMany({
    select: {
      id: true,
      displayName: true,
      cash: true,
      stocks: true,
    },
  });

  console.log(`共找到 ${users.length} 位用戶\n`);

  for (const user of users) {
    const cashChange = randomCashChange();
    const stocksChange = randomStocksChange();
    
    const newCash = Math.max(0, user.cash + cashChange); // 確保不為負
    const newStocks = Math.max(0, user.stocks + stocksChange); // 確保不為負

    await prisma.user.update({
      where: { id: user.id },
      data: {
        cash: newCash,
        stocks: newStocks,
      },
    });

    console.log(`✅ ${user.displayName}:`);
    console.log(`   現金: $${user.cash.toFixed(2)} → $${newCash.toFixed(2)} (${cashChange >= 0 ? '+' : ''}${cashChange.toFixed(2)})`);
    console.log(`   持股: ${user.stocks} → ${newStocks} (${stocksChange >= 0 ? '+' : ''}${stocksChange})\n`);
  }

  console.log('✅ 完成！所有用戶資產已隨機調整');
  console.log('💡 提示：等待遊戲換日後，排行榜會重新排序並顯示排名變化動畫');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error('執行失敗:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
