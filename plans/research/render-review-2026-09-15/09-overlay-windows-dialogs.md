# 09 overlay-windows-dialogs — render-work review

**Summary**

- `AbstractWindow.show()` runs the window's entire first `doLayout()` **before**
  `LayerManager.mount()` attaches the element, so every `getBorderSize()` on the
  way takes its uncached pre-connect path. Probed on a *bare* window (header +
  empty body): **516 `getThemeVar` = `getComputedStyle(documentElement)` calls**,
  against 0 when the same tree is laid out attached. `Dialog.open()` already
  mounts first and pays 3. Two-line reorder (F09.1, HIGH, window open).
- The default resize-fps cap is **60**, and `PerFrameCoalescer` compares the
  frame delta against `1000/60 = 16.667 ms`. At a real 60 Hz vsync cadence
  (~16.6 ms) that test fails on roughly every other frame: probed, 6 buffered
  moves → **3 applied, alternating**. A window border drag renders at ~30 fps
  with uneven pacing on a 60 Hz display (F09.2, HIGH, window-resize drag).
- `pickSnapBorder` reads **8 live `getElementRect`s per animation frame** while
  the Ctrl-snap modifier is held, for eight rectangles whose geometry the
  framework already holds in cached fields (F09.3, HIGH, pointer movement).
- A **settled, zero-change** window layout pass issues **43 `DOM.sink.apply`
  calls and 1 same-valued stylesheet-rule mutation**: 27 applies are completely
  empty (8 from the resize strips), and the other 16 are four clip frames each
  writing `left`/`top`/`width`/`height` as four separate applies with the values
  they already hold (F09.4, F09.5). `fitNormalWindowToViewport` re-runs exactly
  that pass, unconditionally, on **every** viewport-resize event for every open
  normal-state window — even when the clamped rect is byte-identical.
- With 4 minimized windows, one viewport-resize event costs **16
  `getComputedStyle(documentElement)` + 16 `getViewportSize()` forced flushes and
  624 applies**, because each minimized window's own listener re-runs the static
  whole-stack relayout (F09.6, quadratic).
- Protect: the header **move** frame is 1 inline apply, 0 rule writes, 0 layout
  passes, 0 geometry reads beyond one `getViewportSize` — slice 10's precedent
  claim is **verified**, and the exact pattern is documented in F09.11.

## Findings

### F09.1 `show()` lays the whole window out while it is still detached

- **Category**: A, D
- **Impact**: HIGH — once per window open, but ~500 forced style resolutions on
  a *minimal* window; Loom opens a `TabWindow` on every strip tear-off, and
  `Dock` floats panels the same way.
- **Where**: `overlay/AbstractWindow.ts:812-830` (`show`); `core/LayerManager.ts`
  `mount`; the read it triggers is `core/Component.ts` `getBorderSize` →
  `estimateBorderSideWidth` → `DOM.source.getThemeVar`.
- **Hot path**:
  - `win.show()`
  - `this.getElement(true)` — element created, **not attached**
  - `LayerManager.register(this)`; `trapWheel(this)`
  - `this.doLayout()` ← whole subtree laid out while detached
  - → `Container.doLayout` → `Border.doLayout` → header `Border.doLayout` → …
  - → every `clampWidth`/`clampHeight`/`getPerimeterSize`/`getInnerSize` calls
    `getBorderSize()`
  - → `getBorderSize()` sees `isConnected === false`, skips the `_borderWidths`
    cache, and runs `estimateBorderSideWidth` per side
  - → `DOM.source.getThemeVar(name)` = `getComputedStyle(document.documentElement)`
  - `LayerManager.mount(el)` ← attachment happens *after* all of the above
- **Evidence**: probe `09b`, test 1 — the identical tree (a `Window` with a
  `WindowHeader` and one empty `Container` body), one `doLayout()`:
  - detached: `{ isConnected: 132, getThemeVar: 516, getParentNode: 4 }`
  - connected: `{ isConnected: 4, getBorderWidths: 2, getParentNode: 4 }`
  `Dialog.open()` (`overlay/Dialog.ts:925-942`) does the opposite order —
  `getElement(true)` → `LayerManager.mount` → `scheduleLayout()` — and probe
  `09c` test 1 measures `getThemeVar: 3` for a whole dialog open. Same library,
  same seam, opposite ordering.
- **Proposed change**: move `LayerManager.mount(el)` above `this.doLayout()` in
  `show()` (it is already unconditional and idempotent — `mount` is a
  `contains`-guarded `appendChild`). `bringToFront()` and
  `attachViewportResizeListener()` have no ordering dependency on `doLayout`.
  The detached pass is also *wrong*, not just slow: it sizes the window from
  estimated border widths that the next (attached) pass re-measures.
