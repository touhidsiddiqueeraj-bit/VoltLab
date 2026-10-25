# Shipping VoltLab as an Android APK — viability assessment

**Short answer: yes — viable, with two tiers of effort.** The simulator core was
designed to run without a backend, which is the whole ball game on Android.

## Why it's viable (verified)

The engine is pure, dependency-free JavaScript that already runs in a plain
browser tab today:

- `sim/engine.js` — the solver: no Node APIs, no `fetch`, no filesystem. It is
  ESM, imports only `sim/devices.js`, and is driven by plain method calls
  (`pressButton`, `setSwitch`, `step`).
- `app/js/render.js` + `app/js/symbols.js` — the SVG schematic renderer: same
  story, pure DOM/SVG.
- `docs/demo/` (the GitHub Pages demo) already runs the **real engine + renderer
  fully client-side** — proof that everything a user sees on screen works
  without the HTTP host.

The only piece that does not exist on Android is the *transport*: the full
editor UI (`app/js/main.js`) talks to `server.js` over HTTP (`POST /api/command`)
and SSE (`/api/events`). None of that logic is complicated — it's a thin pipe
between the UI and `sim/api.js`'s tool dispatcher.

## Tier 1 — demo APK (≈ half a day)

Bundle `docs/demo/` as-is in a [Capacitor](https://capacitorjs.com) shell:

```bash
npm i -D @capacitor/cli @capacitor/core @capacitor/android
npx cap init VoltLab io.voltlab.simulator --web-dir=www
cp -r docs/demo www/
npx cap add android
npx cap open android   # then Build ▸ Generate Signed Bundle / APK
```

Result: an installable APK with the live demo — circuit selection, run/pause,
advance, zoom/fit, and the mimic buttons all working offline. No server, no
permissions, no network. This alone is shippable as a companion app.

**Caveat:** the demo page is a *viewer/operator* — it has no editor palette.
Editing (placing components, wiring) is Tier 2.

## Tier 2 — full editor APK (≈ 1–2 weeks)

The editor needs one new module: a **client-side command bridge** that offers
the same interface the server offers, but backed by an in-page `Engine`:

```
ui/main.js  ──cmd(tool, args)──▶  www/js/local-api.js  ──▶  sim/api.js dispatcher  ──▶  Engine
        ▲                                                                        │
        └────────── renderScene(engine.snapshot()) on a 10 Hz timer ──────────────┘
```

`sim/api.js` already centralizes every tool (`press_button`, `connect`,
`inject_fault`, `load_circuit`, …) — the bridge is essentially:

- a `cmd(tool, args)` shim that calls the dispatcher directly instead of
  `fetch('/api/command')`;
- a `setInterval(100ms)` loop replacing the SSE stream, calling
  `renderScene()` with `engine.snapshot()`;
- `save_circuit` / circuit listing mapped to `localStorage` instead of the
  `circuits/` directory;
- PDF/video export either dropped or replaced with `window.print()` /
  `MediaRecorder` (both work in modern Android WebViews).

Everything else — palette, wiring, inspector, faults menu, tutorial, operator
panel — is already transport-agnostic UI code.

**MCP layer:** not applicable on Android (it exists so desktop LLM agents can
drive the app over stdio/HTTP). It's simply absent from the mobile build, no
porting needed.

## Known Android-specific work items

| Item | Effort | Notes |
|---|---|---|
| Touch targets | small | Terminals are 18 px hit circles — enlarge to ≥ 40 px on touch profiles, or add a magnifier on long-press |
| Pinch-zoom | small | Replace Ctrl+wheel handler with touch gesture (the transform plumbing already exists) |
| Back button | trivial | Map to "cancel placing / close menu" instead of exiting |
| APK size | none | ~3–5 MB (a WebView + static JS; Electron is *not* included) |
| Performance | none | The solver is a per-tick union-find over ≤ ~50 components; runs comfortably in a WebView |
| Play Store | process | Signing key + Play Console; for direct APK distribution (sideload) nothing is needed |

## CI for the APK (when you're ready)

A `build-apk.yml` workflow needs `actions/setup-java@v4` (Temurin 17) +
`android-actions/setup-android@v3` + `gradle-wrapper`; `./gradlew
assembleRelease` in `android/` produces `app-release-unsigned.apk`; sign with
`r0adkll/upload-google-play` or a keystore secret. Budget ~5–8 min per build.
Add it only when Tier 2 lands — shipping a demo-only APK from CI is also fine
if you want the badge earlier.

## Recommendation

1. Ship **Tier 1 now** — it's a static folder that already works; zero risk to
   the desktop app.
2. Do **Tier 2** when there's real mobile demand; the architecture (transport
   behind one module, engine already browser-proven) was set up for exactly
   this move.
