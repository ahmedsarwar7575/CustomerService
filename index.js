import app from "./app.js";
import dotenv from "dotenv";
import seedDatabase from "./config/seed.js";
import http from "http";
import { attachMediaStreamServer } from "./controllers/mediaStream.js";
dotenv.config();

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);
attachMediaStreamServer(server);
server.listen(PORT, () => {
  // seedDatabase()
  console.log(`Server running on port ${PORT}`);
  console.log(`API Documentation: http://localhost:${PORT}/api-docs`);
});

