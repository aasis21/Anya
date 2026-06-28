// Client renderer for the voice-mode canvas (voice in / voice out, no camera).
// Self-contained HTML served from the per-instance loopback server. Turns go to
// POST /turn; replies are spoken via SpeechSynthesis. Centerpiece is an
// audio-reactive orb driven by the mic level + conversation state.

export function renderHtml(instanceId) {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
<title>Anya · Voice</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet" />
<style>
  :root {
    --bg: #06070b;
    --panel: rgba(18, 21, 30, 0.6);
    --stroke: rgba(255, 255, 255, 0.10);
    --stroke-strong: rgba(255, 255, 255, 0.22);
    --ink: #eef1f6;
    --muted: #9aa3b2;
    --sans: "Sora", var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
    --serif: "Instrument Serif", Georgia, serif;
    --accent: #8aa0b6; --accent-2: #5b6b7e;
    --level: 0; /* live mic loudness 0..1 */
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    font-family: var(--sans); background: var(--bg); color: var(--ink);
    overflow: hidden; -webkit-font-smoothing: antialiased;
  }
  body[data-state="idle"]      { --accent:#8aa0b6; --accent-2:#566273; }
  body[data-state="listening"] { --accent:#5ce6a3; --accent-2:#22b685; }
  body[data-state="thinking"]  { --accent:#ffcf6b; --accent-2:#f0a93a; }
  body[data-state="speaking"]  { --accent:#7db5ff; --accent-2:#4f8cff; }

  #stage { position: fixed; inset: 0; display: flex; flex-direction: column; isolation: isolate; }

  /* ambient aurora */
  #aurora {
    position: absolute; inset: -30%; z-index: 0; pointer-events: none; filter: blur(70px); opacity: .5;
    background:
      radial-gradient(36% 42% at 22% 26%, color-mix(in srgb, var(--accent) 45%, transparent), transparent 70%),
      radial-gradient(40% 46% at 80% 22%, color-mix(in srgb, var(--accent-2) 40%, transparent), transparent 72%),
      radial-gradient(60% 60% at 50% 112%, color-mix(in srgb, var(--accent) 55%, transparent), transparent 70%);
    animation: drift 20s ease-in-out infinite alternate; transition: opacity .6s ease;
  }
  @keyframes drift { 0%{transform:translate3d(0,0,0) scale(1)} 100%{transform:translate3d(2%,-2%,0) scale(1.08)} }
  #grain {
    position: absolute; inset: 0; z-index: 9; pointer-events: none; opacity: .045; mix-blend-mode: overlay;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  }

  /* top wordmark */
  #topbar { position: absolute; top: 0; left: 0; right: 0; z-index: 3; display: flex; align-items: center; gap: 12px; padding: 18px 18px; }
  .wordmark { display: flex; align-items: baseline; gap: 8px; }
  .wordmark b { font-family: var(--serif); font-style: italic; font-weight: 400; font-size: 27px; letter-spacing: .3px; }
  .wordmark span { font-size: 11px; letter-spacing: .3em; text-transform: uppercase; color: var(--muted); }
  #spacer { flex: 1; }
  .ghost {
    -webkit-appearance: none; cursor: pointer; color: var(--ink);
    width: 38px; height: 38px; border-radius: 12px; display: grid; place-items: center; font-size: 16px;
    background: var(--panel); border: 1px solid var(--stroke); backdrop-filter: blur(14px);
    transition: transform .12s ease, background .2s ease, border-color .2s ease;
  }
  .ghost:hover { background: rgba(40,46,60,.7); border-color: var(--stroke-strong); transform: translateY(-1px); }
  .ghost:active { transform: scale(.95); }
  .ghost.off { opacity: .45; }

  /* center column */
  #center { position: relative; z-index: 2; flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 30px; padding: 20px; }

  /* ---- the orb ---- */
  #orb-wrap { position: relative; width: min(58vw, 300px); aspect-ratio: 1; display: grid; place-items: center; }
  /* expanding rings while live */
  #orb-wrap::before, #orb-wrap::after {
    content: ""; position: absolute; inset: 8%; border-radius: 50%;
    border: 1.5px solid color-mix(in srgb, var(--accent) 45%, transparent); opacity: 0;
  }
  body[data-state="listening"] #orb-wrap::before { animation: ring 2.4s ease-out infinite; }
  body[data-state="listening"] #orb-wrap::after  { animation: ring 2.4s ease-out infinite 1.2s; }
  body[data-state="speaking"]  #orb-wrap::before { animation: ring 1.3s ease-out infinite; }
  @keyframes ring { 0%{opacity:.6; transform:scale(.85)} 100%{opacity:0; transform:scale(1.35)} }

  #orb {
    position: relative; width: 78%; aspect-ratio: 1; border-radius: 50%;
    transform: scale(calc(1 + var(--level) * 0.16));
    transition: transform .08s linear;
    background:
      radial-gradient(60% 60% at 32% 28%, #ffffff 0%, color-mix(in srgb, var(--accent) 70%, #fff) 22%, var(--accent) 52%, var(--accent-2) 100%);
    box-shadow:
      0 30px 80px -20px color-mix(in srgb, var(--accent) 60%, transparent),
      0 0 60px 0 color-mix(in srgb, var(--accent) 40%, transparent),
      inset 0 2px 6px rgba(255,255,255,.55), inset 0 -20px 40px rgba(0,0,0,.25);
    animation: breathe 5s ease-in-out infinite;
  }
  @keyframes breathe { 0%,100%{filter:brightness(1)} 50%{filter:brightness(1.08)} }
  #orb::before {
    content: ""; position: absolute; inset: 6%; border-radius: 50%;
    background: conic-gradient(from 0deg, transparent, color-mix(in srgb,#fff 55%,transparent), transparent 38%, color-mix(in srgb,var(--accent) 60%,transparent) 60%, transparent 78%);
    mix-blend-mode: screen; opacity: .8; filter: blur(6px);
    animation: spin 8s linear infinite;
  }
  body[data-state="thinking"] #orb::before { animation-duration: 2.4s; }
  body[data-state="speaking"] #orb { cursor: pointer; }
  @keyframes spin { to { transform: rotate(360deg); } }
  #orb::after {
    content: ""; position: absolute; top: 12%; left: 18%; width: 34%; height: 24%; border-radius: 50%;
    background: radial-gradient(closest-side, rgba(255,255,255,.85), transparent); filter: blur(2px);
  }

  #status { font-size: 14px; font-weight: 500; letter-spacing: .4px; color: var(--muted); }
  #status b { color: color-mix(in srgb, var(--accent) 75%, #fff); font-weight: 600; }
  #caption-inner {
    max-width: 560px; text-align: center; font-size: 19px; line-height: 1.5;
    min-height: 1.5em; transition: opacity .25s ease;
    font-family: var(--serif); letter-spacing: .2px;
  }
  #caption-inner:empty { display: none; }
  .you { color: color-mix(in srgb, var(--accent) 80%, #ffffff); font-style: italic; }
  .interim { opacity: .5; }

  /* permission overlay */
  #overlay { position: absolute; inset: 0; z-index: 5; display: none; place-items: center; text-align: center; padding: 28px; background: rgba(5,6,10,.7); backdrop-filter: blur(6px); }
  #overlay.show { display: grid; }
  #overlay .glyph { font-size: 30px; margin-bottom: 12px; }
  #overlay h2 { margin: 0 0 8px; font-family: var(--serif); font-style: italic; font-weight: 400; font-size: 24px; }
  #overlay p { margin: 0 auto; max-width: 360px; font-size: 13.5px; line-height: 1.55; color: var(--muted); }

  /* control deck */
  #deck { position: relative; z-index: 2; flex: none; display: flex; align-items: center; gap: 14px; justify-content: center; padding: 16px 16px 12px; }
  #deck::before {
    content: ""; position: absolute; left: 50%; bottom: -8px; width: 300px; height: 110px; transform: translateX(-50%);
    pointer-events: none; filter: blur(38px); z-index: -1; opacity: .5; transition: opacity .5s ease;
    background: radial-gradient(50% 60% at 50% 50%, color-mix(in srgb, var(--accent) 55%, transparent), transparent 70%);
  }
  #mic {
    position: relative; cursor: pointer; border: none; flex: none;
    width: 64px; height: 64px; border-radius: 50%; color: #06241a; font-size: 23px; display: grid; place-items: center;
    background: radial-gradient(120% 120% at 30% 25%, #fff, color-mix(in srgb, var(--accent) 85%, #fff) 32%, var(--accent-2));
    box-shadow: 0 10px 28px -6px color-mix(in srgb, var(--accent) 60%, transparent), inset 0 1px 1px rgba(255,255,255,.6);
    transition: transform .12s ease, box-shadow .3s ease;
  }
  #mic:active { transform: scale(.94); }
  #mic.live { color: #fff; background: radial-gradient(120% 120% at 30% 25%, #ff9b95, #f0534f 45%, #c1322f); box-shadow: 0 10px 28px -6px rgba(220,70,66,.6), inset 0 1px 1px rgba(255,255,255,.4); }
  .hint { position: relative; z-index: 2; flex: none; font-size: 11px; color: var(--muted); text-align: center; padding: 0 16px 12px; letter-spacing: .2px; }
</style>
</head>
<body data-state="idle">
  <div id="stage">
    <div id="aurora"></div>

    <div id="topbar">
      <div class="wordmark"><b>Anya</b><span>voice</span></div>
      <span id="spacer"></span>
      <button id="spk" class="ghost" title="Mute voice">&#x1F50A;</button>
    </div>

    <div id="center">
      <div id="orb-wrap"><div id="orb"></div></div>
      <div id="status">Tap the mic to start</div>
      <div id="caption-inner"></div>
    </div>

    <div id="deck">
      <button id="mic" title="Start / stop talking">&#x1F3A4;</button>
    </div>
    <div class="hint" id="hint">Voice mode — just start talking any time to interrupt Anya.</div>

    <div id="overlay"><div class="card">
      <div class="glyph">&#x1F399;</div>
      <h2 id="ov-title">Microphone needed</h2>
      <p id="ov-msg">Allow microphone access to start talking.</p>
    </div></div>

    <div id="grain"></div>
  </div>

<script>
(function () {
  "use strict";
  var INSTANCE = ${JSON.stringify(instanceId)};
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  var el = {
    body: document.body,
    orb: document.getElementById("orb"),
    status: document.getElementById("status"),
    cap: document.getElementById("caption-inner"),
    overlay: document.getElementById("overlay"),
    ovTitle: document.getElementById("ov-title"),
    ovMsg: document.getElementById("ov-msg"),
    mic: document.getElementById("mic"),
    spk: document.getElementById("spk"),
    hint: document.getElementById("hint"),
  };

  var stream = null, recog = null;
  var live = false, busy = false, speakMuted = false, state = "idle";
  var audioCtx = null, analyser = null, levelRAF = 0;

  var LABELS = { idle: "Tap the mic to start", listening: "<b>Listening</b>", thinking: "<b>Thinking</b>…", speaking: "<b>Speaking</b>" };
  function setState(s, label) {
    state = s; el.body.setAttribute("data-state", s);
    el.status.innerHTML = label || LABELS[s] || "";
    if (s !== "listening") el.body.style.setProperty("--level", "0");
  }
  function showOverlay(title, msg) {
    if (title === null) { el.overlay.classList.remove("show"); return; }
    el.ovTitle.textContent = title; el.ovMsg.textContent = msg || ""; el.overlay.classList.add("show");
  }
  function caption(html) { el.cap.innerHTML = html || ""; }

  // ---- mic + audio-reactive level ----
  async function startMic() {
    stopMic();
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    showOverlay(null);
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      var src = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512; analyser.smoothingTimeConstant = 0.8;
      src.connect(analyser);
      var buf = new Uint8Array(analyser.frequencyBinCount);
      var bargeFrames = 0;
      var loop = function () {
        if (!analyser) return;
        analyser.getByteTimeDomainData(buf);
        var sum = 0;
        for (var i = 0; i < buf.length; i++) { var v = (buf[i] - 128) / 128; sum += v * v; }
        var rms = Math.sqrt(sum / buf.length);
        el.body.style.setProperty("--level", state === "listening" ? Math.min(1, rms * 3.2).toFixed(3) : "0");
        // Barge-in: if the user starts talking while Anya is speaking, cut the
        // reply short and hand the floor back. echoCancellation keeps Anya's own
        // TTS from tripping this; we require sustained energy to avoid blips.
        if (state === "speaking" && !speakMuted && rms > 0.07) {
          if (++bargeFrames >= 8) { bargeFrames = 0; stopSpeaking(); }
        } else { bargeFrames = 0; }
        levelRAF = requestAnimationFrame(loop);
      };
      loop();
    } catch (e) { /* analyser optional */ }
  }
  function stopMic() {
    if (levelRAF) { cancelAnimationFrame(levelRAF); levelRAF = 0; }
    analyser = null;
    if (audioCtx) { try { audioCtx.close(); } catch (e) {} audioCtx = null; }
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    el.body.style.setProperty("--level", "0");
  }

  // ---- speech recognition ----
  function buildRecognition() {
    if (!SR) return null;
    var r = new SR(); r.continuous = true; r.interimResults = true; r.lang = navigator.language || "en-US";
    r.onresult = function (ev) {
      var interim = "", finalText = "";
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        var res = ev.results[i];
        if (res.isFinal) finalText += res[0].transcript; else interim += res[0].transcript;
      }
      if (interim) caption('<span class="you interim">' + escapeHtml(interim) + "</span>");
      if (finalText.trim()) sendTurn(finalText.trim());
    };
    r.onerror = function (ev) {
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        showOverlay("Microphone blocked", "Allow microphone access in your browser to talk."); stopLive();
      }
    };
    r.onend = function () { if (live && !busy) { try { r.start(); } catch (e) {} } };
    return r;
  }
  function pauseRecog() { if (recog) { try { recog.stop(); } catch (e) {} } }
  function resumeRecog() { if (live && recog && !busy) { try { recog.start(); } catch (e) {} } }

  // ---- TTS (with barge-in) ----
  var speakResolve = null;
  function finishSpeak() { if (speakResolve) { var r = speakResolve; speakResolve = null; r(); } }
  function stopSpeaking() { try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {} finishSpeak(); }
  function speak(text) {
    return new Promise(function (resolve) {
      speakResolve = resolve;
      if (speakMuted || !text || !window.speechSynthesis) return finishSpeak();
      try {
        window.speechSynthesis.cancel();
        var u = new SpeechSynthesisUtterance(text); u.rate = 1.02; u.pitch = 1.0;
        u.onend = finishSpeak; u.onerror = finishSpeak; window.speechSynthesis.speak(u);
      } catch (e) { finishSpeak(); }
    });
  }

  // ---- turn round-trip ----
  async function sendTurn(text) {
    if (busy) return;
    busy = true; pauseRecog(); setState("thinking");
    caption('<span class="you">' + escapeHtml(text) + "</span>");
    var reply = "";
    var ctrl = new AbortController();
    var to = setTimeout(function () { ctrl.abort(); }, 45000);
    try {
      var resp = await fetch("/turn", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text }), signal: ctrl.signal,
      });
      var data = await resp.json();
      reply = (data && data.reply) || (data && data.error) || "";
    } catch (e) {
      reply = (e && e.name === "AbortError")
        ? "That took too long — I'm still here, try again."
        : "I couldn't reach Anya just now.";
    } finally {
      clearTimeout(to);
    }
    try {
      if (reply) { caption("<span>" + escapeHtml(reply) + "</span>"); setState("speaking"); await speak(reply); }
    } finally {
      // Always release the lock and hand the mic back, even if anything above threw.
      busy = false;
      if (live) { setState("listening"); resumeRecog(); } else setState("idle");
    }
  }

  // ---- lifecycle ----
  async function startLive() {
    try { await startMic(); }
    catch (e) {
      showOverlay("Microphone blocked",
        "Couldn't access the microphone (" + (e && e.name || "error") + "). You can still type to Anya below.");
    }
    live = true; el.mic.classList.add("live"); el.mic.title = "Stop"; el.mic.innerHTML = "&#x23F9;";
    if (SR) { recog = buildRecognition(); try { recog.start(); } catch (e) {} setState("listening"); }
    else { setState("idle", "Voice not supported"); el.hint.textContent = "Speech recognition isn't supported in this browser."; }
  }
  function stopLive() {
    live = false; busy = false; el.mic.classList.remove("live"); el.mic.title = "Start"; el.mic.innerHTML = "&#x1F3A4;";
    if (recog) { try { recog.onend = null; recog.stop(); } catch (e) {} recog = null; }
    stopSpeaking();
    stopMic(); setState("idle"); caption("");
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  el.mic.addEventListener("click", function () { live ? stopLive() : startLive(); });
  el.orb.addEventListener("click", function () { if (state === "speaking") stopSpeaking(); });
  el.spk.addEventListener("click", function () {
    speakMuted = !speakMuted; el.spk.classList.toggle("off", speakMuted);
    el.spk.innerHTML = speakMuted ? "&#x1F507;" : "&#x1F50A;";
    if (speakMuted && window.speechSynthesis) window.speechSynthesis.cancel();
  });

  if (!SR) el.hint.textContent = "Speech recognition isn't supported in this browser.";
  window.addEventListener("pagehide", stopLive);
})();
</script>
</body>
</html>`;
}
