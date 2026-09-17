# 11 overlay-popups-layers-animation — render-work review

**Summary**

- `Tooltip.hide()` never early-returns. `Component.removeElement()` keeps the handle, so the
  `if (!el) return` guard fires only before the first-ever `show()`. Every `mouseout` and every
  `mousedown` over any tooltip-attached component — and every `Tooltip.attach` call — therefore
  plays a full 100 ms fade-out on a detached element: 3 sink applies, a `setTimeout`, a
  `matchMedia`, and **2 native listeners that are never removed** (probe P2/Q4/P5). Per pointer
  event, app-wide. **The largest finding in this slice.**
- `Tooltip.attach` is **not idempotent** (the assigned question): re-attaching identical text costs
  4 `Event.removeListener` + 4 `Event.addListener` + 5 fresh closures + one stray `hide()`. Because
  the closures are minted fresh, `Event`'s own same-reference dedup (`Event.ts:465-476`) can never
  fire. `Button.setText` calls it unconditionally, so an unrelated button re-labelling itself
  **starts the fade-out of a tooltip currently showing for a different component** (probe Q3).
- `Popover`'s reposition costs **4 forced document layouts per event and writes nothing** when the
  anchor has not moved (probe P3), on an *uncoalesced* raw `scroll` listener per scrollable ancestor
  plus a `resize` viewport listener. Two of the four reads are literal duplicates
  (`_reposition` and `positionArrow` each re-read the same anchor rect and the same viewport).
- `FloatingPanel.placeNextTo` does a live `getElementRect` after the host's `super.doLayout()` —
  `MarkdownViewer.doLayout` calls it twice per pass, i.e. **2 forced synchronous layouts per frame
  per visible Markdown preview** during a gutter drag or window resize.
- `Tooltip.show` measures text one line at a time (`measureText` per line + one more for the line
  height), each a probe-element append + `getBoundingClientRect`: **2 forced layouts for a one-line
  tooltip, 4 for a three-line one** (probe P1). `Util.measureTextWidths` — the batch form the
  framework's own `performance.md:141` mandates — exists and is never used here.
- `LayerManager`'s monotonic z counter is consumed by `bringToFront`, not only `register`, so an
  ordinary window crosses the PinnedWindow, Popover *and* Dropdown bands after ~400 title-bar
  clicks (probe P4). `Notification`'s hard-coded `Z_INDEX = 10002` is overtaken by the dropdown band
  after three layer registrations.
- **Positives to protect:** `LayerManager` writes no DOM and reads no geometry. `Animation.play` is
  CSS-transition-driven — zero per-frame JS, inline styles only, no stylesheet-rule writes.
  `Popover.positionArrow`'s per-reposition `setShadow` produced **zero** `setRuleStyles` ops on
  repeat (probe P3) — the suspected rule-write-per-frame hazard does not exist here.

---

## Findings

### F11.1 `Tooltip.hide()` runs a full fade-out on an already-hidden tooltip, once per `mouseout`

- **Category** — B (unchanged-value write), G (listener and allocation churn), H.
- **Impact** — **HIGH**. Per pointer event, multiplied by the number of tooltip-attached components
  a pointer sweeps across. A Loom toolbar/tab strip/gutter row is ~30–60 such components.
- **Where**
  - `overlay/Tooltip.ts:337-374` — `hide()`; the `if (!el) { return; }` guard at `:354-356`.
  - `overlay/Tooltip.ts:422-424` — `mouseoutFn` = bare `Tooltip.hide()`.
  - `overlay/Tooltip.ts:433-435` — `mousedownFn` = bare `Tooltip.hide()`.
  - `overlay/Tooltip.ts:476` — `detach()` ends in `Tooltip.hide()`.
  - `core/Component.ts` `removeElement()` — detaches the node, keeps the handle.
  - `core/Animation.ts:211-213` — the two `{ once: true }` listeners; `:153-177` `finish()` and
    `:133-151` `cancel()` remove neither.
- **Hot path**
  1. pointer leaves any component with a tooltip attachment
  2. `Event` base `mouseout` handler → `Tooltip.attach`'s `mouseoutFn` (`Tooltip.ts:422`)
  3. `Tooltip.hide()` (`:337`)
  4. `const el = inst.getElement()` (`:344`) — **non-null**, because `hide()`'s own
     `inst.removeElement()` at `:371` only detaches the node; the handle survives
  5. `Tooltip.dismissing = true` (`:358`)
  6. `Animation.play(el, { to: { opacity: "0" }, … })` (`:361`)
  7. `Animation.isReducedMotion()` → `DOM.source.matchMedia(...)` (`Animation.ts:118`)
  8. `buf.set("transition", …)` + `buf.setMany({opacity:"0"})` → 2 sink applies (`Animation.ts:202-209`)
  9. `DOM.sink.addListener(el, "transitionend", finish, {once:true})` and
     `…"transitionstart", rearmFallback, {once:true}` (`Animation.ts:211-212`)
  10. `DOM.sink.setTimeout(finish, 140)` (`Animation.ts:213`)
  11. 140 ms later the fallback wins (a detached element fires no `transitionend`): `finish()` writes
      `transition: null` (1 more apply), `setVisible(false)`, `removeElement()` — and **leaves both
      `once` listeners attached to the same, permanently-retained singleton element**.
- **Evidence** — probe `.worktrees/_probes/11-overlay-popups-layers-animation/overlay.test.ts` (P2) and
  `attach.test.ts` (Q4), run against the lib's vitest setup:
  - `P2 hide() with nothing showing: apply 3 setTimeout 1 addListener 2 removeListener 0 matchMedia 1 style keys ["transition","opacity"] dismissing flag true`
  - `P2 after fallback: total apply 4 removeElement ops 1 removeListener 0`
  - `P2 10 stray hides: addListener 20 removeListener 0`
  - `Q4 element handle across 5 stray hides [2,2,2,2,2] all identical? true sink.addListener calls 10`
  - `P5 play() no-from, fallback wins: addListener ["transitionend","transitionstart"] removeListener 0 completed 1`
  The handle is identical across hides, so the leaked listeners pile onto **one** element. They are
  only flushed when a genuine `transitionend` finally fires on it (i.e. on the next real tooltip
  dismissal), at which point every accumulated handler runs in one event.
- **Proposed change** — two independent mechanisms:
  1. `Tooltip.hide()` returns early when the tooltip is neither visible nor mid-dismiss. The cheapest
     correct test is `inst.isVisible() || Tooltip.dismissing`; the existing `!el` test cannot work
     because `removeElement()` does not clear the handle. Keep the timer-cancel and the
     viewport-listener teardown ahead of that return (they are the parts a stray hide legitimately
     needs).
  2. `Animation.play`'s `finish()` and `cancel()` call `DOM.sink.removeListener` for both
     `transitionend` and `transitionstart`, so the fallback and cancel paths leave no residue. This
     is a `core/Animation.ts` change that benefits every `play()` caller, not only `Tooltip`.
- **Risk / blast radius** — `hide()` is called from `Tooltip.detach`, `mouseoutFn`, `mousedownFn`,
  `attachToElement`'s `mouseoutFn`/`mousedownFn`, and `AbstractChart.ts:857/889/1105`. The early
  return changes nothing observable: the animation it skips is already running on a detached
  element. `tests/overlay/Tooltip.test.ts` pins show geometry and teardown, not hide's write count;
  `tests/core/Animation.test.ts:299-343` pins `afterTransition`'s listener removal but asserts
  nothing about `play`'s, so the listener fix is unpinned in either direction.
- **Proof at implement time** — a probe asserting `DOM.sink` op count == 0 for a `Tooltip.hide()`
  issued while `isVisible()` is false; and `removeListener` call count == 2 after a `play()` whose
  fallback timer wins (currently 0, probe P5).

