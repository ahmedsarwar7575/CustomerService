import twilio from "twilio";
import {
  absoluteUrl,
  createVoiceAccessToken,
  getPlaybackUrlByCallSid,
  handleCallStatusWebhook,
  handleInboundVoiceRequest,
  handleOutboundVoiceRequest,
  handleRecordingWebhook,
  makeAgentIdentity,
  setAgentActive,
} from "./service.js";
import {
  buildErrorTwiml,
  buildFallbackTwiml,
  buildHangupTwiml,
  buildInboundAgentTwiml,
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

function log(label, payload) {
  try {
    console.log(`[MANUAL_CALLS] ${label}`, JSON.stringify(payload, null, 2));
  } catch {
    console.log(`[MANUAL_CALLS] ${label}`, payload);
  }
}

export async function getToken(req, res) {
  try {
    const data = await createVoiceAccessToken(req);

    log("TOKEN_RESPONSE", {
      identity: data.identity,
      agent: data.agent,
      callerId: data.callerId,
      hasToken: Boolean(data.token),
    });

    return res.status(200).json({
      success: true,
      message: "Manual calling token generated successfully.",
      ...data,
    });
  } catch (error) {
    log("TOKEN_ERROR", { message: error?.message || String(error) });
    return jsonError(
      res,
      401,
      "Failed to generate manual calling token.",
      error
    );
  }
}

export async function deviceOffline(req, res) {
  try {
    const agentId =
      req?.user?.id || req?.query?.agentId || req?.body?.agentId || null;

    if (!agentId) {
      return res
        .status(400)
        .json({ success: false, message: "agentId is required." });
    }

    await setAgentActive(agentId, false);

    log("DEVICE_OFFLINE", { agentId });

    return res.status(200).json({
      success: true,
      message: "Agent marked offline.",
      agentId,
    });
  } catch (error) {
    log("DEVICE_OFFLINE_ERROR", { message: error?.message || String(error) });
    return jsonError(res, 500, "Failed to mark agent offline.", error);
  }
}

export async function outboundVoiceWebhook(req, res) {
  try {
    log("OUTBOUND_VOICE_WEBHOOK_BODY", req.body);

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

    log("OUTBOUND_TWIML", { to: result.to, callerId: result.callerId });

    return xml(res, twiml);
  } catch (error) {
    log("OUTBOUND_VOICE_WEBHOOK_ERROR", {
      message: error?.message || String(error),
      body: req.body,
    });
    return xml(
      res,
      buildErrorTwiml(
        error?.message || "We could not place your call right now."
      )
    );
  }
}

export async function inboundVoiceWebhook(req, res) {
  try {
    log("INBOUND_VOICE_WEBHOOK_BODY", req.body);

    const dialCallStatus = String(req.body?.DialCallStatus || "").toLowerCase();

    if (dialCallStatus === "completed") {
      log("INBOUND_VOICE_WEBHOOK_COMPLETED_HANGUP", { dialCallStatus });
      return xml(res, buildHangupTwiml());
    }

    if (dialCallStatus === "answered") {
      log("INBOUND_VOICE_WEBHOOK_ALREADY_ANSWERED", { dialCallStatus });
      const response = new twilio.twiml.VoiceResponse();
      return xml(res, response.toString());
    }

    const routing = await handleInboundVoiceRequest(req.body);

    if (routing.type === "fallback") {
      log("INBOUND_ROUTING_FALLBACK", {
        callSid: req.body?.CallSid,
        fallbackNumber: routing.fallbackNumber,
      });

      return xml(
        res,
        buildFallbackTwiml({
          fallbackNumber: routing.fallbackNumber,
          statusCallbackUrl: absoluteUrl(req, "/manual-calls/voice/status"),
          recordingStatusCallbackUrl: absoluteUrl(
            req,
            "/manual-calls/recording/status"
          ),
        })
      );
    }

    const agentIdentity = makeAgentIdentity(routing.agent.id);
    const fallbackUrl = absoluteUrl(req, "/manual-calls/voice/fallback");

    const twiml = buildInboundAgentTwiml({
      agentIdentity,
      statusCallbackUrl: absoluteUrl(req, "/manual-calls/voice/status"),
      recordingStatusCallbackUrl: absoluteUrl(
        req,
        "/manual-calls/recording/status"
      ),
      fallbackUrl,
    });

    log("INBOUND_TWIML", {
      agentIdentity,
      agentId: routing.agent.id,
      twiml,
    });

    return xml(res, twiml);
  } catch (error) {
    log("INBOUND_VOICE_WEBHOOK_ERROR", {
      message: error?.message || String(error),
      body: req.body,
    });
    return xml(
      res,
      buildErrorTwiml(
        error?.message || "We could not connect your call right now."
      )
    );
  }
}

export async function fallbackVoiceWebhook(req, res) {
  try {
    log("FALLBACK_VOICE_WEBHOOK_BODY", req.body);

    const dialCallStatus = String(req.body?.DialCallStatus || "").toLowerCase();

    if (dialCallStatus === "answered" || dialCallStatus === "completed") {
      log("FALLBACK_VOICE_WEBHOOK_DONE", { dialCallStatus });
      if (dialCallStatus === "completed") return xml(res, buildHangupTwiml());
      const response = new twilio.twiml.VoiceResponse();
      return xml(res, response.toString());
    }

    const fallbackNumber =
      process.env.INBOUND_FALLBACK_NUMBER || "+18557201568";

    log("FALLBACK_VOICE_WEBHOOK_ROUTING_TO_FALLBACK", { fallbackNumber });

    return xml(
      res,
      buildFallbackTwiml({
        fallbackNumber,
        statusCallbackUrl: absoluteUrl(req, "/manual-calls/voice/status"),
        recordingStatusCallbackUrl: absoluteUrl(
          req,
          "/manual-calls/recording/status"
        ),
      })
    );
  } catch (error) {
    log("FALLBACK_VOICE_WEBHOOK_ERROR", {
      message: error?.message || String(error),
      body: req.body,
    });
    return xml(
      res,
      buildErrorTwiml("We could not connect your call right now.")
    );
  }
}

export async function callStatusWebhook(req, res) {
  try {
    log("VOICE_STATUS_WEBHOOK_BODY", req.body);

    const result = await handleCallStatusWebhook(req.body);

    log("VOICE_STATUS_WEBHOOK_RESULT", result);

    return res.status(200).json({
      success: true,
      message: "Call status processed successfully.",
      callSid: result.callSid,
    });
  } catch (error) {
    log("VOICE_STATUS_WEBHOOK_ERROR", {
      message: error?.message || String(error),
      body: req.body,
    });
    return jsonError(res, 500, "Failed to process call status webhook.", error);
  }
}

export async function recordingStatusWebhook(req, res) {
  try {
    log("RECORDING_STATUS_WEBHOOK_BODY", req.body);

    const result = await handleRecordingWebhook(req.body);

    log("RECORDING_STATUS_WEBHOOK_RESULT", result);

    if (result.shouldProcess) {
      log("POST_CALL_PIPELINE_QUEUED", {
        callSid: result.callSid,
        recordingSid: result.recordingSid,
      });

      setImmediate(() => {
        runPostCallPipeline(result).catch((error) => {
          console.error("[MANUAL_CALLS] POST_CALL_PIPELINE_FAILED", {
            callSid: result.callSid,
            error: error?.message || String(error),
          });
        });
      });
    } else {
      log("POST_CALL_PIPELINE_SKIPPED", {
        callSid: result.callSid || null,
        reason: "shouldProcess is false",
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
    log("RECORDING_STATUS_WEBHOOK_ERROR", {
      message: error?.message || String(error),
      body: req.body,
    });
    return jsonError(res, 500, "Failed to process recording webhook.", error);
  }
}

export async function getPlaybackUrl(req, res) {
  try {
    const { callSid } = req.params;
    const data = await getPlaybackUrlByCallSid(callSid);

    log("PLAYBACK_URL_RESULT", {
      callSid,
      hasPlaybackUrl: Boolean(data?.playbackUrl),
      recordingKey: data?.recordingKey || null,
    });

    return res.status(200).json({
      success: true,
      message: "Recording playback URL generated successfully.",
      ...data,
    });
  } catch (error) {
    log("PLAYBACK_URL_ERROR", {
      callSid: req.params?.callSid,
      message: error?.message || String(error),
    });
    const status = error?.statusCode || 404;
    return jsonError(res, status, "Failed to generate playback URL.", error);
  }
}
