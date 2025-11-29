// prisma.config.ts
// Prisma 7.x 設定檔，定義資料庫連線方式

import { defineConfig } from "@prisma/internals";

export default defineConfig({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});
