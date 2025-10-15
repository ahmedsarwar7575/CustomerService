import app from "./app.js";
import dotenv from "dotenv";
import seedDatabase from "./config/seed.js";
// import { debug } from "./inbound/recording.js";
import http from "http";
import { attachMediaStreamServer } from "./inbound/mediaStream.js";
import {attachUpsellStreamServer } from "./outbound/automaticOutbound.js";
dotenv.config();

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);
attachMediaStreamServer(server);
server.listen(PORT, () => {
  // seedDatabase()
  // debug()
  console.log(`Server running on port ${PORT}`);
  console.log(`API Documentation: http://localhost:${PORT}/local-test.html`);
});

