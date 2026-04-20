import { Server } from "socket.io";

let ioInstance;

export const initSocket = (server) => {
  ioInstance = new Server(server, {
    cors: {
      origin: process.env.CLIENT_URL || "http://localhost:5173",
      credentials: true,
    },
    path: "/socket.io/",
  });

  ioInstance.on("connection", (socket) => {
    console.log("Socket connected:", socket.id);

    socket.on("sms:join", ({ userId }) => {
      if (!userId) return;
      socket.join(`sms:user:${userId}`);
    });

    socket.on("sms:leave", ({ userId }) => {
      if (!userId) return;
      socket.leave(`sms:user:${userId}`);
    });

    socket.on("disconnect", () => {
      console.log("Socket disconnected:", socket.id);
    });
  });

  return ioInstance;
};

export const getIo = () => {
  if (!ioInstance) {
    throw new Error("Socket.IO not initialized");
  }
  return ioInstance;
};
