import twilio from "twilio";
import { isE164, isSafeClientIdentity } from "./service.js";

function createDial(statusCallbackUrl, recordingStatusCallbackUrl, extra = {}) {
  const response = new twilio.twiml.VoiceResponse();

  const dial = response.dial({
    answerOnBridge: true,
    timeout: 25,
    method: "POST",
    action: statusCallbackUrl,
    record: "record-from-answer-dual",
    recordingTrack: "both",
    recordingStatusCallback: recordingStatusCallbackUrl,
    recordingStatusCallbackMethod: "POST",
    ...extra,
  });

  return { response, dial };
}

export function buildOutboundTwiml({
  to,
  callerId,
  statusCallbackUrl,
  recordingStatusCallbackUrl,
}) {
  const { response, dial } = createDial(statusCallbackUrl, recordingStatusCallbackUrl, {
    callerId,
  });

  const progressAttrs = {
    statusCallbackEvent: "initiated ringing answered completed",
    statusCallback: statusCallbackUrl,
    statusCallbackMethod: "POST",
  };

  if (isE164(to)) {
    dial.number(progressAttrs, to.replace(/\s+/g, ""));
    return response.toString();
  }

  if (isSafeClientIdentity(to)) {
    dial.client(progressAttrs, to);
    return response.toString();
  }

  throw new Error("Destination is not a valid E.164 number or safe client identity.");
}

export function buildInboundTwiml({
  identities = [],
  statusCallbackUrl,
  recordingStatusCallbackUrl,
  fallbackMessage,
}) {
  const cleanIdentities = identities.filter(Boolean);

  if (!cleanIdentities.length) {
    return buildErrorTwiml(fallbackMessage || "No available agent.");
  }

  const { response, dial } = createDial(statusCallbackUrl, recordingStatusCallbackUrl);

  const progressAttrs = {
    statusCallbackEvent: "initiated ringing answered completed",
    statusCallback: statusCallbackUrl,
    statusCallbackMethod: "POST",
  };

  for (const identity of cleanIdentities) {
    dial.client(progressAttrs, identity);
  }

  return response.toString();
}

export function buildErrorTwiml(message) {
  const response = new twilio.twiml.VoiceResponse();
  response.say({ voice: "alice" }, message || "We are unable to complete your request.");
  response.hangup();
  return response.toString();
}