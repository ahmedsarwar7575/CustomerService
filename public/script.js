const logEl = document.getElementById("log");
const connectingEl = document.getElementById("connecting");
const startBtn = document.getElementById("startBtn");
const hangupBtn = document.getElementById("hangupBtn");
const remoteAudio = document.getElementById("remoteAudio");

let pc, dc, micStream;
let lastUserTranscript = "";
let lastRagItemId = null;
let awaitingResponse = false;

const log = (o) => {
  const s = typeof o === "string" ? o : JSON.stringify(o);
  logEl.textContent += s + "\n";
  logEl.scrollTop = logEl.scrollHeight;
};

async function getEphemeral() {
  const r = await fetch("/realtime-session");
  const txt = await r.text();
  if (!r.ok) { log(["[session error]", txt]); throw new Error(txt); }
  const { client_secret } = JSON.parse(txt);
  if (!client_secret) throw new Error("No client_secret");
  return client_secret;
}

async function rag(query) {
  const r = await fetch("/rag", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query })
  });
  const txt = await r.text();
  if (!r.ok) { log(["[rag error]", txt]); return { count: 0, block: "" }; }
  return JSON.parse(txt);
}

async function startCall() {
  try {
    connectingEl.style.display = "block";
    startBtn.disabled = true; hangupBtn.disabled = false;

    const client_secret = await getEphemeral();
    connectingEl.style.display = "none";

    pc = new RTCPeerConnection();
    dc = pc.createDataChannel("oai-events");

    pc.ontrack = (e) => { remoteAudio.srcObject = e.streams[0]; };
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micStream.getTracks().forEach(t => pc.addTrack(t, micStream));

    dc.onopen = () => log("[dc] open");
    dc.onclose = () => log("[dc] close");
    dc.onerror = (e) => log(["[dc] error", String(e)]);

    dc.onmessage = async (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { log(["event:", ev.data]); return; }
      // Show all events
      log(["event:", m]);

      if (m.type === "conversation.item.input_audio_transcription.completed") {
        lastUserTranscript =
          m.transcript ||
          m.item?.content?.find?.(c => typeof c?.transcript === "string")?.transcript ||
          "";
        lastUserTranscript = (lastUserTranscript || "").trim();
        if (lastUserTranscript) log(`Q: ${lastUserTranscript}`);
      }

      if (m.type === "input_audio_buffer.speech_stopped" && !awaitingResponse) {
        try {
          awaitingResponse = true;

          // Cancel any auto-started response (defensive)
          dc.send(JSON.stringify({ type: "response.cancel" }));

          const q = (lastUserTranscript || "").trim();
          const { count, block } = q ? await rag(q) : { count: 0, block: "" };

          if (count > 0) {
            dc.send(JSON.stringify({
              type: "conversation.item.create",
              item: {
                type: "message",
                role: "system",
                content: [{ type: "input_text", text: `### SNIPPETS\n${block}\n\n### USER QUESTION\n${q}` }]
              }
            }));
            lastRagItemId = "__PENDING__";
          } else {
            dc.send(JSON.stringify({
              type: "conversation.item.create",
              item: {
                type: "message",
                role: "system",
                content: [{ type: "input_text", text: `No matching snippets for: "${q}". Say: "That isn’t in our knowledge base yet." Then clarify next step.` }]
              }
            }));
            lastRagItemId = "__PENDING__";
          }

          // wait until item is created, then trigger response
        } catch (e) {
          log(["[rag pipeline error]", String(e)]);
          dc.send(JSON.stringify({ type: "response.create" })); // fallback
        }
      }

      if (m.type === "conversation.item.created" && lastRagItemId === "__PENDING__") {
        lastRagItemId = m.item?.id || null;
        dc.send(JSON.stringify({ type: "response.create" }));
      }

      if (m.type === "response.created") {
        // ok
      }

      if (m.type === "response.output_text.delta") {
        // (optional) live text
      }

      if (m.type === "response.done") {
        const outputs = m.response?.output || [];
        for (const out of outputs) {
          if (out.role === "assistant") {
            const part = Array.isArray(out.content)
              ? out.content.find(c => typeof c?.transcript === "string" && c.transcript.trim())
              : null;
            const a = (part?.transcript || "").trim();
            if (a) log(`A: ${a}`);
          }
        }
        // clean up injected system item so it doesn't snowball context
        if (lastRagItemId) {
          dc.send(JSON.stringify({ type: "conversation.item.delete", item_id: lastRagItemId }));
          lastRagItemId = null;
        }
        awaitingResponse = false;
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const resp = await fetch(
      `https://api.openai.com/v1/realtime?model=${encodeURIComponent("gpt-4o-realtime-preview-2024-12-17")}&voice=${encodeURIComponent("alloy")}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${client_secret}`,
          "Content-Type": "application/sdp",
          "OpenAI-Beta": "realtime=v1",
        },
        body: offer.sdp,
      }
    );

    const answer = { type: "answer", sdp: await resp.text() };
    await pc.setRemoteDescription(answer);
    log("[webrtc] connected");
  } catch (e) {
    log(["[startCall error]", String(e)]);
    startBtn.disabled = false; hangupBtn.disabled = true;
    connectingEl.style.display = "none";
  }
}

async function hangup() {
  try { dc && dc.close(); } catch {}
  try { pc && pc.close(); } catch {}
  try { micStream && micStream.getTracks().forEach(t => t.stop()); } catch {}
  startBtn.disabled = false; hangupBtn.disabled = true;
  log("[webrtc] call ended");
}

startBtn.onclick = startCall;
hangupBtn.onclick = hangup;
