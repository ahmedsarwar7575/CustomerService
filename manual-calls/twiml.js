import twilio from "twilio";
import { isE164, isSafeClientIdentity } from "./service.js";

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildClientParameter(name, value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return `<Parameter name="${escapeXml(name)}" value="${escapeXml(text)}"/>`;
}

export function buildOutboundTwiml({
  to,
  callerId,
  statusCallbackUrl,
  recordingStatusCallbackUrl,
}) {
  const response = new twilio.twiml.VoiceResponse();

  const dial = response.dial({
    answerOnBridge: true,
    timeout: 25,
    callerId,
    record: "record-from-answer-dual",
    recordingTrack: "both",
    recordingStatusCallback: recordingStatusCallbackUrl,
    recordingStatusCallbackMethod: "POST",
  });

  const attrs = {
    statusCallbackEvent: "initiated ringing answered completed",
    statusCallback: statusCallbackUrl,
    statusCallbackMethod: "POST",
  };

  if (isE164(to)) {
    dial.number(attrs, to.replace(/\s+/g, ""));
    return response.toString();
  }

  if (isSafeClientIdentity(to)) {
    dial.client(attrs, to);
    return response.toString();
  }

  throw new Error(
    "Destination is not a valid E.164 number or safe client identity."
  );
}

export function buildInboundTwiml({
  identity,
  from,
  to,
  callSid,
  statusCallbackUrl,
  recordingStatusCallbackUrl,
  fallbackMessage,
}) {
  if (!identity) {
    const response = new twilio.twiml.VoiceResponse();
    response.say({ voice: "alice" }, fallbackMessage || "No available agent.");
    response.hangup();
    return response.toString();
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<Response>",
    `<Dial answerOnBridge="true" timeout="25" record="record-from-answer-dual" recordingTrack="both" recordingStatusCallback="${escapeXml(
      recordingStatusCallbackUrl
    )}" recordingStatusCallbackMethod="POST">`,
    `<Client statusCallbackEvent="initiated ringing answered completed" statusCallback="${escapeXml(
      statusCallbackUrl
    )}" statusCallbackMethod="POST">`,
    `<Identity>${escapeXml(identity)}</Identity>`,
    buildClientParameter("caller", from),
    buildClientParameter("from", from),
    buildClientParameter("to", to),
    buildClientParameter("callSid", callSid),
    "</Client>",
    "</Dial>",
    "</Response>",
  ]
    .filter(Boolean)
    .join("");
}

export function buildErrorTwiml(message) {
  const response = new twilio.twiml.VoiceResponse();
  response.say(
    { voice: "alice" },
    message || "We are unable to complete your request."
  );
  response.hangup();
  return response.toString();
}