### F11.2 `Tooltip.attach` is not idempotent, and its stray `hide()` dismisses an unrelated visible tooltip

- **Category** — B, G, H.
- **Impact** — **MEDIUM–HIGH**. Per `Button.setText` / per pooled-row rebind, app-wide; plus a
  user-visible correctness bug.
- **Where**
  - `overlay/Tooltip.ts:393-454` — `attach`: `detach()` first (`:394`), four fresh closures
    (`:399-435`), four `Event.addListener` (`:437-440`), one record (`:442`).
  - `overlay/Tooltip.ts:462-477` — `detach`: four `Event.removeListener` + `Tooltip.hide()`.
  - `core/Event.ts:465-476` — `registerEntry`'s same-reference dedup, which `attach` defeats.
  - Per-event / per-rebind callers: `component/button/Button.ts:1445` (from `_rebuildTooltip`,
    called by `setText:1175` and `clearDescription`), `component/list/AbstractSelectableList.ts:427`
    (from `applyTooltip`, called by `updateItem:407` on every pooled-row rebind),
    `component/container/TabBar.ts:1231/1749`, `component/container/SplitGutter.ts:469/472`.
- **Hot path (the `Button` case)**
  1. any caller sets a button's title — `Button.setText(text)` (`Button.ts:1167`), which has **no
     unchanged-text guard** of its own
  2. `Button._rebuildTooltip()` (`Button.ts:1417`)
  3. `Tooltip.attach(this, str)` (`Button.ts:1445`)
  4. `Tooltip.detach(this)` → 4 × `Event.removeListener` → `Tooltip.hide()` (F11.1's whole cost)
  5. 4 fresh closures + 1 record allocated; 4 × `Event.addListener`
- **Evidence** — probe `attach.test.ts`:
  - `Q1 first attach: Event.addListener 4 Event.removeListener 0`
  - `Q1 re-attach IDENTICAL text: Event.addListener 4 Event.removeListener 4`
  - `Q1 closure identity across attach calls: mouseoverFn same? false mouseoutFn same? false record same? false`
  - `Q2 50 labelled Buttons: Event.addListener calls total 400 of which tooltip types 250 mousemove registrations 50`
  - `Q2 setText(same text) on one button: Event.addListener 4 Event.removeListener 4`
  - `Q3 before unrelated setText: visible true dismissing false` /
    `Q3 after unrelated setText: visible true dismissing true`

  **Answering the assigned question directly:** `Event.addListener` *is* idempotent for a stable
  function reference — `registerEntry` explicitly overwrites the options of an already-registered
  reference rather than adding a second entry (`Event.ts:465-476`). `Tooltip.attach` defeats that
  twice over: it detaches first, and it mints four new closures each call, so the dedup path is
  unreachable. The app-sized cost of the current design is (a) a resident **4 `Event` registrations
  and 4 retained closures per labelled `Button`** — 200 registrations across a 50-button shell, of
  which 50 are `mousemove`; (b) **8 `Event` API calls + 5 allocations + one full stray fade-out per
  `setText`**; and (c) the app-wide window-level `mousemove` capture handler existing *solely*
  because tooltips are attached — in a resting Loom shell nothing else registers an exact-target
  `mousemove` (`Scrollbar`, `Body`, `DragManager`, `AbstractWindow` all register theirs only for the
  duration of an active drag). That per-`mousemove` routing is ~1 WeakMap intern hit + 1 `getId`
  handle resolve + 2 Map lookups; measured against the 16.7 ms budget it is noise on its own, so I
  am **not** claiming it as a frame-budget cost — the cost that matters is (b), amplified by F11.1.
- **Proposed change**
  1. `attach` returns early when the stored record's `text` and `colors` both match — the one-line
     guard that makes the whole chain a no-op for the overwhelmingly common repeat call.
  2. `detach` calls `hide()` only when the detached component is the tooltip's current anchor
     (`Tooltip.activeElement === component.getElement()`), which is the only case the dismissal was
     ever for. This removes the Q3 bug outright.
  3. `mouseoutFn` and `mousedownFn` have identical bodies (`Tooltip.hide()`) and capture nothing —
     hoist both to module-level named functions shared by every attachment, cutting the per-attach
     allocation from 5 to 3 and letting `Event`'s dedup apply to two of the four types.
  4. The per-attachment `mousemove` listener exists only to keep the cursor position fresh between
     `mouseover` and the 500 ms timer firing — `Tooltip.show` is never re-invoked once the tooltip
     is up, so the `Tooltip.md` claim that the tooltip "follows the pointer until it leaves" is not
     what the code does. Registering it inside `mouseoverFn` and removing it in `mouseoutFn` / when
     the timer fires would confine it to the hover window and let the app-wide `mousemove` base
     listener be uninstalled the rest of the time.
- **Risk / blast radius** — `tests/overlay/Tooltip.test.ts:291` pins that repeated `attach` calls do
  not register a duplicate teardown hook; an early return preserves that. Change (2) is the only one
  with observable behaviour change, and the behaviour it removes is the bug. `Button`'s own
  `_tooltipSuppressed` path (`Button.ts:1429`) calls `detach` on a component that may hold no
  attachment — already a no-op.
- **Proof at implement time** — probe Q1 re-run: `Event.addListener`/`removeListener` == 0 on a
  re-attach with identical text (currently 4/4); probe Q3 re-run: `Tooltip.dismissing` stays `false`
  after an unrelated `setText`.

### F11.3 `Tooltip.show` measures text one line at a time and re-measures the line height on every show

- **Category** — A (forced sync read on a hot path), I (an existing batch helper is not used).
- **Impact** — **MEDIUM** on the ordinary hover path (once per hover, 2–4 forced full-document
  layouts). **HIGH** on `AbstractChart`'s hover path, which calls `Tooltip.show` per `mousemove`.
- **Where**
  - `overlay/Tooltip.ts:229-230` — `lines.reduce((max, line) => Math.max(max, Util.measureTextWidth(line)), 0)`.
  - `overlay/Tooltip.ts:232` + `:636-640` — `_perLineHeight()` → `DOM.source.measureText("X")`.
  - `overlay/Tooltip.ts:253` — the wrapped-height `measureText(text, { maxWidth })`.
  - `overlay/Tooltip.ts:275` — `DOM.source.getViewportSize()`.
  - `overlay/Tooltip.ts:318` — `DOM.sink.apply(el, { style: { opacity: "1" } })` on the repeat path.
  - `core/Util.ts:104` — `measureTextWidths(texts[])`, the unused batch form.
  - `core/DOM.ts:2130-2178` — each `measureText` creates two elements, appends to `document.body`,
    reads two `getBoundingClientRect`s, removes. One forced style+layout flush per call.
  - `core/DOM.ts:2336-2341` — `getViewportSize` reads `documentElement.clientWidth` (slice 03: the
    `Math.max` then discards it).
  - `packages/lib/docs/concepts/performance.md:141` — "Measuring N strings one at a time costs N
    forced layouts… should use one `DOMSource.measureTexts` call rather than a `measureText` loop."
- **Hot path (chart hover)**
  1. `mousemove` over a chart mark → `AbstractChart.handlePointerMove` (`AbstractChart.ts:853`)
  2. `Tooltip.show(text, x, y)` (`AbstractChart.ts:869`)
  3. `inst._text.setText(text)` — a DOM write (`Tooltip.ts:224`)
  4. `Util.measureTextWidth(line)` per line — **forced layout each** (`Tooltip.ts:230`)
  5. `inst._perLineHeight()` → `measureText("X")` — **another forced layout** (`Tooltip.ts:232`)
  6. `inst.getPerimeterSize()` (`:237`), `DOM.source.getViewportSize()` — **another** (`:275`)
  7. `DOM.sink.apply(el, {style:{opacity:"1"}})` — an unchanged-value write on every repeat (`:318`)
- **Evidence** — probe P1:
  - `P1 first show 1-line: measureText 2 measureTexts 0 getViewportSize 1 apply ops 24 …`
  - `P1 repeat show same text new pos: measureText 2 getViewportSize 1 apply ops 6 style keys ["left","width","top","height","opacity"]`
  - `P1 show 3-line: measureText 4 getViewportSize 1 apply ops 10 …`

  `measureTexts` is called **zero** times. A 3-line tooltip (the shape `Button._rebuildTooltip`
  produces for a title + description) costs 4 forced layouts. A repeat show with unchanged text
  still costs 2, plus the `opacity: "1"` re-write.
- **Proposed change**
  - Replace the per-line loop with one `Util.measureTextWidths(lines)` call (`Util.ts:104`), or one
    `DOM.source.measureTexts` request carrying the lines plus the `"X"` line-height probe — one
    forced layout for the whole show instead of N+1.
  - Memoise `_perLineHeight()` on a theme generation counter: it measures a constant string with
    default font options and can only change on a theme/font change, which `ThemeManager` already
    signals.
  - Skip the whole measurement block when the text is unchanged from the last `show()` (the chart
    case moves the tooltip far more often than it changes its text), and skip the `opacity: "1"`
    write when the tooltip is already at full opacity.
- **Risk / blast radius** — `tests/overlay/Tooltip.test.ts:81-133` pin the resulting width/height
  arithmetic exactly, so any change must keep `measureTextWidths`'s per-string results identical to
  `measureTextWidth`'s (they share the same probe styling path except for the shared wrapper, so
  this needs checking rather than assuming). The wrapped-height branch at `:251-257` needs the
  `maxWidth` form, which `measureTextWidths` does not offer — `measureTexts` does.
