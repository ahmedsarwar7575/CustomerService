import app from "./app.js";
import dotenv from "dotenv";
import http from "http";
import { createUpsellWSS } from "./outbound/automaticOutbound.js";
import { attachMediaStreamServer } from "./inbound/mediaStream.js";
import { startUpsellCron /*, runUpsellJobOnce */ } from "./outbound/cronJob.js";
dotenv.config();

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

const upsellWSS = createUpsellWSS();
const mediaStreamWSS = attachMediaStreamServer();

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "/", "http://localhost");
  const path = url.pathname;
  console.log(`[HTTP] upgrade ${path} ua=${req.headers["user-agent"] || ""}`);

  if (path === "/upsell-stream") {
    upsellWSS.handleUpgrade(req, socket, head, (ws) =>
      upsellWSS.emit("connection", ws, req)
    );
    return;
  }

  if (path === "/media-stream") {
    mediaStreamWSS.handleUpgrade(req, socket, head, (ws) =>
      mediaStreamWSS.emit("connection", ws, req)
    );
    return;
  }

  socket.destroy();
});
startUpsellCron();

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`API Documentation: http://localhost:${PORT}/local-test.html`);
});
