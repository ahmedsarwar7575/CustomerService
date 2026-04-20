import twilio from "twilio";
import { isE164, isSafeClientIdentity } from "./service.js";

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

export function buildInboundAgentTwiml({
  agentIdentity,
  statusCallbackUrl,
  recordingStatusCallbackUrl,
  fallbackUrl,
}) {
  const response = new twilio.twiml.VoiceResponse();

  const dial = response.dial({
    answerOnBridge: true,
    timeout: 25,
    record: "record-from-answer-dual",
    recordingTrack: "both",
    recordingStatusCallback: recordingStatusCallbackUrl,
    recordingStatusCallbackMethod: "POST",
    action: fallbackUrl,
    method: "POST",
  });

  dial.client(
    {
      statusCallbackEvent: "initiated ringing answered completed",
      statusCallback: statusCallbackUrl,
      statusCallbackMethod: "POST",
    },
    agentIdentity
  );

  return response.toString();
}

export function buildFallbackTwiml({
  fallbackNumber,
  statusCallbackUrl,
  recordingStatusCallbackUrl,
}) {
  const response = new twilio.twiml.VoiceResponse();

  response.say(
    { voice: "alice" },
    "All agents are currently unavailable. Please hold while we connect you."
  );

  const dial = response.dial({
    answerOnBridge: true,
    timeout: 60,
    record: "record-from-answer-dual",
    recordingTrack: "both",
    recordingStatusCallback: recordingStatusCallbackUrl,
    recordingStatusCallbackMethod: "POST",
  });

  dial.number(
    {
      statusCallbackEvent: "initiated ringing answered completed",
      statusCallback: statusCallbackUrl,
      statusCallbackMethod: "POST",
    },
    fallbackNumber.replace(/\s+/g, "")
  );

  return response.toString();
}

export function buildHangupTwiml() {
  const response = new twilio.twiml.VoiceResponse();
  response.hangup();
  return response.toString();
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