- **Proof at implement time** — probe P1 re-run: `measureText + measureTexts` call count == 1 for a
  3-line show (currently 4), and == 0 for a repeat show with unchanged text (currently 2).

### F11.4 An open `Popover` pays 4 forced document layouts per scroll event and per resize frame, and writes nothing

- **Category** — A, D (avoidable layout pass), G (uncoalesced listener).
- **Impact** — **HIGH** while a popover is open during a scroll or a window/gutter resize. Raw
  `scroll` in WebKitGTK is not rAF-coalesced, so this can run several times per frame.
- **Where**
  - `overlay/Popover.ts:690-760` — `_reposition()`: `getElementRect` (`:695`), `getPreferredSize()`
    (`:703`), `getViewportSize()` (`:706`), then `positionArrow()` (`:757-759`).
  - `overlay/Popover.ts:871-957` — `positionArrow()`: a **second** `getElementRect` (`:876`) and a
    **second** `getViewportSize` (`:909`), plus `getBorderSize()` (`:910`).
  - `overlay/Popover.ts:616-624` — `doLayout()` calls `positionArrow()` unconditionally, so the
    layout pass that `_reposition`'s own `setX/setY/setWidth/setHeight` schedules costs 2 more reads
    on the next frame.
  - `overlay/Popover.ts:963-973` — `attachRepositionListeners`: `Event.addViewportListener(this,
    "resize", …)` plus a **raw** `DOM.sink.addListener(ancestor, "scroll", this._onScroll,
    {passive:true})` per scrollable ancestor, both wired straight to `_reposition` with no rAF gate.
  - `overlay/Popover.ts:995-1013` — `collectScrollAncestors`: one `DOM.source.getComputedOverflow`
    per ancestor per open, and `DOM.source.getDocumentElement()` re-called every loop iteration.
- **Hot path**
  1. user scrolls a `Panel` the popover's anchor lives in (or drags a window edge)
  2. native `scroll` → `Popover._onScroll` (`:214`) → `_reposition()` — **no coalescing**
  3. `DOM.source.getElementRect(anchor)` — forced layout #1
  4. `this.getPreferredSize()` — full un-memoised size aggregation over the popover subtree (slice 05)
  5. `DOM.source.getViewportSize()` — forced layout #2
  6. `positionArrow()` → `getElementRect(anchor)` again — forced layout #3
  7. `positionArrow()` → `getViewportSize()` again — forced layout #4
  8. next rAF: the scheduled `doLayout()` → `positionArrow()` → forced layouts #5 and #6
- **Evidence** — probe P3:
  - `P3 show(): getElementRect 3 getViewportSize 3 getComputedOverflow 1 setRuleStyles ops 5 apply ops 46`
  - `P3 _reposition() unchanged anchor: getElementRect 2 getViewportSize 2 apply ops 0 setRuleStyles ops 0`
  - `P3 _reposition() moved anchor: getElementRect 2 getViewportSize 2 apply ops 2 style keys ["top","height"] setRuleStyles ops 0`
  - `P3 doLayout(): getElementRect 1 getViewportSize 1 apply ops 1`

  The unchanged-anchor line is the important one: **four live geometry reads, zero DOM writes.** The
  `getComputedOverflow` count of 1 is an artefact of the probe's two-level tree; a Loom popover
  anchored inside a `Tree` → `Accordion` → `Split` → `Dock` walks ~15–25 levels, i.e. 15–25
  `getComputedStyle` calls per open.
- **Proposed change**
  - Coalesce `_onScroll` / `_onWindowResize` through a single pending-`requestAnimationFrame` flag,
    the shape `accordion-gutter-drag-coalescing` and `dragmanager-pointer-coalescing` already
    established, so N scroll events per frame collapse to one reposition.
  - Pass the already-read `anchorRect` and `vp` into `positionArrow(anchorRect, vp)` instead of
    letting it re-read both. That halves the reads with no behaviour change; `doLayout`'s own call
    can read once and pass them on.
  - Early-return from `_reposition` when the anchor rect and viewport are both unchanged since the
    previous call (the common case for a scroll on a container the anchor is not actually inside,
    and for a resize frame that is not moving the anchor).
  - Fold `DOM.source.getDocumentElement()` out of `collectScrollAncestors`' loop condition.
- **Risk / blast radius** — `tests/overlay/Popover.test.ts:226-294` pin that `setBody`/`setTitle`
  while open re-measure and reposition **synchronously** (`_reflowIfOpen` at `:676-683`), so the
  coalescing must apply to the listener callbacks only, not to `_reflowIfOpen`. `Popover` is the
  only consumer of `_reposition`.
- **Proof at implement time** — probe P3 re-run: `getElementRect + getViewportSize` == 0 for an
  unchanged-anchor reposition (currently 4), and == 2 for a moved-anchor one (currently 4); plus a
  scroll-storm probe asserting one `_reposition` per frame for 10 synthetic scroll events.

### F11.5 `FloatingPanel.placeNextTo` forces a document layout per host layout pass

- **Category** — A.
- **Impact** — **HIGH** during hot path 1 (continuous resize) whenever a `MarkdownViewer` is
  visible — two forced synchronous layouts per frame, on top of everything else the frame pays.
- **Where**
  - `component/container/FloatingPanel.ts:197-229` — `placeNextTo`; `getContentInsets()` at `:205`
    (slice 28: allocates a fresh `Insets` with a UUID per call), `DOM.source.getElementRect(textEl)`
    at `:223`.
  - `component/display/MarkdownViewer.ts:214-224` — `doLayout()` calls `placeNextTo` **twice** after
    `super.doLayout()`; also `:389-390`, `:404-405`, `:419-420`.
