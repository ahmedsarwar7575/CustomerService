const qaPairs = [];           
  let pendingUserQ = null;      
  const logEl = document.getElementById("log");

  const log = (...args) => {
    const str = args.join(" ");
    const match = str.match(/^event:\s*(\{.*\})$/);
    if (!match) return;

    try {
      const obj = JSON.parse(match[1]);

      if (obj.type === "conversation.item.input_audio_transcription.completed") {
        const q = (obj?.transcript || "").trim();
        if (!q) return;
        logEl.textContent += `Q: ${q}\n`;
        pendingUserQ = q; 
      }

      if (obj.type === "response.done") {
        const outputs = obj.response?.output || [];
        for (const out of outputs) {
          if (out.role === "assistant") {
            const part = out.content?.find((c) => c.transcript);
            if (part) {
              const a = (part.transcript || "").trim();
              logEl.textContent += `A: ${a}\n`;
              if (pendingUserQ) {
                qaPairs.push({ q: pendingUserQ, a });
                pendingUserQ = null;
              } else {
                qaPairs.push({ q: null, a });
              }
            }
          }
        }
      }

      logEl.scrollTop = logEl.scrollHeight;
    } catch (e) {
      // ignore
    }
  };

  let pc, dc, localStream;

  async function startCall() {
    document.getElementById("connecting").style.display= "block";
    document.getElementById("startBtn").disabled = true;
    document.getElementById("hangupBtn").disabled = false;

    const tokenRes = await fetch("/realtime-session");
    const { client_secret } = await tokenRes.json();
    if (!client_secret) {
      log("event:", JSON.stringify({ error: "No client_secret" }));
      return;
    }
    document.getElementById("connecting").style.display= "none";
    pc = new RTCPeerConnection();
    pc.onconnectionstatechange = () => log("event:", JSON.stringify({ pc_state: pc.connectionState }));
    pc.oniceconnectionstatechange = () => log("event:", JSON.stringify({ ice_state: pc.iceConnectionState }));

    dc = pc.createDataChannel("oai-events");
    dc.onmessage = (ev) => {
      // Some events are plain strings, others are JSON; forward to log()
      try {
        JSON.parse(ev.data);
        log("event:", ev.data);
      } catch {
        log("event:", JSON.stringify({ note: ev.data }));
      }
    };

    pc.ontrack = (e) => (document.getElementById("remoteAudio").srcObject = e.streams[0]);

    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    localStream.getAudioTracks().forEach((t) => pc.addTrack(t, localStream));

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
    log("event:", JSON.stringify({ status: "Connected. Speak!" }));
  }

  async function postSummary() {
    try {
      // If the last user spoke but no assistant answer yet, still include their Q
      if (pendingUserQ) {
        qaPairs.push({ q: pendingUserQ, a: null });
        pendingUserQ = null;
      }
      document.getElementById("Summary").style.display= "block";
      const r = await fetch("/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pairs: qaPairs,
          meta: { source: "webrtc-demo" }
        }),
      });
      const data = await r.json();
      document.getElementById("Summary").style.display= "none";
    //   const releventdata = {
    //     summary: data?.summary,
    //     home_resort: data?.input?.home_resort,
    //     mortgage_owed: data?.input?.mortgage_owed,
    //     unpaid_fees_or_assessments: data?.input?.unpaid_fees_or_assessments,
    //     mortgage_balance_estimate: data?.input?.mortgage_balance_estimate,
    //     network_or_destination: data?.input?.network_or_destination,
    //     points_or_weeks: data?.input?.points_or_weeks,
    //     previous_attempts_to_cancel: data?.input?.previous_attempts_to_cancel,
    //     preferred_outcome: data?.input?.preferred_outcome,
    //   }
      logEl.textContent += `\n--- SUMMARY JSON ---\n${JSON.stringify(data, null, 2)}\n`;
      logEl.scrollTop = logEl.scrollHeight;
    } catch (e) {
      logEl.textContent += `\n[summary error] ${e}\n`;
    }
  }

  async function hangup() {
    // 1) Send Q/A to summarizer BEFORE tearing down
    await postSummary();

    // 2) Tidy up the call
    document.getElementById("hangupBtn").disabled = true;
    try { dc && dc.close(); } catch {}
    try { pc && pc.close(); } catch {}
    try { localStream && localStream.getTracks().forEach((t) => t.stop()); } catch {}
    document.getElementById("startBtn").disabled = false;
    log("event:", JSON.stringify({ status: "Call ended." }));
  }

  document.getElementById("startBtn").onclick = startCall;
  document.getElementById("hangupBtn").onclick = hangup;
