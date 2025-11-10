import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import apiRouter from "./routes/api.js";
import setupSwagger from "./config/swagger.js";
import sequelize from "./config/db.js";
import { Agent, User, Ticket, Rating } from "./models/index.js";
import twalioRoutes from "./inbound/twilioRoutes.js";
import realtime from "./inbound/realtime.js";
import recording from "./routes/recording.js";
import { playRecording } from "./controllers/Call.js";
import outbound from "./outbound/outboundByAgent.js"
import outboundFlow from "./outbound/outboundRoutes.js"
// import seedDatabase from "./config/seed.js";
import gmailRoutes from "./routes/gmail.js";
const app = express();

app.use(
  cors({
    origin: (origin, cb) => cb(null, true), // reflect any origin
    credentials: true, // allow cookies/Authorization
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Origin",
      "X-Requested-With",
      "Content-Type",
      "Accept",
      "Authorization",
    ],
  })
);
app.options("*", cors()); // answer all preflights

// (optional but helps when some middleware blocks OPTIONS)
app.use((req, res, next) => {
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
// API Routes
app.use("/", apiRouter);
app.use("/", twalioRoutes);
app.use("/", realtime);
app.use("/", recording);
app.use("/", outbound);
app.use("/", outboundFlow);
app.use("/", gmailRoutes);
app.use("/playRecording/:callSid", playRecording);

// Swagger Documentation
setupSwagger(app);

// Database synchronization
const syncDatabase = async () => {
  try {
    await sequelize.authenticate();
    console.log("Database connection established");

    // Sync all models
    await sequelize.sync();
    console.log("Database synchronized");

    // Seed initial data
    // await seedDatabase();
  } catch (error) {
    console.error("Database error:", error);
  }
};

syncDatabase();

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Internal Server Error" });
});

export default app;