- **Hot path**
  1. `Split` gutter drag / window resize → `doLayout` cascade reaches `MarkdownViewer`
  2. `MarkdownViewer.doLayout()` → `super.doLayout()` commits every child's rectangle (**writes**)
  3. `this._minimap.placeNextTo(this._markdown)` → `DOM.source.getElementRect(textEl)` — a live rect
     read after those writes, in the same task: **forced style+layout flush of the whole document**
  4. `this._controls.placeNextTo(this._markdown)` → a second one
- **Evidence** — read directly; `MarkdownViewer.doLayout`'s own doc comment (`:203-212`) states the
  call must happen "after `super.doLayout()`, so every sibling this pass touches … has already
  committed and flushed its geometry", i.e. the write-then-read ordering is deliberate and
  documented. `FloatingPanel.placeNextTo`'s doc comment (`:186-192`) explains why a live rect is
  used rather than `getWidth()`: a `Markdown` reading-width cap is CSS-only, so the rendered box can
  be narrower than the allocated one. Both reasons are sound; the cost is the per-pass frequency,
  not the read itself. Not measured in the target engine — this is the same read shape that cost
  ~110 ms/frame in the `ScrollStrip` case, but I have not measured this instance.
- **Proposed change** — cache the rendered width on the `FloatingPanel` and re-read only when an
  input that can change it has moved: the host's inner width, `textColumn`'s allocated width, and a
  generation counter bumped by `Markdown.setMaxMeasure` / `setFontScale` (the two CSS-only writers
  the doc comment names). An unchanged signature returns the cached `hugX` and does no read at all.
  The alternative — having `Markdown` report its rendered width through a cached typed accessor
  instead of a live rect — is cleaner but reaches into slice 25.
- **Risk / blast radius** — two callers, both in `MarkdownViewer`. `MarkdownMinimap` extends
  `FloatingPanel` and inherits `placeNextTo` unchanged. No test in
  `tests/component/display/` pins the read count; the placement result is what is pinned.
- **Proof at implement time** — a probe spying `DOM.source.getElementRect` across 10 identical
  `MarkdownViewer.doLayout()` passes: currently 20, target 0 after the first; then ms/frame on the
  Loom Markdown-preview gutter drag.

### F11.6 `LayerManager`'s z counter is burned by `bringToFront`, so a window climbs out of its band

- **Category** — H (function/implementation mismatch), B, D.
- **Impact** — **MEDIUM**. Correctness, not frame time: an ordinary window eventually paints over
  pinned windows, popovers and dropdowns. Plus a redundant inline write + subtree walk per raise.
- **Where**
  - `core/LayerManager.ts:174-176` — `let _zCounter = 0`, never reset.
  - `core/LayerManager.ts:228` — `const zIndex = band + (++_zCounter)` in `register`.
  - `core/LayerManager.ts:452-467` — `restampSubtree` also does `n.zIndex = n.band + (++_zCounter)`.
  - `core/LayerManager.ts:398-407` — `bringToFront` calls it unconditionally, with no
    already-topmost check.
  - `core/LayerManager.ts:112-136` — the band comment: "the 200-1000 gap between bands leaves
    headroom for the monotonic `_zCounter`; it is not reset, on the assumption a single session
    opens far fewer than 200 unrelated layers in the same band before a reload".
- **Hot path** — `AbstractWindow`'s `mousedown` → `LayerManager.bringToFront(window)` → one counter
  increment per click, plus `onZIndexChanged` → `Component.setZIndex` → one inline style write per
  node in the raised subtree, even when the layer was already on top and its order did not change.
- **Evidence** — probe P4:
  - `P4 pinned z 9402 plain z start 9003 plain z after 1200 raises 10203 crossed pinned at raise # 400 above Popover band? true above Dropdown band? true`
  - `P4 sole layer: z after register 10204 after 2 redundant raises 10206 onZIndexChanged z 10206`

  The band comment's headroom budget counts *registrations*. `bringToFront` consumes the same
  counter and is a **per-click** gesture, so the real budget is `registrations + raises`, and 398
  raises is a plausible afternoon. `setZIndex` is guarded (`Component.ts:2263-2272`) and writes
  inline (confirmed by probe P6's style keys), so the redundant write is cheap — but it is never
  actually elided, because `restampSubtree` always produces a *different* number.
- **Proposed change**
  - `bringToFront` returns early when `node` is already the topmost node in its band and nothing in
    its subtree needs re-stamping — the common repeat-click case, which then costs zero counter,
    zero walk, zero write.
  - Allocate the counter **per band** rather than globally, so a raise in the Window band can never
    consume Popover-band headroom; or renormalise a band's stamps when its counter approaches the
    next band base.
- **Risk / blast radius** — `tests/overlay/LayerManager.test.ts:176-232` pin that `bringToFront`
  "re-stamps the layer above its prior z and notifies via `onZIndexChanged`", including for a sole
  layer at `:177-194`. An already-topmost early return **would break that test** — the test pins
  today's behaviour, not a requirement, so this needs a deliberate decision recorded in the plan.
  The per-band counter change is invisible to every existing assertion that only compares relative
  order.
- **Proof at implement time** — probe P4 re-run: a Window-band layer's z stays below
  `Band.PinnedWindow` after 5,000 raises (currently crosses at 400); and `onZIndexChanged` call
  count == 0 for a redundant raise of the sole layer.

### F11.7 `Notification`'s hard-coded `Z_INDEX` is overtaken by the dropdown band after three layer registrations

- **Category** — H.
- **Impact** — **MEDIUM**. Correctness: a toast silently renders *behind* an open menu or picker for
  the rest of the session.
- **Where** — `overlay/Notification.ts:111-117`:
  `private static readonly Z_INDEX: number = 10002;` with the comment "Sits just above the managed
  dropdown band (`LayerManager.Band.Dropdown` = 10000) so a toast floats over open pickers and
  menus". `core/LayerManager.ts:130` (`Z_BAND_DROPDOWN = 10000`) and `:228` (`band + ++_zCounter`).
- **Hot path** — any three `LayerManager.register` calls in the session (a window, a dialog, a menu
  — the counter is global across bands). The fourth dropdown opened is stamped `10000 + 4 = 10004`,
  above the toast.
- **Evidence** — arithmetic from `register`'s stamp formula, corroborated by probe P4, where a
  layer's stamp reached 10204 purely from raises. No probe was written for the toast case
  specifically; the counter behaviour it depends on is the one P4 measures.
- **Proposed change** — give `Notification` a real band. It does not need to be a *dismissable*
  layer to have a band constant: add `Band.Notification` between `Dropdown` and `Dialog` and, if a
  toast must outrank live dropdowns rather than merely their band base, register it as a `"manual"`
  layer so it draws a counter stamp like everything else (`topmostInputLayer` at
  `LayerManager.ts:345-353` already skips `"manual"` layers, so this would not shadow keyboard
  routing). The current comment's premise — that a fixed literal can sit "just above a band" — is
  not true of a band-plus-counter allocator.
- **Risk / blast radius** — `Notification` has no `DismissableLayer` implementation today, so
  registering it is new surface; the cheaper variant (a `Band.Notification` constant used as a plain
  literal) fixes the ordering against band *bases* but not against high-counter dropdowns. Say which
  in the plan. `tests/overlay/Notification.test.ts` asserts nothing about z.
- **Proof at implement time** — a probe opening 5 dropdowns then a toast and asserting the toast's
  committed `zIndex` exceeds every registered dropdown's.

### F11.8 `AnimatedDropdown` re-implements `OverlayFade`, which exists for exactly this

- **Category** — I (duplication), H.
- **Impact** — **LOW** (code health; no measurable render cost). Listed because it is the reason two
  fade code paths must be fixed in lockstep whenever `Animation.play` changes — F11.1's listener fix
  touches both.
- **Where**
  - `core/OverlayFade.ts:52-83` (`fadeShow`) vs `core/AnimatedDropdown.ts:198-237` (`showAnimated`).
  - `core/OverlayFade.ts:97-131` (`fadeHideAndDetach`) vs `core/AnimatedDropdown.ts:245-285`
    (`hideAnimated`).
  The two pairs share the same `setWillChange("opacity, transform")` bracketing, the same
  `from`/`to` opacity + `translateY` configs, the same `_dismissing` re-entrancy guard (a per-class
  field in one, a `WeakMap` in the other), and the same `setVisible(false)` + `removeElement()`
  finalize. `AnimatedDropdown` adds exactly one thing `OverlayFade` lacks: the
  `LayerManager.unregister` in `finalize` (`:255`).
- **Evidence** — `OverlayFade.ts:41-45` documents the split itself: "`Menu` and `Popover` use it
  directly; `AnimatedDropdown` … wraps the same transition as its `showAnimated` method for
  subclasses that extend it rather than composing this free-function form." Consumer counts (grep
  over `packages/`, excluding `dist` and docs): `fadeShow` — 2 call sites,
  `overlay/Popover.ts:512` and `overlay/Menu.ts:740`; `fadeHideAndDetach` — 2,
  `overlay/Popover.ts:539` and `overlay/Menu.ts:752`.
