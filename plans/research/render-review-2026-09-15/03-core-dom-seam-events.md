# 03 core-dom-seam-events — render-work review

**Summary**

1. **Every component issues one empty `DOM.sink.apply` per layout pass.** `InlineStyle.flushDirty` has no empty-bag guard (its sibling `StyleRule.flushDirty` has one), so `applyBounds`' `setAutoCommitStyle(true)` flushes `{ style: {} }` even when the rectangle did not change. Probe P6: a 201-component tree, one unchanged full-tree pass → **200 `apply` calls, 200 of them empty**. At Loom's tree size during a gutter drag that is ~2k wasted handle resolves and ~4k allocations per frame. Hot path 1. (F03.1)
2. **`DOMSource.getViewportSize()` forces a document layout for a number `Math.max` then throws away.** `document.documentElement.clientWidth` is a forced-reflow read and is always ≤ `window.innerWidth`, so the `Math.max` never selects it on any desktop engine. 30 call sites; probe P1 shows **one `resize` event costs one read per registered viewport-`resize` listener**, and the later ones land after earlier handlers' DOM writes → a forced synchronous layout per extra listener per resize frame. Hot path 1. (F03.2)
3. **`Event`'s subtree ancestor walk is O(DOM depth) for every event of a type *any* component registered**, matching or not. Probe P3: a 20-deep unrelated subtree, zero matching ancestors → **20 `getId` + 20 `getParentElement` seam calls**, each a registry resolve, and each ancestor `intern`ed (a `WeakRef` + a `FinalizationRegistry.register` on first sight). `Button` registers `pointerover`/`pointerout` subtree listeners for its whole life and `SplitGutter` registers `mouseover`/`mouseout`, so all four walks run on every element-boundary crossing — including inside a CodeMirror editor. Hot path 3. (F03.3)
4. **`ProductionDOMSink.deleteStyleRule` linear-scans `sheet.cssRules` to find the rule's index** — up to ~6.8k CSSOM index reads per deletion at the rule counts `stylerule-batched-flush` measured — on the table cell-rule churn path `performance.md` says fires on most single-column scroll steps. Hot path 2. (F03.4)
5. **The sink filters nothing.** Unchanged-value suppression lives entirely in `Component`'s typed setters (probe P4: a repeated identical `setBackgroundColor` reaches the sink zero times). `setRuleStyles` writes the sheet unconditionally even though its multi-key path already reads `rule.style.cssText` and could compare — and a sheet mutation is a full-document restyle regardless of value. (F03.6)

The diagnostics sampler costs **nothing** when the overlay is closed: `DiagnosticsSampler.start()` only runs from `DiagnosticsOverlay.open()`, and the overlay instance is constructed lazily there. The always-on residue is three unconditional integer increments (`noteComponentConstructed`, `noteBagListener*`, `noteLayoutPass`) plus one `Diagnostics.isTimingEnabled()` boolean read per layout flush.

---

## Findings

### F03.1 `InlineStyle` flushes an empty style patch through the sink once per component per layout pass

- **Category**: B (unchanged-value write), G (allocation churn), I (the guard exists in the sibling subclass)
- **Impact**: HIGH — one wasted seam call + handle resolve + two allocations per component per layout pass, on hot path 1.
- **Where**:
  - `core/StyleTarget.ts:79-83` — `StyleTarget.flush()` calls `flushDirty(this._dirty)` with no empty check.
  - `core/StyleTarget.ts:457-459` — `InlineStyle.flushDirty` → `DOM.sink.apply(this._target!, { style: dirty })`, unconditional.
  - `core/StyleTarget.ts:404-410` — `StyleRule.flushDirty` **does** early-return on `Object.keys(dirty).length === 0`.
  - `core/DOM.ts:340-346` — `applyPatchTo` treats `{}` as truthy, allocates `Object.keys({})`, loops zero times.
  - `core/DOM.ts:1641-1643` — `ProductionDOMSink.apply` resolves the handle before it knows the patch is empty.
- **Hot path**:
  - `flushPendingLayouts` (rAF) → `Component.doLayout`
  - → `LayoutManager.commitBounds` / `Component.applyBounds` (`core/Component.ts:3977`)
  - → `setAutoCommitStyle(false)` … `writeBounds` (no property changes when the rectangle is unchanged)
  - → `setAutoCommitStyle(true)` (`core/Component.ts:1809-1816`) → `commitElementStyle()` → `InlineStyle.flush()`
  - → `flushDirty({})` → `DOM.sink.apply(handle, { style: {} })` → `_registry.resolve(handle)` + `Object.keys({})`
  - once per component in the subtree, once per frame.
- **Evidence**: probe P6 (`.worktrees/_probes/03-core-dom-seam-events/seam-events.probe.test.ts`), 201 components, second `doLayout()` with identical bounds:
  `P6 { components: 201, appliesInUnchangedPass: 200, emptyAppliesInPass: 200 }` — every `apply` in the pass carried an empty style bag. Probe P5 on the same path shows the non-empty case also carries a stale property: `widthOnlyPatches: [['left','width']]` — `left` rides along unchanged because `setWidth` and `setX` both call `writeHorizontalGeometry()`, which writes both.
- **Proposed change**: give `StyleTarget.flush()` the same empty-bag early return `StyleRule.flushDirty` already has (or move the guard into `flush()` and delete the subclass copy, which is the duplication half). Add a defensive `if (!patch.style || …)` short-circuit in `ProductionDOMSink.apply` / `applyPatchTo` so a direct sink caller with an empty patch also costs nothing. The `left`-rides-along half belongs to `writeHorizontalGeometry` (slice 01).
- **Risk / blast radius**: `StyleTarget.flush()` is reached from `Component.commitElementStyle`, `setAutoCommitStyle(true)`, and `InlineStyle.attach`. Tests that count recorded `apply` ops would see fewer — grep `tests/` for `op === 'apply'` assertions before changing. Production behaviour is identical: an empty patch writes nothing today either.
- **Proof at implement time**: re-run probe P6 — `emptyAppliesInPass` must be 0. Then `ms/frame` on the 2×2 editor-grid horizontal drag, and total `apply` ops per frame under the recording sink.

### F03.2 `getViewportSize()` pays a forced document layout for a value `Math.max` discards, once per registered `resize` listener per resize frame

- **Category**: A (forced sync read on a hot path), J (a read whose result can never win)
- **Impact**: HIGH — per resize frame, multiplied by the number of live viewport-`resize` listeners (Body + Rail + Drawer + each open Window/Dialog/Popover + each `Markdown`).
- **Where**:
  - `core/DOM.ts:2336-2341` — `ProductionDOMSource.getViewportSize()`:
    ```typescript
    const width  = Math.max(document.documentElement.clientWidth,  window.innerWidth  || 0);
    const height = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);
    ```
  - Callers that fire on `resize`: `core/Body.ts:225`, `overlay/Rail.ts:1249` (via `_boundResizeHandler` → `applyRestingGeometry` → `restingRect`), `overlay/Drawer.ts:436`, `overlay/Dialog.ts:892,1000`, `overlay/Popover.ts:706,909`, `overlay/AbstractWindow.ts:2206,2272,2576,2597,2646,2658,2777,3112`, `component/display/Markdown.ts:1339,1421`.
  - 30 call sites in total; full list in the read-classification table below.
