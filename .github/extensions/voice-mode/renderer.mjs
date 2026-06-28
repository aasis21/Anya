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
  body[data-state="idle"]      { --accent:#7f93c9; --accent-2:#9fb2d8; }
  body[data-state="listening"] { --accent:#5ce6a3; --accent-2:#22b685; }
  body[data-state="thinking"]  { --accent:#ffcf6b; --accent-2:#f0a93a; }
  body[data-state="speaking"]  { --accent:#7db5ff; --accent-2:#4f8cff; }

  #stage { position: fixed; inset: 0; display: flex; flex-direction: column; isolation: isolate; }

  /* ambient aurora */
  #aurora {
    position: absolute; inset: -30%; z-index: 0; pointer-events: none; filter: blur(70px); opacity: .62;
    background:
      radial-gradient(32% 38% at 20% 24%, color-mix(in srgb, var(--accent) 55%, transparent), transparent 70%),
      radial-gradient(36% 42% at 82% 20%, color-mix(in srgb, var(--accent-2) 52%, transparent), transparent 72%),
      radial-gradient(30% 36% at 68% 78%, color-mix(in srgb, var(--accent) 40%, transparent), transparent 70%),
      radial-gradient(60% 64% at 50% 114%, color-mix(in srgb, var(--accent-2) 55%, transparent), transparent 70%);
    animation: drift 20s ease-in-out infinite alternate; transition: opacity .6s ease;
  }
  /* second slow-rotating aurora layer for depth */
  #aurora2 {
    position: absolute; inset: -40%; z-index: 0; pointer-events: none; filter: blur(90px); opacity: .4;
    background:
      conic-gradient(from 0deg at 50% 50%,
        color-mix(in srgb, var(--accent) 38%, transparent),
        transparent 25%,
        color-mix(in srgb, var(--accent-2) 40%, transparent) 50%,
        transparent 75%,
        color-mix(in srgb, var(--accent) 38%, transparent));
    animation: spin 60s linear infinite; transition: opacity .6s ease;
  }
  @keyframes drift { 0%{transform:translate3d(0,0,0) scale(1)} 100%{transform:translate3d(3%,-3%,0) scale(1.1)} }
  /* keep idle serene — dim the ambient layers until a conversation starts */
  body[data-state="idle"] #aurora  { opacity: .32; }
  body[data-state="idle"] #aurora2 { opacity: .16; }
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
    content: ""; position: absolute; inset: 8%; border-radius: 50%; pointer-events: none;
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
      0 30px 90px -18px color-mix(in srgb, var(--accent) 70%, transparent),
      0 0 70px 4px color-mix(in srgb, var(--accent-2) 45%, transparent),
      inset 0 2px 6px rgba(255,255,255,.55), inset 0 -20px 40px rgba(0,0,0,.25);
    animation: breathe 5s ease-in-out infinite;
  }
  @keyframes breathe { 0%,100%{filter:brightness(1)} 50%{filter:brightness(1.1)} }
  /* iridescent inner swirl — always rotating, so even idle feels alive */
  #orb::before {
    content: ""; position: absolute; inset: 4%; border-radius: 50%;
    background: conic-gradient(from 0deg,
      color-mix(in srgb, var(--accent) 70%, transparent),
      color-mix(in srgb, #ffffff 60%, transparent) 18%,
      color-mix(in srgb, var(--accent-2) 75%, transparent) 40%,
      transparent 58%,
      color-mix(in srgb, var(--accent) 65%, transparent) 78%,
      color-mix(in srgb, var(--accent-2) 70%, transparent));
    mix-blend-mode: screen; opacity: .85; filter: blur(8px);
    animation: spin 9s linear infinite;
  }
  body[data-state="thinking"] #orb::before { animation-duration: 2.4s; }
  body[data-state="speaking"] #orb { cursor: pointer; }
  @keyframes spin { to { transform: rotate(360deg); } }
  #orb::after {
    content: ""; position: absolute; top: 12%; left: 18%; width: 34%; height: 24%; border-radius: 50%;
    background: radial-gradient(closest-side, rgba(255,255,255,.85), transparent); filter: blur(2px);
  }
  /* the entire orb area is the single control — tap anywhere on it */
  #orb-wrap { cursor: pointer; }
  #orb { cursor: pointer; }
  #orb-glyph {
    position: absolute; inset: 0; display: grid; place-items: center; z-index: 3;
    font-size: clamp(34px, 9vw, 52px); line-height: 1; pointer-events: none;
    filter: drop-shadow(0 2px 6px rgba(0,0,0,.35));
    opacity: 0; transform: scale(.7); transition: opacity .35s ease, transform .35s ease;
  }
  /* show the mic prompt only while idle; fade to the live visuals otherwise */
  body[data-state="idle"] #orb-glyph { opacity: .96; transform: scale(1); animation: glyphBob 3.4s ease-in-out infinite; }
  @keyframes glyphBob { 0%,100%{transform:scale(1) translateY(0)} 50%{transform:scale(1.06) translateY(-2px)} }

  /* audio-reactive waveform ring (canvas) layered behind the orb */
  #ring { position: absolute; inset: -14%; width: 128%; height: 128%; pointer-events: none; opacity: 0; transition: opacity .4s ease; }
  body[data-state="listening"] #ring,
  body[data-state="speaking"]  #ring { opacity: 1; }

  /* floating particles drifting around the orb */
  .particle {
    position: absolute; border-radius: 50%; pointer-events: none;
    background: color-mix(in srgb, var(--accent) 80%, #fff);
    box-shadow: 0 0 8px 1px color-mix(in srgb, var(--accent) 60%, transparent);
    opacity: 0; animation: float linear infinite;
  }
  @keyframes float {
    0%   { opacity: 0; transform: translate(0,0) scale(.6); }
    15%  { opacity: .7; }
    85%  { opacity: .7; }
    100% { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(1); }
  }
  /* idle invitation: a clear, gentle breathing pulse + double "tap me" halo */
  body[data-state="idle"] #orb-wrap::before { animation: ringSoft 3.2s ease-out infinite; }
  body[data-state="idle"] #orb-wrap::after  { animation: ringSoft 3.2s ease-out infinite 1.6s; }
  /* gentle, slowed swirl + softer glow while idle so it feels at rest */
  body[data-state="idle"] #orb {
    box-shadow:
      0 24px 70px -22px color-mix(in srgb, var(--accent) 45%, transparent),
      0 0 44px 0 color-mix(in srgb, var(--accent-2) 26%, transparent),
      inset 0 2px 6px rgba(255,255,255,.45), inset 0 -20px 40px rgba(0,0,0,.25);
    animation: idlePulse 3.6s ease-in-out infinite;
  }
  body[data-state="idle"] #orb:hover { animation-play-state: paused; transform: scale(1.05); }
  @keyframes idlePulse { 0%,100%{transform:scale(1); filter:brightness(1)} 50%{transform:scale(1.035); filter:brightness(1.08)} }
  body[data-state="idle"] #orb::before { opacity: .5; animation-duration: 16s; }
  @keyframes ringSoft { 0%{opacity:.34; transform:scale(.9)} 70%{opacity:0; transform:scale(1.2)} 100%{opacity:0} }

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

  /* discreet end-session control, tucked in the corner, only while live */
  #end { display: none; }
  body:not([data-state="idle"]) #end { display: grid; }
  .hint { position: relative; z-index: 2; flex: none; font-size: 11px; color: var(--muted); text-align: center; padding: 0 16px 12px; letter-spacing: .2px; }