- **Proposed change** — have `showAnimated` / `hideAnimated` delegate to `fadeShow` /
  `fadeHideAndDetach`, passing the layer unregister through `FadeOptions.onComplete`. The
  `_dismissing` field then becomes the `WeakMap`'s entry and `isOpen()` keeps its own `_open` flag.
- **Risk / blast radius** — every picker dropdown, `ComboBox`, `PopupPanel`, `AutoCompleteDropdown`
  and `AbstractCalendarDropdown` inherits this. `AutoCompleteDropdown.ts:238` overrides
  `onHideComplete`, which must still fire after the unregister (`AnimatedDropdown.ts:253-257`
  documents that ordering). `tests/overlay/AnimatedDropdown.test.ts` covers only the z-stamp.
- **Proof at implement time** — the existing dropdown-close tests
  (`tests/component/input/ComboBoxDropdownClose.test.ts`, `tests/core/Animation.test.ts:469`) pass
  unchanged, plus a probe asserting the sink op sequence of `showAnimated` is byte-identical before
  and after.

### F11.9 `ButtonGroup` leaks a listener per removed button and per `setContainer` call

- **Category** — G, J, H.
- **Impact** — **LOW–MEDIUM**. A removed button keeps deselecting its former siblings (a live
  correctness bug), and a second `setContainer` leaves a dangling subtree `keydown` listener.
