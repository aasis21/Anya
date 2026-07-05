# Anya launch_video.html — voiceover script (ElevenLabs-ready)

Matches `launch_video.html`'s locked timeline: `T={s1:0,s2:5000,s3:11000,s4:23000,s5:29000,
s6:38000,s7:44000,s8:50000}`, `DURATION=56000` (56s total).

Generate each numbered line as its **own** ElevenLabs clip (don't do one long take — you need to
drop each clip at its own scene start time, same pattern as `assets/vo/vo{n}_{voice}.mp3` used
elsewhere in this project). Target pace: confident, unhurried tech-narrator read — each line is
sized to fit its scene with ~0.5-1s of natural silence to spare, so don't rush it.

## ElevenLabs settings
- Model: **Eleven Multilingual v2** (or Turbo v2.5 if you want faster iteration)
- Voice: a grounded, confident male or female narrator — e.g. **"Adam"**, **"Brian"**, or **"Charlotte"**
  work well for dev-tool launch copy. Avoid overly energetic/hype voices — this copy is matter-of-fact.
- Stability: **0.45–0.55** (a little variation keeps it human, not flat)
- Similarity boost: **0.75**
- Style exaggeration: **0.2–0.3** (low — keep it clean/product-demo, not dramatic)
- Speaker boost: on

## Lines

| # | Scene | Window (ms) | Budget | Line |
|---|-------|-------------|--------|------|
| 1 | S1 hook | 0 – 5000 | 5.0s | **Half your work isn't in your IDE. It's in twenty open tabs.** |
| 2 | S2 reveal | 5000 – 11000 | 6.0s | **Meet Anya. Copilot, in your browser — on the subscription you already have.** |
| 3a | S3 researcher | 11000 – 14000 | 3.0s | **Ten tabs. One brief. Three themes, one open question.** |
| 3b | S3 PM | 14000 – 17000 | 3.0s | **A messy backlog. One ranked list — start with PAY-812.** |
| 3c | S3 developer | 17000 – 20000 | 3.0s | **A pull request. A drafted review — one risk flagged.** |
| 3d | S3 support | 20000 – 23000 | 3.0s | **A ticket. A ready reply — grounded in your docs.** |
| 4 | S4 point-at-anything | 23000 – 29000 | 6.0s | **Point at anything, on any page. Right-click, add to Anya — it's context.** |
| 5 | S5 acts | 29000 – 38000 | 9.0s | **And it acts. Fills forms, clicks through wizards, files your bookmarks — driving your real, logged-in browser.** |
| 6 | S6 in control | 38000 – 44000 | 6.0s | **You're always in control. Approve each action, or let it flow. Model and threads — all saved.** |
| 7 | S7 privacy | 44000 – 50000 | 6.0s | **No Anya server. No telemetry. Just a local bridge, talking to your own Copilot.** |
| 8 | S8 end card | 50000 – 56000 | 6.0s | **GitHub Copilot, in your browser. One line to install. Every Chromium browser.** |

## Plain-text block (for a single copy-paste if you'd rather generate one continuous read then
manually chop it in Audacity/ffmpeg — riskier for hitting the tight scene marks, the per-line
approach above is recommended)

```
Half your work isn't in your IDE. It's in twenty open tabs.

Meet Anya. Copilot, in your browser — on the subscription you already have.

Ten tabs. One brief. Three themes, one open question.
A messy backlog. One ranked list — start with PAY-812.
A pull request. A drafted review — one risk flagged.
A ticket. A ready reply — grounded in your docs.

Point at anything, on any page. Right-click, add to Anya — it's context.

And it acts. Fills forms, clicks through wizards, files your bookmarks — driving your real, logged-in browser.

You're always in control. Approve each action, or let it flow. Model and threads — all saved.

No Anya server. No telemetry. Just a local bridge, talking to your own Copilot.

GitHub Copilot, in your browser. One line to install. Every Chromium browser.
```

## After generating

1. Save each ElevenLabs output as `assets/vo/vo1.mp3` … `vo8.mp3` (use `vo3a`/`vo3b`/`vo3c`/`vo3d`
   for the four vignette lines) next to `launch_video.html` (create an `assets/vo/` folder if
   this project doesn't have one yet).
2. Measure each clip's actual duration (`ffprobe -v error -show_entries format=duration -of
   default=noprint_wrappers=1 vo1.mp3`) — if any line runs long and crowds its scene boundary,
   re-generate that line shorter/faster rather than shifting the whole timeline, since
   `launch_video.html`'s scene marks are baked into its own JS timers.
3. Drop each clip onto the timeline at its scene-start timestamp (0 / 5000 / 11000 / 14000 /
   17000 / 20000 / 23000 / 29000 / 38000 / 44000 / 50000 ms) when you build the final mix —
   same VO-timeline + sidechain-ducked-music-bed + loudnorm(-14 LUFS) approach used for the
   `anya-teaser-project` v3 reel this session.
