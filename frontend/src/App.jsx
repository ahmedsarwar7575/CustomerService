import { useEffect, useMemo, useRef, useState } from "react";
import { Device } from "@twilio/voice-sdk";

const API = import.meta.env.VITE_API_BASE_URL || "https://csagentbackend.getpie.io";

export default function Dialer() {
  const deviceRef = useRef(null);
  const activeCallRef = useRef(null);
  const incomingCallRef = useRef(null);

  const [status, setStatus] = useState("idle");
  const [to, setTo] = useState("");
  const [log, setLog] = useState([]);
  const [muted, setMuted] = useState(false);
  const [starting, setStarting] = useState(false);

  const digits = useMemo(
    () => ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"],
    []
  );
  const inCall = status === "in-call" || status === "calling";
  const hasIncoming = status === "incoming";
  const canCall = status === "ready" && to.trim().length > 0;

  const addLog = (m) =>
    setLog((x) =>
      [...x, `${new Date().toLocaleTimeString()}  ${m}`].slice(-250)
    );

  const statusLabel = useMemo(() => {
    if (status === "idle") return "Idle";
    if (status === "ready") return "Ready";
    if (status === "incoming") return "Incoming";
    if (status === "calling") return "Calling";
    if (status === "in-call") return "In call";
    if (status === "error") return "Error";
    return status;
  }, [status]);

  const statusPill = useMemo(() => {
    const base =
      "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset";
    if (status === "ready")
      return `${base} bg-emerald-50 text-emerald-700 ring-emerald-200`;
    if (status === "incoming")
      return `${base} bg-amber-50 text-amber-700 ring-amber-200`;
    if (status === "error")
      return `${base} bg-rose-50 text-rose-700 ring-rose-200`;
    if (status === "in-call")
      return `${base} bg-blue-50 text-blue-700 ring-blue-200`;
    if (status === "calling")
      return `${base} bg-blue-50 text-blue-700 ring-blue-200`;
    return `${base} bg-slate-50 text-slate-700 ring-slate-200`;
  }, [status]);

  async function fetchToken() {
    const r = await fetch(`${API}/twilio/token?identity=agent_demo`, {
      credentials: "include",
    });
    if (!r.ok) throw new Error("Token fetch failed");
    return r.json();
  }

  async function startDevice() {
    if (starting || deviceRef.current) return;
    setStarting(true);
    try {
      const { token, identity  } = await fetchToken();
      console.log("token", token);
      console.log("identity", identity);
      const device = new Device(token, { logLevel: 1 });
      deviceRef.current = device;

      device.on("registered", () => {
        addLog("Device registered");
        setStatus("ready");
      });

      device.on("incoming", (call) => {
        incomingCallRef.current = call;
        addLog(`Incoming: ${call.parameters.From || "Unknown"}`);
        setStatus("incoming");

        call.on("disconnect", () => {
          addLog("Incoming ended");
          incomingCallRef.current = null;
          setStatus("ready");
        });

        call.on("cancel", () => {
          addLog("Incoming canceled");
          incomingCallRef.current = null;
          setStatus("ready");
        });

        call.on("reject", () => {
          addLog("Incoming rejected");
          incomingCallRef.current = null;
          setStatus("ready");
        });

        call.on("error", (e) =>
          addLog(`Call error: ${e?.message || String(e)}`)
        );
      });

      device.on("error", (e) => {
        addLog(`Device error: ${e?.message || String(e)}`);
        setStatus("error");
      });

      device.on("tokenWillExpire", async () => {
        try {
          const { token: newToken } = await fetchToken();
          device.updateToken(newToken);
          addLog("Token refreshed");
        } catch {
          addLog("Token refresh failed");
        }
      });

      await device.register();
    } catch (e) {
      addLog(e?.message || String(e));
      setStatus("error");
    } finally {
      setStarting(false);
    }
  }

  async function placeCall() {
    const device = deviceRef.current;
    if (!device) return addLog("Start device first");
    const number = to.trim();
    if (!number) return;

    setStatus("calling");
    addLog(`Dialing ${number}`);

    const call = await device.connect({ params: { To: number } });
    activeCallRef.current = call;

    call.on("accept", () => {
      addLog("Connected");
      setStatus("in-call");
    });

    call.on("disconnect", () => {
      addLog("Ended");
      activeCallRef.current = null;
      setMuted(false);
      setStatus("ready");
    });

    call.on("cancel", () => {
      addLog("Canceled");
      activeCallRef.current = null;
      setMuted(false);
      setStatus("ready");
    });

    call.on("error", (e) => addLog(`Call error: ${e?.message || String(e)}`));
  }

  function hangup() {
    const incoming = incomingCallRef.current;
    if (incoming) {
      incoming.reject();
      incomingCallRef.current = null;
      addLog("Rejected incoming");
      setStatus("ready");
      return;
    }
    const active = activeCallRef.current;
    if (active) active.disconnect();
  }

  function accept() {
    const incoming = incomingCallRef.current;
    if (!incoming) return;
    incoming.accept();
    addLog("Accepted incoming");
    setStatus("in-call");
  }

  function toggleMute() {
    const active = activeCallRef.current;
    if (!active) return;
    const next = !muted;
    active.mute(next);
    setMuted(next);
    addLog(next ? "Muted" : "Unmuted");
  }

  function appendChar(ch) {
    if (inCall) {
      const active = activeCallRef.current;
      if (active && typeof active.sendDigits === "function") {
        active.sendDigits(ch);
        addLog(`DTMF ${ch}`);
      }
      return;
    }
    setTo((v) => (v + ch).slice(0, 32));
  }

  function backspace() {
    if (inCall) return;
    setTo((v) => v.slice(0, -1));
  }

  function clearAll() {
    if (inCall) return;
    setTo("");
  }

  function normalizeKey(k) {
    if (k >= "0" && k <= "9") return k;
    if (k === "*" || k === "#") return k;
    if (k === "+") return "+";
    return null;
  }

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const key = e.key;

      if (key === "Enter") {
        if (hasIncoming) {
          e.preventDefault();
          accept();
          return;
        }
        if (canCall) {
          e.preventDefault();
          placeCall().catch((err) => addLog(err?.message || String(err)));
          return;
        }
        return;
      }

      if (key === "Escape") {
        e.preventDefault();
        hangup();
        return;
      }

      if (key === "Backspace") {
        if (!inCall) {
          e.preventDefault();
          backspace();
        }
        return;
      }

      if (key.toLowerCase() === "m") {
        if (inCall) {
          e.preventDefault();
          toggleMute();
        }
        return;
      }

      const d = normalizeKey(key);
      if (d) {
        e.preventDefault();
        appendChar(d);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canCall, hasIncoming, inCall, muted, status, to]);

  useEffect(() => {
    return () => {
      try {
        activeCallRef.current?.disconnect?.();
      } catch {}
      try {
        deviceRef.current?.destroy?.();
      } catch {}
    };
  }, []);

  const primaryDisabled = !canCall;
  const hangDisabled = !inCall && !hasIncoming;

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-slate-50 text-slate-900">
      <div className="mx-auto w-full max-w-6xl px-4 py-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">
              React Dialer
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Type digits on keyboard or use the keypad.{" "}
              <span className="font-semibold">Enter</span> to call/accept,{" "}
              <span className="font-semibold">Esc</span> to hang up,{" "}
              <span className="font-semibold">M</span> to mute.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={statusPill}>{statusLabel}</span>
            <span
              className={
                "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset " +
                (deviceRef.current
                  ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                  : "bg-slate-50 text-slate-700 ring-slate-200")
              }
            >
              {deviceRef.current ? "Device" : "No Device"}
            </span>
          </div>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[420px_1fr]">
          <div className="rounded-3xl border border-slate-200 bg-white shadow-[0_10px_30px_rgba(2,6,23,0.08)]">
            <div className="p-5">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <input
                    className="w-full bg-transparent text-lg font-extrabold tracking-widest text-slate-900 outline-none placeholder:tracking-normal placeholder:text-slate-400"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    placeholder="+923001234567"
                    inputMode="tel"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={backspace}
                      disabled={inCall || !to}
                      className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      ⌫
                    </button>
                    <button
                      onClick={clearAll}
                      disabled={inCall || !to}
                      className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="mt-2 text-xs text-slate-500">
                  {inCall
                    ? "Keypad sends DTMF during call"
                    : "Supports +, 0-9, *, #"}
                </div>

                <div className="mt-4 grid grid-cols-3 gap-3">
                  {digits.map((d) => (
                    <button
                      key={d}
                      onClick={() => appendChar(d)}
                      className="group relative h-14 rounded-2xl border border-slate-200 bg-white text-xl font-extrabold tracking-widest shadow-sm transition active:translate-y-[1px] hover:shadow-md"
                    >
                      <span className="opacity-90 group-hover:opacity-100">
                        {d}
                      </span>
                    </button>
                  ))}
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <button
                    onClick={startDevice}
                    disabled={!!deviceRef.current || starting}
                    className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-sm font-extrabold text-slate-900 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {deviceRef.current
                      ? "Device Ready"
                      : starting
                      ? "Starting..."
                      : "Start Device"}
                  </button>

                  <button
                    onClick={() =>
                      placeCall().catch((err) =>
                        addLog(err?.message || String(err))
                      )
                    }
                    disabled={primaryDisabled}
                    className="inline-flex h-11 items-center justify-center rounded-2xl bg-gradient-to-b from-blue-500 to-blue-600 text-sm font-extrabold text-white shadow-md transition hover:from-blue-600 hover:to-blue-700 disabled:cursor-not-allowed disabled:from-blue-300 disabled:to-blue-300"
                  >
                    Call
                  </button>

                  <button
                    onClick={hangup}
                    disabled={hangDisabled}
                    className="inline-flex h-11 items-center justify-center rounded-2xl bg-gradient-to-b from-rose-500 to-rose-600 text-sm font-extrabold text-white shadow-md transition hover:from-rose-600 hover:to-rose-700 disabled:cursor-not-allowed disabled:from-rose-300 disabled:to-rose-300"
                  >
                    Hang Up
                  </button>

                  <button
                    onClick={toggleMute}
                    disabled={!inCall}
                    className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-sm font-extrabold text-slate-900 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {muted ? "Unmute" : "Mute"}
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3">
                  <button
                    onClick={accept}
                    disabled={!hasIncoming}
                    className="inline-flex h-11 items-center justify-center rounded-2xl bg-gradient-to-b from-emerald-500 to-emerald-600 text-sm font-extrabold text-white shadow-md transition hover:from-emerald-600 hover:to-emerald-700 disabled:cursor-not-allowed disabled:from-emerald-300 disabled:to-emerald-300"
                  >
                    Accept
                  </button>
                  <button
                    onClick={hangup}
                    disabled={!hasIncoming}
                    className="inline-flex h-11 items-center justify-center rounded-2xl bg-gradient-to-b from-rose-500 to-rose-600 text-sm font-extrabold text-white shadow-md transition hover:from-rose-600 hover:to-rose-700 disabled:cursor-not-allowed disabled:from-rose-300 disabled:to-rose-300"
                  >
                    Reject
                  </button>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="rounded-lg border border-slate-200 bg-white px-2 py-1 font-semibold text-slate-700">
                    Enter
                  </span>
                  <span>call/accept</span>
                  <span className="mx-1">·</span>
                  <span className="rounded-lg border border-slate-200 bg-white px-2 py-1 font-semibold text-slate-700">
                    Esc
                  </span>
                  <span>hang up</span>
                  <span className="mx-1">·</span>
                  <span className="rounded-lg border border-slate-200 bg-white px-2 py-1 font-semibold text-slate-700">
                    Backspace
                  </span>
                  <span>delete</span>
                  <span className="mx-1">·</span>
                  <span className="rounded-lg border border-slate-200 bg-white px-2 py-1 font-semibold text-slate-700">
                    M
                  </span>
                  <span>mute</span>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white shadow-[0_10px_30px_rgba(2,6,23,0.08)]">
            <div className="flex items-center justify-between gap-3 px-6 pt-6">
              <div>
                <h2 className="text-lg font-extrabold tracking-tight">
                  Activity
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Inbound and outbound events
                </p>
              </div>
              <div className="text-xs font-semibold text-slate-500">
                {log.length} events
              </div>
            </div>

            <div className="p-6">
              <div className="h-[420px] overflow-auto rounded-2xl border border-slate-200 bg-gradient-to-b from-white to-slate-50 p-4 text-xs leading-relaxed text-slate-700">
                {log.length ? (
                  <div className="whitespace-pre-wrap">{log.join("\n")}</div>
                ) : (
                  <div className="text-slate-500">No activity yet</div>
                )}
              </div>

              <div className="mt-4 grid gap-2 text-sm text-slate-600">
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="font-extrabold text-slate-900">Tips</div>
                  <div className="mt-2 grid gap-1 text-sm text-slate-600">
                    <div>Allow microphone permissions in your browser.</div>
                    <div>
                      For inbound calls, backend must dial the same identity
                      used in the token.
                    </div>
                    <div>Use HTTPS (ngrok) in production-like testing.</div>
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4">
                  <div>
                    <div className="text-sm font-extrabold text-slate-900">
                      Connection
                    </div>
                    <div className="text-xs text-slate-600">{API}</div>
                  </div>
                  <button
                    onClick={() => setLog([])}
                    className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-extrabold text-slate-900 shadow-sm transition hover:bg-slate-50"
                  >
                    Clear Log
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {hasIncoming && (
          <div className="pointer-events-none fixed inset-x-0 bottom-6 mx-auto flex w-full max-w-2xl justify-center px-4">
            <div className="pointer-events-auto flex w-full items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 shadow-lg">
              <div className="min-w-0">
                <div className="text-sm font-extrabold text-amber-800">
                  Incoming call
                </div>
                <div className="truncate text-xs text-amber-700">
                  From: {incomingCallRef.current?.parameters?.From || "Unknown"}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={accept}
                  className="inline-flex h-10 items-center justify-center rounded-xl bg-gradient-to-b from-emerald-500 to-emerald-600 px-4 text-sm font-extrabold text-white shadow-md transition hover:from-emerald-600 hover:to-emerald-700"
                >
                  Accept
                </button>
                <button
                  onClick={hangup}
                  className="inline-flex h-10 items-center justify-center rounded-xl bg-gradient-to-b from-rose-500 to-rose-600 px-4 text-sm font-extrabold text-white shadow-md transition hover:from-rose-600 hover:to-rose-700"
                >
                  Reject
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