- **Where**
  - `overlay/ButtonGroup.ts:229-245` — `addButton` registers `button.on("action", () => …)`, an
    **inline arrow** (ARCHITECTURE.md §"Listeners must reference a named function"), with no stored
    reference.
  - `overlay/ButtonGroup.ts:252-266` — `removeButton` splices the array and drops the
    `RovingTabIndex` entry but never calls `button.off("action", …)`.
  - `overlay/ButtonGroup.ts:276-298` — `setContainer` allocates a fresh `RovingTabIndex` (discarding
    any previous one) and registers another inline-arrow subtree `keydown` listener each call, with
    no removal path; `dispose()` (`:138-140`) clears only the group's own bag.
  - `overlay/ButtonGroup.ts:96-114` — `updateButtonStates` sweeps **every** sibling with
    `setSelected(false)`, including those already deselected.
  - `overlay/ButtonGroup.ts:283` — `Event.addSubtreeListener(container, …)` registers against a
    component the group does not own (ARCHITECTURE.md §"A component must not listen to another
    component's events through `Event`"); `ButtonGroup` is not a `Component`, so the rule is not
    literally binding, but the coupling it forbids is exactly what this is.
- **Hot path** — per click on a group member (the sweep), and per `removeButton` / repeat
  `setContainer` (the leaks). Not a frame path.
- **Evidence** — read directly. `tests/overlay/ButtonGroup.test.ts:112-134` pins that `removeButton`
  "drops the member" (from the array) but asserts nothing about the listener, so the leak is
  unpinned. `dispose()`'s own JSDoc (`:131-137`) claims "The buttons this group manages … each own
  their registrations independently and release them on their own teardown" — true of the button's
  bag, but the group's `"action"` closure is what keeps `updateButtonStates` reachable from a
  removed button.
- **Proposed change** — store the handler per button (a `Map<button, () => void>` or a named method
  bound once), remove it in `removeButton` and in `dispose()`; make `setContainer` idempotent by
  reusing the existing `RovingTabIndex` and removing a previously-registered keydown listener;
  give the keydown handler a name; skip `setSelected(false)` for a sibling already reporting
  `isSelected() === false`.
- **Risk / blast radius** — `tests/overlay/ButtonGroup.test.ts` has 19 cases covering the selection
  model and the `SpatialNavigation` stand-down; the sweep-skip must keep
  `:29-47` ("the else branch deselects every sibling") passing, which it does as long as the
  observable end state is unchanged.
- **Proof at implement time** — a probe asserting a removed button's click no longer reaches
  `"selection"`, and that `setSelected` call count on an N-button group is (number of actually
  selected siblings), not N-1.

### F11.10 A live `Notification` turns on `Event`'s full ancestor climb for `mouseover` / `mouseout` / `dblclick`

- **Category** — G, E.
- **Impact** — **LOW in a Loom shell** (`SplitGutter` already registers subtree
  `mouseover`/`mouseout`, so the climb for those two types is already on); **MEDIUM in an app with
  no `Split`**, where a 3-second toast switches on a full-document ancestor walk for every pointer
  crossing.
- **Where**
  - `overlay/Notification.ts:238` — `Event.addSubtreeListener(this, "dblclick", …)`.
  - `overlay/Notification.ts:249-250` — `Event.addSubtreeListener(this, "mouseover"/"mouseout", …)`.
  - `core/Event.ts:296-347` — the climb runs for **every** event of a type that has at least one
    subtree registration, and only returns early at `:297-299` when the type has none.
  - `component/container/SplitGutter.ts:230-231` — the pre-existing `mouseover`/`mouseout` subtree
    registrations (slice 06).
- **Hot path** — any `mouseover`/`mouseout` anywhere in the document while a toast is on screen:
  `Event.baseListener` → the `while (handle)` climb at `:302-347`, one `getId` + one
  `getParentElement` seam call per ancestor level, to `<html>`.
- **Evidence** — read directly; the mechanism is slice 03's confirmed finding, and the early return
  at `Event.ts:297` is what makes a *new* subtree type (here `dblclick`) the marginal cost in Loom.
  I did **not** measure the marginal cost of one extra registration in an already-climbing type — it
  is one extra `Map.get` per level and should be noise; I am reporting the type-activation, not the
  registration count.
- **Proposed change** — the toast's own `mouseover`/`mouseout` handlers already filter on
  `relatedTarget` containment (`:386`, `:410`), so a plain exact-target `Event.addListener` on the
  root plus the existing containment filter would cover the descendant case the subtree listener was
  chosen for — the comment at `:240-248` explains the choice as "double-clicks on the badge/text
  bubble up", which is a `dblclick` requirement, not a hover one. Worth confirming before changing:
  the badge and text are `pointer-events: none` (`:204`, and `SelectableText` is not), so the
  hover target may already be the root.
- **Risk / blast radius** — hover-hold pause/resume is user-visible; `tests/overlay/Notification.ts`
  covers the refcount but not the DOM routing. Low value relative to risk — this one is a
  ride-along, not a plan of its own.
- **Proof at implement time** — a probe counting `DOM.source.getParentElement` calls for one
  synthetic `mouseover` with and without a live toast, in a tree with no `Split`.

### F11.11 `Notification` never re-stacks on a viewport resize

- **Category** — H.
- **Impact** — **LOW**. Cosmetic: after a window resize, live toasts stay at the old
  bottom-right coordinates until the next `show()` or dismissal.
- **Where** — `overlay/Notification.ts:605-619` (`restack`, the only writer of toast x/y) is called
  from `show` (`:274`), `finishDismiss` (`:598`) and `destructor` (`:678`). No `resize` listener
  exists anywhere in the file, yet `restack` derives both coordinates from
  `DOM.source.getViewportSize()`.
- **Evidence** — read the whole file; grep for `resize` in `overlay/Notification.ts` returns nothing.
  The class JSDoc (`:80-83`) promises a toast "appears in the bottom-right corner of the viewport".
- **Proposed change** — one `Event.addViewportListener` on a module sentinel (the pattern
  `LayerManager.ts:146` already uses), installed while `activeNotifications` is non-empty, calling
  `restack()` — coalesced through rAF so a resize drag does not re-stack per raw event.
- **Risk / blast radius** — none beyond adding a listener; `restack` is already idempotent and its
  `setX`/`setY` are guarded.
- **Proof at implement time** — a probe resizing the modelled viewport and asserting the toast's
  committed x/y track it.

### F11.12 `Notification.doLayout` re-derives a constant geometry and force-runs the close button's layout

- **Category** — D, B.
- **Impact** — **LOW**. A toast's box is a fixed 320×64, so every value `doLayout` computes is a
  constant; the guarded setters absorb the writes, but the work and the forced child pass are real.
- **Where** — `overlay/Notification.ts:627-657`; `badgeSizePx()` (`:630` → `:29-31` →
  `ThemeManager.getResolvedScale()`) per pass; `this._closeButton.doLayout()` at `:654`, an
  unconditional extra layout of the button's internal `Fit`/`HBox` subtree.
- **Evidence** — read directly; `WIDTH`/`HEIGHT`/`H_PADDING`/`V_PADDING`/`CLOSE_SIZE` are all
  `static readonly` literals (`:104-110`) and the component's own size is pinned in the constructor
  (`:175-176`). Probe P6 shows a second `show()` costing 77 applies / 7 `setRuleStyles`, essentially
  all of it construction of the new toast rather than re-layout of the old one.
- **Proposed change** — compute the child rectangles once (memoised on `badgeSizePx()`'s value) and
  drop the explicit `_closeButton.doLayout()`, which the framework's own commit path already
  performs when the button's rectangle changes.
- **Risk / blast radius** — the `_closeButton.doLayout()` comment (`:652-653`) says it exists to
  "cascade the size change down to the times-glyph"; per the briefing's cross-slice finding,
  `LayoutManager.commitBounds:567` calls `child.doLayout()` unconditionally already, so this call is
  very likely redundant — confirm against that path before removing.
- **Proof at implement time** — a probe running 5 identical `Notification.doLayout()` passes and
  asserting 0 sink ops after the first (and that the ✕ glyph's committed box is unchanged).

### F11.13 `PopupPanel.showAt` writes `maxSize` twice and commits five geometry setters before a synchronous `doLayout`

- **Category** — D.
- **Impact** — **LOW**. Per open only.
- **Where** — `overlay/PopupPanel.ts:135-161`: `setMaxSize({MAX_VALUE, MAX_VALUE})` at `:143`, then
  `getPreferredSize()` (`:145`), then `setWidth` / `setMaxSize` again / `setHeight` / `setX` /
  `setY` (`:151-155`), each of which schedules a layout, then `showAnimated()` + an explicit
  `doLayout()` (`:157-158`).
- **Evidence** — read directly. The clear-then-reset of `maxSize` is deliberate and documented
  (`:142-143`: a reused panel still carries the previous open's cap) and `tests/overlay/PopupPanel.test.ts:146`
  pins it ("re-measures from the new anchor's room on a second, taller-content open"), so the
  double write is load-bearing — the avoidable part is the five separate `scheduleLayout` calls
  before a pass that is then run synchronously anyway.
- **Proposed change** — bracket the geometry commit in `pauseLayout()` / `resumeLayout()`, or set
  the rectangle through one `setBounds`-style commit, so the open costs one scheduled pass rather
  than five queue insertions plus one synchronous pass.
- **Risk / blast radius** — `PopupPanel` is used by `PopupButton` and any consumer building a custom
  popup; nine `showAt` placement tests pin the resulting coordinates, none the pass count.
- **Proof at implement time** — a probe counting `scheduleLayout` entries per `showAt`.

---

## Entity inventory

| Entity | Stated function | Owns DOM | Per-layout-pass writes/reads | Verdict | Findings |
|---|---|---|---|---|---|
| `overlay/Tooltip.ts` | "A singleton floating tooltip that appears near the cursor after a short delay" (llms.txt:118) | One root element + a `Text` child; no per-instance rules beyond `Component`'s own | `doLayout`: 4 guarded setters on `_text`, 1 `getContentBounds`, no live reads. Per **show**: 2–4 `measureText` (forced layouts) + 1 `getViewportSize`. Per **hide**: 3 sink applies + 1 timer + 2 leaked listeners | **over-built** — the attach mechanism does far more work per call than its function needs | F11.1, F11.2, F11.3 |
| `overlay/Popover.ts` | "An anchored, non-modal floating bubble with a directional arrow tail" (llms.txt:116) | Root + a raw-inserted arrow `Component` | `doLayout`: 1 `getElementRect` + 1 `getViewportSize` + a guarded `setShadow`. Per reposition event: 4 live reads, 0 writes when unchanged | **over-built** on the read side, `fits` otherwise | F11.4 |
| `overlay/PopupPanel.ts` | "A floating panel that sizes itself to its content, places itself against a trigger rect, and caps its height" (llms.txt:117) | Inherits `AnimatedDropdown`'s root; own class-tier rule | None of its own — no `doLayout` override. Per open: 1 `getViewportSize`, 1 `getPreferredSize`, 6 geometry setters | `fits` | F11.13 |
| `overlay/Notification.ts` | "A lightweight toast-style notification … auto-dismisses after a configurable duration" (llms.txt:119) | Root + badge `Glyph` + `SelectableText` + close `Button` | `doLayout`: 12 guarded setters on constants + 1 forced `_closeButton.doLayout()`. Per show/dismiss: 1 `getViewportSize` in `restack` | **mismatch** — promises viewport-corner placement but never tracks the viewport | F11.7, F11.10, F11.11, F11.12 |
| `overlay/NotificationHistoryButton.ts` | "A trigger button that opens a menu of recent notifications" (llms.txt:120) | None of its own (a `MenuButton` subclass) | None — the provider runs per menu open, not per pass | `fits` | — |
| `overlay/ButtonGroup.ts` | "Manages mutual exclusivity among a set of RadioButton or ToggleButton instances" (llms.txt:38) | **None** — not a `Component` (yet `callable()`-wrapped at `:301`) | None | **over-built** — leaks listeners it never tracks | F11.9 |
| `core/AnimatedDropdown.ts` | "Floating panel that fades in on `showAnimated` and fades out + detaches on `hideAnimated`" (class JSDoc `:41-48`) | Root element; own class-tier rule | None — no `doLayout`. Per open: 1 `getViewportSize` in `placeAnchored` | **over-built** — re-implements `OverlayFade` | F11.8 |
| `core/LayerManager.ts` | "Central registry and document-level interaction broker for portaled overlay surfaces" (`:148-163`) | **None** — never writes the DOM (`:457` comment is accurate) | **Zero.** Per pointerdown/focusin: 2 array allocations + `DOM.source.contains` per layer. Per open/close: O(stack) splice | `fits` on render work; **mismatch** on the z allocator | F11.6 |
| `core/OverlayPosition.ts` | Pure placement primitives — "all viewport reads are supplied by the caller, so it is directly unit-testable with no DOM" (`:237-239`) | **None** | **Zero** — no DOM access of any kind | `fits` — the best-factored file in the slice | — |
| `core/OverlayFade.ts` | The shared dropdown-style entrance/exit fade (`:38-51`) | **None** — operates on a passed `Component` | **Zero** per pass. Per show/hide: 2 `setWillChange` inline writes + one `Animation.play` | `fits`, but under-used | F11.8 |
| `core/Animation.ts` | "Small helpers for playing CSS transitions on raw DOM elements" (`:10-23`) | **None** — writes through a per-call `InlineStyle` buffer | **Zero per frame** for `play` (CSS-driven). `tween` allocates one values object per rAF tick (`:428`) and nulls its frame id on completion (`:443`) | `fits`, except the listener residue | F11.1 (listener removal) |
| `component/container/FloatingPanel.ts` | "A `Panel` that pins itself to one corner of its host's inner box, via an owned `AnchorConstraints`" (llms.txt:39) | Inherits `Panel`'s root | None of its own. Per **host** pass via `placeNextTo`: 1 `getElementRect` (forced) + 1 `getContentInsets()` allocation | **mismatch** — a placement verb with a live read on a per-pass path | F11.5 |

---

## Redundant, duplicated and dead code

Items not already covered by a finding. Greps run over `packages/` (lib source, lib tests, docs app,
create-app), excluding `node_modules` and `packages/lib/dist`.

- **`Popover.clearActions()` has zero callers.** `grep -rn --include=*.ts "clearActions" packages/`
  → 2 hits: the declaration (`overlay/Popover.ts:443`) and the generated
  `dist/lib/types/overlay/Popover.d.ts:47`. No test, no docs-app usage, no library usage. It is
  public API so removal is a breaking change; flag it, do not delete it silently.
- **`AnimatedDropdown.onShowComplete()` has no implementor.**
  `grep -rn --include=*.ts "onShowComplete" packages/lib/src` → 3 hits, all inside
  `core/AnimatedDropdown.ts` itself (`:218`, `:232`, `:360`). Its sibling `onHideComplete` has
  exactly one override (`component/input/AutoCompleteDropdown.ts:238`). A documented `protected`
  extension point with no user after the whole picker family was built on the class.
- **`LayerManager`'s comments say "three document-level listeners"; there are four.**
  `core/LayerManager.ts:159-161` ("a single set of document-level `pointerdown` / `focusin` /
  `keydown` listeners"), `:710` and `:720` — all three miss the `blur` listener added at `:715`/`:725`.
- **`Tooltip.md` claims behaviour the code does not implement.** "The tooltip appears 500 ms after
  the pointer enters the component **and follows the pointer until it leaves**"
  (`docs/components/Tooltip.md:17`). `mousemoveFn` (`Tooltip.ts:417-420`) only updates the coordinates
  used by the *pending* show; nothing re-invokes `show()` once the tooltip is up. Either the doc or
  the listener should go — see F11.2's proposal (4).
- **`Notification`'s "named listener refs" comment is inaccurate.** `overlay/Notification.ts:149-159`
  says the four handlers are "Named listener refs (removable, grep-able, **named in stack traces**)";
  all four are anonymous arrow functions assigned to named fields, so they are removable and
  grep-able but appear unnamed in a stack trace. Cosmetic; mentioned because the same file's
  neighbours took the comment at face value.
- **`Glyph.register(...)` runs as a module import side effect** in `overlay/Notification.ts:33`
  (5 glyphs) and `overlay/NotificationHistoryButton.ts:10` (1 glyph). `overlay/index.ts:16-19`
  re-exports both, so importing anything at all from `@jimka/typescript-ui/overlay` registers six
  glyph datasets. Bundle/startup cost, not render work; noted for whoever owns the glyph registry
  (slice 13).
- **Health-audit items in this slice that are now CLOSED** (verified against current `master`):
  - Audit Priority 2 #6 — "`Menu.open()`'s horizontal placement hand-rolls the primitives
    `overlay-edge-flip` built to replace exactly this." **Closed.** `overlay/Menu.ts:646` now calls
    `positionAdjacent` for the submenu axis, `:663`/`:666` call `positionAnchoredFlexible` for the
    top-level dropdown, and `placeVertically` (the only remaining local helper) is a three-line
    wrapper over `positionFlexibleAnchored`. One placement policy, routed through the primitives.
  - Audit "Unused exports" — `core/OverlayPosition.ts:12,20,140` (`AnchorAxis`, `AnchorOptions`,
    `FlexiblePlacement`). **Closed.** `AnchorAxis` no longer exists (the file imports
    `AxisOrientation` from `primitive/Axis.ts` at `:6`, which also closes audit #8's third
    near-duplicate), and `AnchorOptions` (`:14`) and `FlexiblePlacement` (`:134`) are now
    module-private interfaces with no `export` keyword.

**Positives this slice must not regress** (per the briefing's instruction to record them):

- `LayerManager` performs **zero DOM writes and zero geometry reads**. Its only seam calls are
  `DOM.source.contains` / `intern` / `isWindow` in the pointer and focus handlers. There is no
  per-frame work, no viewport-size read, no rule write. The `restampSubtree` comment at `:456-459`
  ("the manager never writes the DOM") is accurate.
- `Animation.play` costs **zero JS per animated frame** — the motion is a CSS transition, the styles
  go through an `InlineStyle` buffer (`Animation.ts:115`), and `finish` clears `transition` so a
  later `transform` write is not retroactively animated (`:174`). `Animation.tween`'s rAF loop nulls
  its frame id when it ends (`:443`) and `cancel()` is guarded against a double-cancel.
- **No stylesheet-rule write is reachable on any per-frame or per-pointer-event path in this slice.**
  I specifically suspected `Popover.positionArrow`'s per-reposition `setShadow` (`:907`); probe P3
  shows `setRuleStyles ops 0` for both an unchanged-anchor and a moved-anchor reposition, because
  `Component.setShadow` is guarded (`Component.ts:3098-3125`). `setZIndex` is likewise guarded and
  writes inline, not to a rule (`Component.ts:2263-2272`, corroborated by probe P6's style keys).
- **Nothing in this slice parks content in the render tree.** Every overlay calls `removeElement()`
  on hide — `Tooltip.ts:371`, `AnimatedDropdown.ts:251`, `OverlayFade.ts:106` — so the
  `visibility: hidden` hazard slice 07 found in `Tab.setBarVisible` has no analogue here.
- `Tooltip.attach`'s auto-detach teardown hook is correctly guarded by a `WeakSet`
  (`Tooltip.ts:450-453`), so repeated attaches register exactly one `onDestroy` hook — pinned by
  `tests/overlay/Tooltip.test.ts:291`. Any F11.2 rewrite must keep that.
- `core/OverlayPosition.ts` is pure, exhaustively unit-tested (37 cases in
  `tests/overlay/OverlayPosition.test.ts`, including two property-style invariants), and is now the
  single placement vocabulary for `Tooltip`, `Menu`, `PopupPanel` and `AnimatedDropdown`.

---

## Cross-slice notes

- **→ 01 core-component-lifecycle.** `Component.removeElement()` detaches the node but leaves the
  handle in place, so `getElement()` keeps returning a live handle for a component that is no longer
  in the document. `Tooltip.hide`'s `if (!el) return` guard (`Tooltip.ts:354`) is written against the
  opposite assumption and is dead after the first show — the root cause of F11.1. Any overlay that
  uses "has an element" as a proxy for "is mounted" has the same bug shape. Either
  `removeElement` should clear the handle, or `Component` should expose an `isMounted()` the
  overlays can test.
- **→ 13 button-glyph-image.** `Button.setText` (`Button.ts:1167-1179`) has **no unchanged-text
  guard** and unconditionally runs `recomputePreferredSize()` + `_rebuildTooltip()` +
  `_reflectAccessibleName()`. `_rebuildTooltip` is the entry point for F11.1 and F11.2, so a
  same-text guard on `setText` would remove the whole chain for the repeat case, complementing the
  guard proposed inside `Tooltip.attach`. This is the same shape as slice 13's confirmed
  `Button.setGlyph` finding.
- **→ 18 lists-trees.** `AbstractSelectableList.applyTooltip` (`:421-432`) calls `Tooltip.attach`
  from `updateItem` (`:407`), i.e. on **every pooled-row rebind during a virtual scroll**, with no
  comparison against the text already attached. Its own comment ("Tooltip.attach replaces any prior
  attachment, so re-attaching with new text on pool reuse is safe") is correct about safety and
  silent about cost: today each rebind pays 8 `Event` API calls, 5 allocations and one stray
  fade-out. F11.2's same-text guard fixes this call site for free.
- **→ 25 display-markdown.** `MarkdownViewer.doLayout` (`:214-224`) is what makes
  `FloatingPanel.placeNextTo`'s live rect read a per-frame cost (F11.5). The cleanest fix may belong
  on `Markdown` — a cached rendered-width accessor invalidated by `setMaxMeasure` / `setFontScale` —
  rather than on `FloatingPanel`. Whoever plans slice 25 should coordinate.
- **→ 12 menus-toolbars.** The 2026-08-29 audit's Priority-2 #6 (`Menu` hand-rolling the
  `OverlayPosition` primitives) is **closed** — see the Redundant section for the evidence. Note for
  slice 12: `Menu` composes `OverlayFade`'s free functions (`Menu.ts:740`, `:752`) while
  `AnimatedDropdown` re-implements them (F11.8); `Menu` is the pattern to converge on, not the
  outlier.
- **→ 09 overlay-windows-dialogs.** `AbstractWindow`'s raise-on-mousedown is the gesture that burns
  `LayerManager`'s global z counter (F11.6). The fix has to be agreed across both slices: either the
  window stops calling `bringToFront` when it is already topmost, or the manager early-returns.
- **→ 03 core-dom-seam-events.** `DOM.sink.addListener(..., { once: true })` has no cleanup path
  when the event never fires. `Animation.play` (`:211-212`) is the library's heaviest user of that
  shape and leaks two listeners per non-firing transition (probe P5). If the seam grew an
  `addOnceListener` that tracked and could revoke its registration, `Animation` would be the first
  consumer. Also confirming slice 03's `getViewportSize` finding from this side: this slice calls it
  once per `Tooltip.show`, twice per `Popover._reposition` (plus once more per `Popover.doLayout`),
  once per `PopupPanel.showAt`, once per `AnimatedDropdown.placeAnchored`, and once per
  `Notification.restack` — every one of them a forced document layout for a value the `Math.max` at
  `DOM.ts:2337` discards.
- **→ 05 layout-base-box-flow-grid.** `Popover._reposition` calls `this.getPreferredSize()` on every
  scroll event and every resize frame (`Popover.ts:703`). With no memo anywhere (slices 01 and 05),
  that is a full un-cached size aggregation over the popover subtree per pointer/scroll event, on
  top of the four forced layouts in F11.4.
- **Seam contract this slice relies on that does not hold:** the layout system's "a child handed the
  rectangle it already has is not re-laid-out" contract. `Popover`, `Tooltip` and `Notification` all
  override `doLayout` and none opts into `canSkipUnchangedLayout`, matching the briefing's confirmed
  finding that no built-in class does. Of the three, **`Notification` is the one that could safely
  opt in** — its box is a fixed 320×64 whose children are placed from static constants, so an
  unchanged commit genuinely has nothing to do. `Popover` and `Tooltip` cannot, because their
  `doLayout` bodies depend on inputs (the anchor rect, the line count) that change without the
  rectangle changing.

---

## Suggested plan grouping

**Plan A — "tooltip hover-path cost"** (F11.1 + F11.2 + F11.3). One coherent change set, one
measurable surface: the cost of moving the pointer across a toolbar, and of a button re-labelling
itself. Three mechanisms that each stand alone but share every test file:
`Tooltip.hide` early return, `Tooltip.attach` same-text guard + shared module-level handlers +
anchor-scoped `detach`-hide, and the batched/memoised measurement in `Tooltip.show`. Depends on
nothing. **Highest payoff in the slice.** The `Animation.play` listener-removal half of F11.1 can
ship inside this plan or be split into Plan E; it is a two-line change in `core/Animation.ts` with
its own probe. Coordinate with slice 13 so `Button.setText`'s same-text guard lands with it.

**Plan B — "popover reposition coalescing"** (F11.4). Self-contained in `overlay/Popover.ts`: rAF
coalescing on the two listener callbacks, threading `anchorRect`/`vp` into `positionArrow`, and an
unchanged-anchor early return. Measurable on its own (forced-read count per synthetic scroll storm).
Independent of Plan A. Would benefit from slice 05's size-hint memo landing first, but does not
depend on it.

**Plan C — "floating-panel rendered-width cache"** (F11.5). Touches `FloatingPanel` and, depending
on the design chosen, `Markdown`. **Depends on slice 25's review** to decide whether the cache lives
on the panel or the prose column. Measured on the Loom Markdown-preview gutter drag, where it should
show up directly in ms/frame.

**Plan D — "layer z allocation"** (F11.6 + F11.7). One change set: per-band counters (or
renormalisation), an already-topmost early return in `bringToFront`, and giving `Notification` a real
band instead of the `10002` literal. **Depends on slice 09** agreeing the `AbstractWindow` side, and
requires an explicit decision about `tests/overlay/LayerManager.test.ts:177-194`, which pins the
behaviour the early return removes. Correctness payoff, not frame time — plan it, but after A and B.

**Plan E — "overlay fade convergence"** (F11.8, optionally carrying F11.1's `Animation` half).
`AnimatedDropdown.showAnimated`/`hideAnimated` delegate to `OverlayFade`. Pure consolidation with no
measurable render gain; its value is that F11.1's listener fix and any future `Animation.play`
change then has one call path to verify instead of three. **Should land after Plan A**, so the
listener fix is already in place and this only moves code.

**Too small to plan — ride along with a neighbour:**

- F11.9 (`ButtonGroup` listener leaks) — ride with whichever plan touches `RovingTabIndex` or the
  toggle-button family (slices 13 / 28). It is a correctness fix with no render-work component.
- F11.11 and F11.12 (`Notification` resize re-stack; constant `doLayout`) — ride with Plan D, which
  already opens `overlay/Notification.ts`. F11.12 should also carry the `canSkipUnchangedLayout`
  opt-in noted in the cross-slice section, since `Notification` is a clean candidate for it.
- F11.13 (`PopupPanel.showAt` pass count) — ride with Plan B; both are open-path layout-scheduling
  cleanups in the same directory.
- F11.10 (`Notification` subtree listeners) — ride with Plan D only if the `pointer-events`
  investigation it needs is cheap; otherwise drop it. The marginal cost in a Loom shell is near zero.
- The documentation corrections in the Redundant section (the "three listeners" comment, the
  `Tooltip.md` follows-the-pointer claim, the `Notification` named-refs comment) should ride with
  whichever plan touches each file, rather than becoming a docs plan of their own.
