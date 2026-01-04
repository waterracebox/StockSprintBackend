import { prisma } from '../src/db.js';

async function main() {
  console.log('🔄 Initializing sortOrder for existing questions...');

  // 初始化 Quiz 題目的 sortOrder (根據 ID 排序)
  const quizQuestions = await prisma.quizQuestion.findMany({
    where: { sortOrder: 0 },
    orderBy: { id: 'asc' },
  });

  for (const [index, question] of quizQuestions.entries()) {
    await prisma.quizQuestion.update({
      where: { id: question.id },
      data: { sortOrder: index + 1 },
    });
  }

  console.log(`✅ Initialized sortOrder for ${quizQuestions.length} Quiz questions`);

  // 初始化 Minority 題目的 sortOrder (根據 ID 排序)
  const minorityQuestions = await prisma.minorityQuestion.findMany({
    where: { sortOrder: 0 },
    orderBy: { id: 'asc' },
  });

  for (const [index, question] of minorityQuestions.entries()) {
    await prisma.minorityQuestion.update({
      where: { id: question.id },
      data: { sortOrder: index + 1 },
    });
  }

  console.log(`✅ Initialized sortOrder for ${minorityQuestions.length} Minority questions`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
