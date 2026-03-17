import {
  absoluteUrl,
  createVoiceAccessToken,
  getPlaybackUrlByCallSid,
  handleCallStatusWebhook,
  handleInboundVoiceRequest,
  handleOutboundVoiceRequest,
  handleRecordingWebhook,
} from "./service.js";
import {
  buildErrorTwiml,
  buildInboundTwiml,
  buildOutboundTwiml,
} from "./twiml.js";
import { runPostCallPipeline } from "./worker.js";

function xml(res, body, status = 200) {
  return res.status(status).type("text/xml").send(body);
}

function jsonError(res, status, message, error) {
  return res.status(status).json({
    success: false,
    message,
    error: error?.message || (typeof error === "string" ? error : undefined),
  });
}

export async function getToken(req, res) {
  try {
    const data = await createVoiceAccessToken(req);

    return res.status(200).json({
      success: true,
      message: "Manual calling token generated successfully.",
      ...data,
    });
  } catch (error) {
    return jsonError(
      res,
      401,
      "Failed to generate manual calling token.",
      error
    );
  }
}

export async function outboundVoiceWebhook(req, res) {
  try {
    const result = await handleOutboundVoiceRequest(req.body);

    const twiml = buildOutboundTwiml({
      to: result.to,
      callerId: result.callerId,
      statusCallbackUrl: absoluteUrl(req, "/manual-calls/voice/status"),
      recordingStatusCallbackUrl: absoluteUrl(
        req,
        "/manual-calls/recording/status"
      ),
    });

    return xml(res, twiml);
  } catch (error) {
    const twiml = buildErrorTwiml(
      error?.message || "We could not place your call right now."
    );
    return xml(res, twiml);
  }
}

export async function inboundVoiceWebhook(req, res) {
  try {
    console.log("INBOUND VOICE WEBHOOK", req.body);

    const result = await handleInboundVoiceRequest(req.body);

    const twiml = buildInboundTwiml({
      identity: result.identity,
      from: req.body?.From || req.body?.Caller || "",
      statusCallbackUrl: absoluteUrl(req, "/manual-calls/voice/status"),
      recordingStatusCallbackUrl: absoluteUrl(
        req,
        "/manual-calls/recording/status"
      ),
      fallbackMessage:
        "All of our agents are currently unavailable. Please try again shortly.",
    });

    console.log("INBOUND TWIML", twiml);

    return xml(res, twiml);
  } catch (error) {
    const twiml = buildErrorTwiml(
      error?.message || "We could not connect your call right now."
    );
    return xml(res, twiml);
  }
}

export async function callStatusWebhook(req, res) {
  try {
    const result = await handleCallStatusWebhook(req.body);

    return res.status(200).json({
      success: true,
      message: "Call status processed successfully.",
      callSid: result.callSid,
    });
  } catch (error) {
    return jsonError(res, 500, "Failed to process call status webhook.", error);
  }
}

export async function recordingStatusWebhook(req, res) {
  try {
    const result = await handleRecordingWebhook(req.body);

    if (result.shouldProcess) {
      setImmediate(() => {
        runPostCallPipeline(result).catch((error) => {
          console.error("Manual call pipeline failed:", {
            callSid: result.callSid,
            error: error?.message || String(error),
          });
        });
      });
    }

    return res.status(202).json({
      success: true,
      message: result.shouldProcess
        ? "Recording received and queued for processing."
        : "Recording webhook received. Nothing to process.",
      callSid: result.callSid || null,
    });
  } catch (error) {
    return jsonError(res, 500, "Failed to process recording webhook.", error);
  }
}

export async function getPlaybackUrl(req, res) {
  try {
    const { callSid } = req.params;
    const data = await getPlaybackUrlByCallSid(callSid);

    return res.status(200).json({
      success: true,
      message: "Recording playback URL generated successfully.",
      ...data,
    });
  } catch (error) {
    const status = error?.statusCode || 404;
    return jsonError(res, status, "Failed to generate playback URL.", error);
  }
}
