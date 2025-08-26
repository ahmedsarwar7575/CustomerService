import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import apiRouter from "./routes/api.js";
import setupSwagger from "./config/swagger.js";
import sequelize from "./config/db.js";
import { Agent, User, Ticket, Rating } from "./models/index.js";
import twalioRoutes from "./routes/twilioRoutes.js";
// import seedDatabase from "./config/seed.js";

const app = express();

// Middleware
const allowedOrigins = [
  "http://localhost:5173", // Vite default
  "http://localhost:3000", // Next.js default
  "https://cs-agent-ten.vercel.app/", // replace with your actual Vercel domain
];

const corsOptions = {
  origin(origin, callback) {
    // allow requests with no origin (like curl or Postman)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Origin",
    "X-Requested-With",
    "Content-Type",
    "Accept",
    "Authorization",
  ],
};
app.use(cors(corsOptions));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// API Routes
app.use("/", apiRouter);
app.use("/", twalioRoutes);

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
