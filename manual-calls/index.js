import express, { Router } from "express";
import twilio from "twilio";
import * as controller from "./controller.js";
import { getBaseUrl } from "./service.js";

const router = Router();

router.use(express.json());
router.use(express.urlencoded({ extended: false }));

function validateTwilioWebhook(req, res, next) {
  if (process.env.ENABLE_TWILIO_WEBHOOK_VALIDATION !== "true") {
    return next();
  }

  try {
    const authToken = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
    const signature = req.header("X-Twilio-Signature");

    if (!authToken) {
      return res.status(500).json({
        success: false,
        message: "TWILIO_AUTH_TOKEN is missing. Twilio validation cannot run.",
      });
    }

    if (!signature) {
      return res.status(401).json({
        success: false,
        message: "Missing X-Twilio-Signature header.",
      });
    }

    const url = `${getBaseUrl(req)}${req.originalUrl}`;
    const isValid = twilio.validateRequest(authToken, signature, url, req.body);

    if (!isValid) {
      return res.status(403).json({
        success: false,
        message: "Invalid Twilio webhook signature.",
      });
    }

    return next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Twilio webhook validation failed.",
      error: error?.message || String(error),
    });
  }
}

router.post("/token", controller.getToken);
router.post("/device/offline", controller.deviceOffline);

router.post(
  "/voice/outbound",
  validateTwilioWebhook,
  controller.outboundVoiceWebhook
);
router.post(
  "/voice/incoming",
  validateTwilioWebhook,
  controller.inboundVoiceWebhook
);
router.post(
  "/voice/fallback",
  validateTwilioWebhook,
  controller.fallbackVoiceWebhook
);
router.post(
  "/voice/status",
  validateTwilioWebhook,
  controller.callStatusWebhook
);
router.post(
  "/recording/status",
  validateTwilioWebhook,
  controller.recordingStatusWebhook
);

router.get("/recording/:callSid", controller.getPlaybackUrl);

export default router;
