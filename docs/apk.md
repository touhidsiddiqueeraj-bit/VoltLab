# VoltLab on Android — both tiers shipped

> **Status — Tier 2 shipped.** [VoltLab 1.2.0](https://github.com/touhidsiddiqueeraj-bit/VoltLab/releases/latest)
> packages the **full circuit editor** in an offline APK: palette, wiring,
> inspector, faults, saving to the device, exports — the real engine running
> in the page, no server. Tier 1 (the demo/operator APK) shipped in
> [1.1.0](https://github.com/touhidsiddiqueeraj-bit/VoltLab/releases/tag/v1.1.0).

**Short answer: it was viable, and it's done.** The simulator core was
designed to run without a backend — that design is what made both tiers
straightforward.

## Why it was viable

The engine is pure, dependency-free JavaScript that already ran in a plain
browser tab (the GitHub Pages demo proved it):

- `sim/engine.js` — the solver: no Node APIs, no `fetch`, no filesystem.
- `app/js/render.js` + `app/js/symbols.js` — the SVG schematic renderer: pure DOM/SVG.
- `sim/tools.js` — the tool dispatcher (split out of `sim/api.js` in 1.2.0 so
  the exact same tool logic runs in Node and in the browser).

The only piece that did not exist on Android was the *transport*: the editor
UI (`app/js/main.js`) talked to `server.js` over HTTP + SSE.

## How Tier 2 works (v1.2.0)

One seam, one local host:

```
ui/main.js ──cmd(tool,args)──▶ app/js/host.js ──▶ app/js/local-api.js ──▶ sim/tools.js ──▶ sim/engine.js
     ▲                                                                          │
     └────────── onState(engine.snapshot()) on a 10 Hz loop ────────────────────┘
```

- **`app/js/host.js`** — the single transport seam. Server mode keeps the
  exact fetch + SSE behaviour; local mode (Capacitor, `file://`, or `?local=1`
  in any browser) swaps in the in-page host. Every UI feature goes through it.
- **`app/js/local-api.js`** — the in-page host: same contracts as `server.js`
  (`call`/`state`/`health`, command-then-broadcast, the 10 Hz realtime loop)
  around the shared dispatcher. Dependency-injected (`fetchImpl`, `storage`),
  so it's unit-tested in Node (`test/localapi.test.mjs`).
- **Circuits** = bundled examples (`circuits/` + a generated `index.json`
  manifest) ∪ user-saved circuits in `localStorage`. Saved copies shadow
  bundled ones with the same name.
- **Exports** — video (webm) and PDF reports save via
  `@capacitor/filesystem` to the app's Documents folder on Android, or as a
  browser download in `?local=1` mode. Local screenshots render the SVG
  canvas to PNG.
- **Touch** — two-finger pinch zoom, one-finger pan, tap-to-select/wire,
  hold-to-press mimic buttons, and an in-page Save-as dialog (Android
  WebViews have no `window.prompt`). Terminals grow to 13 px hit circles on
  coarse pointers; palette and inspector become swipe-in drawers below 900 px.
- **MCP** — not applicable offline; the panel says so. The desktop app keeps
  the full agent layer.

### Try it without an APK

Any static file server + `?local=1`:

```bash
scripts/build-offline-bundle.sh        # → dist/offline (~300 KB)
cd dist/offline && python3 -m http.server 8099
open http://localhost:8099/?local=1    # full editor, zero server
```

## Building the APK

```bash
scripts/build-apk.sh                   # → dist/VoltLab-<version>.apk
```

Requires a JDK 21 and `ANDROID_HOME`; wraps `scripts/build-offline-bundle.sh`
for the web layer, generates launcher icons from the app logo, signs with the
release keystore ( honouring `KEYSTORE_PASSWORD`; the build keystore stays out
of the repo). `docs/apk.md` history: Tier 1 wrapped `docs/demo/` (operator
tier, v1.1.0); Tier 2 wraps the full editor (v1.2.0).

## Known Android-specific choices

| Item | Resolution |
|---|---|
| Touch targets | terminals 13 px hit circles on coarse pointers; 38–40 px buttons; 52 px mimic buttons |
| Pinch-zoom | two-pointer gesture on the canvas (transform plumbing reused) |
| `window.prompt` | in-page `<dialog>` Save-as |
| Back button | WebView default (exit); cancel via on-screen affordances |
| APK size | ~3.4 MB |
| Performance | per-tick union-find solver — no problem in a WebView |
| Play Store | not required for sideloading; signing key + console if you want it there |

## CI for the APK

The desktop installers build on tag push via `.github/workflows/release.yml`.
The APK is built locally with `scripts/build-apk.sh` (keystore + SDK are not
in CI); the release process attaches it to the same GitHub Release.
