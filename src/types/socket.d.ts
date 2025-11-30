// Socket.io 型別擴充 - 在 socket.data 中加入使用者資訊

import { Role } from "@prisma/client";

declare module "socket.io" {
  interface Socket {
    data: {
      userId: number;
      role: Role;
    };
  }
}
