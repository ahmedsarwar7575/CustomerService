import { Device } from "@twilio/voice-sdk";

let device;
let activeCall = null;
let incomingCall = null;
let muted = false;

const $ = (id) => document.getElementById(id);
const log = (msg) => {
  $("log").textContent += msg + "\n";
  $("log").scrollTop = $("log").scrollHeight;
};
const setStatus = (s) => ($("status").textContent = s);

async function fetchToken(identity) {
  const r = await fetch(`/twilio/token?identity=${encodeURIComponent(identity)}`);
  if (!r.ok) throw new Error("Token fetch failed");
  return r.json();
}

async function startDevice() {
  const identity = $("identity").value.trim();
  const { token } = await fetchToken(identity);

  device = new Device(token, {
    logLevel: 1,
    // tokenRefreshMs: 30000, // optional: refresh before expiry
  });

  device.on("registered", () => {
    log("✅ Device registered, ready for incoming calls");
    setStatus("ready");
  });

  device.on("error", (e) => {
    log("❌ Device error: " + (e?.message || e));
    setStatus("error");
  });

  device.on("incoming", (call) => {
    incomingCall = call;
    log("📞 Incoming call from: " + call.parameters.From);
    setStatus("incoming");

    call.on("disconnect", () => {
      log("📴 Incoming call ended");
      incomingCall = null;
      setStatus("ready");
    });

    call.on("error", (e) => log("❌ Call error: " + (e?.message || e)));
  });

  // Required to receive inbound calls; WebSocket opens on register/connect. :contentReference[oaicite:9]{index=9}
  await device.register();
}

async function makeCall() {
  if (!device) return log("Start device first.");
  if (activeCall) return log("Already on a call.");

  const to = $("to").value.trim();
  if (!to) return log("Enter a phone number.");

  setStatus("calling");
  log("📲 Dialing: " + to);

  // Twilio docs: device.connect({ params: { To: "+1555..." } }) :contentReference[oaicite:10]{index=10}
  activeCall = await device.connect({ params: { To: to } });

  activeCall.on("accept", () => {
    log("✅ Call connected");
    setStatus("in-call");
  });

  activeCall.on("disconnect", () => {
    log("📴 Call ended");
    activeCall = null;
    muted = false;
    setStatus("ready");
    $("mute").textContent = "Mute";
  });

  activeCall.on("error", (e) => {
    log("❌ Call error: " + (e?.message || e));
  });
}

function hangup() {
  if (incomingCall) {
    incomingCall.reject();
    incomingCall = null;
    setStatus("ready");
    log("❎ Rejected incoming call");
    return;
  }
  if (activeCall) {
    activeCall.disconnect();
  } else if (device) {
    device.disconnectAll();
  }
}

function acceptIncoming() {
  if (!incomingCall) return log("No incoming call.");
  incomingCall.accept();
  log("✅ Incoming call accepted");
  setStatus("in-call");
}

function rejectIncoming() {
  if (!incomingCall) return log("No incoming call.");
  incomingCall.reject();
  log("❎ Incoming call rejected");
  incomingCall = null;
  setStatus("ready");
}

function toggleMute() {
  if (!activeCall) return log("No active call to mute.");
  muted = !muted;
  activeCall.mute(muted);
  $("mute").textContent = muted ? "Unmute" : "Mute";
  log(muted ? "🔇 Muted" : "🔊 Unmuted");
}

$("startup").addEventListener("click", () => startDevice().catch(e => log(e.message)));
$("call").addEventListener("click", () => makeCall().catch(e => log(e.message)));
$("hangup").addEventListener("click", hangup);
$("accept").addEventListener("click", acceptIncoming);
$("reject").addEventListener("click", rejectIncoming);
$("mute").addEventListener("click", toggleMute);
