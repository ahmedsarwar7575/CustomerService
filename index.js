import dotenv from "dotenv";
import http from "http";
import app from "./app.js";
import { createUpsellWSS } from "./outbound/automaticOutbound.js";
import { attachMediaStreamServer } from "./inbound/mediaStream.js";
import { initSocket } from "./socket.js";
import { bootTokens } from "./Email/Email.js";

dotenv.config();

const PORT = process.env.PORT || 3000;

app.use((req, _res, next) => {
  console.log(req.url);
  const [path, qs] = req.url.split("?", 2);
  const normalized = path.replace(/^\/+/, "/");
  req.url = qs ? `${normalized}?${qs}` : normalized;
  next();
});

const server = http.createServer(app);

initSocket(server);

const inboundWSS = attachMediaStreamServer();
const outboundWSS = createUpsellWSS();

if (!inboundWSS) throw new Error("inboundWSS not created");
if (!outboundWSS) throw new Error("outboundWSS not created");

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "/", "http://x");
  const path = url.pathname;

  if (path.startsWith("/socket.io")) {
    return;
  }

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

server.listen(PORT, () => {
  bootTokens();
  console.log(`Server running on port ${PORT}`);
});
