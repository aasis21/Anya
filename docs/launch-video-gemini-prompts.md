# Anya — Launch Video: Gemini / Veo Prompt Pack

Paste-ready prompts for generating the ~56s launch video with **Gemini (Veo 3.1)**.
Derived from the final script (v3, holistic). Each prompt is fully self-contained —
Gemini has no memory of this repo, so the style block is repeated inside every prompt.

---

## The hard constraint: 8 seconds per generation

Gemini's video model (Veo 3 / Veo 3.1) generates **8-second clips** — 720p or 1080p,
24 fps, 16:9, with native audio. There is **no single-shot 56-second generation**:

| Where | Max per generation | Longer videos? |
|-------|--------------------|----------------|
| Gemini app ("create a video") | 8 s | No — one clip per prompt |
| Gemini API (`veo-3.1`) | 8 s | No — stitch clips yourself |
| Google Flow (labs.google/flow, Ultra plan) | 8 s | Yes — "Extend" chains ~7 s continuations and "Scenebuilder" stitches scenes to ~1 min+ |

**So the 56 s video = 9 generations of 8 s each, trimmed and stitched in an editor**
(CapCut / DaVinci Resolve / Premiere — or Flow's Scenebuilder if you have Ultra).
The scene table below maps each generation to its slot in the final timeline.

---

## Generation settings (use for every clip)

- Model: **Veo 3.1** (in Gemini: attach prompt + optional reference image, choose video)
- Aspect: **16:9**, resolution **1080p**, duration **8 s** (the default/max)
- For UI scenes (clips 2–6), attach a real screenshot from `docs/ph-screenshots/`
  as the **starting frame / reference image** — this is the single biggest quality
  lever; Veo invents garbled UI text otherwise.
- Generate **without dialogue** (ambient + SFX only). Veo's native voices differ
  between generations, so a 9-clip VO would sound like 9 narrators. Record the VO
  once (human, or Gemini TTS / any TTS) and lay it over the stitched cut in post.

**Append this negative instruction to every prompt:**

> No subtitles, no captions, no watermarks, no logos other than described, no
> readable body text (text may appear as soft out-of-focus glyphs), no camera
> shake, no people's faces in close-up.

---

## Clip-by-clip prompts

Every prompt already embeds the style block:
dark GitHub-style theme — background `#0d1117`, panels `#161b22`, hairline rules
`#30363d`, text `#e6edf3`, accent blue `#2f81f7`, success green `#3fb950`.

### Clip 1 — Hook (final cut: 0:00–0:05, trim 8 s → 5 s)

```
Cinematic 8-second shot, 16:9, moody dark tech aesthetic. A void of deep
charcoal-navy space (#0d1117). Dozens of translucent glassy browser-tab cards
float and slowly pile up chaotically: a code pull-request diff, a kanban ticket
board, a text document, a monitoring dashboard with graphs, an email thread, a
spreadsheet, a travel booking page. Each card glows faintly at the edges in
GitHub blue (#2f81f7). Shallow depth of field, slow dolly push-in toward the
densest cluster, cards drifting and overlapping like falling glass. Soft
volumetric light from above. Color palette: near-black background, soft white
text glow (#e6edf3), blue accents. Mood: overwhelming but elegant. Audio:
sparse minimal electronic tick-pulse, low ambient hum, no voices, no music
melody. No subtitles, no captions, no watermarks, no readable body text (text
as soft out-of-focus glyphs), no camera shake, no faces.
```

### Clip 2 — Reveal (0:05–0:11, trim 8 s → 6 s)

> Attach `docs/ph-screenshots/anya-landing-hero.png` or a real sidebar screenshot
> as the starting frame.

```
Screen-capture style 8-second product shot, 16:9, dark browser UI on a
GitHub-dark theme (background #0d1117, panels #161b22, thin borders #30363d).
Start on a Chromium browser window with a crowded tab strip of many small tabs.
At the 1.5-second mark a sleek chat sidebar smoothly slides in from the right
edge with a satisfying easing motion — dark panel, a glowing blue letter-A
logo (#2f81f7), an empty chat state and a rounded input box at the bottom.
The rest of the page dims slightly as the sidebar arrives. Subtle UI glow,
crisp flat design, no skeuomorphism. Camera: locked-off screen recording look,
very slight slow zoom toward the sidebar. Audio: one soft whoosh as the panel
slides in, then a warm minimal electronic groove starts. No subtitles, no
captions, no watermarks, no readable body text (suggest text as soft blurred
lines), no camera shake, no faces.
```

### Clip 3a — Sees every tab, part 1 (0:11–0:17, trim 8 s → 6 s)

> Attach `docs/assets/summarize.webp` (or a real chat screenshot) as reference.

```
Screen-capture style 8-second product montage, 16:9, dark theme (#0d1117
background, #161b22 panels, #2f81f7 blue accents, #3fb950 green checkmarks).
A dark chat sidebar sits on the right of a browser. Two quick vignettes,
4 seconds each, hard cut between them. Vignette 1: behind the sidebar, a
research page with many open tabs; in the sidebar, three small pill-shaped
"tool cards" appear one after another, each completing with a green check
(labels suggested as blurred short text), then an answer streams in as soft
lines of light-gray text. Vignette 2: a kanban ticket board behind the
sidebar; the same tool-card sequence, then a ranked numbered list streams in.
Snappy motion, cards pop in with tiny bounce. Audio: minimal electronic
groove, soft pop on each tool-card completion. No subtitles, no captions,
no watermarks, no readable body text, no camera shake, no faces.
```

### Clip 3b — Sees every tab, part 2 (0:17–0:23, trim 8 s → 6 s)

```
Screen-capture style 8-second product montage, 16:9, dark theme (#0d1117
background, #161b22 panels, #2f81f7 blue accents, #3fb950 green checkmarks).
A dark chat sidebar on the right of a browser, two quick vignettes, 4 seconds
each, hard cut between them. Vignette 1: behind the sidebar, a code
pull-request page with a green-and-red diff; in the sidebar three pill-shaped
tool cards complete with green checks, then review comments stream in as soft
gray text lines. Vignette 2: a documentation site behind the sidebar; tool
cards complete, then a drafted reply streams into the chat. Snappy, confident
pacing, cards pop with tiny bounce. Audio: minimal electronic groove
continues, soft pop on each tool-card completion. No subtitles, no captions,
no watermarks, no readable body text, no camera shake, no faces.
```

### Clip 4 — Point at anything (0:23–0:29, trim 8 s → 6 s)

> Attach `docs/assets/menu.webp` (context-menu screenshot) as reference.

```
Screen-capture style 8-second product shot, 16:9, dark theme (#0d1117
background, #161b22 panels, hairline borders #30363d). A dark documentation
article page fills the browser, chat sidebar docked on the right. A cursor
selects a paragraph (selection highlight in translucent blue #2f81f7), then
right-clicks: a native dark context menu appears; one menu row with a small
glowing blue letter-A icon highlights. On click, the selected paragraph
shrinks and flies into the sidebar's input box, landing as a small rounded
chip with a subtle pop and glow. Smooth 60fps-feeling UI motion, locked-off
screen-recording camera with a gentle push-in on the chip landing. Audio:
minimal groove continues, soft click on the menu, satisfying pop when the
chip lands. No subtitles, no captions, no watermarks, no readable body text
(blurred lines only), no camera shake, no faces.
```

### Clip 5 — Acts on your browser (0:29–0:38, needs 9 s → generate 8 s and stretch cut, or trim VO)

```
Screen-capture style 8-second product montage, 16:9, dark theme (#0d1117
background, #161b22 panels, blue #2f81f7 focus rings). Three quick vignettes,
under 3 seconds each, hard cuts. Vignette 1: a dark web form with several
labeled input fields; a text caret moves field to field and text types itself
in rapidly, each field flashing a subtle blue focus ring. Vignette 2: a
multi-step wizard with a stepper across the top; the "Next" button clicks
itself and steps advance 1 → 2 → 3, progress bar filling blue. Vignette 3: a
bookmarks manager; bookmark rows animate, sliding themselves into folders
which pulse green (#3fb950) as they file away. Motion is precise and
mechanical-but-smooth, like an invisible expert user. Audio: groove
continues, rapid soft keyboard ticks in vignette 1, click per wizard step,
soft file-away pops in vignette 3. No subtitles, no captions, no watermarks,
no readable body text, no camera shake, no faces.
```

### Clip 6 — You're in control (0:38–0:44, trim 8 s → 6 s)

```
Screen-capture style 8-second product shot, 16:9, dark theme (#0d1117
background, #161b22 panels, #30363d borders). In a dark chat sidebar, an
approval banner slides down from the top: a rounded amber-tinted panel
(#d29922 accent) with two buttons — one green-filled, one gray-outlined. A
cursor moves deliberately and clicks the green button; the banner collapses
with a satisfying tick and a green check (#3fb950). Then a small rounded
model-selector pill at the top of the sidebar flips through three values with
a smooth vertical roll animation. Finally a thread drawer peeks in from the
left edge showing a stacked list of chat threads with tiny pin icons, then
recedes. Calm, assured pacing. Audio: groove continues softer, one gentle
click on the approve button, soft tick on the pill flips. No subtitles, no
captions, no watermarks, no readable body text (short blurred labels only),
no camera shake, no faces.
```

### Clip 7 — Privacy (0:44–0:50, trim 8 s → 6 s)

```
Cinematic 8-second shot, 16:9, near-black void (#0d1117). Thousands of tiny
particles of cool white and blue light (#2f81f7) drift inward from the
darkness and slowly assemble into a minimal line-art padlock, centered,
glowing softly. As the lock completes, its shackle clicks shut with a subtle
flare, then all the light settles and dims until only the faint lock outline
remains on black. Extremely slow, meditative camera — a barely perceptible
push-in. Shallow depth of field, gentle volumetric glow, no other objects.
Mood: quiet, safe, final. Audio: music strips away to near-silence, a soft
low down-whoosh as particles gather, one deep soft click as the lock closes,
then room-tone silence. No subtitles, no captions, no watermarks, no text,
no camera shake, no faces.
```

### Clip 8 — End card (0:50–0:56, trim 8 s → 6 s)

> Legibility warning: Veo will mangle the install one-liner. Either overlay the
> real text in your editor (recommended — matches the original plan's HTML end
> card), or accept stylized glyphs from this prompt and add the text in post.

```
Cinematic 8-second end card, 16:9, near-black background (#0d1117). A bold
glowing letter "A" logo in GitHub blue (#2f81f7) lands center-frame with a
single confident boom and a soft shockwave of light. Beneath it, a dark
terminal-style input line appears and a short command types itself out
character by character with a blinking block cursor (render the text as
stylized monospace glyphs, slightly soft — real text will be overlaid in
editing). A thin line of small dim gray text (#8b949e) fades in below.
Everything holds steady for the final 2 seconds. Minimal, premium,
typographic. Audio: one deep boom on the logo landing, quiet terminal
key-ticks during the typing, then silence. No subtitles, no captions, no
watermarks, no camera shake, no faces, no objects other than the logo,
terminal line, and caption line.
```

---

## Assembly checklist (editor)

1. **Trim** each 8 s generation to its slot: 5/6/6/6/6/8/6/6/6 s per the table
   (clip 5's 9 s slot: either slow the 8 s clip ~112 % or tighten VO line 5).
2. **Stitch** in order 1 → 2 → 3a → 3b → 4 → 5 → 6 → 7 → 8. Hard cuts everywhere;
   the only "soft" joins are the whoosh at 0:05 and the music strip at 0:44.
3. **VO**: record the 8-line script from the main doc (~140 wpm) as one take;
   place clip starts at 0.0 / 5.0 / 11.0 / 23.0 / 29.0 / 38.0 / 44.0 / 50.0 s.
4. **Captions**: overlay every VO line as on-screen text (Fraunces for display
   lines, JetBrains Mono for kickers) — Veo was told to render no text, so all
   legible words come from your editor.
5. **End-card text overlay** (real, legible):
   `> irm https://raw.githubusercontent.com/aasis21/Anya/main/install.ps1 | iex`
   plus "Every Chromium browser · github.com/aasis21/Anya".
6. **Music**: one continuous track 0:06.5 → 0:44 (Veo's per-clip audio won't be
   continuous — mute Veo audio on clips 2–6 and keep only its SFX if they land
   well, or rebuild SFX from a library). Duck music −6 dB under VO, normalize
   the master to −14 LUFS.

## Reality check

Veo excels at clips 1, 7, and 8 (the cinematic bookends) and will be
convincing-but-stylized for the UI clips 2–6. If you want the UI beats
pixel-accurate, keep the original hybrid plan: screen-record `reel.html` for
0:05–0:44 and use Gemini only for clips 1, 7, and 8 — that's 3 generations
instead of 9 and the product shots are real.