</style>
</head>
<body data-state="idle">
  <div id="stage">
    <div id="aurora"></div>
    <div id="aurora2"></div>

    <div id="topbar">
      <div class="wordmark"><b>Anya</b><span>voice</span></div>
      <span id="spacer"></span>
      <button id="end" class="ghost" title="End session">&#x2715;</button>
      <button id="spk" class="ghost" title="Mute voice">&#x1F50A;</button>
    </div>

    <div id="center">
      <div id="orb-wrap"><canvas id="ring"></canvas><div id="orb"><span id="orb-glyph">&#x1F3A4;</span></div></div>
      <div id="status">Tap the orb to start</div>
      <div id="caption-inner"></div>
    </div>

    <div class="hint" id="hint">Tap the glowing orb to talk — then just speak any time to interrupt Anya.</div>

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
    ring: document.getElementById("ring"),
    orbWrap: document.getElementById("orb-wrap"),
    status: document.getElementById("status"),
    cap: document.getElementById("caption-inner"),
    overlay: document.getElementById("overlay"),
    ovTitle: document.getElementById("ov-title"),
    ovMsg: document.getElementById("ov-msg"),
    end: document.getElementById("end"),
    spk: document.getElementById("spk"),
    hint: document.getElementById("hint"),
  };

  var stream = null, recog = null;
  var live = false, busy = false, speakMuted = false, state = "idle";
  var audioCtx = null, analyser = null, levelRAF = 0;

  var LABELS = { idle: "Tap the orb to start", listening: "<b>Listening</b>", thinking: "<b>Thinking</b>…", speaking: "<b>Speaking</b> — tap to interrupt" };
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

  // ---- audio-reactive waveform ring around the orb ----
  var ringCtx = null, ringDpr = 1;
  function sizeRing() {
    if (!el.ring) return;
    var r = el.ring.getBoundingClientRect();
    ringDpr = Math.min(2, window.devicePixelRatio || 1);
    el.ring.width = Math.max(1, Math.round(r.width * ringDpr));
    el.ring.height = Math.max(1, Math.round(r.height * ringDpr));
    ringCtx = el.ring.getContext("2d");
  }
  function drawRing(freq) {
    if (!el.ring) return;
    if (!ringCtx) sizeRing();
    var ctx = ringCtx; if (!ctx) return;
    var W = el.ring.width, H = el.ring.height;
    ctx.clearRect(0, 0, W, H);
    if (state !== "listening" && state !== "speaking") return;
    var cx = W / 2, cy = H / 2;
    var radius = Math.min(W, H) * 0.40;
    var bars = 72;
    var accent = getComputedStyle(el.body).getPropertyValue("--accent").trim() || "#9b8cff";
    var accent2 = getComputedStyle(el.body).getPropertyValue("--accent-2").trim() || "#3ad6c5";
    var bins = freq ? freq.length : 0;
    for (var i = 0; i < bars; i++) {
      var t = i / bars;
      var idx = Math.floor(t * Math.min(bins, 160));
      var amp = freq ? freq[idx] / 255 : 0;
      amp = Math.pow(amp, 1.4);
      var len = radius * (0.10 + amp * 0.42);
      var ang = t * Math.PI * 2 - Math.PI / 2;
      var ca = Math.cos(ang), sa = Math.sin(ang);
      var x1 = cx + ca * radius, y1 = cy + sa * radius;
      var x2 = cx + ca * (radius + len), y2 = cy + sa * (radius + len);
      ctx.strokeStyle = i % 2 ? accent2 : accent;
      ctx.globalAlpha = 0.35 + amp * 0.6;
      ctx.lineWidth = Math.max(1, ringDpr * 2);
      ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  window.addEventListener("resize", function () { ringCtx = null; });

  // ---- drifting particles around the orb (ambient life, always on) ----
  function spawnParticle() {
    if (!el.orbWrap) return;
    var p = document.createElement("div");
    p.className = "particle";
    var size = 2 + Math.random() * 4;
    p.style.width = size + "px"; p.style.height = size + "px";
    var startX = 10 + Math.random() * 80, startY = 10 + Math.random() * 80;
    p.style.left = startX + "%"; p.style.top = startY + "%";
    var dx = (Math.random() * 2 - 1) * 80, dy = -40 - Math.random() * 90;
    p.style.setProperty("--dx", dx.toFixed(0) + "px");
    p.style.setProperty("--dy", dy.toFixed(0) + "px");
    var dur = 4 + Math.random() * 4;
    p.style.animationDuration = dur + "s";
    el.orbWrap.appendChild(p);
    setTimeout(function () { p.remove(); }, dur * 1000 + 200);
  }
  setInterval(function () { if (state !== "idle") spawnParticle(); }, 900);

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
      var freq = new Uint8Array(analyser.frequencyBinCount);
      var bargeFrames = 0;
      var loop = function () {
        if (!analyser) return;
        analyser.getByteTimeDomainData(buf);
        analyser.getByteFrequencyData(freq);
        var sum = 0;
        for (var i = 0; i < buf.length; i++) { var v = (buf[i] - 128) / 128; sum += v * v; }
        var rms = Math.sqrt(sum / buf.length);
        el.body.style.setProperty("--level", state === "listening" ? Math.min(1, rms * 3.2).toFixed(3) : "0");
        drawRing(freq);
        // Barge-in: if the user starts talking while Anya is speaking, cut the
        // reply short and hand the floor back. echoCancellation keeps Anya's own
        // TTS from tripping this; we require sustained energy to avoid blips.
        if (state === "speaking" && !speakMuted && rms > 0.07) {
          if (++bargeFrames >= 8) { bargeFrames = 0; bargeCancel(); }
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

  // ---- TTS queue (ordered, with barge-in) ----
  // Sentences are enqueued as they stream in and spoken back-to-back, so Anya
  // starts talking before the full reply has arrived.
  var speakQueue = [];
  var speaking = false;
  var speakDoneResolve = null;
  function settleSpeakDone() { if (speakDoneResolve && !speaking && !speakQueue.length) { var r = speakDoneResolve; speakDoneResolve = null; r(); } }
  function enqueueSpeak(text) {
    text = (text || "").trim();
    if (speakMuted || !text || !window.speechSynthesis) return;
    speakQueue.push(text);
    if (!speaking) playNext();
  }
  function playNext() {
    if (!speakQueue.length) { speaking = false; settleSpeakDone(); return; }
    speaking = true;
    var text = speakQueue.shift();
    try {
      var u = new SpeechSynthesisUtterance(text); u.rate = 1.02; u.pitch = 1.0;
      u.onend = playNext; u.onerror = playNext;
      window.speechSynthesis.speak(u);
    } catch (e) { playNext(); }
  }
  function stopSpeaking() {
    speakQueue.length = 0; speaking = false;
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {}
    settleSpeakDone();
  }
  function waitForSpeech() {
    return new Promise(function (resolve) {
      if (!speaking && !speakQueue.length) return resolve();
      speakDoneResolve = resolve;
    });
  }

  // Pull whole sentences out of a streaming buffer; return the trailing partial.
  function findSentenceEnd(s) {
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === "\\n") return i;
      if (c === "." || c === "!" || c === "?") {
        var n = s.charAt(i + 1);
        if (n === "" || n === " " || n === "\\n" || n === '"' || n === "'" || n === ")") return i;
      }
    }
    return -1;
  }
  function flushSentences(buf) {
    var idx, guard = 0;
    while ((idx = findSentenceEnd(buf)) > -1 && guard++ < 40) {
      var s = buf.slice(0, idx + 1).trim();
      if (s) enqueueSpeak(s);
      buf = buf.slice(idx + 1).replace(/^\s+/, "");
    }
    return buf;
  }

  // barge-in / interrupt: stop talking AND cut the in-flight turn short
  var activeCtrl = null;
  function bargeCancel() { if (activeCtrl) { try { activeCtrl.abort(); } catch (e) {} } stopSpeaking(); }

  // ---- turn round-trip (streaming) ----
  async function sendTurn(text) {
    if (busy) return;
    busy = true; pauseRecog(); setState("thinking");
    caption('<span class="you">' + escapeHtml(text) + "</span>");

    var ctrl = new AbortController(); activeCtrl = ctrl;
    var to = setTimeout(function () { ctrl.abort(); }, 65000);
    var full = "", pending = "", firstChunk = true, errored = "";
    try {
      var resp = await fetch("/turn", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text }), signal: ctrl.signal,
      });
      var ct = resp.headers.get("content-type") || "";
      if (!resp.ok || ct.indexOf("text/event-stream") < 0) {
        var data = await resp.json().catch(function () { return null; });
        full = (data && (data.reply || data.error)) || "I couldn't reach Anya just now.";
        caption("<span>" + escapeHtml(full) + "</span>"); setState("speaking"); enqueueSpeak(full);
      } else {
        var reader = resp.body.getReader(), dec = new TextDecoder(), sseBuf = "";
        while (true) {
          var chunk = await reader.read();
          if (chunk.done) break;
          sseBuf += dec.decode(chunk.value, { stream: true });
          var frames = sseBuf.split("\\n\\n"); sseBuf = frames.pop();
          for (var f = 0; f < frames.length; f++) {
            var line = frames[f]; var p = line.indexOf("data:");
            if (p < 0) continue;
            var msg; try { msg = JSON.parse(line.slice(p + 5).trim()); } catch (e) { continue; }
            if (msg.delta) {
              if (firstChunk) { firstChunk = false; setState("speaking"); }
              full += msg.delta; pending += msg.delta;
              caption("<span>" + escapeHtml(full) + "</span>");
              pending = flushSentences(pending);
            }
            if (msg.error) errored = msg.error;
            if (msg.done) { if (pending.trim()) { enqueueSpeak(pending.trim()); pending = ""; } }
          }
        }
        if (pending.trim()) { enqueueSpeak(pending.trim()); pending = ""; }
        if (!full && errored) { full = "Sorry, something went wrong."; setState("speaking"); enqueueSpeak(full); }
      }
      await waitForSpeech();
    } catch (e) {
      if (!(e && e.name === "AbortError")) {
        var m = "I couldn't reach Anya just now.";
        caption("<span>" + escapeHtml(m) + "</span>"); setState("speaking"); enqueueSpeak(m);
        await waitForSpeech();
      }
    } finally {
      clearTimeout(to); activeCtrl = null;
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
    live = true;
    if (SR) { recog = buildRecognition(); try { recog.start(); } catch (e) {} setState("listening"); }
    else { setState("idle", "Voice not supported"); el.hint.textContent = "Speech recognition isn't supported in this browser."; }
  }
  function stopLive() {
    live = false; busy = false;
    if (recog) { try { recog.onend = null; recog.stop(); } catch (e) {} recog = null; }
    bargeCancel();
    stopMic(); setState("idle"); caption("");
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // The whole orb area is the single control: tap to start when idle, tap to
  // interrupt while Anya is speaking.
  function orbTap() {
    if (!live && state === "idle") { startLive(); return; }
    if (state === "speaking") { bargeCancel(); return; }
  }
  el.orbWrap.addEventListener("click", orbTap);
  el.end.addEventListener("click", stopLive);
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
