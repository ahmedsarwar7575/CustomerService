import express from "express";
const router = express.Router();

router.get("/", (req, res) => {
  // Replace with logged-in agent identity from DB/session
  res.render("dialer", { identity: "agent_demo" });
});

export default router;