- **Hot path**:
  - window `resize` → `Event.baseViewportListener` (`core/Event.ts:350`)
  - → handler 1 = `Body._onViewportResize` (`core/Body.ts:224-226`) → `getViewportSize()` (read #1) → `setSize(...)` → `InlineStyle` writes on `<body>`
  - → handler 2 = `Rail._boundResizeHandler` / `Drawer.onViewportResize` / `AbstractWindow.onViewportResize` → `restingRect()` / `computeMaximizeRect()` → `getViewportSize()` (read #2, **after** handler 1's writes, same task → forced style+layout of the whole document)
  - → handler 3, 4 … each the same.
- **Evidence**: `window.innerWidth` is the layout viewport *including* the classic scrollbar; `documentElement.clientWidth` is the same viewport *excluding* it — so `innerWidth >= clientWidth` on any desktop engine and `Math.max` returns `innerWidth` in every case except `innerWidth` being falsy. The `clientWidth` / `clientHeight` reads are therefore pure cost: they are in the standard forced-reflow set, `innerWidth` is not. Probe P1 (two registered `resize` listeners, one dispatched `resize`): `viewportReadsForOneEvent: 2`. Separately, P1 confirms `Body` does **not** write on an unchanged viewport (`unchangedViewportBodyWrites: 0`) — `Component.setWidth`/`setHeight` already early-out (`core/Component.ts:4055-4060`), so this finding is about the read, not the write.
- **Proposed change**: two independent halves, either useful alone.
  (a) Reorder the expression to `window.innerWidth || document.documentElement.clientWidth` (same value, no forced reflow) — keep `clientWidth` only as the fallback for an engine with no `innerWidth`.
  (b) Memoize the result inside `ProductionDOMSource` for the duration of the task (`queueMicrotask` clears it), so N handlers for one `resize` event share one read. (b) alone removes the *repeat* forced layouts; (a) removes them all.
- **Risk / blast radius**: (a) changes the returned number only on an engine where `innerWidth < clientWidth` (mobile pinch-zoom visual viewport); the current `Math.max` already prefers the larger, so the desktop value is unchanged. (b) makes a caller that reads → writes → reads within one task see the first value; nothing in the library does that with the viewport. `tests/dom/viewport-consume.test.ts` and the `ModelledDOMSource` path (which does not read the DOM at all) pin the seam's contract, not the production expression.
- **Proof at implement time**: a WebKitGTK Timeline recording of a window drag-resize with a `Rail` mounted — count "Recalculate Style / Layout" entries per `resize` task before and after; and probe P1's `viewportReadsForOneEvent` (→ 1 after (b)).

### F03.3 The subtree ancestor walk climbs to the document root for every event of a registered type, interning each ancestor

- **Category**: G (allocation / registry churn), H (does more than the function requires)
- **Impact**: MEDIUM — per pointer event, O(DOM depth) seam calls; Loom's `pointerover`/`pointerout`/`mouseover`/`mouseout` all qualify, and boundary crossings inside a CodeMirror editor fire them tens of times a second.
- **Where**:
  - `core/Event.ts:296-346` — the `while (handle)` walk: `DOM.source.getId(handle)` (line 306) then `DOM.source.getParentElement(handle)` (line 340), one pair per ancestor, with no termination other than `parentElement === null`.
  - `core/DOM.ts:2568-2572` — `getParentElement` interns the parent: `_registry.intern(parent)`.
  - `core/DOM.ts:212-224` — `HandleRegistry.intern` mints a `WeakRef` **and** a `FinalizationRegistry.register` for every node the registry has not seen.
  - Permanent registrations that keep the window listener installed for their type: `component/button/Button.ts:851-853` (`pointerdown`, `pointerover`, `pointerout`, constructor, never removed), `component/container/SplitGutter.ts:230-231` (`mouseover`, `mouseout`), `layout/Accordion.ts:1403-1404` (per header), `overlay/Notification.ts:249-250`, `core/Component.ts:4882` (`wheel`).
- **Hot path**:
  - pointer crosses an element boundary inside a CodeMirror editor
  - → window capture `pointerover` → `Event.baseListener` (`core/Event.ts:248`)
  - → `DOM.source.intern(evnt.target)` (line 272) — a fresh mint for each recycled CodeMirror span
  - → exact-target phase misses (`listenerMap` has no entry for that raw span's id)
  - → `subtreeListenerMap.get("pointerover")` is non-empty because *some* `Button` exists
  - → walk: span → `.cm-line` → `.cm-content` → `.cm-scroller` → `.cm-editor` → content frame → clip frame → `TabPanel` → `Dock` … → `<body>` → `<html>`
  - → 2 registry resolves + 1 `WeakMap` get (+ a mint on first sight) per level, matching nothing
  - → repeated for `pointerout`, `mouseover`, `mouseout` on the same crossing.
- **Evidence**: probe P3 — a 20-deep component chain, an unrelated registrar holding the only subtree registration for the type: `P3 { chainDepth: 20, matches: 0, getId: 20, getParentElement: 20 }`. Probe P2 — a 12-deep chain with the listener two hops above the target: `P2 { chainDepth: 12, hopsNeeded: 2, getId: 12, getParentElement: 12 }`, i.e. the walk does 6× the necessary work and then continues to the root. The walk is not a forced layout — `.id` and `.parentElement` are attribute/structural reads — so this is call and allocation cost, not reflow cost.
- **Proposed change**: replace the per-level pair with one seam call, `DOMSource.getAncestorIds(handle): readonly string[]`, that climbs `parentElement` inside `core/DOM.ts` and returns the ids only. That is one handle resolve and zero interns per event instead of 2·depth resolves and up to depth interns, and it keeps the seam worker-shaped (a plain string array crosses `postMessage`). `baseListener` then iterates the array against `subtreeListeners`. The two `try`/`catch` reentrancy guards (`core/Event.ts:304-315`, `339-345`) become unnecessary — a disposed component's id is already gone from the map, so a stale id simply misses.
- **Risk / blast radius**: `tests/dom/event-subtree-reentrant-dispose.test.ts` case **EV2** ("a subtree listener disposing its own component ends the walk without crashing") asserts an *outer* ancestor listener does **not** run after an inner one disposes itself. With a snapshot the outer listener would run, because its component is still alive and registered. Read the code comment at `core/Event.ts:304-315`: the abort is described as crash-avoidance for an unresolvable handle, not as a contract — so EV2 pins incidental behaviour and would need restating. EV1/EV3/EV4 are unaffected. Also check `Event.reindexComponent`: a `setId` fired from a listener mid-walk would be seen by the current loop and not by a snapshot; `tests/dom/events.test.ts` "setId reindex" cases dispatch after the rename, not during, so they do not pin it.
- **Proof at implement time**: a probe asserting `getParentElement` call count is 0 and `getId` call count is 0 for one dispatched event on a 20-deep chain (P3 re-run), plus `_handleRegistrySize()` growth across 1,000 synthetic `pointerover` dispatches over distinct leaf nodes.

### F03.4 `deleteStyleRule` linear-scans the live `cssRules` list to find the index to delete

- **Category**: D (work recomputed that a cache already holds), H
- **Impact**: MEDIUM — per freed per-instance rule; `performance.md` states a wide table crosses a cell-rule rebuild "on most single-column scroll steps", so this sits on hot path 2.
- **Where**: `core/DOM.ts:1714-1741`.
  ```typescript
  for (let idx = 0; idx < sheet.cssRules.length; idx += 1) {
      if (sheet.cssRules[idx] === rule) { sheet.deleteRule(idx); return; }
  }
  ```
  Reached from `core/StyleTarget.ts:232` (`disposeStyleRule`) ← `StyleRule.dispose` ← `Component.destructor` / the component `FinalizationRegistry`.
- **Hot path**:
  - `VirtualScroller` horizontal scroll → `Table.Body` slides the column window
  - → a cell whose type changed is rebuilt → old cell `dispose()` → `StyleRule.dispose()` → `disposeStyleRule(selector)`
  - → `DOM.sink.deleteStyleRule` → `mainSheet()` (see F03.5) → `ruleIndex(sheet)` → **full `cssRules` scan** → `sheet.deleteRule(idx)`
  - once per freed cell per scroll step.
- **Evidence**: read at `core/DOM.ts:1714-1741`. The sink already maintains `_ruleIndex: Map<string, CSSStyleRule>` (`core/DOM.ts:1623`) and hands back the rule object in O(1), but has no index → position mapping, so the position is re-derived by walking the CSSOM. `plans/implemented/stylerule-batched-flush.md` records 6,768 rules on the shared sheet for a 5,904-component window; each `sheet.cssRules[idx]` is a CSSOM binding call, not a JS array index. Not measured on a real engine — flagged as an O(N)-per-delete structural fact, not a measured millisecond figure.
- **Proposed change**: keep an insertion-ordered `CSSStyleRule[]` alongside `_ruleIndex` so the position is found by `Array.prototype.indexOf` over plain JS references (same asymptotics, ~two orders of magnitude cheaper per probe), or carry the index in the map value and repair the tail after a delete. A third option that removes both the scan and the `deleteRule` sheet mutation: blank the rule (`setRuleStyles(rule, {…: null})`) and keep it on a free list keyed by the selector shape — but that changes `_ruleCacheHas` semantics and `tests/dom/style-rule-index.test.ts` asserts a deleted selector really leaves the sheet, so it is a larger change.
- **Risk / blast radius**: `tests/dom/style-rule-index.test.ts` pins the full contract, including "deletes from the middle without disturbing the surviving rules", "adopts an existing rule left on the sheet after `DOM.reset()`", and the two `@keyframes`-interleaving cases. Any position bookkeeping must survive the adopt-after-reset path, where `ruleIndex` rebuilds from the live sheet and non-`STYLE_RULE` entries (keyframes) occupy positions the map never sees.
- **Proof at implement time**: a probe counting `cssRules` index reads per `deleteStyleRule` against a synthetic 5,000-rule sheet; then `ms/frame` on a wide-table horizontal scroll in the WebKitGTK harness.

### F03.5 `mainSheet()` re-finds `<head>` and re-scans its `<style>` elements on every rule insert, delete and keyframe check

- **Category**: D (recomputed with unchanged inputs), H
- **Impact**: MEDIUM-LOW — once per component-rule materialisation and once per component-rule disposal; it rides along on F03.4's path, so the two fix together.
- **Where**: `core/DOM.ts:1797-1820`. Every call does `document.getElementsByTagName("head")[0]`, then `head.getElementsByTagName("style")` and a loop reading `.id` on each, then `style.sheet`. Callers: `ensureStyleRule` (`:1696`), `deleteStyleRule` (`:1714`), `ensureKeyframes` (`:1743`).
- **Hot path**: same as F03.4, plus first render of every component (`Component.materialiseStyleRule` → `StyleRule.ensure` → `_ruleFor` → `DOM.sink.ensureStyleRule` → `mainSheet()`).
- **Evidence**: read at `core/DOM.ts:1797-1820`. There is no memo field; `_indexedSheet` caches the *index* keyed on the sheet object but `mainSheet()` itself is called first, every time, to produce that object. `ensureKeyframes` additionally walks the whole `cssRules` list (`core/DOM.ts:1743-1755`) on each call — cold in practice (seven module-level call sites) but the same shape.
- **Proposed change**: cache the `CSSStyleSheet` in a private field, invalidated in the same place `_indexedSheet` is (a new sink instance after `DOM.reset()` starts with a null cache, which is already the correct behaviour). Keep the `<style id="Base">` re-discovery for the first call only.
- **Risk / blast radius**: a consumer that removes and re-creates `<style id="Base">` mid-session would keep writing to a detached sheet. Nothing in the library does; the `DOM.reset()` adopt path (`tests/dom/style-rule-index.test.ts` "adopts an existing rule left on the sheet after `DOM.reset()`") replaces the *sink*, which resets the cache with it.
- **Proof at implement time**: a probe counting `getElementsByTagName` calls per `ensureStyleRule` against a jsdom sheet; expect 0 after the first.

### F03.6 The sink performs no unchanged-value filtering — including on the stylesheet path, where a same-value write costs a full-document restyle

- **Category**: B, C (stylesheet-rule write reachable per event)
- **Impact**: MEDIUM — not reachable per *frame* through `Component`'s typed setters (which filter), but reachable per pointer event through the state-rule path and by any direct `DOM.sink` caller.
- **Where**:
  - `core/DOM.ts:1667-1694` — `ProductionDOMSink.setRuleStyles`. The multi-key branch already reads `rule.style.cssText` into the scratch declaration, mutates the scratch, then assigns `rule.style.cssText = scratch.cssText` **unconditionally**. The single-key branch (`keys.length === 1`) writes `writeDeclaration(rule.style, key, value)` with no read and no comparison.
  - `core/DOM.ts:340-398` — `applyPatchTo`: every style key, class, attribute, dataset key, `textContent`, `scrollLeft` and `scrollTop` in the patch is written with no comparison.
  - `core/StyleTarget.ts:34-40, 61-63, 69-71` — `set` / `queue` / `queueMany` accept any value into the dirty bag without comparing it to what was last written.
- **Hot path**: `Component`'s per-state class/rule writes (`:hover`, `.pressed`) on `pointerover`/`pointerout`/`pointerdown` — one rule mutation per hover transition; and `SplitGutter.onMouseOver`/`onMouseOut` (`component/container/SplitGutter.ts:230-231`), which fire on every boundary crossing in or out of a gutter during a drag-adjacent mouse move.
- **Evidence**: probe P4 — `comp.setBackgroundColor('rgb(1, 2, 3)')` twice with an identical value after a first real set: `P4 { ruleWritesForTwoIdenticalSets: 0, applyWritesForTwoIdenticalSets: 0 }`. So the *typed setter* layer filters and the common path is safe; the seam itself does not, which is what a direct caller (144 `DOM.sink.apply` sites outside `core/DOM.ts`) and the `queue`/`queueMany` batching path get. `plans/implemented/stylerule-batched-flush.md`'s own outcome table records "Already-rendered component, re-render | same 24 keys, re-queued | no new rule, one `setRuleStyles`" — i.e. the plan deliberately left the same-value sheet mutation in place.
- **Proposed change**: in `setRuleStyles`, compare `scratch.cssText` with the `rule.style.cssText` it was seeded from and skip the write-back when equal (the read is already being paid). For the single-key branch, read the property off `rule.style` first and skip on equality — reading a `CSSStyleDeclaration`'s own specified value is not a computed-style read and does not force layout, which is why this guard is affordable where a `getComputedStyle` guard would not be. Optionally give `StyleTarget.set`/`queue` a last-written map so the bag never carries a no-op.
- **Risk / blast radius**: `RecordingDOMSink` records `setRuleStyles` ops and `tests/` assert on them via the `ruleStyleWrites(sink)` helper; a production-only guard does not change the recorded stream, but a `StyleTarget`-level guard would — decide which layer before touching tests. `cssText` round-tripping already normalises shorthand ordering, so the comparison is between two engine-serialised strings and is stable.
- **Proof at implement time**: rule writes per frame under the `count=1` diagnostics readout during a hover sweep across a `SplitGutter`; and a probe asserting a second `setRuleStyles` with an identical bag performs no sheet mutation.

### F03.7 `baseViewportListener` allocates one entry array per registered component per event

- **Category**: G
- **Impact**: LOW — per pointer event during a drag; small but on hot path 3.
- **Where**: `core/Event.ts:350-372`.
  ```typescript
  for (let listeners of typeListeners) {   // Map iteration yields a fresh [key, value] array
      let compFunc = listeners[1];
  ```
- **Hot path**: `mousemove` during a `Split`/`Accordion` gutter drag (`core/PointerDrag.ts:96` registers `mousemove` on the viewport), a `Dock` tab drag (`overlay/DragManager.ts:369`), a window drag (`overlay/AbstractWindow.ts:2095`), a scrollbar thumb drag (`component/container/Scrollbar.ts:1068`) → `baseViewportListener` → one array per entry per event.
- **Evidence**: read at `core/Event.ts:353-355`. Also note `component/container/Scrollbar.ts:268-269` and `component/input/SpinButton.ts:152-153` register viewport `mouseup`/`mouseleave` at construction and never remove them, so `viewportListenerMap.get("mouseup")` grows with the scrollbar/spinner count — every `mouseup` in the app fans out over all of them.
- **Proposed change**: iterate `typeListeners.values()` instead of the map itself. One line.
- **Risk / blast radius**: none — the key is unused. `tests/dom/events.test.ts` "runs every registered viewport component even when one of them consumes" (and its reversed-order twin) pin the iteration order, which `.values()` preserves.
- **Proof at implement time**: a heap-allocation probe is not available offline; land it as a ride-along with F03.3 and verify only that the viewport-delivery tests still pass.

### F03.8 The `ElementPatch` contract puts the two forced-layout writes last, after the style writes

- **Category**: A (latent — no current caller triggers it)
- **Impact**: LOW today; a correctness-of-contract hazard for future callers.
- **Where**: `core/DOM.ts:340-398` (`applyPatchTo`) and the documented order at `core/DOM.ts:122-125`: "styles first, then class removals before additions, … then dataset / text / scroll."
- **Hot path**: none currently. Assigning `element.scrollLeft` / `scrollTop` requires the engine to have up-to-date layout to clamp the offset, so a patch carrying both a style and a scroll offset forces a synchronous layout *inside a single `apply`* — the one shape the layout pipeline's "resolve everything, then commit" rule exists to prevent.
- **Evidence**: grep for patches carrying scroll offsets — `component/input/PickerColumn.ts:389`, `component/list/AbstractSelectableList.ts:2273,2275`, `core/Component.ts:4401,4424,4463,4910,4913` — every one passes scroll offsets alone, never mixed with `style`. So the hazard is unexercised.
- **Proposed change**: document the constraint at `ElementPatch` ("a patch carrying `scrollLeft`/`scrollTop` must carry nothing else, because the scroll write forces layout"), or split the scroll offsets out of `ElementPatch` into their own one-way sink method so the type cannot express the mix.
- **Risk / blast radius**: `tests/dom/handle-registry.test.ts` and `tests/dom/recorder.test.ts` exercise the combined patch shape; splitting the method would touch `RecordingDOMSink`.
- **Proof at implement time**: a lint or type-level check, not a counter.

### F03.9 `core/Type.ts` — 14 of 16 exports have no caller outside their own test

- **Category**: J (dead code), I (duplication with `Util`)
- **Impact**: LOW — code health; 261 lines and a public `Type` namespace kept alive by one test file.
- **Where**: `core/Type.ts:1-261`.
- **Evidence**: grep across all of `packages/` (lib, docs app, create-app) excluding `tests/` and `core/Type.ts` itself:
  ```
  grep -rn "Type\.\(requireNonNull\|isBoolean\|…\)" --include=*.ts packages/ | grep -v /tests/ | grep -v lib/core/Type.ts
  ```
  → three hits, two of them the same call: `component/list/AbstractSelectableList.ts:1263` (`Type.isArray`) and `core/Component.ts:2222` (`Type.isBoolean`, with a comment on `:2216` explaining it). `tests/unit/core/Type.test.ts` accounts for the other 59 references. Live importers of the module: two (`AbstractSelectableList.ts:13`, `Component.ts:13`).
  Duplication: `Type.isInteger` (`core/Type.ts:201`) and `Util.isInteger` (`core/Util.ts:385`) are the same predicate, and `Util.generateUUID` uses the `Util` one. `Type.isBoolean` (`:34`) resolves a bare global `toString` while `Type.isFunction` (`:121`) uses `{}.toString` for the identical idiom.
- **Proposed change**: reduce `Type` to the two predicates with callers (or inline them — `Array.isArray(items)` and `typeof value === "boolean"` say the same thing at both sites) and delete the rest with its test file. `Type` is not exported from `core/index.ts`, so removal is not consumer-visible — confirm before deleting.
- **Risk / blast radius**: `tests/unit/core/Type.test.ts` goes with it.
- **Proof at implement time**: bundle size of the `core` entry point; no runtime counter.

### F03.10 `Event.init()` is an exported no-op with zero callers

- **Category**: J
- **Impact**: LOW.
- **Where**: `core/Event.ts:370-375` — `export function init() { }` with the JSDoc "Initialises the event system (currently a no-op)."
- **Evidence**: `grep -rn "Event\.init(" --include=*.ts packages/` → 0 hits (excluding the declaration).
- **Proposed change**: delete it.
- **Risk / blast radius**: `Event` is exported from the `core` barrel, so this is a public API removal — bundle with the next minor.
- **Proof at implement time**: n/a.

### F03.11 `Event`'s three registries are typed with the boxed `String` object as the key

- **Category**: H
- **Impact**: LOW — code health; it forces defensive `String(...)` normalisation at two call sites.
- **Where**: `core/Event.ts:175-177` (`Map<String, Map<String, CompFunc>>` × 3), with the consequences at `core/Event.ts:707,715,748` (`touched.add(String(type))`, `const typeStr = String(type)`) and `core/Event.ts:760-763` (`ids.add(String(id))`, whose comment says "The maps are declared with `String` (object) keys throughout this module while every write passes a primitive, so normalise here").
- **Evidence**: every write passes a primitive `string`; no site ever constructs a `String` object, so the declared type is simply wrong and the normalisation is dead defence.
- **Proposed change**: change the three declarations to `Map<string, …>` and delete the four `String(...)` wrappers.
- **Risk / blast radius**: internal types only; `ListenerCounts` and the exported functions keep their signatures.
- **Proof at implement time**: type-check passes; `tests/unit/core/Event.test.ts` `purgeComponent` cases E1–E5 and `listenerCounts` cases 10–11 still pass.

### F03.12 `AutoRepeat` schedules through the raw `setTimeout`, though its tick writes to elements

- **Category**: H (violates the seam contract the sink's own docs state)
- **Impact**: LOW — a latent `DOM.reset()` hazard, not a render cost.
- **Where**: `core/AutoRepeat.ts:70, 91` use bare `clearTimeout` / `setTimeout`. The class JSDoc (`core/AutoRepeat.ts:30-32`) asserts "`setTimeout` is a process timer, not a DOM call, so it does not route through the DOM seam", but `dom-seams.md` draws the line differently: the sink "offers `setTimeout` / `clearTimeout` … for the one case where a timer is not merely a timer: a deferred callback that will write to an element." `AutoRepeat`'s `onTick` is exactly that — `component/input/SpinButton.ts:148` emits `"tick"`, which drives a `NumberSpinner` value write; `Scrollbar`'s arrow repeat drives a scroll write.
- **Evidence**: read at `core/AutoRepeat.ts:70,91` and `core/DOM.ts:2825-2838` (`DOM.reset()` calls `clearAllTimeouts()` before rebuilding the registry, precisely so a pending timer cannot resolve a stale handle). An `AutoRepeat` armed across a `DOM.reset()` survives and fires against the new registry with a handle minted against the old one, which `HandleRegistry.resolve` throws on.
- **Proposed change**: route through `DOM.sink.setTimeout` / `clearTimeout` and correct the class JSDoc.
- **Risk / blast radius**: `tests/unit/core/AutoRepeat.test.ts` uses fake timers; `DOM.sink.setTimeout` in the recording sink must honour them — check `tests/dom/TestDOM.ts`'s `setTimeout` implementation before switching.
- **Proof at implement time**: a probe that starts an `AutoRepeat`, calls `DOM.reset()`, advances timers, and asserts no throw.

### F03.13 `ListenerBag.clear()` decrements the diagnostics counter one call at a time

- **Category**: H
- **Impact**: LOW.
- **Where**: `core/ListenerBag.ts:113-121` — a nested loop calling `Diagnostics.noteBagListenerRemoved()` once per listener, where the count is already known.
- **Evidence**: read at `core/ListenerBag.ts:114-118`.
- **Proposed change**: add `Diagnostics.noteBagListenersRemoved(n)` (or make the existing function take an optional count) and call it once per bucket.
- **Risk / blast radius**: `tests/core/Diagnostics.test.ts` and `tests/unit/core/ListenerBag.test.ts` assert the balanced count, which is preserved.
- **Proof at implement time**: the `semanticListeners` readout in `readFrameworkCounts()` is unchanged after a `clear()`.

### F03.14 `auditStyleRules` resolves a component name per rule by scanning the whole component index

- **Category**: H
- **Impact**: LOW — on-demand only (the Style Audit button inside the diagnostics overlay), but quadratic.
- **Where**: `diagnostics/StyleAudit.ts:54-63` — `componentNameForSelector` iterates the full `Map` returned by `buildComponentIndex()` for every `#`-scoped rule, doing up to three `startsWith` comparisons per entry. With the 5,904 components / 6,768 rules `stylerule-batched-flush` recorded, that is ~40M string comparisons for one button press.
- **Evidence**: read at `diagnostics/StyleAudit.ts:54-63` and its caller at `:113`.
- **Proposed change**: the index is keyed by the escaped `#<id>` prefix and the selector is `prefix + suffix`; split the selector at the first `.`/`:` after the id and do one `Map.get`, rather than testing every prefix.
- **Risk / blast radius**: `tests/diagnostics/StyleAudit.test.ts` and `StyleAudit.regression.test.ts` pin the reported component names, including the escaped-id case a hand-split must reproduce (an id starting with a digit escapes to `\3<digit> `, whose trailing space is part of the selector).
- **Proof at implement time**: wall time of one `auditStyleRules()` call on a synthetic 5,000-rule sheet.

### F03.15 `Body.getElement()` re-reads `document.body` through the seam on every call

- **Category**: H, D
- **Impact**: LOW.
- **Where**: `core/Body.ts:198-200` overrides the cached-field accessor with `return DOM.source.getBody();`, which is `_registry.intern(document.body)` (`core/DOM.ts:2645-2647`) — a `document.body` property read plus a `WeakMap.get` per call.
- **Evidence**: the override's own justification is in `Component.reattachElementBuffers`' JSDoc (`core/Component.ts:7614-7626`): "`Body` is the one component whose element can change underneath it." That is a test-harness concern; production swaps the body once, at `Body.init`.
- **Proposed change**: cache the handle in a field and re-read it only from `reattachElementBuffers()`, which already exists as the "the DOM changed underneath me" hook.
- **Risk / blast radius**: `tests/core/Body.test.ts` and any suite calling `installTestDOM` more than once per `Body` singleton; `Favicon._reset()` exists for exactly this class of cross-reset staleness and shows the pattern.
- **Proof at implement time**: `getBody` call count during one whole-tree layout pass (probe), expected to drop to 0 after the first.

### F03.16 The event target's id is read twice when a type has both exact-target and subtree registrations

- **Category**: I
- **Impact**: LOW.
- **Where**: `core/Event.ts:276` (`let elementId = DOM.source.getId(targetHandle);`) and `core/Event.ts:306` (the walk's first iteration, on the same handle).
- **Evidence**: probe P2 reports `getId: 12` for a 12-deep chain with no exact-target registration; with one it is 13 — the target's id resolved twice. Subsumed by F03.3's single-call redesign.
- **Proposed change**: ride along with F03.3.
- **Risk / blast radius**: none.
- **Proof at implement time**: P2's `getId` count.

---

## Entity inventory

| Entity | Stated function | Owns DOM | Per-layout-pass writes/reads | Verdict | Findings |
|---|---|---|---|---|---|
| `DOM` (`core/DOM.ts:2811`) | The single swap point holding the active sink and source | none | none | fits | — |
| `HandleRegistry` (`:171`) | Canonicalising handle↔node registry; `retain` strong, `intern` weak | holds every live node reference in the framework | one `Map.get` per sink/source call; one `WeakMap.get` + optional mint per `intern` | fits | F03.3 (intern churn on the event walk) |
| `PatchBuilder` (`:409`) | Fluent sugar over one `ElementPatch`, for cold call sites | none | none on the layout path (2 production call sites: `Component.ts:1429`, `SpatialNavigation.ts:646`) | fits | — |
| `applyPatchTo` / `writeDeclaration` / `scratchDeclaration` (`:340,304,326`) | Terminal raw-DOM write for a patch and for a declaration | writes styles, classes, attributes, dataset, text, scroll | 1 call per component per pass; `Object.keys` allocation per style bag; no value comparison | over-built (no empty/unchanged guard) | F03.1, F03.6, F03.8 |
| `ProductionDOMSink` (`:1619`) | One-line pass-throughs for every DOM write, plus the shared-stylesheet plumbing | `<style id="Base">`, every created element | `apply` per component per pass; `setRuleStyles` only on style change | over-built on the sheet path | F03.1, F03.4, F03.5, F03.6 |
| `ProductionDOMSource` (`:2083`) | Live reads: geometry, metrics, theme vars, traversal, environment | none (reads only) | see the read-classification table below | mismatch on `getViewportSize` | F03.2 |
| `Event` (namespace, `core/Event.ts:13`) | One window-level capture listener per type; routes to exact-target, subtree and viewport registrations | one `addEventListener` per registered type on `window` | zero during layout; O(depth) seam calls per pointer/keyboard event of a registered type | over-built (walk), plus dead `init` | F03.3, F03.7, F03.10, F03.11, F03.16 |
| `ListenerBag` (`core/ListenerBag.ts:22`) | Private multi-listener bag behind a host's typed `on`/`off`/`emit` | none | none | fits | F03.13 |
| `PointerDrag` (module fns, `core/PointerDrag.ts:59,73,87,107`) | Body-level pointer-suppression + cursor pin for the life of a drag, and the five-listener viewport drag lifecycle | one `<html>` class + inline `cursor`; one shared `StyleRule` created on the first drag ever | once per drag start and once per drag end — **not** per frame | fits | — |
| `AutoRepeat` (`core/AutoRepeat.ts:276`) | Accelerating press-and-hold repeat state machine | none | none | fits, one contract deviation | F03.12 |
| `Util` (`core/Util.ts:52`) | Text metrics with theme-generation caching, plus small numeric/string helpers | none | cached: `linePaddingPx`, `rootFontSizePx`, `measureTextBaseline`, `opticalCenterOffset`, `boundFontSizePx` all memoise and clear on `invalidateTextMetricsCache` | fits | duplication with `Type.isInteger` |
| `Type` (`core/Type.ts:7`) | Runtime type predicates and assertions | none | none | dead (14 of 16 exports) | F03.9 |
| `Diagnostics` (`core/Diagnostics.ts:35`) | Importless counter leaf pushed by `Component` and `ListenerBag` | none | one integer increment per `doLayout` pass; one boolean read per flush | fits | — |
| `DiagnosticsSampler` (`diagnostics/DiagnosticsSampler.ts:111`) | rAF FPS/frame-time loop + long-task observer + per-window sample assembly | none | **zero when stopped**; started only by `DiagnosticsOverlay.open()` | fits | — |
| `DiagnosticsOverlay` (`diagnostics/DiagnosticsOverlay.ts:60`) | Floating live-readout window | its own window subtree | zero until `open()`; instance constructed lazily there | fits | — |
| `StyleAudit` (`diagnostics/StyleAudit.ts:113`) | On-demand duplicate-rule-body audit of the shared sheet | none | zero unless invoked | over-built (quadratic name lookup) | F03.14 |
| `StyleAuditOverlay` / `StyleAuditView` | The audit's window and table | own subtrees | zero unless opened | fits | — |
| `Body` (`core/Body.ts:45`) | `Component` wrapping `<body>`; tracks the viewport size and mounts the top-level layout | `<body>` | **per resize frame**: one `getViewportSize()` read then `setSize` (which no-ops on an unchanged size — probe P1); **per theme change**: one `scheduleLayout()` → a full-tree `doLayout` | fits, with two seams to tighten | F03.2, F03.15 |
| `Favicon` (`core/Favicon.ts:66`) | Injects `<link rel="icon">` once, unless the page declares one | one `<link>` | once at `Body.init` | fits | — |

### `DOM.source` read classification

**Live geometry / style — forces style or layout when the document is dirty.**

| Read | Cost | Callers on a hot path |
|---|---|---|
| `getViewportRect(component)` | `getBoundingClientRect` — layout | none per frame. Menu/popup anchoring (`MenuButton:209`, `PopupButton:213`, `SplitButton:241`, `ToolBar:756`, `table/Header:715`, `AbstractWindow:1896`), `Slider:657` (per drag *start*), `Scrollbar:1159`, `DockRegion:239`, `DiagramView:1923,2123` |
| `getElementRect(handle)` | `getBoundingClientRect` — layout | **per frame**: `CodeEditor:2258,2259,2367,2500,2501` (→ 23), `ScrollStrip:988,989` (→ 04/07, gated by `scroll-strip-deferred-resync`), `Accordion:2704` (→ 08). **Per scroll**: `Markdown:2207,2221`, `HeadingScrollTracker:115,116` (→ 25). Per open/move: `Menu:635,637,653`, `Popover:695,876`, `ComboBox:287`, the three picker dropdowns, `AbstractWindow:2571,3358`, `FloatingPanel:223`, `Panel:593,594`, `TabBar:3169`, `AbstractChart:955`. **Per key press**: `SpatialNavigation:476,483,491` (→ 28) |
| `getViewportSize()` | `documentElement.clientWidth/Height` — layout (see F03.2) | **per resize frame**: `Body:210,225`, `Rail:701,1249`, `Drawer:436`, `Dialog:892,1000`, `Popover:706,909`, `AbstractWindow:2206,2272,2576,2597,2646,2658,2777,3112`, `Markdown:1339,1421`. Per open: `Menu:304,385,630`, `PopupPanel:148`, `Tooltip:275`, `Notification:606`, `AnimatedDropdown:342`, `DialogBackdrop:42,68`, `ComboBox:303`, `VideoPlayer:768` |
| `getScrollMetrics(handle)` | six `scroll*`/`client*` — layout | **per scroll frame**: `Panel:930,1102,1121,1399,1429,1684,1705` (→ 04), `CodeEditor:300,2339,2475` (→ 23), `Component:4594,4611` (→ 01). Per reveal: `AbstractSelectableList:2266`, `PickerColumn:381`. Per resize: `Markdown:1076,1176,1281,2208` |
| `getScrollLeft` / `getScrollTop` | `scrollLeft`/`scrollTop` — layout | `Component:1548,1549,1596,1597,1661,1662` (capture/restore on display flips), `Component:4402,4425,4484,4485,4911,4914` (settle read-back after a scroll write), `HeadingScrollTracker:84` |
| `getOffsetSize(handle)` | `offsetTop`/`offsetHeight` — layout | `CodeEditor:2531` (per editor resize), `FieldSet:229`, `PickerColumn:380` |
| `elementsFromPoint(x, y)` | hit test — layout; also interns the whole returned stack and allocates an array | `DragManager:422`, once per animation frame during a drag (already coalesced by `dragmanager-pointer-coalescing`) |
| `getThemeVar(name)` | `getComputedStyle(documentElement)` — style | all seven sites cache: `Util:119,141,326` (memoised, cleared by `invalidateTextMetricsCache`), `Text:341`, `ProgressSpinner:65`, `AbstractWindow:2734`, `Component:3742` (only on the pre-attach border estimate) |
| `getBorderWidths(handle)` | `getComputedStyle` — style | `BorderWidths:82`, memoised per spec and per component (`Component._borderWidths`, `core/Component.ts:3685-3692`); a font-relative (`em`/`rem`) spec bypasses the shared cache (`core/BorderWidths.ts:49-57`) but is still memoised on the component |
| `getComputedOverflow(handle)` | `getComputedStyle` — style | `CodeEditor:299`, `Popover:1000`, `SpatialNavigation:480` (per key press, per ancestor) |
| `isRenderedVisible(handle)` | `getComputedStyle` **per ancestor** — style, O(depth) | `Focusable:109` and `SpatialNavigation:378,525`, applied as a `.filter` over every focusable candidate → O(candidates × depth) computed-style reads per focus-navigation key press (→ 28) |
| `measureText` | creates a probe, appends to `<body>`, 2 `getBoundingClientRect`, removes it — a DOM mutation *and* a layout, per call | `Text:531,666` (per stale `Text`), `Tooltip:253,637`, `ChartAxis:76,84` (in a loop — N layouts), `Util:80` |
| `measureTextWidths` / `measureTexts` | one probe wrapper, one layout for the whole batch | `Util:105`, `Text:491` — the batched path `performance.md` directs consumers to |
| `resolveFontSizePx` | probe + `getComputedStyle` — style + layout | `Util:328` only, behind `boundFontSizeCache` |
| `measureFontMetrics` | canvas `measureText`, no layout, but calls `getThemeVar` twice (style) | `Util:213,274`, both memoised |
| `getScrollBarWidth` | two `offsetWidth` reads — layout, **cached after the first call** (`core/DOM.ts:2344-2348`) | `Panel:981`, `Scrollbar` (comment only) |
| `getDocumentSelectionText` | `Selection.toString()` — flattens rendered text; may force layout. Not verified on WebKitGTK | one caller, on copy |

**Cheap — attribute, structural, cached or environment reads that do not force style or layout.**

`intern` (41), `isNode` (17), `isElement` (2), `escapeSelector` (5 — a `CSS.escape` scan plus two `typeof` probes per call, no DOM touch), `isModelled` (1), `isConnected` (8), `getValue` (7), `getSelectionRange` (8), `getActiveElement` (17), `getDocumentSelection` (2), `matchMedia` (3), `isWindow` (1), `getWindow` (9), `getLocationHash`/`Pathname`/`Search` (5), `contains` (53), `querySelector` (9), `querySelectorAll` (8 — allocates and interns every match), `getRuleCssText` (1), `matches` (4), `getParentElement` (14), `getParentNode` (8), `getFirstChild` (1), `getInlineStyle` (1 — the *specified* inline value, not computed), `getDocumentElement` (16), `getBody` (12), `getHead` (2), `getElementById` (4), `getId` (6), `getDataset` (2), `getTagName` (6), `hasAttribute` (10), `getAttribute` (2), `getNaturalSize` (1), `getMediaState` (1), `getFullscreenElement` (1), `getFiles` (1), `hasPointerCapture` (1), `getDevicePixelRatio` (2), `onFontsReady` (1), `startFontLoad` (1), `countElements` (1 — `querySelectorAll("*").length`, O(nodes) but no layout; sampler-only, twice a second while the overlay is open).

Counts are `grep -rn "DOM\.source\.<name>(" --include=*.ts packages/lib/src/typescript/lib` excluding `core/DOM.ts`.

---

## Redundant, duplicated and dead code

Items not already in Findings.

1. **`Component.writeHorizontalGeometry` / `writeVerticalGeometry` write both properties when only one changed.** `core/Component.ts:4338-4346` (and the vertical twin at `:4353`); `setX` (`:4271`) and `setWidth` (`:4055`) each call it. `applyBounds` batches, so this costs bag assignments rather than extra sink calls, but the flushed patch still carries the unchanged property — probe P5: `widthOnlyPatches: [['left','width']]`. → slice 01.
2. **`escapeSelector` capability probe per call.** `core/DOM.ts:2108-2116` runs `typeof CSS !== "undefined" && typeof CSS.escape === "function"` on every call, and every `scope: "component"` rule escapes a UUID that needs no escaping (`core/StyleTarget.ts:196`). Resolve the capability once at module load. `grep -rn "DOM.source.escapeSelector" --include=*.ts packages/lib/src` → 5 production sites.
3. **`ensureKeyframes` walks the full `cssRules` list on every call.** `core/DOM.ts:1743-1755` reads `.type` and `.name` on each rule to test idempotence, with no name index. Seven module-level call sites (`Glyph.ts:62,65,75`, `TabButton.ts:42`, `ProgressBar.ts:8`, `ProgressSpinner.ts:18`, `editor/theme.ts:43`), all at import time when the sheet is small — cold, but the same missing-index shape as F03.4/F03.5 and cheapest to fix alongside them.
4. **Permanent viewport `mouseup` / `mouseleave` registrations.** `component/container/Scrollbar.ts:268-269` and `component/input/SpinButton.ts:152-153` register at construction and never remove, so `viewportListenerMap.get("mouseup")` grows with the scrollbar/spinner count and every `mouseup` in the app fans out over all of them. `Button` (`component/button/Button.ts:615-616`) shows the correct pattern — register on `pointerdown`, remove on release.
5. **Inline-arrow listener registrations cannot be deduplicated or removed.** `Event.registerEntry` (`core/Event.ts:438-476`, the identity match at `:465`) and `addViewportListener` (`core/Event.ts:790-820`, the identity match at `:814`) match on function identity, so a fresh closure always appends. Sites passing a fresh arrow: `layout/Accordion.ts:1403,1404` (per header — a rebuilt section stacks a second pair), `component/input/AbstractCalendarDropdown.ts:633`, `component/input/TimePickerDropdown.ts:111`, `component/container/VirtualScroller.ts:553,567,657,665`, `overlay/ButtonGroup.ts:283`, `component/input/SpinButton.ts:152,153`. All are one-time in the current code, so no leak exists today; the API hazard is real and the JSDoc already warns about it. → owning slices.
6. **The `codebase-health-audit-2026-08-29` item #4** — "`SplitGutter` gained `dragend` three days after Accordion shipped a viewport-listener workaround for the same gap — that workaround is now redundant but wasn't removed" — is still open and is a viewport-listener registration, so it will surface as a `baseViewportListener` fan-out entry. → slices 06 / 08.
7. **`core/Diagnostics.ts` has no batch decrement**, which is what forces F03.13's loop. One added function fixes both.

---

## Cross-slice notes

- **→ 01 core-component-lifecycle**: `applyBounds` (`core/Component.ts:3977`) always re-enables auto-commit at the end, which flushes an empty `InlineStyle` bag when nothing changed — the caller half of F03.1. Also `writeHorizontalGeometry`/`writeVerticalGeometry` write both properties on a single-axis change (item 1 above). And `canSkipUnchangedLayout()` defaults to `false` (`core/Component.ts:4000-4002`), so an unchanged-bounds pass still recurses into the whole subtree, which is what multiplies F03.1 by the component count.
- **→ 02 core-component-styling**: `StyleTarget.set`/`queue`/`queueMany` (`core/StyleTarget.ts:34,61,69`) accept a value without comparing it to the last written one; `Component`'s typed setters filter above them (probe P4 shows zero sink writes for a repeated identical `setBackgroundColor`), so the seam's lack of filtering is currently masked. If a plan ever moves a style write below the typed setters, F03.6's guard becomes load-bearing. `StyleRule.flushDirty` has the empty-bag guard `InlineStyle.flushDirty` lacks — one of the two is the template for the other.
- **→ 04 core-panel-scrolling**: `Panel` reads `getScrollMetrics` at seven sites, three of them (`:1102,1121,1399`) inside the scroll-shadow / scrollbar update path. Each is a six-property live layout read; `Panel:1121` re-reads metrics already read at `:1102` in the same function.
- **→ 23 editor-code**: `CodeEditor` holds five `getElementRect` sites and three `getScrollMetrics` sites, several inside the resize settle path (`:2475,2500,2501,2531`). Those are the per-visible-editor forced layouts the cost model budgets at 15–20 ms/frame.
- **→ 25 display-markdown**: `Markdown` registers **viewport** `scroll` and `resize` listeners (`component/display/Markdown.ts:1355-1356`). A window-level capture `scroll` listener sees every scroll event in the document, and the handler reads `getElementRect(wrapper)` + `getViewportSize()` per fire — so one `Markdown` on screen adds two forced layout reads to every scroll anywhere in the app, not just its own.
- **→ 28 focus-navigation-forms-primitives**: `DOMSource.isRenderedVisible` does a `getComputedStyle` per ancestor (`core/DOM.ts:2612-2626`) and is used as a `.filter` predicate over every focusable candidate at `core/Focusable.ts:109` and `core/SpatialNavigation.ts:378,525` → O(candidates × depth) computed-style reads per navigation key press.
- **Seam contracts this slice relies on that do not fully hold**:
  - `dom-seams.md` says "`apply(handle, patch)` is the write primitive: one handle resolve performs every mutation in the patch" — true, but it does not say the call is made even when the patch mutates nothing (F03.1).
  - `dom-seams.md` says timers route through the sink "for the one case where a timer is not merely a timer: a deferred callback that will write to an element". `AutoRepeat` is that case and does not route (F03.12).
  - `ElementPatch`'s documented application order places the two forced-layout writes (`scrollLeft`/`scrollTop`) after the style writes in the same `apply` (F03.8).

---

## Suggested plan grouping

**Plan A — "Empty and unchanged writes stop at the seam"** (F03.1, and the `ProductionDOMSink.apply` half of F03.6). One coherent change: an empty-bag guard in `StyleTarget.flush()`, dropping the now-duplicated guard from `StyleRule.flushDirty`, plus an empty-patch short-circuit in `ProductionDOMSink.apply`. Measurable on its own (probe P6 → 0 empty applies; `apply` ops per frame). Touches `core/StyleTarget.ts` and `core/DOM.ts`; overlaps slice 02's ownership of `StyleTarget`, so sequence it with whatever slice 02 proposes there. No dependency on other plans. **Highest payoff per line changed — do this first.**

**Plan B — "Viewport size stops forcing layout"** (F03.2). Reorder the `getViewportSize` expression and add the per-task memo. Touches `core/DOM.ts` only. Independent of every other plan; measurable as forced-layout count per `resize` task in a WebKitGTK recording. Ride-along: F03.15 (`Body.getElement` caching) is the same "read the environment once" idea in the same hot path and is too small to plan alone.

**Plan C — "Shared-stylesheet bookkeeping"** (F03.4, F03.5, and redundancy item 3). Cache the sheet, index rule positions, index keyframe names. One file (`core/DOM.ts`), one test file to keep green (`tests/dom/style-rule-index.test.ts`). Independent; measurable as `cssRules` index reads per `deleteStyleRule`. Depends on nothing, but its value is largest after slice 19/21's table-cell-rule findings land, since those decide how often deletion happens.

**Plan D — "One seam call per event dispatch"** (F03.3, F03.16, F03.7, F03.11, F03.10). Adds `DOMSource.getAncestorIds`, rewrites the subtree walk against it, drops the two reentrancy `try`/`catch` blocks, fixes the `Map<String>` declarations, switches `baseViewportListener` to `.values()`, deletes `Event.init`. Touches `core/DOM.ts`, `core/Event.ts`, `tests/dom/TestDOM.ts` (the modelled source needs the new method), and requires restating `tests/dom/event-subtree-reentrant-dispose.test.ts` case EV2 — flag that for the plan's Architecture Decisions. Independent of A–C. Measurable as seam calls per dispatched event and handle-registry growth.

**Plan E — "Rule writes compare before they mutate"** (the `setRuleStyles` half of F03.6). Deliberately separate from Plan A: it changes what reaches the *stylesheet*, whose cost model (full-document restyle) differs from the inline path, and it needs its own before/after on a hover sweep. Depends on Plan C only in that both touch `ProductionDOMSink`'s sheet methods — land C first to avoid a merge conflict.

**Ride-alongs, too small to plan** (attach to the nearest plan touching the same file): F03.9 (`Type.ts` removal — attach to whichever plan next touches `core/Component.ts`, or run as a standalone dead-code sweep with the other slices' J findings), F03.12 (`AutoRepeat` timer routing — attach to Plan B, which is the other `core/DOM.ts` environment change), F03.13 (`ListenerBag` batch decrement — attach to Plan D, which already touches the diagnostics-adjacent event code), F03.14 (`StyleAudit` name lookup — attach to Plan C, the other stylesheet-bookkeeping change), F03.8 (document or split the scroll fields of `ElementPatch` — attach to Plan A, which is already editing `applyPatchTo`).

**Cross-slice dependency**: Plan A's real-world gain scales with how many components run an unchanged-bounds pass per frame, which slice 01's `canSkipUnchangedLayout` findings may reduce independently. Measure A before slice 01's plan lands, or the two will each claim the other's win.

---

*Probes for this slice live in `.worktrees/_probes/03-core-dom-seam-events/seam-events.probe.test.ts` (P1–P6), run with*
`PROBE_DIR=.worktrees/_probes/03-core-dom-seam-events npx vitest run --config .worktrees/_probes/vitest.probe.config.ts`.
*Recorded results: P1 `{ unchangedViewportBodyWrites: 0, viewportReadsForOneEvent: 2, writesSeenAtLaterListener: 0 }`; P2 `{ chainDepth: 12, hopsNeeded: 2, getId: 12, getParentElement: 12 }`; P3 `{ chainDepth: 20, matches: 0, getId: 20, getParentElement: 20 }`; P4 `{ ruleWritesForTwoIdenticalSets: 0, applyWritesForTwoIdenticalSets: 0 }`; P5 `{ widthOnlyPatches: [['left','width']], noChangePatches: [[]] }`; P6 `{ components: 201, appliesInUnchangedPass: 200, emptyAppliesInPass: 200 }`.*
