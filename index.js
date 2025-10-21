import dotenv from "dotenv";
import http from "http";
import app from "./app.js";
import { attachMediaStreamServer } from "./inbound/mediaStream.js";
import { createUpsellWSS } from "./outbound/automaticOutbound.js";
const PORT = process.env.PORT || 3000;
dotenv.config();
const server = http.createServer(app);

const inboundWSS = attachMediaStreamServer(); // /media-stream
const outboundWSS = createUpsellWSS(); // /upsell-stream

server.on("upgrade", (req, socket, head) => {
  const path = new URL(req.url || "/", "http://x").pathname;
  if (path === "/media-stream") {
    inboundWSS.handleUpgrade(req, socket, head, (ws) =>
      inboundWSS.emit("connection", ws, req)
    );
    return;
  }
  if (path === "/upsell-stream") {
    outboundWSS.handleUpgrade(req, socket, head, (ws) =>
      outboundWSS.emit("connection", ws, req)
    );
    return;
  }
  socket.destroy();
});
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`API Documentation: http://localhost:${PORT}/local-test.html`);
});