- **Risk / blast radius**: `show()` currently relies on `doLayout()` having run
  before `setVisible(true)` and the entrance `Animation.play`; mounting earlier
  keeps that order. `AbstractWindow.styleRuleDisposal.test.ts`,
  `AbstractWindow.resizable.test.ts` ("reconciles border strip visibility
  exactly once per strip at construction") and `Rail.test.ts` all call `show()`;
  none asserts mount-vs-layout order. `LayerManager.register` must still precede
  `bringToFront`.
- **Proof at implement time**: a probe asserting `getThemeVar` calls during
  `show()` drop from 516 to ≤ 5 on the bare-window tree; and that `doLayout`
  count during `show()` is unchanged.

### F09.2 The default resize-fps cap of 60 halves the window-resize frame rate

- **Category**: H (stated function vs implementation), user-visible
- **Impact**: HIGH — the window border-resize hot path, every frame.
- **Where**: `overlay/AbstractWindow.ts:374` (`_resizeFps: number = 60`),
  `:275-285` (`PerFrameCoalescer.onFrame`), `:2172-2176` (`setResizeFps`).
- **Hot path**:
  - native `mousemove` → `WindowBorder._dispatchDrag` → `AbstractWindow.onResize`
  - `this._resizeCoalescer.schedule({clientX, clientY, border})` → `requestAnimationFrame`
  - `onFrame(ts)`: `if (ts - _lastFlushTime < 1000 / 60) { re-arm; return; }`
  - the buffered value is **not** applied; it waits a whole extra frame
- **Evidence**: probe `09d`, test 2 — six moves scheduled, one rAF per move, a
  realistic 16.6 ms vsync cadence: `frames actually applied: 3 [1, 3, 5]`. The
  threshold (16.667 ms) sits just above the real frame interval, so the guard
  trips on essentially every frame at 60 Hz. The cap's own docs
  (`docs/components/Window.md:63`, "Throttle resize-driven layout (default 60)")
  promise 60 fps and deliver 30, with alternating frames — which reads as
  stutter, not as a smooth lower rate.
- **Proposed change**: default `_resizeFps` to "no cap" (leave the `fps`
  callback returning `undefined`), since `requestAnimationFrame` already caps at
  the display rate; keep `setResizeFps(n)` for a caller that genuinely wants a
  lower rate, and apply a small tolerance (e.g. `1000/fps - 1`) so an explicit
  cap equal to the refresh rate does not self-skip.
- **Risk / blast radius**: `AbstractWindow.resizeFpsCoalescing.test.ts` pins the
  *mechanism* (tests 1-4: "first frame always applies", "a too-soon frame
  re-arms without applying", "setResizeFps changes the cap on the very next
  frame"). Those drive the coalescer with explicit timestamps and an explicit
  `setResizeFps`, so they survive a default change; test 2's fixture may need an
  explicit `setResizeFps` call. `getResizeFps`/`setResizeFps` have **zero**
  production callers (see dead-code section), so no in-library behaviour moves.
- **Proof at implement time**: rerun probe `09d` test 2 — all 6 scheduled moves
  apply; plus ms/frame and applied-frames-per-second on a real WebKitGTK window
  border drag.

### F09.3 `pickSnapBorder` forces 8 document layouts per frame for cached geometry

- **Category**: A
- **Impact**: HIGH while the snap modifier is held and the cursor moves — 8
  forced synchronous layouts per animation frame, on a path whose only output is
  one class toggle.
- **Where**: `overlay/AbstractWindow.ts:3337-3370` (`pickSnapBorder`),
  reached from `:3314-3327` (`applySnapMoveFrame`) via `_snapMoveCoalescer`.
- **Hot path**:
  - viewport `mousemove` → `onSnapMouseMove` → `_snapMoveCoalescer.schedule`
  - rAF → `applySnapMoveFrame` → `pickSnapBorder(cx, cy)`
  - loop over 8 strips → `DOM.source.getElementRect(el)` ×8
  - each `getElementRect` is `getBoundingClientRect` → full-document style+layout
  - result: at most one `setSnapTarget` class toggle
- **Evidence**: probe `09a`, test 5 — `pickSnapBorder source: { getElementRect: 8 }`.
  Every input is already cached: the window's own rect is `currentRect()` (pure
  field reads, `:2512-2519`), and each strip's `x`/`y`/`width`/`height` were
  written by `doLayout` (`:2433-2471`) from cached values and are readable
  through `getX/getY/getWidth/getHeight` with no DOM access.
- **Proposed change**: compute each strip's viewport rect arithmetically —
  `currentRect()` plus the strip's own cached `getX/getY/getWidth/getHeight` —
  and keep `getElementRect` out of the loop entirely. The method's own JSDoc
  (`:3288-3291`) already names this cost ("reads up to eight border strips' live
  layout rects … each forcing the browser to flush layout") and the rAF
  coalescing was added to reduce the *frequency*; removing the reads removes the
  cost outright.
- **Risk / blast radius**: only `applySnapMoveFrame` calls it.
  `AbstractWindow.snapMouseMoveCoalescing.test.ts` (9 tests) pins which border
  wins and when the highlight updates, not how the rect is obtained — those tests
  are the regression net. A window inside a transformed or scrolled ancestor
  would diverge; windows mount on `document.documentElement`, so `x`/`y` are
  already viewport coordinates.
- **Proof at implement time**: a probe asserting zero `DOM.source.getElementRect`
  calls in `applySnapMoveFrame`, with the existing coalescing tests'
  border-selection assertions unchanged.

### F09.4 A settled window layout pass issues 43 applies and 1 rule write for no visual change

- **Category**: B, C
- **Impact**: MEDIUM-HIGH — per window layout pass, and F09.5 makes that one pass
  per viewport-resize *event* per open window.
- **Where**:
  - 8 empty applies: `overlay/AbstractWindow.ts:2424-2431` and `:2473-2480` —
    the eight `setAutoCommitStyle(false)` / `setAutoCommitStyle(true)` pairs;
    the `true` leg calls `commitElementStyle()` → `InlineStyle.flush()` →
    `flushDirty({})`, which lacks the empty-bag guard `StyleRule.flushDirty`
    has (`core/StyleTarget.ts:404-410` vs `:457-459`).
  - 16 unchanged single-property applies: `core/Component.ts` `setClipFrame`'s
    `this._clipFrameStyle.setMany({left, top, width, height})`, via
    `StyleTarget.setMany` (`core/StyleTarget.ts:44-47`), which loops `set()` —
    one `DOM.sink.apply` per property, with no last-written-value filter.
    Four clip frames on a `Window`: the window `Border`'s NORTH (header) and
    CENTER (content) frames, and the header `Border`'s WEST (title cell) and
    EAST (trailing row) frames.
  - 1 rule write: `layout/Border.ts:1272` `north.setClipPath(null)` →
    `Component.setClipPath` → `setElementCSSRule` → `DOM.sink.setRuleStyles`,
    unguarded when the value is already `null`.
- **Hot path**: `window.doLayout()` → `Container.doLayout` → `Border.doLayout`
  → `setClipFrame` per region → 4 applies each; → `header.doLayout()` → header
  `Border.doLayout` → `setClipFrame` per region → 4 applies each; back in
  `AbstractWindow.doLayout` → 8 × `setAutoCommitStyle(true)` → 8 empty applies.
- **Evidence**: probes `09b` test 2, `09d` test 1, `09e`. Settled pass on a
  `Window` with a header and one empty `Container` body, geometry unchanged:
  `{ setRuleStyles: 1, apply: 43 }`, `27 empty, 8 of those from the 8 resize
  strips`, rule write `[{"clipPath": null}]`. The 16 non-empty applies dumped in
  `09e` are exactly four `left`/`top`/`width`/`height` quadruples, each
  re-writing the value already present (`600px`/`28px`, `55px`/`28px`,
  `72px`/`28px`, `592px`/`359px`). This confirms and sharpens slice 14's
  `Header`/`WindowHeader` finding: at the whole-`Window` level the clipPath rule
  mutation is the **only** stylesheet write a settled pass makes, and the
  "unchanged geometry applies" are clip-frame writes, not component geometry
  (`Component.setX/setY/setWidth/setHeight` *are* guarded and reach the sink
  zero times).
- **Proposed change**, in dependency order:
  1. `InlineStyle.flushDirty` gets the empty-bag guard its `StyleRule` sibling
     has (slice 01's fix; removes 27 of the 43 applies here).
  2. `StyleTarget.setMany` queues into `_dirty` and issues one `flushDirty` —
     one apply for four properties instead of four (16 → 4).
  3. `StyleTarget.set`/`setMany` skip a write whose value equals the last one
     written (slice 02's fix; takes the remaining 4 to 0 on an unchanged pass).
  4. `Component.setClipPath` guards on the last-written value, or `Border` stops
     re-asserting `null` per region per pass (slice 06 owns this).
  Steps 2 and 3 are the ones this slice adds; 1 and 4 are already reported.
- **Risk / blast radius**: `setMany` is called from `setClipFrame`, `createFrame`
  and every `writeStyle` bulk path — a batching change alters *ordering* of style
  writes relative to other sink ops, which `tests/dom/recorder.test.ts` and the
  `*.classStyleHoisting` / `*.styleRuleDisposal` suites observe by op sequence.
- **Proof at implement time**: rerun probe `09e` — settled `Window` pass should
  report 0 applies and 0 rule writes; and `ms/frame` on a WebKitGTK window
  border drag with the header on screen.

### F09.5 `fitNormalWindowToViewport` relayouts the whole window on every resize event, unconditionally

- **Category**: D
- **Impact**: MEDIUM-HIGH — per browser-resize *event* (a continuous stream
  during an OS window drag), per open normal-state window, front-most or not.
- **Where**: `overlay/AbstractWindow.ts:3082-3092` (`fitNormalWindowToViewport`),
  reached from `:3054-3057` (`onViewportResize`); listener attached for the
  window's life by `show()` (`:828`) via `:3016-3023`.
- **Hot path**:
  - browser `resize` → `Event` viewport dispatch → `onViewportResize()` (one per
    open window)
  - state `"normal"` → `fitNormalWindowToViewport()`
  - `clampRectToViewport(currentRect())` → `DOM.source.getViewportSize()`
    (forced layout) + `getMinSize()`
  - `setAutoCommitStyle(false)`; `setWidth`/`setHeight`/`setX`/`setY` — all four
    guarded, all four no-ops when the clamp changed nothing
  - **`this.doLayout()` — unconditional**
  - `setAutoCommitStyle(true)`
- **Evidence**: probe `09a`, test 6 — refit on a window that already fits:
  `{ setRuleStyles: 1, apply: 44 }`, `28 empty`, `{ getViewportSize: 1, … }`,
  and zero geometry change. Everything F09.4 measures is charged again here, per
  resize event. A window that is not front-most, and a docked-minimized window,
  pay the same (minimized takes the F09.6 branch instead); only a *rail*-minimized
  window is free, because `setWindowState` detaches its listener (`:1269`) and
  `setDisplayed(false)`s it (`:1278`).
- **Proposed change**: compare the clamped rect against `currentRect()` and
  return early when all four components are equal; only call `doLayout()` when
  something actually moved. The same guard belongs on `onViewportResize`'s
  maximized branch (`:3060-3067`), which re-writes the full-viewport rect on
  every event of a resize stream — there the rect genuinely changes per event,
  so keep the relayout but note it is the one legitimate per-event pass.
- **Risk / blast radius**: `AbstractWindow.normalViewportResize.test.ts` (4
  tests) asserts the resulting geometry, not that `doLayout` ran — test 1
  ("leaves an in-bounds window untouched") is exactly the case being
  short-circuited. `AbstractWindow.maximizeRestoreViewportClamp.test.ts` shares
  `clampRectToViewport` and is unaffected.
- **Proof at implement time**: a probe asserting 0 sink ops and 0 `doLayout`
  calls when `fitNormalWindowToViewport` runs on an unchanged viewport.

### F09.6 The minimized stack's viewport-resize handling is quadratic in minimized windows

- **Category**: A, D, I
- **Impact**: MEDIUM-HIGH when more than one window is minimized; the reads land
  interleaved with the previous window's `doLayout()` writes, which is the
  write-then-read shape the cost model calls the dominant JS-side cost.
- **Where**: `overlay/AbstractWindow.ts:2768-2789` (`relayoutMinimizedStack`),
  `:3045-3051` (`onViewportResize`'s minimized branch), `:2733-2743`
  (`getMinDockWidth` → `DOM.source.getThemeVar` →
  `getComputedStyle(documentElement)`).
- **Hot path**, one browser `resize` event, M minimized windows:
  - M separate `onViewportResize()` calls (one listener per window)
  - each → `AbstractWindow.relayoutMinimizedStack()` (static, whole set)
  - which loops all M minimized windows and, **inside the loop**, calls
    `win.getMinDockWidth()` (forced style recalc) and
    `DOM.source.getViewportSize()` (forced layout)
  - then `setX/setY/setWidth/setHeight` + `win.doLayout()` per window
  - → M² forced style recalcs, M² forced layouts, M × (per-window pass)
- **Evidence**: probe `09c`, test 4 — 4 minimized windows.
  One `relayoutMinimizedStack()` call: `{ getThemeVar: 4, getViewportSize: 4 }`,
  `{ setRuleStyles: 4, apply: 156 }`. One resize event (4 listeners firing):
  `{ getThemeVar: 16, getViewportSize: 16 }` — 32 forced document flushes and
  ~624 applies for a row of four 200×26 strips.
- **Proposed change**: (a) hoist `getViewportSize()` and the dock width out of
  the loop — the dock width is a theme constant, so cache it per theme change
  rather than reading `getComputedStyle` per window; (b) make the static relayout
  idempotent per event, e.g. have `onViewportResize`'s minimized branch run it
  only for the first minimized window in `openWindows` order, or coalesce it
  through a single rAF. (b) alone removes the quadratic factor.
- **Risk / blast radius**: `relayoutMinimizedStack` is also called from
  `onExitAction` (`:1077`), from all three `setWindowState` completion callbacks
  (`:1261`, `:1302`, `:1319`) and from the maximized resize branch (`:3069`).
  `AbstractWindow.minimizedViewportResize.test.ts` asserts the resulting stack
  geometry. `getMinDockWidth` is read nowhere else except `computeDockRect`.
- **Proof at implement time**: a probe counting `getThemeVar` + `getViewportSize`
  during one simulated resize event with M = 4 minimized windows — target
  ≤ 2 total, down from 32.

### F09.7 An open `Dialog` pays three forced document layouts and writes nothing per resize event

- **Category**: A, B
- **Impact**: MEDIUM — per viewport-resize event per open dialog. Loom uses
  `Dialog` heavily (27 `Dialog.error`, 7 `Dialog.show`, 2 `Dialog.confirm` call
  sites) and no `Window` at all, so this is the slice's most Loom-relevant path.
- **Where**: `overlay/Dialog.ts:1218-1222` (`onViewportResize`),
  `component/container/DialogBackdrop.ts:67-72` (`resize`),
  `overlay/Dialog.ts:884-904` (`resizeToContent`), `:999-1006` (`center`).
- **Hot path**:
  - browser `resize` → `Dialog.onViewportResize()`
  - `this._backdrop.resize()` → `DOM.source.getViewportSize()` **(read 1)** →
    `setWidth`/`setHeight` (writes)
  - `this.resizeToContent()` → `computeContentHeight()` →
    `contentComponent.getPreferredSize()` (uncached, per slice 05) →
    `DOM.source.getViewportSize()` **(read 2, after write)** → `setHeight` +
    `scheduleLayout` + `center()` → `getViewportSize()` **(read 3)** when the
    height changed
  - `this.center()` — called again unconditionally → `getViewportSize()`
    **(read 3 or 4, after write)**
- **Evidence**: probe `09c`, tests 2 and 3 — `per resize event sink ops: {}`,
  `source: { getViewportSize: 3 }`, and identically on a repeat with an unchanged
  viewport. All three reads produce nothing: the dialog is already centred and
  already the right height.
- **Proposed change**: read the viewport size **once** per event and thread it
  through `backdrop.resize(vp)` / `resizeToContent(vp)` / `center(vp)`; drop
  `onViewportResize`'s second `center()` call (`resizeToContent` already
  re-centres when it changed the height, and when it did not, nothing moved).
  With F09.8 applied the backdrop read disappears entirely, leaving one read
  per event.
- **Risk / blast radius**: `DialogViewportResize.test.ts` (2 tests),
  `DialogCappedScroll.test.ts`, `DialogWrappingRefit.test.ts` and
  `Dialog.test.ts`'s four `resizeToContent` tests all assert resulting geometry.
  `resizeToContent` is public API (`docs/components/Dialog.md`) and is also
  called from `Component.afterNextLayout` in `open()` — keep its no-argument
  form.
- **Proof at implement time**: rerun probe `09c` test 3 — `getViewportSize`
  should be 1 (or 0 with F09.8), sink ops still `{}`.

### F09.8 The backdrop is a viewport-sized surface re-geometried in JS instead of pinned with `inset: 0`

- **Category**: F, H
- **Impact**: MEDIUM — per resize event, and it is the largest single painted
  surface either overlay family owns.
- **Where**: `component/container/DialogBackdrop.ts:42-50` (constructor),
  `:67-72` (`resize`); consumers `overlay/Dialog.ts:1219` and
  `overlay/Drawer.ts:640`.
- **Evidence**: the backdrop is `position: fixed` at `(0,0)` with
  `width`/`height` written from `DOM.source.getViewportSize()` at construction
  and on every resize. Its fill is `var(--ts-ui-dialog-backdrop-bg)` =
  `rgba(0,0,0,0.45)` (Modern/Classic) / `rgba(0,0,0,0.65)` (Dark) —
  `core/themes/{Modern,Classic,Dark}Theme.ts:285-291`. A repo-wide grep for
  `backdrop-filter` / `backdropFilter` across `packages/` returns **zero hits**.
  So the surface is translucent but not blurred: its cost is one full-viewport
  alpha composite per repaint, and its geometry is rewritten per resize event.
- **Proposed change**: give the backdrop `inset: 0` (or `width: 100vw;
  height: 100vh`) once at construction and delete `resize()` along with both its
  call sites. The element then tracks the viewport with no JS, no
  `getViewportSize()` read and no geometry write — and, because its box stops
  changing, no resize-driven repaint of the full-viewport surface.
- **Risk / blast radius**: `resize()` has exactly two callers (`Dialog`,
  `Drawer` — slice 10). `DialogBackdrop` writes through typed setters only and is
  listed as safe in `plans/dom-only-state-inventory.md:286`; `inset` has no typed
  setter today, so this needs either one or a `setElementStyle` on the
  subclass. No test asserts the backdrop's pixel size.
- **Proof at implement time**: a probe asserting zero sink ops and zero
  `getViewportSize` reads from the backdrop across a simulated resize.
- **Positive to protect**: no blur and no `backdrop-filter` anywhere — do not
  let a future "frosted glass" backdrop land without measuring it in WebKitGTK.

### F09.9 Every window-state transition re-sets a glyph the button already carries

- **Category**: B, C
- **Impact**: MEDIUM — per minimize / maximize / restore, on a `Window`. Each
  redundant `Button.setGlyph` is a stylesheet insert + delete (slice 13: 37 sink
  ops, identical whether the name changed).
- **Where**: `overlay/Window.ts:219-222` (`reflectMaximizeState`), called from
  `overlay/AbstractWindow.ts:1244`, `:1268`, `:1313`.
- **Hot path**: `setWindowState(s)` → `reflectMaximizeState(s)` →
  `_header.setMaximizeButtonGlyph(...)` **and** `_header.setMinimizeButtonGlyph(...)`
  → `WindowHeader:459/477` → `Button.setGlyph(name)` — unguarded on both.
- **Evidence**: probe `09a`, test 4 — one `reflectMaximizeState("maximized")`:
  `{ removeElement: 6, apply: 32, createElement: 2, createElementNS: 8,
  appendChild: 8, setId: 2, ensureStyleRule: 2, setRuleStyles: 2,
  insertBefore: 4, deleteStyleRule: 2, release: 6 }`, with the spy showing
  `setMinimizeButtonGlyph` called with `"window-minimize"` — the value it
  already held. Exactly half of that is waste: 1 `ensureStyleRule` +
  1 `setRuleStyles` + 1 `deleteStyleRule` (three shared-stylesheet mutations) +
  ~16 applies + 4 SVG element creations, every transition.
- **Proposed change**: a same-name guard on `Button.setGlyph` is the correct
  upstream fix (slice 13 owns it, and slice 18's `Glyph.setName()` is the deeper
  one). The slice-09-local half-measure is to have `reflectMaximizeState` write
  only the glyph whose state actually changed — but prefer the upstream guard:
  it fixes `ScrollStrip.layoutArrows` and `VideoPlayer.syncFromState` too.
- **Risk / blast radius**: `TabWindow.reflectMaximizeState` is a deliberate
  no-op (`overlay/TabWindow.ts:236-238`), so only `Window` is affected.
  `AbstractWindow.windowMenu.test.ts` ("Minimize/Maximize/Close carry the same
  glyph their header button shows, in each window state") pins the resulting
  glyph names, not the write count.
- **Proof at implement time**: rule-mutation count per `setWindowState`
  transition, target 0 for the unchanged button.

### F09.10 `chromeMinSize()` is rebuilt from uncached size reports twice per resize frame

- **Category**: D
- **Impact**: MEDIUM — per resize frame, and the inputs cannot change during a
  drag.
- **Where**: `overlay/AbstractWindow.ts:770-780` (`setWidth`), `:790-800`
  (`setHeight`), `:716-727` (`chromeMinSize`); `overlay/Window.ts:247-249`
  (`minContentWidthSeed`); `component/container/WindowHeader.ts:585-590`
  (`getMinContentWidth`).
- **Hot path**: `applyResizeFrame` → `setWidth(...)` → `chromeMinSize()` →
  `minContentWidthSeed()` → `_titleGlyph.getPreferredSize()` +
  `_trailingRow.getPreferredSize()` → `HBox.getPreferredSize` → 3 ×
  `Button.getPreferredSize()` (slice 13: re-derived live, no memo). Then
  `setHeight(...)` does the whole thing again.
- **Evidence**: probe `09b`, test 5 — one `applyResizeFrame` on a SOUTHEAST
  drag: `getMinContentWidth calls per resize frame: 2`,
  `trailingRow.getPreferredSize per frame: 3`. Every input
  (`_titleGlyph`, the three trailing buttons, the 100 px text budget, the
  border widths, the insets) is constant for the whole drag.
- **Proposed change**: memoise `chromeMinSize()` on the window, invalidated by
  `setGlyph`/`clearGlyph`, `setMinimizable`/`setMaximizable`, `setInsets`,
  `setBorder` and a theme change (the window already subscribes to theme via
  `_boundOnThemeReflow`, `:444`). `TabWindow.minContentWidthSeed` and
  `chromeHeight` are already constants (`overlay/TabWindow.ts:25,33`), so only
  `Window` pays this.
- **Risk / blast radius**: `setWidth`/`setHeight` are public and are also the
  clamp path for `applyRect` (used by `LayoutSerialization:594`) and the
  minimize dock shrink — `AbstractWindow.minimizeMinSize.test.ts` (4 tests)
  pins the min-size relax/restore round trip, which goes through
  `Component.setMinSize`, not `chromeMinSize`. A stale memo would show as a
  window that can be dragged below its chrome floor after a glyph change.
- **Proof at implement time**: a probe asserting 0 `getMinContentWidth` calls
  across 10 consecutive `applyResizeFrame` calls after the first.

### F09.11 The move drag is not rAF-coalesced — and what it gets right (slice 10's precedent, verified)

- **Category**: A (the read), plus the **positive to protect**
- **Impact**: MEDIUM — one forced document layout per raw `mousemove`, which in
  WebKitGTK can arrive several times per painted frame.
- **Where**: `overlay/AbstractWindow.ts:2357-2381` (`onDrag`), listener
  registered at `:2094-2095`; the read is `:2270-2288`
  (`viewportPositionBounds` → `DOM.source.getViewportSize()`), reached from
  `:2296-2328` (`clampDragDelta`).

**The pattern slice 10 cited — verified, and this is the precise shape to copy:**

  - `onDrag` calls `this.setWillChange("transform")` on **every** move, and
    `Component.setWillChange` (`core/Component.ts:5354-5365`) early-returns on
    an unchanged value — so only the first move of a drag writes the hint. It is
    deliberately *not* set in `startMoveFrom`: a plain click never reaches
    `onDrag` and so never pays for a layer (comment at `:2358-2365`; pinned by
    `AbstractWindow.dragWillChangeOnMove.test.ts`).
  - motion is committed with `this.setTranslate(dx, dy)`
    (`core/Component.ts:4647-4662`), which (a) early-returns when both
    components are unchanged, (b) writes through `setElementStyle` →
    `InlineStyle` → `DOM.sink.apply` — an **inline** style write, **not** a
    `StyleRule` mutation, so it never restyles the document (contrast slice 27's
    `Component.setTransform`, which targets the `#id` rule), and (c) writes
    `translate3d(x,y,0)` rounded to whole pixels.
  - the cached `left`/`top` are deliberately **not** touched during the drag;
    `onMouseUp` (`:2388-2400`) commits `setX`/`setY`, then `setTranslate(0, 0)`
    (which writes `transform: null`) and `setWillChange(null)` to release the
    layer.
  - nothing else runs: no `doLayout`, no `scheduleLayout`, no rule write.

  **Evidence**: probe `09b`, test 4 — one mid-drag `mousemove`:
  `drag sink ops: { apply: 1 }`,
  `writes: [["apply", {"style": {"transform": "translate3d(20px,20px,0)"}}]]`,
  `source: { getViewportSize: 1 }`. One apply, one property, zero rule
  mutations, zero layout passes. Any plan copying this pattern must copy all
  four parts — promote lazily on first motion, write inline (not through the
  rule), guard on the unchanged value, and release the hint on gesture end.

**The blemish**: `onDrag` is a raw viewport `mousemove` handler with no rAF
coalescing, while the *resize* drag in the same class routes through
`PerFrameCoalescer` and the *snap* preview through `_snapMoveCoalescer`. Each
raw move therefore costs one `getViewportSize()` = `documentElement.clientWidth`
= forced document layout, landing after the previous move's transform write.

- **Proposed change**: route `onDrag` through a third `PerFrameCoalescer`
  (buffering `{clientX, clientY}`, no fps cap), exactly as `onSnapMouseMove`
  does, with a `forceFlush()` in `onMouseUp` before the `setX`/`setY` commit.
  Separately, cache the viewport size for the duration of a drag — it cannot
  change mid-gesture, and the window already has a viewport `resize` listener to
  invalidate it.
- **Risk / blast radius**: `onDrag`'s return value `{stop: true, prevent: true}`
  suppresses native text selection and must still be returned synchronously from
  the listener, so the coalescer must wrap only the *apply*, not the handler.
  `AbstractWindow.dragWillChangeOnMove.test.ts` and
  `Window.headerMoveTrigger.test.ts` drive `onDrag` directly and would need a
  drain step. `_dragDX`/`_dragDY` are read by `onMouseUp`, so the buffered value
  must be flushed before commit — `forceFlush()` exists for exactly this.
- **Proof at implement time**: a probe asserting ≤ 1 `getViewportSize` and ≤ 1
  apply per animation frame across N mousemoves in one frame.

### F09.12 `setWindowControlsActive` writes `backgroundImage` through an unguarded setter

- **Category**: C, B
- **Impact**: MEDIUM-LOW — 3 shared-stylesheet mutations per window activation
  change (each a full-document restyle in the target engine), on both `Window`
  and `TabWindow`.
- **Where**: `overlay/windowControls.ts:181-189`;
  `component/container/WindowHeader.ts:340-350` (`setActive`);
  `overlay/TabWindow.ts:248-265` (`paintActive` / `setControlsActive`).
- **Hot path**: `LayerManager.markActive` → `AbstractWindow.onActivate(true)` →
  `paintActive(true)` → `setWindowControlsActive([min, max, close], true)` →
  per button `setBackgroundColor` (**guarded**, `core/Component.ts` — returns
  early on an equal `_instanceStyle.backgroundColor`) + `setBackgroundImage`
  (**unguarded** — straight to `writeStyle`, i.e. the component's `#id` rule).
- **Evidence**: read of `Component.setBackgroundImage` — no guard, unlike its
  `setBackgroundColor` sibling; this is a concrete instance of slice 02's "15
  guarded, 15 not". `LayerManager.markActive` (`core/LayerManager.ts:544-556`)
  *does* dedupe on `_activeLayer === layer`, so `paintActive` fires only on a
  real activation change — which is what keeps this MEDIUM-LOW rather than
  per-mousedown. Note `AbstractWindow.restore()` (`:1409-1419`) calls
  `bringToFront()` on a window that is usually already active, so that path is
  already an activation no-op.
- **Proposed change**: add the missing unchanged-value guard to
  `Component.setBackgroundImage` (slice 02's fix), which removes 3 same-valued
  rule mutations from every repeat activation paint across both window kinds
  and from `WindowHeader.setActive`'s own background swap.
- **Risk / blast radius**: `setBackgroundImage` is called from many places; a
  guard changes nothing observable but can change recorded op order in
  `*.classStyleHoisting` tests.
- **Proof at implement time**: rule-mutation count for two consecutive
  `paintActive(true)` calls — target 0 on the second.

### F09.13 `doLayout` writes the south strip's height from the *right* inset

- **Category**: J (latent correctness), LOW
- **Where**: `overlay/AbstractWindow.ts:2466` —
  `this._borderComponents.south.setHeight(insets.getRight());`
  Every sibling uses the matching side (`southeast` and `southwest` both use
  `insets.getBottom()`, `:2461` / `:2471`).
- **Evidence**: invisible today because `_defaultWindowOptions.insets`
  (`:202`) is a uniform 4 px `Insets`, so `getRight() === getBottom()`. A
  consumer passing asymmetric `insets` gets a mis-sized south grab strip. The
  same asymmetry assumption is baked into `horisontallBorderWidth` /
  `verticalBorderWidth` (`:2412-2413`, which fold only `getLeft()` / `getTop()`)
  and into `chromeMinSize` (`:720-721`) — the latter documents the choice, the
  former does not. (`horisontallBorderWidth` is also misspelled.)
- **Proposed change**: use `insets.getBottom()`; decide explicitly whether
  asymmetric window insets are supported and either fold both sides per axis or
  document the constraint in `WindowOptions`.
- **Risk**: none at the default insets; no test covers asymmetric window insets.
- **Proof at implement time**: a probe constructing a window with
  `new Insets(2, 8, 6, 4)` and asserting each strip's rect matches its edge.

### F09.14 Snap keyboard listeners stay installed for the window's whole life

- **Category**: G, LOW
- **Where**: `overlay/AbstractWindow.ts:866-868` (`show`), `:3139-3148`
  (`attachSnapKeyboardListeners`), `:3219-3239` (`onSnapKeyDown`).
- **Evidence**: probe `09c`, test 5 — `_snapKeysAttached: true` immediately
  after `show()`. Three viewport listeners (`keydown`, `keyup`, `blur`) per open
  window, for the window's lifetime. Every keystroke anywhere in the app —
  including every character typed into a Loom editor — dispatches into every
  open window's `onSnapKeyDown`. The handler itself touches no DOM (six option /
  field reads then an early return), so the per-call cost is negligible; the
  charge is `Event`'s own viewport dispatch and subtree walk (slice 03), paid
  per open window per keystroke.
- **Proposed change**: nothing urgent. If `Event` gains a modifier-filtered
  viewport registration, use it here: the listener only ever acts on a keydown
  whose configured modifier is held. Record it so a future `Event` change knows
  this consumer exists.

### F09.15 `DialogButtonRow` documents right-alignment and implements centring, at a fixed width

- **Category**: H, LOW
- **Where**: `overlay/Dialog.ts:420-423` (class JSDoc: "Lays out one or more
  buttons, right-aligned"), `:538-541` (`doLayout` JSDoc: "Positions buttons
  right-aligned"), `:554` — `let x = Math.round((box.width - totalW) / 2);`
  which centres them. Each button is pinned to `BUTTON_WIDTH = 90`
  (`:156`, `:559`) regardless of its label, so a long label clips.
- **Proposed change**: fix the two JSDoc blocks to say "centred"; separately,
  consider deriving each button's width from its own `getPreferredSize()` with
  90 as a floor. Note the whole row is a hand-rolled `doLayout` over an
  `Absolute` manager that then calls `btn.doLayout()` per button per pass
  (`:562`) — an `HBox` with `AnchorType.CENTER` would do the same job, but see
  slice 14's warning that a general manager on a fixed row is itself a cost.

### F09.16 `AbstractWindow`'s responsibility split is sound; its surface is over-built

- **Category**: H
- **Where**: `overlay/AbstractWindow.ts` (3,405 lines).

The split with `Window` / `TabWindow` / `WindowHeader` is the part that works and
should not be disturbed: eight abstract/virtual hooks (`wireMoveTrigger`,
`reflectCloseable`, `reflectMinimizable`, `reflectMaximizable`,
`reflectMaximizeAvailability`, `reflectMaximizeState`, `paintActive`,
`getTitle`, `minContentWidthSeed`, `chromeHeight`, `addContent`,
`isChromeComponent`) cleanly separate chrome from machinery, and both subclasses
are small (433 and 330 lines) and implement every hook with one or two lines.
`Dialog` deliberately shares nothing with them, which is correct — it is modal,
non-draggable, non-resizable and has no window state.

What is over-built, all small individually:

| Area | Lines | Observation |
|---|---|---|
| Rail genie (`railGenieTransform`, `animateRailCollapse`, `animateRailExpand`) | `:2613-2725` (113) | Three methods and two animation handles for one consumer (`overlay/Rail.ts`, slice 10). `railGenieTransform` reads `getViewportSize()` twice in one call (`:2646`, `:2658`) on two of its four branches. |
| Large-resize fade (`animateRect`, `isLargeRectChange`, `fadeRectSwap`, `startFadeIn`, `beginStateAnimation`, `endBodyFade`, `commitRect`, `tweenRect`) | `:2805-3006` (201) | The most intricate machinery in the file, for one visual case. It is **load-bearing and correct** — pausing the body host's layout for the glide is the right call under the cost model — and `AbstractWindow.largeResizeFade.test.ts` pins 14 behaviours including cancel-mid-glide resume. Do not simplify without re-reading that suite. |
| Snap resize (`_snapEnabled` … `onSnapMouseDown`) | `:3133-3404` (271) | 8% of the file for a grab-affordance widener. Contains F09.3. `setSnapThreshold` / `setSnapModifier` have no in-library caller. |
| Window menu (`buildWindowMenuItems`, `openWindowMenu`, `refreshWindowMenuMaximizeAvailability`) | `:1694-1897` (~100) | Justified: rebuilt per open, lazily constructed, disposed in `destructor`, and `refreshWindowMenuMaximizeAvailability`'s index arithmetic (`:1715`) is fragile but documented and tested. |

`WindowHeader` carries a second, redundant copy of the closeable / minimizable /
maximizable state the base already owns (`component/container/WindowHeader.ts:104-106`);
see the dead-code section.

**Features with no in-library, docs-app, create-app or Loom user**: see the next
section. In Loom specifically, `Dialog` is used at 36 call sites and `Window` /
`TabWindow` at none directly — a `TabWindow` reaches Loom only through
`Tab`'s tear-off (`layout/Tab.ts:2500`) and `Dock`'s floats. So for the target
app, F09.7 / F09.8 (Dialog) outrank F09.2 / F09.5 (Window), while F09.1 fires on
every tear-off.

## Entity inventory

| Entity | Stated function | Owns DOM | Per-layout-pass writes/reads | Verdict | Findings |
|---|---|---|---|---|---|
| `AbstractWindow` (`overlay/AbstractWindow.ts:346`) | Header-agnostic floating-window machinery: 8 resize strips, move, 3-state lifecycle, z-order, show/hide, open-window registry | Own element + 8 `WindowBorder` elements raw-appended in `render()` (not registered children); 1 lazily-built `Menu` | Settled pass: 43 applies (27 empty) + 1 `setRuleStyles({clipPath:null})`, 0 source reads. Resize frame: +1 batched apply, +1 `getViewportSize`. Move frame: 1 apply, 1 `getViewportSize` | over-built (sound split, large surface) | F09.1, F09.2, F09.4, F09.5, F09.6, F09.10, F09.11, F09.13, F09.14, F09.16 |
| `PerFrameCoalescer` (`:238`, module-private) | Buffer the latest high-frequency value, apply once per frame with an optional fps cap | none | none | fits, but mis-placed and mis-defaulted | F09.2; duplication item below |
| `Window` (`overlay/Window.ts:42`) | `AbstractWindow` + `Border` layout + `WindowHeader` NORTH + Shift-drag re-dock source | none of its own (delegates to header) | none beyond the base | fits | F09.9, F09.10 |
| `TabWindow` (`overlay/TabWindow.ts:60`) | Headerless window whose layout manager *is* a `Tab`; bar doubles as chrome | none of its own (3 tool buttons + 1 lead glyph live in the `Tab` bar) | none beyond the base | fits | F09.12; `isChromeComponent` override is redundant |
| `WindowHeader` (`component/container/WindowHeader.ts:95`) | `Header` + trailing min/max/close row + leading title icon + active paint | Inherits `Header`'s `Border`; adds a title cell (`Fit`), a title row (`HBox`), a trailing row (`HBox`), 3 buttons, 1 glyph | 2 clip-frame commits (8 applies, all unchanged) + the inherited `Header` clipPath rule write per pass (slice 14) | over-built (duplicate state) | F09.4, F09.9, F09.10, F09.12 |
| `WindowHeaderTitleGlyph` (`WindowHeader.ts:71`) | `Glyph` opted into `GLYPH_MD_INK_TRAIT` so title icons share one rule | 1 SVG | re-pinned `setPreferredSize` on every `updatePreferredSize` (theme change + construction) | fits | — |
| `WindowBorder` (`component/container/WindowBorder.ts:81`) | One edge/corner resize strip: cursor, `mousedown` → viewport drag, snap-target class | 1 `<div>` | 4 guarded geometry setters + 1 empty apply per pass (from the base's `setAutoCommitStyle` toggle) | over-built (unused options, dead members) | F09.3, F09.4, F09.13; dead-code items |
| `DialogBackdrop` (`component/container/DialogBackdrop.ts:29`) | Full-viewport fixed scrim under a modal | 1 `<div>` | none per pass; 1 `getViewportSize` + 2 writes per resize event | mismatch (JS-sized what CSS pins) | F09.7, F09.8 |
| `Dialog` (`overlay/Dialog.ts:638`) | Modal panel: title bar, scrolling content, button row, promise result | Own element + backdrop (private field, not a child) | none per pass of its own; 3 `getViewportSize` per resize event | fits | F09.7, F09.8 |
| `DialogTitleBar` (`Dialog.ts:224`) | Title text + optional leading glyph + optional close button | none beyond children | Hand-rolled `doLayout`: 1 `getContentBounds()` (→ 1 `Insets` alloc, slice 28), 8-12 guarded setters, 1 unconditional `_closeButton.doLayout()` | fits | — |
| `DialogButtonRow` (`Dialog.ts:424`) | Footer button row + `onClick` guard + Enter-confirm | none beyond children | Hand-rolled `doLayout`: 1 `getContentBounds()`, 4 setters + 1 `doLayout()` per button per pass | mismatch (doc says right-aligned, code centres) | F09.15 |
| `createWindowControlButton` / `WindowControlButton` (`overlay/windowControls.ts:47,145`) | Shared min/max/close control button with themed `window.control` chrome | 1 `<button>` each | none per pass | fits | — |
| `createWindowLeadGlyphButton` / `WindowLeadGlyphButton` (`:107,159`) | The window-menu trigger, a transparent size-peer of the controls | 1 `<button>` | none per pass | fits (single consumer: `TabWindow`) | — |
| `setWindowControlsActive` (`:181`) | Flatten/restore 3 control fills on blur/focus | none | 3 guarded + 3 **unguarded** style writes per activation change | fits, blocked on an upstream guard | F09.12 |
| `DialogButtons` / `DEFAULT_BUTTONS` (`Dialog.ts:601,613`) | Canonical button presets binding text→result→glyph→tint | none | none | fits | — |

## Redundant, duplicated and dead code

Counts are `grep -rn <symbol> --include=*.ts` over `packages/` (lib source, lib
tests, docs app `lib/src/typescript/*.ts`, `create-app`), with the defining line
excluded from the "callers" count. Loom checked separately at
`/home/jika/typescript/loom/src`.

**Zero callers anywhere (dead):**

- `AbstractWindow.getResizeFps()` (`:2161-2163`) — 1 hit, its own definition.
  `setResizeFps` (`:2172`) has 1 caller, a test
  (`AbstractWindow.resizeFpsCoalescing.test.ts:185`), and none in production.
- `WindowBorder.isSnapTarget()` (`component/container/WindowBorder.ts:225`) — 1
  hit, its own definition. The `_snapTarget` field it reads is otherwise used
  only by `render()`'s replay.
- `WindowBorder.setDirection()` (`:154-162`) — 0 callers (all `setDirection`
  hits in the repo belong to `CollapseButton` / `SplitGutter`). Its guard
  `if (!direction) direction = Direction.NORTH` is also broken by construction:
  `Direction.NORTH === 0`, so the guard treats an explicit NORTH as "missing".
  The constructor has the same latent bug (`:113-115`, `if (direction)`), which
  works only because the field default is already NORTH.
- `WindowBorderOptions` and `WindowBorder`'s `options` / `subclassDefaults`
  constructor parameters — every one of the 10 construction sites in the repo is
  `new WindowBorder(direction)` with no second argument, so the `listeners` bag
  and `applyListeners(options?.listeners)` (`:137`) never fire.
  `WindowBorderOptions` has 7 hits, all inside `WindowBorder.ts` itself.
- `DialogBackdropOptions` — 5 hits, all inside `DialogBackdrop.ts`; an empty
  interface plus an empty `_defaultDialogBackdropOptions` const, never supplied
  by either consumer.
- `AbstractWindow.modifierStillHeld(e)` (`:3280-3282`) — a one-line alias of
  `modifierMatches(e)` with a comment implying the two differ ("Some browsers
  fire keyup with a different key field when modifiers chord"). They do not.
  One caller (`onSnapKeyUp:3252`).
- `AbstractWindow.onMouseDown(e)` (`:2034-2036`) — a public one-line
  pass-through to `startMoveFrom`, with exactly one caller
  (`overlay/Window.ts:294`). `TabWindow` calls `startMoveFrom` directly.
- `TabWindow.isChromeComponent()` (`overlay/TabWindow.ts:320-322`) — overrides
  the base (`AbstractWindow.ts:745-747`) to return the base's own default.
- `WindowHeader._closeable` / `_minimizable` / `_maximizable` (`:104-106`) and
  their getters `isCloseable` / `isMinimizable` / `isMaximizable` /
  `isMaximizeButtonEnabled` (`:373`, `:396`, `:419`, `:446`) — the three fields
  are written by the setters and read **only** by those getters, which are
  called only from `AbstractWindow.locked.test.ts` (6 hits) and
  `AbstractWindow.closeable.test.ts`. The authoritative state lives in
  `AbstractWindow._options`, and `isMinimizable`/`isMaximizable` there fold in
  the `resizable` master switch — so the header's copies can disagree with the
  base and no production code would notice. Delete the fields and the three
  boolean getters, or make the header's getters delegate to its buttons
  (`isMaximizeButtonEnabled` already does).

**No-op round trips at construction:**

- `initChrome:536` — `this.setMaximizeBounds(this.getMaximizeBounds())`, which
  reads `_options.maximizeBounds ?? default` and writes it straight back into
  `_options`. `setMaximizeBounds` has no side effect beyond that write
  (`:1907-1911`).
- `applyOptions:590-594` — `setSnapResizeEnabled(options.x ?? this.getX())`,
  `setSnapThreshold`, `setSnapModifier`, `setConstrainToViewport` — the same
  read-then-write-back shape four more times. Only `setSnapResizeEnabled` has a
  real side effect, and it is guarded (`:1932`).

**Duplication:**

- `PerFrameCoalescer` (`AbstractWindow.ts:238-327`) is a clean, documented,
  reusable rAF coalescer that is module-private to `AbstractWindow.ts` and used
  twice inside it. The identical pattern is hand-rolled in at least five other
  places, each with its own comment naming `Split.scheduleDrag`/`flushDrag` as
  the model: `layout/Split.ts:1412-1441`, `layout/Accordion.ts:1960`,
  `component/container/ScrollStrip.ts:566-611`, `core/Panel.ts:712-770`,
  `component/shared/VirtualRowView.ts:585-629`. Hoisting
  `PerFrameCoalescer` to `core/` and collapsing those five onto it is a
  library-wide simplification that this slice is the natural donor for.
- `WindowBorder` / `SplitGutter` share the `dragCursor()` + `beginViewportDrag`
  / `endViewportDrag` lifecycle shape but not the code
  (`WindowBorder.ts:263-312` vs `SplitGutter.ts:605-668`). **Carried from
  `plans/research/codebase-health-audit-2026-08-29.md` Priority 2, item 9 —
  verified still open.**
- `Dialog.applyHeaderVariant` (`:786-806`) and `Dialog.applySeverityHeader`
  (`:816-829`) are the same four steps (background, title-text foreground,
  leading glyph, glyph foreground) written twice; the only difference is that
  the variant path skips the glyph for `'affirm'` and returns early for
  `'plain'`.

**Closed audit item**: the 2026-08-29 audit's "`windowControls.ts` claiming a
helper is shared by two consumers when only one remains" no longer holds —
`createWindowControlButton` is used by both `WindowHeader.ts:168-170` and
`TabWindow.ts:95-97`, and `setWindowControlsActive` by both focus hooks. The
doc comments match the current consumer set.

**Doc / code mismatches:**

- `docs/components/AbstractWindow.md:5` — "`AbstractWindow` extends
  [`Panel`]". It extends `Container` (`AbstractWindow.ts:346`), and the
  `WINDOW_BODY_INSET_PX` comment (`:24-29`) documents the move away from
  `Panel`. `docs/components/Window.md:53` and `TabWindow.md:44` inherit the same
  error ("Inherits all `PanelOptions` / `ComponentOptions` fields" —
  `WindowOptions extends ContainerOptions`, which adds nothing to
  `ComponentOptions`, so no `PanelOptions` field is available).
- `overlay/Dialog.ts:420-423` and `:538-541` — "right-aligned" vs a centring
  implementation (F09.15).

## Cross-slice notes

- **→ 01 core-component-lifecycle**: `InlineStyle.flushDirty`
  (`core/StyleTarget.ts:457-459`) still lacks the empty-bag guard its
  `StyleRule` sibling has at `:404-410`. Measured here: **27 of the 43 applies
  on a settled `Window` layout pass are empty**, 8 of them from the eight
  `setAutoCommitStyle(false)/(true)` pairs in `AbstractWindow.doLayout`. Also,
  `Component.getElement()`'s `DOM.source.getElementById(this.getId())` fallback
  (`core/Component.ts:1288`, `:6658`) fired **277 times** during one minimal
  `Dialog.show()` (probe `09c` test 1) — in production that is 277
  `document.getElementById` calls to open one dialog.
- **→ 01 / 02**: `StyleTarget.setMany` (`core/StyleTarget.ts:44-47`) loops
  `set()`, so an attached target issues **one `DOM.sink.apply` per property**.
  `Component.setClipFrame`'s four-property write therefore costs 4 applies, and
  since `StyleTarget` has no last-written-value filter, all four are re-issued
  with unchanged values on every settled pass. On a `Window` that is 16 applies
  per pass across four clip frames (probe `09e`). Batching `setMany` into one
  `flushDirty` and adding the value filter fixes it for every clip-framed
  container in the library, not just windows.
- **→ 02 core-component-styling**: `Component.setBackgroundImage` is one of the
  unguarded half. Named consumer on a state path: `setWindowControlsActive`
  (`overlay/windowControls.ts:181-189`), 3 rule mutations per window activation
  change. `Component.setClipPath` (`core/Component.ts`, → `setElementCSSRule`)
  is likewise unguarded; measured 1 same-valued `setRuleStyles({clipPath:null})`
  per settled `Window` pass.
- **→ 03 core-dom-seam-events**: `DOMSource.getViewportSize()` call sites in
  this slice: `AbstractWindow` × 7 (`:2206`, `:2272`, `:2576`, `:2597`,
  `:2646`, `:2658`, `:2777`, `:3112`), `Dialog` × 2 (`:892`, `:1000`),
  `DialogBackdrop` × 2 (`:42`, `:68`). Two are per-frame (`applyResizeFrame`,
  `clampDragDelta`), one is per-minimized-window-inside-a-loop (`:2777`). Every
  open window and every open dialog registers its own viewport `resize`
  listener, so slice 03's "one read per registered viewport listener, the later
  ones landing after earlier handlers' writes" is exactly what F09.6 and F09.7
  measure. Also: each shown window keeps three viewport keyboard listeners
  (`keydown`/`keyup`/`blur`) for its whole life (F09.14).
- **→ 06 layout-split-border-dockregion**: `Border.ts:1272`'s
  `north.setClipPath(null)` is the single rule mutation a settled `Window` pass
  makes. A `Window` nests two `Border`s (the window's own NORTH/CENTER and the
  header's WEST/EAST), so slice 06's per-region clip-path cost is charged twice
  per window on screen.
- **→ 10 overlay-dock-drag-rail-drawer**: slice 10's precedent claim about
  `AbstractWindow`'s header drag is **confirmed** — see F09.11 for the exact
  four-part pattern and the probe numbers (1 apply, 1 property, 0 rule
  mutations, 0 layout passes per move frame). One correction to add when
  citing it: the *writes* are exemplary, but the path is **not** rAF-coalesced,
  so it still pays one `getViewportSize()` forced layout per raw mousemove. Also
  for slice 10: `DialogBackdrop` is shared with `Drawer` (`Drawer.ts:588-640`),
  so F09.8's `inset: 0` change removes `Drawer.ts:640`'s resize call too; and
  `Rail` is the sole consumer of `AbstractWindow`'s 113-line genie-transform
  block.
- **→ 13 button-glyph-image**: `Button.setGlyph`'s missing same-name guard has
  another per-event caller here — `Window.reflectMaximizeState` (`Window.ts:219-222`)
  re-sets one unchanged glyph on every window-state transition (F09.9). Also,
  `WindowHeader.getMinContentWidth` drives 3 `Button.getPreferredSize()` calls
  twice per window resize frame (F09.10), which is a live instance of slice 13's
  "no memo" finding on a hot path.
- **→ 14 text-and-small-display**: confirmed and extended. Slice 14's
  `Header`/`WindowHeader` finding holds; measured at the whole-`Window` level, a
  settled pass produces exactly **1** stylesheet-rule mutation (`clipPath`), and
  the "unchanged geometry applies" are clip-frame writes from
  `StyleTarget.setMany`, not component geometry —
  `Component.setX`/`setY`/`setWidth`/`setHeight` are guarded and reach the sink
  zero times on an unchanged pass.
- **Doc contract that does not hold**: `docs/concepts/performance.md:137` says
  "Every `getSize()` call forces a flush so the read is up-to-date". It does
  not — `Component.getSize()` is a two-field read with no flush. Several places
  in this slice (`currentRect`, `getWidth`/`getHeight` in `applyResizeFrame`)
  rely on the actual, cheap behaviour, so the doc is the thing that is wrong.
- **Open plans**: `plans/dom-only-state-inventory.md:86` already catalogues
  `AbstractWindow.render()`'s raw-appended border strips as `accept-loss`
  (self-healing via the `render()` override) and `:286` lists `DialogBackdrop`
  and `WindowBorder` as replay-safe. Nothing proposed here contradicts that;
  F09.1 moves `mount` earlier in `show()`, which does not change what `render()`
  appends. No other open plan touches this slice's files.

## Suggested plan grouping

**Plan A — "window open and window resize stop paying for nothing"** (this
slice's largest user-visible win; self-contained, no cross-slice dependency)
- F09.1 (`show()` mounts before laying out)
- F09.2 (default resize-fps cap)
- F09.5 (`fitNormalWindowToViewport` early-return on an unchanged rect)
- F09.10 (memoise `chromeMinSize`)
Measured together on: `getThemeVar` count across one `show()`; applied frames
per second on a WebKitGTK border drag; sink ops + `doLayout` count for one
viewport-resize event on an already-fitting window.

**Plan B — "the snap-resize affordance stops reading the DOM"** (smallest,
highest confidence, independent)
- F09.3 (`pickSnapBorder` from cached geometry)
- rides along: F09.13 (south strip inset), the `WindowBorder` dead members and
  unused options bag, `modifierStillHeld`, `onMouseDown`,
  `TabWindow.isChromeComponent`, and `WindowHeader`'s duplicate boolean state.
Measured on: `DOM.source.getElementRect` calls per snap frame (8 → 0).

**Plan C — "dialog and backdrop stop re-measuring the viewport"** (the
Loom-relevant one; touches `Drawer`, so coordinate with slice 10)
- F09.7 (one viewport read per resize event; drop the duplicate `center()`)
- F09.8 (`inset: 0` backdrop; delete `DialogBackdrop.resize` and both callers)
- rides along: F09.15 (the right-aligned/centred doc fix), the
  `applyHeaderVariant`/`applySeverityHeader` merge, `DialogBackdropOptions`.
Measured on: `getViewportSize` calls per resize event with a dialog open
(3 → 0-1); sink ops per resize event (already 0 — must stay 0).

**Plan D — "the minimized dock stops being quadratic"** (independent, low risk)
- F09.6 (hoist the reads out of the loop; coalesce the static relayout)
Measured on: `getThemeVar` + `getViewportSize` per resize event with M = 4
minimized windows (32 → ≤ 2).

**Plans that belong to other slices — do not duplicate here, but they are what
makes a settled window pass free:**
- F09.4's four steps: step 1 is slice 01's `InlineStyle.flushDirty` guard;
  steps 2 and 3 (`StyleTarget.setMany` batching + last-written-value filter) are
  new and belong in slice 02's plan, with this slice's `09e` probe as the
  measurement; step 4 is slice 06's `Border` clip-path plan.
- F09.9 depends on slice 13's `Button.setGlyph` same-name guard.
- F09.12 depends on slice 02's `setBackgroundImage` guard.
- F09.11's coalescing change should land **after** the `PerFrameCoalescer`
  hoist, so all six of the library's hand-rolled rAF coalescers (this slice's
  two, plus `Split`, `Accordion`, `ScrollStrip`, `Panel`, `VirtualRowView`) move
  onto one implementation in a single library-wide change rather than a seventh
  copy appearing in `onDrag`.

**Too small to plan, ride along with a neighbour**: every item in the dead-code
section; the `initChrome` / `applyOptions` no-op round trips; the three doc
mismatches (`AbstractWindow.md` "extends Panel", `Window.md`/`TabWindow.md`
"Inherits all PanelOptions", `performance.md:137` on `getSize`); the
`horisontallBorderWidth` spelling.

**Positives a plan must not regress** (all probe-verified):
1. The move-drag frame: 1 inline apply, 1 property, 0 rule mutations, 0 layout
   passes. Pinned by `AbstractWindow.dragWillChangeOnMove.test.ts`.
2. `applyResizeFrame` batches the window's own four geometry writes into **one**
   apply via `setAutoCommitStyle(false)/(true)` — this is the correct pattern and
   the contrast with the unbatched clip-frame writes (F09.4).
3. A rail-minimized window costs **nothing** on a viewport resize: `setDisplayed(false)`
   takes it out of the render tree and `detachViewportResizeListener()` drops its
   listener (`AbstractWindow.ts:1269-1280`).
4. `Dialog.open()` mounts before laying out (`:925-942`) — the precedent F09.1
   copies.
5. The backdrop is a plain translucent `rgba()` fill with **no** blur and no
   `backdrop-filter` anywhere in `packages/`.
6. The snap-preview and resize paths are both rAF-coalesced; the large-resize
   fade genuinely pauses the body host's layout for the glide.
7. `AbstractWindow.destructor` disposes all 8 strips and the lazy `Menu`, so an
   open/close cycle leaks no stylesheet rules — pinned by
   `AbstractWindow.styleRuleDisposal.test.ts`.
8. `LayerManager.markActive` dedupes, so `paintActive` fires only on a real
   activation change.

**Probes**: `.worktrees/_probes/09-overlay-windows-dialogs/slice09{a,b,c,d,e}.probe.test.ts`,
run with
`PROBE_DIR=.worktrees/_probes/09-overlay-windows-dialogs npx vitest run --config .worktrees/_probes/vitest.probe.config.ts --silent=false`.
`09a` uses the default (disconnected) modelled handles, which is why its
`getThemeVar` counts are high; `09b`-`09e` mark every handle connected first and
are the numbers quoted for steady state.
