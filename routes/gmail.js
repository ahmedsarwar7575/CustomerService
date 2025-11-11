// routes/gmailRoutes.js  (ESM)
import { Router } from "express";
import {
  auth,
  oauth2callback,
  setupWatch,
  pushWebhook,
} from "../Email/Email.js";
import { sendEmail } from "../Email/Sender.js";
const router = Router();

router.get("/auth", auth);
router.get("/oauth2callback", oauth2callback);
router.post("/setup-watch", setupWatch);
router.post("/gmail/push", pushWebhook);
router.post("/email", sendEmail);

export default router;
