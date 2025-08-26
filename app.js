import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import apiRouter from "./routes/api.js";
import setupSwagger from './config/swagger.js';
import sequelize from "./config/db.js";
import { Agent, User, Ticket, Rating } from "./models/index.js";
import twalioRoutes from "./routes/twilioRoutes.js";
// import seedDatabase from "./config/seed.js";

const app = express();

// Middleware
app.use(cors());
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
    await sequelize.sync({ alter: true });
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
