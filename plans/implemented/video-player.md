# VideoPlayer — Implementation Plan

## Overview

Add a **`VideoPlayer`** component: a container whose media surface is a native `<video>` element but whose control bar (play/pause, seek scrubber, current-time / duration readout, volume, mute, fullscreen) is built entirely from this library's own components. Native browser `controls` are **not** used.

One-DOM-element-per-class ([ARCHITECTURE.md#one-dom-element-per-class](ARCHITECTURE.md)) forbids the composite's root `<div>` from also being the `<video>`, so the media surface is extracted into its own thin primitive **`Video`** (mirroring [`Image`](src/typescript/lib/component/display/Image.ts#L40), which wraps `<img>` via `tag: "img"`). `VideoPlayer` then *composes* `Video` + a control bar built from existing primitives ([`Button`](src/typescript/lib/component/button/Button.ts), [`Slider`](src/typescript/lib/component/input/Slider.ts), [`Text`](src/typescript/lib/component/input/Text.ts)) arranged with existing layout managers — exactly the [`PaginationBar`](src/typescript/lib/component/display/PaginationBar.ts#L56) pattern (a `Component` that builds an `HBox` of `Button`s + a `Text` inline).

Both new classes live under the **display** component folder ([`src/typescript/lib/component/display/`](src/typescript/lib/component/display/)) alongside `Image`, `ProgressBar`, and `PaginationBar`. A third file holds the **playback-engine seam** — a `PlaybackEngine` interface plus the default `ProgressiveEngine` — so an adaptive-streaming engine (hls.js/dash.js) can be attached later without rewriting the component and **without any new runtime dependency now**.

The one investigation finding that shapes everything: the DOM seam ([core/DOM.ts](src/typescript/lib/core/DOM.ts)) has **no media operations today** — no play/pause, no `currentTime`/`volume`/`duration` read or write, no Fullscreen API. These must be added to `DOMSink` / `DOMSource` (production impls in the same file) **and** to the test doubles in [tests/dom/TestDOM.ts](tests/dom/TestDOM.ts). Media DOM events (`timeupdate`, `play`, `loadedmetadata`, …) are **non-bubbling**, so they cannot route through the `Event` class's single window-level capture handler; they are wired through `DOM.sink.addListener` on the video element — the documented "native hook the Event API cannot model today" carve-out ([ARCHITECTURE.md#event-handling](ARCHITECTURE.md), the same class as `transitionend`).

---

## Architecture Decisions

### Extract the `<video>` surface into a `Video` primitive; `VideoPlayer` composes it

One-element-per-class means the composite root (which holds control-bar children) cannot itself be the `<video>`. `Video` is the minimal native-element wrapper — the `Image` twin — owning `tag: "video"`, the media typed setters, the media-state read, and the native media-event bridge. `VideoPlayer`'s mass is genuine **coordination** (play-state machine, scrubber⇄currentTime sync, volume/mute sync, fullscreen state, engine dispatch) that no layout manager contains, so per [ARCHITECTURE.md#compose-before-specializing](ARCHITECTURE.md) it earns a specialized class — but its control *bar* is pure arrangement and stays a composed `HBox`, never a new class. `Video` is exported publicly (a bare video surface is independently useful, like `Image`); `VideoPlayer` is the headline deliverable.

### Media events bridge `DOM.sink.addListener` → custom `emit`, not the `Event` class

`timeupdate` / `play` / `pause` / `loadedmetadata` / `durationchange` / `volumechange` / `ratechange` / `ended` / `progress` are non-bubbling and never reach the window-level capture handler that backs `Event.addListener` — so the `"action"`-style DOM shorthand ([Slider.on](src/typescript/lib/component/input/Slider.ts#L420), which wraps `Event.addListener`) is unavailable here. `Video` registers native listeners via `DOM.sink.addListener(videoHandle, type, handler)` (the documented terminus for hooks the `Event` API can't model — [ARCHITECTURE.md#event-handling](ARCHITECTURE.md)) and re-fans them out to consumers through the framework-custom `on` / `off` / `emit` + `ListenerBag` surface ([ARCHITECTURE.md#event-handling](ARCHITECTURE.md), custom-event half). `VideoPlayer` subscribes to `Video`'s custom events via `Video.on(...)` — never by reaching into `Video`'s element with the `Event` API (which [ARCHITECTURE.md](ARCHITECTURE.md) forbids across component boundaries).

### Native listeners wire at render time, not in the constructor

`DOM.sink.addListener` needs the real element, which does not exist during construction. Unlike `Slider`, which installs pointer interaction in its constructor (`Event.addListener` routes by id at the window level, so it works pre-render — [Slider.installInteraction](src/typescript/lib/component/input/Slider.ts#L536)), `Video` must attach media listeners from an **`init()` override** — the render-time hook other components use (`FileField`, `ScrollStrip`, `SplitGutter` all override `init`). This honours [ARCHITECTURE.md#defer-dom-work-to-render-time](ARCHITECTURE.md).

### Extend the DOM seam for media + fullscreen

New `DOMSink` methods: `mediaPlay(handle)`, `mediaPause(handle)`, `setCurrentTime(handle, seconds)`, `setVolume(handle, value)`, `setMuted(handle, muted)`, `setPlaybackRate(handle, rate)`, `requestFullscreen(handle)`, `exitFullscreen()`. New `DOMSource` methods: `getMediaState(handle): MediaState` (`{ currentTime, duration, paused, ended, volume, muted, playbackRate }`) and `getFullscreenElement(): Handle | null`. Each is added to the interface, the production impl (`ProductionDOMSink` / `ProductionDOMSource` in the same file), and the test doubles (`RecordingDOMSink` / `ModelledDOMSource` in [tests/dom/TestDOM.ts](tests/dom/TestDOM.ts)). The `src` attribute reuses the existing `setAttr` patch path (`DOM.sink.apply(handle, { setAttr: { src } })`, as [Image.render](src/typescript/lib/component/display/Image.ts#L110) does) — no new sink method for `src`.

### Playback-engine seam: progressive default, streaming-ready

```typescript
export interface PlaybackEngine {
    load(video: Video, src: string): void;
    destroy(): void;
}
```

`ProgressiveEngine.load(video, src)` simply calls `video.setSrc(src)` (which writes the `src` attribute — the browser auto-loads a progressive MP4/WebM). `destroy()` is a no-op. `VideoPlayer` holds `_engine` (default `ProgressiveEngine`, overridable via the `engine` option) and on `setSrc` calls `this._engine.destroy()` then `this._engine.load(this._video, src)`. A future `HlsEngine` would `hls.attachMedia(el)` + `hls.loadSource(src)` — which needs the raw `HTMLVideoElement`, a boundary the DOM seam deliberately hides. **Handing the element to an external library is an unresolved seam question and a documented prerequisite for streaming — it is a Non-Goal here**; the interface is the extension point, and the progressive path never touches raw DOM.

### Root layout: `Border` (video centre, control bar south)

`VideoPlayer` sets a [`Border`](src/typescript/lib/layout/Border.ts) layout: `Video` in the centre region (fills), the control bar in the south region. This is composition of existing managers per [ARCHITECTURE.md#positioning-is-always-absolute](ARCHITECTURE.md) — no `doLayout` override, no new manager. (A floating-overlay control bar is a Non-Goal; south-docked keeps the layout inside the manager system.)

---

## Public API

All components wrapped with `callable()` and exported under the callable name ([ARCHITECTURE.md#components-are-exported-through-callable](ARCHITECTURE.md)).

### `Video` — native `<video>` surface primitive

```typescript
export interface VideoOptions extends ComponentOptions {
    src?:          string;
    poster?:       string;
    autoplay?:     boolean;
    loop?:         boolean;
    muted?:        boolean;
    preload?:      "none" | "metadata" | "auto";
    volume?:       number;   // 0..1
    playbackRate?: number;
    listeners?: {
        timeupdate?:      () => void;
        play?:            () => void;
        pause?:           () => void;
        ended?:           () => void;
        loadedmetadata?:  () => void;
        durationchange?:  () => void;
        volumechange?:    () => void;
        ratechange?:      () => void;
    };
}

class Video extends Component<VideoOptions> {
    // tag: "video" via _defaultVideoOptions (mirrors Image)
    getSrc(): string | null;              setSrc(src: string): this;
    getPoster(): string | null;           setPoster(url: string): this;
    isAutoplay(): boolean;                setAutoplay(v: boolean): this;
    isLoop(): boolean;                    setLoop(v: boolean): this;
    isMuted(): boolean;                   setMuted(v: boolean): this;
    getPreload(): string | null;          setPreload(v: "none"|"metadata"|"auto"): this;
    getVolume(): number;                  setVolume(v: number): this;   // clamped 0..1
    getPlaybackRate(): number;            setPlaybackRate(v: number): this;
    setCurrentTime(seconds: number): this;             // seek (runtime-only, not option-backed)
    play(): this;                         pause(): this;
    getMediaState(): MediaState;          // reads through DOM.source.getMediaState

    on(event: "timeupdate"|"play"|"pause"|"ended"|"loadedmetadata"|"durationchange"|"volumechange"|"ratechange", listener: () => void): this;
    off(...): this;
    dispose(): void;                      // detaches native media listeners
}
```

`MediaState` (new type, exported from `core/DOM.ts`): `{ currentTime: number; duration: number; paused: boolean; ended: boolean; volume: number; muted: boolean; playbackRate: number }`.

**State-bearing property routing** — for each option-backed field the trio is `option field` ⇄ `setX`/`getX` ⇄ `_options.<field>` cache (the default cache per [ARCHITECTURE.md#three-non-negotiable-rules](ARCHITECTURE.md); no separate backing field unless the setter normalises). `volume` normalises (clamp to `0..1`) so it may read from `_options.volume ?? DEFAULT_VOLUME`. `currentTime` is **runtime-only** (a live playhead, not consumer config) → **not** on `VideoOptions`, no getter that returns cached state (it is read live via `getMediaState`); `setCurrentTime` seeks.

### `VideoPlayer` — composite player

```typescript
export interface VideoPlayerOptions extends ComponentOptions {
    src?:          string;
    poster?:       string;
    autoplay?:     boolean;
    loop?:         boolean;
    muted?:        boolean;
    volume?:       number;   // 0..1
    playbackRate?: number;
    controls?:     boolean;  // show/hide the custom control bar; default true
    engine?:       PlaybackEngine;
    listeners?: {
        play?:  () => void;
        pause?: () => void;
        ended?: () => void;
    };
}

class VideoPlayer extends Component<VideoPlayerOptions> {
    getSrc(): string | null;          setSrc(src: string): this;       // routes through _engine
    getVolume(): number;              setVolume(v: number): this;      // → _video + volume slider
    isMuted(): boolean;               setMuted(v: boolean): this;
    getPlaybackRate(): number;        setPlaybackRate(v: number): this;
    setCurrentTime(seconds: number): this;                             // seek
    getCurrentTime(): number;         getDuration(): number;           // read live from _video
    isPlaying(): boolean;             play(): this;   pause(): this;   togglePlay(): this;
    isControlsVisible(): boolean;     setControlsVisible(v: boolean): this;
    isFullscreen(): boolean;
    enterFullscreen(): this;          exitFullscreen(): this;          toggleFullscreen(): this;

    on(event: "play"|"pause"|"ended", listener: () => void): this;   off(...): this;
    dispose(): void;
}
```

Runtime-only (NOT on the options bag, per rule 3 — framework-managed / derived state): `_playing`, `_fullscreen`, `_scrubbing` (guards the timeupdate⇄scrubber feedback loop), and the live `currentTime`/`duration` (read from `_video`, never cached on `_options`).

### `PlaybackEngine` + `ProgressiveEngine`

As in Architecture Decisions. `ProgressiveEngine` is the default; exported for reference and subclassing.

---

## Internal Structure

**Control-bar children** (built inline in `VideoPlayer`'s constructor, `PaginationBar`-style):

| Child | Type | Role |
|---|---|---|
| `_playBtn` | `Button` | glyph swaps `play` ⇄ `pause` on play-state |
| `_scrubber` | `Slider` | `min:0`, `max:duration`, `value:currentTime` |
| `_timeText` | `Text` | `"m:ss / m:ss"` current / duration |
| `_muteBtn` | `Button` | glyph swaps `volume-high` ⇄ `volume-mute` |
| `_volume` | `Slider` | `min:0`, `max:1`, `step:0.05` |
| `_fullscreenBtn` | `Button` | glyph swaps `expand` ⇄ `compress` |

Glyphs are all present under `glyphs/solid/`: `play`, `pause`, `volume_high`, `volume_mute`, `expand`, `compress`. Register them via `Glyph.register(...)` at module load, exactly as [PaginationBar](src/typescript/lib/component/display/PaginationBar.ts#L15) registers its angle glyphs.

**Pure state→UI mapping (maximise testable surface).** Extract the mapping from a `MediaState` snapshot to control-bar writes into a single pure method:

```typescript
// Called by every media-event handler AND directly by unit tests.
private syncFromState(state: MediaState): void {
    if (!this._scrubbing) {
        this._scrubber.setMax(state.duration || 0);
        this._scrubber.setValue(state.currentTime);
    }

    this._timeText.setText(`${formatMediaTime(state.currentTime)} / ${formatMediaTime(state.duration)}`);
    this._playBtn.setGlyph(state.paused ? "play" : "pause");
    this._muteBtn.setGlyph(state.muted || state.volume === 0 ? "volume-mute" : "volume-high");
    this._volume.setValue(state.muted ? 0 : state.volume);
}
```

`formatMediaTime(seconds: number): string` is a module-level **pure** helper (`h:mm:ss` when ≥ 3600s, else `m:ss`; `NaN`/`Infinity` → `"0:00"`) — fully unit-testable.

**Feedback-loop guard.** Scrubber `pointerdown`→`pointerup` (or its `"change"` events) sets/clears `_scrubbing`; while `_scrubbing`, incoming `timeupdate` must not overwrite the thumb. On scrubber `"change"`, call `this._video.setCurrentTime(value)`.

**Fullscreen.** `enterFullscreen()` → `DOM.sink.requestFullscreen(rootHandle)`; `exitFullscreen()` → `DOM.sink.exitFullscreen()`. A `fullscreenchange` listener (via `DOM.sink.addListener` on the root element — it bubbles to `document`, unlike media events) reads `DOM.source.getFullscreenElement()`, updates `_fullscreen`, and swaps the button glyph. Must be triggered from the button's user-gesture `"action"` handler (browsers reject programmatic requests outside a gesture).

---

## Ordered Implementation Steps

1. **Extend the DOM seam.** In [core/DOM.ts](src/typescript/lib/core/DOM.ts): add the `MediaState` type; add the 8 `DOMSink` media/fullscreen methods to the `interface` (line ~440) and `ProductionDOMSink` (impl ~1160), and the 2 `DOMSource` methods to the `interface` (~701) and `ProductionDOMSource`. → verify: `npx tsc --noEmit` clean.
2. **Extend the test doubles.** In [tests/dom/TestDOM.ts](tests/dom/TestDOM.ts): implement the new methods on `RecordingDOMSink` (record the call) and `ModelledDOMSource` (return a settable modelled `MediaState`; `getFullscreenElement` returns a settable handle). → verify: existing suite still compiles + passes.
3. **`PlaybackEngine.ts`.** Create the interface + `ProgressiveEngine`; export both. → verify: `tsc`.
4. **`Video.ts`.** Wrap `<video>` (`tag: "video"` default, `Image`-style); typed setters + `getMediaState`; `init()` override wiring native media listeners via `DOM.sink.addListener` and re-emitting as custom events; `dispose()` detaches them; `applyOptions` + constructor dispatch of the option-backed setters (Slider-style tail dispatch). Register no glyphs. → verify: `tsc` + a unit test asserting `src`/`autoplay`/`loop` attrs recorded.
5. **`VideoPlayer.ts`.** `Border` layout; build `Video` + the six control-bar children in an `HBox` child; `Glyph.register` the media glyphs; wire `Video.on(...)` → `syncFromState`; scrubber/volume/mute/play/fullscreen `"action"`/`"change"` handlers; `_engine` dispatch in `setSrc`; `formatMediaTime` helper; `syncFromState`; `dispose()`. → verify: `tsc`.
6. **Barrel exports.** Add `Video`, `VideoOptions`, `VideoPlayer`, `VideoPlayerOptions`, `PlaybackEngine`, `ProgressiveEngine` to [component/display/index.ts](src/typescript/lib/component/display/index.ts). → verify: `grep -n "VideoPlayer" src/typescript/lib/component/display/index.ts`.
7. **Unit tests.** `tests/component/display/Video.test.ts` + `VideoPlayer.test.ts` per Expected Behaviour. → verify: `npm test`.
8. **Docs.** `docs/components/VideoPlayer.md` (+ `Video.md`); add both to the **Display** section of [docs/.vitepress/config.mts](docs/.vitepress/config.mts) (~line 116, after `PaginationBar`). `typedoc.json` already lists `display/index.ts` as an entry point (line 12) — no change; the new exports flow through. → verify: `npm run docs:build` finishes with **zero** warnings.
9. **Demo wiring (manual-verify entry point).** Add a `VideoPlayer` instance to a demo panel (e.g. `MiscPanel.ts`) so the dev server exercises real playback. → verify: `npm run dev`, load `http://localhost:8015`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/component/display/Video.ts` |
| Create | `src/typescript/lib/component/display/VideoPlayer.ts` |
| Create | `src/typescript/lib/component/display/PlaybackEngine.ts` |
| Create | `tests/component/display/Video.test.ts` |
| Create | `tests/component/display/VideoPlayer.test.ts` |
| Create | `docs/components/VideoPlayer.md` |
| Create | `docs/components/Video.md` |
| Modify | `src/typescript/lib/core/DOM.ts` (media + fullscreen on both interfaces + production impls; `MediaState` type) |
| Modify | `tests/dom/TestDOM.ts` (media + fullscreen on `RecordingDOMSink` / `ModelledDOMSource`) |
| Modify | `src/typescript/lib/component/display/index.ts` (barrel exports) |
| Modify | `docs/.vitepress/config.mts` (Display sidebar entries) |
| Modify | `src/typescript/MiscPanel.ts` (demo instance — optional, for manual verification) |

---

## Expected Behaviour

**Unit-testable** (recording sink + modelled source; drive pure methods directly):

- `Video({ src, autoplay, loop, muted, preload, poster })` records the corresponding attribute writes on render.
- `Video.setVolume(v)` clamps to `[0,1]`; `getVolume()` returns the clamped value; out-of-range inputs (`-1`, `2`) saturate.
- `Video.setSrc(url)` then `getSrc()` round-trips; render writes `setAttr.src`.
- `Video.play()` / `pause()` / `setCurrentTime(n)` / `setPlaybackRate(n)` invoke the matching `DOMSink` method (assert via `RecordingDOMSink`).
- `VideoPlayer` constructs the six control children; the control bar is present when `controls !== false` and absent (or hidden) when `controls: false`.
- `formatMediaTime`: `0 → "0:00"`, `5 → "0:05"`, `65 → "1:05"`, `3661 → "1:01:01"`, `NaN → "0:00"`, `Infinity → "0:00"`.
- `syncFromState(state)`: sets `_timeText` to `"cur / dur"`; `_playBtn` glyph `play` when `paused`, else `pause`; `_muteBtn` glyph `volume-mute` when `muted || volume===0`, else `volume-high`; `_scrubber.max === duration` and `value === currentTime`; while `_scrubbing`, `syncFromState` leaves the scrubber value untouched.
- `setSrc` calls `_engine.destroy()` then `_engine.load(video, src)` (inject a spy engine via the `engine` option; assert call order).
- `ProgressiveEngine.load(video, src)` calls `video.setSrc(src)`.
- Option→setter routing: every `VideoPlayerOptions` field reaches its setter (default-options-fallback registry updated if any field is class-defaulted — see [tests/component/default-options-fallback.test.ts](tests/component/default-options-fallback.test.ts)).
- ARIA: `Video` element gets an appropriate role/label; control buttons carry accessible labels.

**Manual-verify** (the offline harness cannot exercise these — `RecordingDOMSink.addListener` records only the event *type*, not the handler, so media-event-driven flow is not automatable; playback/fullscreen/drag/focus have no modelled behaviour):

- Progressive MP4/WebM URL plays; `timeupdate` advances the scrubber and time readout.
- Dragging the scrubber seeks; the video jumps and resumes; no thumb "fight" during drag.
- Play/pause button toggles playback and swaps its glyph; volume slider changes audio; mute toggles and swaps glyph.
- Fullscreen button enters/exits fullscreen on the root element and swaps `expand`⇄`compress`; state stays correct after pressing Esc.
- Keyboard focus reaches the controls; focus does not scroll the player.

---

## Verification

- `npx tsc --noEmit` — clean.
- `npm test` — new `Video` / `VideoPlayer` suites green; existing suites unaffected (seam extension is additive).
- `grep -n "VideoPlayer\|Video\b" src/typescript/lib/component/display/index.ts` — exports present.
- `npm run docs:build` — **zero** warnings (JSDoc `{@link}` only public symbols per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md)).
- `npm run dev` → `http://localhost:8015`, exercise the `MiscPanel` (or wherever wired) `VideoPlayer` for every Manual-verify behaviour above. Scope DevTools queries to `.VideoPlayer` (multiple components coexist).
- `npm run build:lib` if the change must surface to downstream consumers.

---

## Documentation Impact

- **Barrel:** `component/display/index.ts` re-exports `Video`, `VideoPlayer`, `PlaybackEngine`, `ProgressiveEngine` + their `*Options` types. `package.json` already maps the `./component/display` subpath — no change.
- **TypeDoc:** `typedoc.json` already lists `display/index.ts` as an entry point (line 12); new exports are picked up automatically. JSDoc every exported symbol; only `{@link}` other *public* symbols (prose-reference internals) per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md).
- **Guide pages:** create `docs/components/VideoPlayer.md` and `docs/components/Video.md` mirroring [docs/components/Slider.md](docs/components/Slider.md) (Usage / Common methods / events tables). Add both to the **Display** group in [docs/.vitepress/config.mts](docs/.vitepress/config.mts) after `PaginationBar`.
- **API cross-links:** use the `[`X`](/api/component/display/classes/X)` form the existing pages use.

---

## Potential Challenges

- **Seam extension touches four impls.** Every new `DOMSink`/`DOMSource` method must land in the interface, production impl, `RecordingDOMSink`, and `ModelledDOMSource`, or the build/tests break — enumerate before editing.
- **Feedback loop scrubber⇄timeupdate.** Without the `_scrubbing` guard, seeking and playback fight over the thumb — the guard is load-bearing; verify live.
- **Media events don't bubble.** Do **not** try `Event.addListener(this, "timeupdate", …)` — it silently never fires (window-capture only sees bubbling events); use `DOM.sink.addListener` on the video element.
- **Fullscreen requires a user gesture.** Only call `requestFullscreen` from the button's `"action"` handler; a programmatic call is rejected.
- **Streaming engine needs the raw element.** hls.js/dash.js attach to the live `HTMLVideoElement`, which the DOM seam hides — resolving that boundary is a prerequisite for streaming and intentionally out of scope (Non-Goals).
- **Listener leaks.** `Video.dispose()` / `VideoPlayer.dispose()` must detach native + custom listeners (mirror [PaginationBar.dispose](src/typescript/lib/component/display/PaginationBar.ts#L154)).
- **`currentTime` must not be option-backed.** It is a live playhead; caching it on `_options` would violate the runtime-state rule and desync from the element.

---

## Critical Files

- [src/typescript/lib/component/display/Image.ts](src/typescript/lib/component/display/Image.ts) — the native-element-wrapper template (`tag` default, `render` attr write).
- [src/typescript/lib/component/display/PaginationBar.ts](src/typescript/lib/component/display/PaginationBar.ts) — inline `HBox` + `Button`s + `Text` composite, `Glyph.register`, `dispose`.
- [src/typescript/lib/component/input/Slider.ts](src/typescript/lib/component/input/Slider.ts) — the scrubber/volume control; option→setter tail dispatch; `on`/`off` shorthand; CSS-var theming pattern.
- [src/typescript/lib/core/Component.ts](src/typescript/lib/core/Component.ts) — `getElement` (L747), `render` (L4903), `init` (L4829), `applyStyle` (L3926), `createRootElement`/`createElement` (L4895), `tag` option (L109), `setElementAttribute` (L1083).
- [src/typescript/lib/core/DOM.ts](src/typescript/lib/core/DOM.ts) — `DOMSink` (L440), `DOMSource` (L701) interfaces + production impls; the seam being extended.
- [tests/dom/TestDOM.ts](tests/dom/TestDOM.ts) — `RecordingDOMSink` (L244), `ModelledDOMSource` (L521) test doubles.
- [ARCHITECTURE.md](ARCHITECTURE.md) — event split, one-element-per-class, compose-before-specialize, absolute positioning, typed setters, defer-DOM, `callable`.
- [tests/component/default-options-fallback.test.ts](tests/component/default-options-fallback.test.ts) — register any class-defaulted field.

---

## Non-Goals

- **Adaptive streaming (hls.js/dash.js).** No new runtime dependency; the `PlaybackEngine` seam is the extension point, but a concrete streaming engine — and the DOM-seam escape it needs to reach the raw element — is out of scope.
- **Captions/subtitles, playlists, PiP, chapter markers, thumbnail-preview scrubbing.** Not requested; add later behind the same options-bag/setter discipline.
- **Auto-hiding / floating-overlay control bar.** The control bar is a south-docked `Border` region; an overlay that fades on idle is a separate layout concern.
- **Native `controls` attribute as the default chrome.** Explicitly excluded by the scope decision; the custom control bar is the default.
