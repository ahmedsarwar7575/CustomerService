import dotenv from "dotenv";
import http from "http";
import app from "./app.js";
import { createUpsellWSS } from "./outbound/automaticOutbound.js";
import { attachMediaStreamServer } from "./inbound/mediaStream.js";
import { startUpsellCron } from "./outbound/cronJob.js"; 
dotenv.config();

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);
app.use((req, _res, next) => {
  // Keep query intact, collapse multiple slashes in the path
  const [path, qs] = req.url.split("?", 2);
  const normalized = path.replace(/\/{2,}/g, "/") || "/";
  req.url = qs ? `${normalized}?${qs}` : normalized;
  next();
});
const inboundWSS = attachMediaStreamServer(); // /media-stream
const outboundWSS = createUpsellWSS(); // /upsell-stream

if (!inboundWSS) throw new Error("inboundWSS not created");
if (!outboundWSS) throw new Error("outboundWSS not created");

server.on("upgrade", (req, socket, head) => {
  // const path = new URL(req.url || "/", "http://x").pathname;
    const url = new URL(req.url || "/", "http://x");
    const path = url.pathname;

  if (path === "/media-stream") {
    inboundWSS.handleUpgrade(req, socket, head, (ws) => {
      inboundWSS.emit("connection", ws, req);
    });
    return;
  }

  if (path.startsWith("/upsell-stream")) {
    outboundWSS.handleUpgrade(req, socket, head, (ws) => {
      outboundWSS.emit("connection", ws, req);
    });
    return;
  }

  socket.destroy();
});
startUpsellCron();
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
