// Socket.io 認證中介軟體 - 驗證 JWT Token 並附加使用者資訊至 socket.data

import { Server, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { Role } from "@prisma/client";

// JWT Payload 型別定義
interface JwtPayload {
  userId: number;
  role: Role;
}

/**
 * Socket.io 認證中介軟體
 * 從 handshake.auth.token 驗證 JWT，並將使用者資訊附加至 socket.data
 */
export function socketAuthMiddleware(io: Server) {
  io.use((socket: Socket, next) => {
    try {
      // 從握手認證資訊中取得 token
      const token = socket.handshake.auth.token;

      if (!token) {
        console.error("[Socket Auth] 缺少認證 Token");
        return next(new Error("Authentication error: Missing token"));
      }

      // 驗證 token
      const secret = process.env.JWT_SECRET;
      if (!secret) {
        console.error("[Socket Auth] JWT_SECRET 未設定");
        return next(new Error("Server configuration error"));
      }

      const decoded = jwt.verify(token, secret) as JwtPayload;

      // 將使用者資訊附加至 socket.data（型別已在 socket.d.ts 定義）
      socket.data.userId = decoded.userId;
      socket.data.role = decoded.role;

      // 【新增】讓用戶加入專屬 room，方便後續定向廣播資產更新
      socket.join(`user:${decoded.userId}`);

      console.log(`[Socket Auth] 使用者 ${decoded.userId} (${decoded.role}) 通過驗證並加入 room:user:${decoded.userId}`);
      next();
    } catch (error: any) {
      console.error("[Socket Auth] Token 驗證失敗:", error.message);
      next(new Error("Authentication error: Invalid token"));
    }
  });
}
