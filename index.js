import app from "./app.js";
import dotenv from "dotenv";
import seedDatabase from "./config/seed.js";
// import { debug } from "./inbound/recording.js";
import http from "http";
// import { attachMediaStreamServer } from "./inbound/mediaStream.js";
dotenv.config();
import { connectIndex } from "./utils/pinecone.js";
import { attachNewFlow } from "./newFlow.js";
const PORT = process.env.PORT || 8000;
const server = http.createServer(app);

await connectIndex();
await attachNewFlow(server);
// attachMediaStreamServer(server);
server.listen(PORT, () => {
  // seedDatabase()
  // debug()
  // connectIndex();
  console.log(`Server running on port ${PORT}`);
  console.log(`API Documentation: http://localhost:${PORT}/local-test.html`);
});

