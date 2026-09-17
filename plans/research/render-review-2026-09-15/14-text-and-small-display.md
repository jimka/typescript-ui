# 14 text-and-small-display — render-work review

**Summary**

- `Text.setText` has no same-string guard and no cheap measurement path: every call
  marks the measurement stale, schedules a parent layout, and makes the next layout
  pass issue an off-screen `<span>` probe read — **one forced whole-document
  layout per `setText`**, even when the string is byte-identical (probe: 1
  `measureText`, 3 sink applies, 1 rAF for an identical string). This is the cost
  Loom pays per keystroke and works around by hand with
  `measure()` + `setPreferredSize` + `setAutoMeasure(false)`. Hot paths 4 and 6.
  (F14.1)
- A **wrapping** `Text` re-measures *inside the layout commit*: `setWidth` calls
  `calculateSize()` synchronously, and each call issues **two** probe reads —
  measured at **20 `measureText` calls over 10 drag frames**, i.e. 2 forced
  document layouts per frame per wrapping `Text`. Hot path 1. (F14.4)
- `ProgressSpinner` in overlay mode is a **perpetual layout + rAF loop**,
  confirming slice 01's prediction: 6 consecutive rAF generations each carried
  exactly 1 callback and 9 sink applies, with nothing changing. It runs for the
  whole life of a `TablePanel`/`TreeTablePanel`/`DiagramView` load. It also means
  slice 01's proposed `setSize` unchanged-guard would silently break the overlay's
  resize tracking. (F14.2)
- `Text.setLineHeight(px)` publishes a **new permanent shared stylesheet rule per
  distinct pixel value** — 11 values → 10 `ensureStyleRule` + 10 `setRuleStyles`,
  **zero deletes**. Any caller that syncs a `Text`'s line-height to a
  continuously-changing box height (`ComboBox.doLayout:922`,
  `CellRenderer.doLayout:120`, the tree/list row renderers) issues a
  full-document restyle per frame and leaks a rule per pixel. Hot path 1. (F14.3)
- `Header` drives a single west-anchored label through a full `Border` layout
  manager, so every settled `Header` pass costs **1 stylesheet-rule mutation +
  4 unchanged geometry applies + 2 empty applies** — measured identical across
  three consecutive passes. Multiplied by every `Header`/`WindowHeader` on screen,
  on every resize frame. (F14.5)

---

## Findings

### F14.1 `Text.setText` forces a synchronous document layout per call, with no same-value guard

- **Category**: A (forced sync read on a hot path), B (unchanged-value write), D (avoidable layout pass)
- **Impact**: **HIGH** — one forced whole-document layout per `setText`, on the
  typing / status-readout path, multiplied by every live readout.
- **Where**:
  - `component/input/Text.ts:828-845` — `setText`, no same-string guard
  - `component/input/Text.ts:831` — `this._measurementDirty = true`
  - `component/input/Text.ts:833-835` — `(this.getParentComponent() ?? this).scheduleLayout()`
  - `component/input/Text.ts:842` — `DOM.sink.apply(element, { text })`
  - `component/input/Text.ts:511-543` — `calculateSize`, `:531` the solo `DOM.source.measureText`
  - `core/DOM.ts:2130-2177` — `ProductionDOMSource.measureText`: `document.body.appendChild(probe)` then two `getBoundingClientRect()` reads
  - Callers: `component/container/StatusBar.ts:250` (`setMessage`), `:299` (`setDefaultMessage`), `component/display/PaginationBar.ts:182` (`refresh`), `component/display/IconText.ts:97`, `component/display/IconLabel.ts` (`setText`)
- **Hot path**:
  1. keystroke / caret move / store event
  2. `StatusBar.setMessage` → `Text.setText` (`StatusBar.ts:250` → `Text.ts:828`)
  3. `Text.setText` sets `_measurementDirty` and calls `parent.scheduleLayout()` (`Text.ts:831,834`)
  4. next rAF → `flushPendingLayouts` → `StatusBar.doLayout` → `HBox` resolve phase
  5. `Text.getPreferredSize()` (`Text.ts:716`) → `needsMeasure()` true → `calculateSize()`
  6. `DOM.source.measureText` (`Text.ts:531`) → `appendChild` + `getBoundingClientRect` (`DOM.ts:2165-2167`)
  7. That read lands after every geometry write the pass has already made → **full-document style + layout flush**.
- **Evidence**: probe `slice14a.probe.test.ts`, case "an IDENTICAL setText…":
  ```
  IDENTICAL setText sink ops : {"apply":3}
  IDENTICAL setText apply payloads: [["text"],["style"],["style"]]
  IDENTICAL setText rAF scheduled: 1
  IDENTICAL setText source calls: {"measureText":1}
  ```
  A byte-identical string costs the same `measureText` as a changed one
  (`CHANGED setText source calls: {"measureText":1}`). `slice14b.probe.test.ts`
  reproduces it end-to-end through the real component:
  `STATUSBAR setMessage — sink ops: {"apply":6}, rAF scheduled: 1, source calls: {"isConnected":2,"measureText":1}`,
  and an **identical** follow-up `setMessage` costs the same 6 applies.
  Loom's `src/EditorController.ts:115-186` is a three-fold hand-rolled workaround
  for exactly this (`measure()` against a widest-case string, pin
  `setPreferredSize`, then `setAutoMeasure(false)`), with a 14-line comment naming
  the forced reflow.
- **Proposed change**, three independent parts, in payoff order:
  1. **A cheap natural measurement for the single-line case.** With the default
     `truncate: true` a `Text` is `white-space: nowrap`, so its natural
     measurement needs no layout at all: width is `ctx.measureText(text).width`,
     height is `Util.lineHeightPx({ fontSizePx })` (already pure arithmetic,
     `core/Util.ts:174`), baseline is `Util.measureTextBaseline()` (already
     canvas-derived and cached, `core/Util.ts:194-217`). `ProductionDOMSource`
     already owns the canvas 2D context this needs (`core/DOM.ts:2318-2325`,
     `measureFontMetrics`). Add a single-line seam on `DOMSource` and route
     `applyNaturalMetrics`'s natural probe through it; keep the DOM probe only for
     the wrap-aware `maxWidth` re-measure in `measuredHeight` (`Text.ts:666`).
     This removes the forced layout from every `setText` in the library with no
     consumer opt-in, which is what makes Loom's pin unnecessary.
  2. **A same-string early return** at the top of `setText` (`Text.ts:828`):
     `if (this._options.text?.toString() === text.toString()) return this;`.
     Removes the text-node write, the stale mark, the scheduled pass and the
     probe outright for a repeated readout.
  3. **Drop the explicit `scheduleLayout()`** (`Text.ts:834`) — see F14.7; the
     `setPreferredSize` ancestor relay already schedules, and only when the size
     actually moved.
- **Risk / blast radius**: `setText` is the single most-called API in the library
  (every `Button`, `MenuItem`, `TabButton`, cell/list/tree renderer, `Header`,
  `StatusBar`). (2) is pinned by nothing that asserts a write on an unchanged
  value; `tests/component/input/TextAutoMeasureLayoutSchedule.test.ts:64` asserts
  "still writes the text and still marks the measurement stale" for a *changed*
  string, so it survives. (1) changes measured numbers, so every baseline-
  and width-sensitive test (`TextIntrinsicHeight`, `StatusBar.test.ts:146`,
  `content-box-containment.test.ts`) must be re-run; the offline modelled source
  derives both paths from the same font table, so parity is checkable offline and
  a real-browser parity check is the only manual step. `measureTexts` batching
  (`plans/implemented/text-measurement-batching.md`) stays for the wrap path and
  for the theme-change sweep; (1) makes it matter much less, which the plan's
  `## Architecture Decisions` does not contradict (it optimised probe *count*, not
  probe *existence*).
- **Proof at implement time**: a probe asserting zero `DOM.source.measureText`
  calls across `setText` + `doLayout` for a default `nowrap` `Text`; and zero sink
  writes for an identical `setText`. In the harness: `ms/frame` on a Loom
  selection drag with the status-bar readouts left on default auto-measure (the
  pin removed from `EditorController.ts`).

---

### F14.2 `ProgressSpinner.showOverlay` is a perpetual layout-plus-rAF loop

- **Category**: D (avoidable layout pass), B, G
- **Impact**: **HIGH** — one layout pass and 9 sink applies per frame, for the
  entire duration of every store load and every diagram busy state, plus a rAF
  pump that never lets the frame loop go idle.
- **Where**:
  - `component/display/ProgressSpinner.ts:276-313` — `doLayout`
  - `component/display/ProgressSpinner.ts:288` — `this.setSize({ width: target.getWidth(), height: target.getHeight() })`
  - `core/Component.ts:3918-3936` — `setSize`: no unchanged guard, `:3933` unconditional `this.scheduleLayout()`
  - `component/display/ProgressSpinner.ts:306-308` — `_arc.setX/setY/setSize`, all unguarded
  - `core/Component.ts:184-190, 7350-7361` — `scheduleLayout` during a flush queues into the *next* frame and arms a fresh rAF
  - Live consumers: `component/table/TablePanel.ts:122`, `component/table/TreeTablePanel.ts:128`, `component/diagram/DiagramView.ts:813`
- **Hot path**: self-sustaining, no external trigger:
  1. `showOverlay` ends with an explicit `this.doLayout()` (`ProgressSpinner.ts:242`)
  2. `doLayout` calls `this.setSize(...)` (`:288`)
  3. `Component.setSize` writes geometry and calls `this.scheduleLayout()` unconditionally (`Component.ts:3925-3933`)
  4. `ensureFlushScheduled` arms a rAF (`Component.ts:186-189`)
  5. next frame → `flushPendingLayouts` → `spinner.doLayout()` → back to (2), forever.
- **Evidence**: probe `slice14c.probe.test.ts`:
  ```
  SPINNER OVERLAY rAF callbacks per generation: [1,1,1,1,1,1]
  SPINNER OVERLAY sink ops over 6 generations: {"apply":54}
  ```
  Six consecutive generations, one scheduled callback each, 9 applies per frame,
  with the target's size never changing. The loop is load-bearing, not accidental:
  the overlay is mounted by a raw `DOM.sink.appendChild` (`ProgressSpinner.ts:237`)
  and is never `addComponent`ed, so it is in no parent's laid-out set —
  `DiagramView.ts:809-811` says so in a comment and calls `doLayout()` by hand for
  the same reason. The loop is the only thing tracking the target's size.
- **Proposed change**: give the overlay a real resize relay instead of a
  self-re-arming pass. `showOverlay` should register on the target — e.g. via the
  target's `afterNextLayout` / a preferred-size relay, or by making the spinner an
  actual child whose bounds the target commits — and `doLayout` should read the
  target's size and write it only when it differs (an `if (w !== this.getWidth() || h !== this.getHeight())`
  guard around `:288` is the minimum change and breaks the loop on its own).
  `_arc.setX/setY/setSize` (`:306-308`) should likewise be skipped when the
  computed box is unchanged.
- **Risk / blast radius**: three live consumers plus `MiscPanel.ts:1748`.
  `tests/component/display/ProgressSpinner.test.ts` and
  `tests/component/diagram/DiagramView.test.ts:3119-3164` pin `isOverlay()` and
  the overlay geometry. **Cross-dependency**: slice 01 proposes adding an
  unchanged-value guard to `Component.setSize`. That fix alone would stop this
  loop — and with it stop the overlay resizing with its target, silently. This
  finding must be fixed *with or before* slice 01's `setSize` guard, not after.
- **Proof at implement time**: the probe above re-run, asserting
  `[1,0,0,0,0,0]` instead of `[1,1,1,1,1,1]`; plus a case asserting the overlay
  still resizes when the target's width changes.

---

### F14.3 `Text.setLineHeight(px)` publishes a permanent stylesheet rule per distinct pixel value

- **Category**: C (stylesheet-rule write on a hot path), J (rule leak)
- **Impact**: **HIGH** on any path where a `Text`'s line-height tracks a
  continuously-changing box height — one full-document restyle per frame in the
  target engine (~195 ms/frame at 21k nodes per the briefing's cost model), plus
  unbounded stylesheet growth.
- **Where**:
  - `component/input/Text.ts:1162-1213` — `setLineHeight`; `:1173` the guard (value **and** mode must both match); `:1200` `setValueStyleState("lh", value + "px", …)`
  - `core/Component.ts:6293-6308` — `setValueStyleState` → `ensureSharedStateRule`
  - `core/Component.ts:6101-6103` → `core/ClassStyleRules.ts:1093-1128` — `ensureClassStateRule`: memoised per `(ctor, suffix)`, and **never deleted** (`_stateBags` is a permanent map; no counterpart to `StyleRule.dispose`)
  - Callers that feed it a live box height: `component/input/ComboBox.ts:922`, `component/table/cell/renderer/CellRenderer.ts:120`, `component/tree/renderer/Label.ts:100`, `component/tree/renderer/IconLabel.ts:154`, `component/list/renderer/Label.ts:113`, `component/list/renderer/Glyph.ts:169`
- **Hot path** (a `ComboBox` stretched vertically during a gutter drag):
  1. `Split.commitPanes` → pane `doLayout` → `ComboBox.doLayout`
  2. `ComboBox.ts:922` `this._label.setLineHeight(box.height)` with a new pixel height
  3. `Text.ts:1173` guard fails (value changed) → `Text.ts:1200` `setValueStyleState`
  4. `Component.ts:6298` `ensureSharedStateRule(".lh<N>px", …)` → memo miss
  5. `ClassStyleRules.ts:1121` `new StyleRule({ scope: "class", … })` → `insertRule` → **full-document restyle**
  6. plus one `DOM.sink.apply` class swap (`Component.ts:6304`) and one `scheduleLayout` (`Text.ts:1210`).
- **Evidence**: probe `slice14a.probe.test.ts`, case "setLineHeight with a fresh pixel value…" — 11 consecutive distinct values on one rendered `Text`:
  ```
  11 distinct setLineHeight values — ops: {"ensureStyleRule":10,"setRuleStyles":10,"apply":11}
    ensureStyleRule selectors: [".Text.lh20px",".Text.lh22px",… ,".Text.lh30px"]
    deleteStyleRule selectors: []
  ```
  (10 inserts, not 11, because `.Text.lh21px` was already memoised by an earlier
  case — which is exactly the mechanism: the memo is global and permanent.)
  **The rebind path is clean**: a pooled row whose height does not change hits the
  `:1173` guard and writes nothing — that guard was added precisely for
  `CellRenderer.doLayout` (see its own comment, `Text.ts:1164-1172`). The problem
  is a *changing* value, not a repeated one.
- **Proposed change**: two options, not mutually exclusive.
  (a) Bound the shared tier: keep the value-class mechanism for values drawn from
  a small fixed set (menu row heights, a status-bar band) and fall back to a
  per-instance `#id` declaration when a component's line-height is observed to
  change more than once — an `#id` write is an inline-equivalent rule update, not
  an `insertRule`, so it does not add a rule.
  (b) Give the value tier a release path: reference-count each
  `(ctor, suffix)` entry in `ClassStyleRules._stateBags` and delete the rule when
  the last instance leaves it, so a drag does not leave one rule per dragged pixel
  behind for the life of the page.
  A cheaper stop-gap for the specific callers: quantise the synced height (the
  renderers only need the line box to match the row, not to the pixel).
- **Risk / blast radius**: `setValueStyleState` is shared with
  `Cell.focusedStyleRule` and `TreeRow.focusedStyleRule`, which use fixed
  suffixes and are unaffected. `tests/component/input/TextLineHeightValueClassSharing.test.ts`
  and `tests/component/input/ComboBox.test.ts:379-462` pin the sharing semantics
  row-by-row and would need rows added, not changed, for (b).
  `plans/implemented/class-hierarchy-cascade.md` owns the tier design.
- **Proof at implement time**: rule writes per frame under a simulated
  row-height or combo-height drag (`ensureStyleRule` count over 60 frames should
  be bounded, not 60); `DiagnosticsOverlay`'s **stylesheet rules** counter flat
  across a drag instead of climbing.

---

### F14.4 A wrapping `Text` issues two forced document layouts per frame, inside the layout commit

- **Category**: A, D
- **Impact**: **HIGH** on hot path 1 for any wrapping `Text` on screen —
  `Dialog` message bodies, `Notification` content, `Markdown`-adjacent labels,
  any `truncate: false` + wrapping label in a resizable pane.
- **Where**:
  - `component/input/Text.ts:690-703` — `setWidth` override; `:699` `this.calculateSize()` **synchronously, inside the bounds commit**
  - `component/input/Text.ts:646-670` — `measuredHeight`; `:666` the second, wrap-aware `DOM.source.measureText(text, { …, maxWidth })`
  - `component/input/Text.ts:411-444` — `applyNaturalMetrics`, which calls `measuredHeight` (`:425`) from inside the batched path too
  - `core/Component.ts:4104` — `writeBounds` calls `setWidth` as part of every commit
- **Hot path**:
  1. gutter drag frame → `LayoutManager.commitBounds` → `child.setBounds` → `Component.writeBounds` (`Component.ts:4100-4110`)
  2. `writeBounds` → `Text.setWidth` (`Text.ts:690`)
  3. `isWrapping()` true and width changed → `_measurementDirty = true`; `calculateSize()` (`Text.ts:696-699`)
  4. `calculateSize` → `DOM.source.measureText` (`Text.ts:531`) → probe 1: `appendChild` + 2 × `getBoundingClientRect` → forced document layout
  5. `applyNaturalMetrics` → `measuredHeight` → `DOM.source.measureText(… maxWidth)` (`Text.ts:666`) → probe 2 → second forced document layout
  6. `setCalculatedSize` → `setPreferredSize` → ancestor relay → every ancestor `scheduleLayout` (`Component.ts:6720-6724`) → a second pass next frame.
  Steps 4 and 5 both land **after** the pass's own geometry writes, in the same task.
- **Evidence**: probe `slice14b.probe.test.ts`:
  ```
  WRAPPING Text, 10 drag frames — source calls: {"measureText":20}
  NOWRAP  Text, 10 drag frames — source calls: {}
  ```
  Exactly 2 probes per frame for the wrapping case, 0 for the default
  `truncate: true` / `nowrap` case. The batched path does not help here: the
  wrap-aware re-measure in `measuredHeight` runs *after* `measureTexts` has
  already removed its wrapper from the document (`DOM.ts:2273`), so each
  participant's wrap probe is its own separate flush.
- **Proposed change**: take the re-measure off the commit path.
  `setWidth` should only mark `_measurementDirty` and let the next
  `getPreferredSize` / `getMinSize` read do the work (they already re-measure on
  demand, `Text.ts:716, 765`), or defer it through `afterNextLayout`. Second,
  when the wrap probe is unavoidable, give `measuredHeight` a memo keyed on
  `(text, font signature, innerWidth)` so the settle frames of a drag — where the
  width oscillates over a handful of values — reuse a result. Third,
  `measuredHeight`'s early-out at `:662` (`innerWidth >= naturalWidth`) should be
  matched by a "width unchanged since last wrap measure" early-out, which is the
  common case once a drag settles.
- **Risk / blast radius**: `setWidth`'s doc comment (`Text.ts:672-689`) states the
  synchronous re-measure is deliberate so the taller preferred height propagates
  "before the next layout pass reads it"; deferring it must keep
  `tests/component/input/TextIntrinsicHeight.test.ts:53-71` and
  `:84-112` (the VBox wrapped-height case) green, which is the contract to
  preserve. Everything else that wraps is a consumer of the same two tests.
- **Proof at implement time**: a probe asserting ≤ 1 `measureText` per drag frame
  for a wrapping `Text`, and 0 once the width settles; `ms/frame` on a dialog or
  notification resize in the harness.

---

### F14.5 `Header` drives one label through a `Border` layout: a stylesheet mutation and four unchanged geometry writes per pass

- **Category**: C, B, H (function/implementation mismatch)
- **Impact**: **HIGH** by multiplication — one stylesheet-rule mutation per
  `Header`/`WindowHeader` per layout pass, and a stylesheet mutation is the most
  expensive write in the target engine.
- **Where**:
  - `component/display/Header.ts:66` — `this.setLayoutManager(new BorderLayout())`
  - `component/display/Header.ts:68-74` — one `Text` child, `Placement.WEST` / `AnchorType.WEST` / `FillType.HORIZONTAL`
  - `layout/Border.ts:1272/1320/1377/1419` — the per-region `setClipPath` writes (slice 06)
  - `component/container/WindowHeader.ts:95` — the only subclass; one per `Window`/`Dialog`
  - Consumers: `diagnostics/DiagnosticsOverlay.ts:102,108`, every `Window`/`Dialog` title bar, `component/diagram/*` group nodes
- **Hot path**: window resize / gutter drag → ancestor `doLayout` →
  `Header.doLayout` (inherited from `Container`) → `Border.doLayout` →
  `Component.setClipPath` on the region → `StyleTarget` rule mutation (no
  last-written-value filter, slice 02) → **full-document restyle**; plus the
  region's clip-frame rectangle re-written property-by-property.
- **Evidence**: probe `slice14e.probe.test.ts`, three consecutive settled passes,
  byte-identical each time:
  ```
  E pass 0: ["setRuleStyles \"#a4b2…\" {\"clipPath\":null}",
             "other:5 {\"style\":{\"left\":\"4px\"}}",
             "other:5 {\"style\":{\"top\":\"4px\"}}",
             "other:5 {\"style\":{\"width\":\"23px\"}}",
             "other:5 {\"style\":{\"height\":\"16px\"}}",
             "Header.label {\"style\":{}}",
             "Header {\"style\":{}}"]
     label geometry: x=0 y=0 w=23 h=16 pref={"width":23,"height":16}
  ```
  `other:5` is the `Border` region's clip-frame handle (neither the `Header`
  element nor the label element), so the four real geometry writes bypass
  `Component.setWidth`'s unchanged guard entirely. The two `{"style":{}}` applies
  are slice 01's empty-flush finding, one per component.
  `slice14d.probe.test.ts` confirms the pattern repeats identically on passes 0,
  1 and 2 — this is steady state, not a settle.
- **Proposed change**: `Header`'s stated function is "a header bar component
  containing a left-aligned text label" (`Header.ts:39-43`). A `Border` manager
  with one west region is over-built for that: a `Fit`/`HBox`, or placing the
  label directly from a `doLayout` override with `getContentBounds()`, removes
  the region machinery, the clip frame and the `clip-path` rule write in one go.
  `WindowHeader` is the only subclass and already overrides
  `updatePreferredSize`; check whether it relies on `Border`'s other regions for
  its stretched controls before collapsing the manager (it places window controls,
  so it probably does — in which case keep `Border` for `WindowHeader` and give
  plain `Header` the simpler manager).
- **Risk / blast radius**: `tests/component/display/Header.test.ts` and
  `tests/component/container/WindowHeader.test.ts` pin placement and baseline.
  Overlaps slice 06's `clip-path` finding (`Split.ts:2145`, `Border.ts:1272/1320/1377/1419`);
  if slice 06's fix lands first, this finding shrinks to the four unchanged
  geometry applies and the over-built manager.
- **Proof at implement time**: rule writes per frame with N headers on screen
  (`setRuleStyles` count under an unchanged whole-tree pass should drop by one per
  header); the probe above re-run asserting 0 `setRuleStyles`.

---

### F14.6 A theme change measures every live `Text`, including ones nobody can see

- **Category**: E (work for invisible content), A
- **Impact**: **MEDIUM** — one-off per theme change, but it is an N-wide sweep
  with N extra forced layouts for the wrapping subset.
- **Where**:
  - `component/input/Text.ts:446-449` — `wantsBatchedMeasure()`: `_autoMeasure && needsMeasure() && !!text` — **no visibility test**
  - `component/input/Text.ts:458-502` — `batchMeasure`: walks the whole `_measurableRefs` registry (`:465`) and measures every stale participant (`:491`)
  - `component/input/Text.ts:82` — `_measurableRefs`, every live `Text` in the process
  - `component/input/Text.ts:557-559` — `needsMeasure` returns true for every instance as soon as `Util.textMetricsGeneration()` bumps
  - `core/Util.ts:340-347` — `invalidateTextMetricsCache` bumps the generation
- **Hot path**: theme change → generation bump → the first size read from *any*
  `Text` → `batchMeasure` → one `measureTexts` flush covering every `Text` in the
  app, including those inside `display:none` tab pages, collapsed panes, closed
  menus and unopened dialogs → each participant's `applyNaturalMetrics` →
  `setPreferredSize` → ancestor relay → `scheduleLayout` on every ancestor chain
  (`Component.ts:6720-6724`); and for each *wrapping* participant one further
  solo `measureText` (`Text.ts:666`) **after** the batch wrapper has been removed
  from the document — i.e. one extra forced layout each.
- **Evidence**: read of `wantsBatchedMeasure` and `batchMeasure`; the library's own
  `tests/component/TextBatchMeasure.test.ts:74-92` shows every stale instance
  joining the batch regardless of parentage or display state. Confirmed
  indirectly by `slice14a.probe.test.ts`'s spectator cases: 40 unattached `Text`
  instances were all measured by the *first* size read of an unrelated `Text`, so
  by the time the probe installed its counter none of them were stale.
- **Proposed change**: filter `wantsBatchedMeasure()` on effective visibility
  (`isEffectivelyDisplayed()` / an element that is attached), leaving invisible
  instances stale so they measure lazily when they are next shown. The generation
  counter already makes that safe — `needsMeasure()` stays true until they are
  read. Independently, the wrap re-measure should join the batch rather than
  running per participant after it (build the `maxWidth` requests in a second
  `measureTexts` call).
  Note F14.1's canvas path subsumes most of this: with a layout-free natural
  measurement the sweep costs no forced layout at all.
- **Risk / blast radius**: `tests/component/input/TextThemeReflow.test.ts:47`
  ("re-measures lazily on the next getPreferredSize() call after a theme change")
  already encodes the lazy contract, so filtering is consistent with it.
  `plans/implemented/text-measurement-batching.md`'s decision was about probe
  count, not scope, so this does not contradict it.
- **Proof at implement time**: a probe counting `measureTexts` request-list length
  on a theme change with half the `Text`s inside an undisplayed subtree.

---

### F14.7 Seven `Text` setters end in an unconditional parent `scheduleLayout()` that the preferred-size relay already covers

- **Category**: D
- **Impact**: **MEDIUM** — one extra layout root per call, and it is the *only*
  effect of the call when the measurement turns out unchanged.
- **Where**: `component/input/Text.ts:834` (`setText`), `:942` (`setFontFamily`),
  `:1021` (`setFontSize`), `:1090` (`setFontStyle`), `:1137` (`setFontWeight`),
  `:1210` (`setLineHeight`), `:1240` (`centerInHeight`), `:1354` (`setTruncate`).
  Counterpart: `core/Component.ts:3436-3448` — `setPreferredSize` **is** guarded
  on an unchanged value; `core/Component.ts:6720-6724` — `wireChild` installs a
  relay that calls `this.scheduleLayout()` on every ancestor when the preferred
  size actually changes.
- **Hot path**: any of the eight setters, on any path. For a status readout that
  is re-set with the same rendered width (a digit change that does not move the
  box), the relay correctly stays silent and the explicit `scheduleLayout()` is
  the sole cause of the next frame's pass.
- **Evidence**: read of `Component.setPreferredSize` (guarded, `:3438`) and the
  relay closure (`:6720`). The probe's `IDENTICAL setText … rAF scheduled: 1`
  shows the schedule firing with nothing to recompute.
- **Proposed change**: delete the explicit `scheduleLayout()` from all eight
  sites and rely on the `setPreferredSize` relay, which fires exactly when the
  size moved. The one setter that needs its own signal is `setTruncate`, which
  changes `getMinSize`'s width cap (`Text.ts:437-439`) without necessarily moving
  the preferred size — it should call `notifyIntrinsicSizeChanged()`
  (`Component.ts:7376-7383`) instead, which is the documented hook for exactly
  that case.
- **Risk / blast radius**: `tests/component/input/TextAutoMeasureLayoutSchedule.test.ts:43`
  asserts "schedules the parent while auto-measure is on" — that test pins the
  current mechanism and would have to be rewritten to assert the *effect* (the
  parent lays out) rather than the call. `tests/component/input/TextIntrinsicHeight.test.ts:113-135`
  pins the `setLineHeight` idempotence guard, which stays.
- **Proof at implement time**: a probe asserting 0 rAF frames scheduled for a
  `setText` whose measured size is unchanged, and ≥ 1 when it changes;
  `DiagnosticsOverlay`'s **layout passes per second** while typing.

---

### F14.8 The shared `.Text` class rule carries six no-op declarations matched by every text element in the document

- **Category**: H (over-engineering), F (restyle surface)
- **Impact**: **MEDIUM** — no write cost, but `.Text` is one of the widest-matching
  selectors in a Loom shell (every `Button` label, `MenuItem`, `TabButton`,
  tree/list row label, `Header` label, `StatusBar` readout is a `Text`), and every
  stylesheet mutation anywhere in the app triggers a full-document restyle that
  re-applies all of them.
- **Where**: `component/input/Text.ts:126-141` — `ownClassStyleDefaults.font`;
  `component/input/Text.ts:62-74` — `_defaultTextOptions`
- **Evidence**: probe `slice14f.probe.test.ts` — the rule a first `Text` render emits:
  ```
  TEXT setRuleStyles ".Text" {"fontFamily":"var(--ts-ui-font-family, system-ui, sans-serif)",
    "fontKerning":"auto","fontSize":"var(--ts-ui-font-size, 14px)","fontSizeAdjust":"none",
    "fontStretch":"normal","fontStyle":"normal","fontVariant":"normal","fontWeight":"normal",
    "textAlign":"left","lineHeight":"calc(1em + var(--ts-ui-line-padding, 2px))",
    "textOverflow":"ellipsis"}
  ```
  Six of the eleven — `fontKerning: auto`, `fontSizeAdjust: none`,
  `fontStretch: normal`, `fontStyle: normal`, `fontVariant: normal`,
  `fontWeight: normal` — are the CSS **initial** values for those properties, and
  `textAlign: left` is effectively initial for an LTR document. They exist only so
  `resolveFontValue` can report a non-null value from the class tier. The four
  matching setters have **zero real consumers** (see the greps in *Redundant,
  duplicated and dead code* below) — the only call sites are `Text`'s own
  `applyOptions` dispatch and `Header`'s forwarding.
- **Proposed change**: drop `fontKerning`, `fontSizeAdjust`, `fontStretch`,
  `fontVariant` from `_defaultTextOptions` and from `ownClassStyleDefaults.font`,
  and have the corresponding getters fall back to `null` (they already return
  `null` for an undeclared key, `Component.ts:5756-5779`). `fontStyle: normal` and
  `fontWeight: normal` are load-bearing for the class-tier dedup that lets
  `Button`'s bold label deviate cleanly, so check
  `tests/component/input/TextClassStyleHoisting.test.ts` before removing those
  two. Keeping the four *setters* is fine; it is the unconditional *declarations*
  that cost.
- **Risk / blast radius**: `tests/component/input/TextClassStyleHoisting.test.ts`
  and `tests/component/input/TextTruncateWritePath.test.ts:86` ("a fresh Text with
  no font override never materialises its own `#id` rule") pin the dedup
  behaviour and are the gate.
- **Proof at implement time**: declaration count on `.Text` in the probe above;
  in the harness, `ms/frame` of a drag frame that also mutates a rule (the restyle
  cost is what shrinks).

---

### F14.9 `ProgressBar.doLayout` rewrites its track and fill geometry unconditionally and leaves an extra scheduled pass

- **Category**: B, D
- **Impact**: **MEDIUM** — 12 sink applies plus one extra scheduled layout root per
  pass, per visible `ProgressBar`, on every resize frame.
- **Where**:
  - `component/display/ProgressBar.ts:499-530` — `doLayout`
  - `component/display/ProgressBar.ts:511-513` — `_track.setX/setY/setSize`
  - `component/display/ProgressBar.ts:516-524` — `_fill.setX/setY/setSize`, including `setX(0)`/`setY(0)` which are constant forever
  - `core/Component.ts:3918-3936` — `setSize`, unguarded, `:3933` unconditional `scheduleLayout`
- **Hot path**: any ancestor resize → `ProgressBar.doLayout` → two unguarded
  `setSize` calls → geometry applies + two extra layout roots queued for the next
  frame.
- **Evidence**: probe `slice14d.probe.test.ts`:
  ```
  PROGRESSBAR rAF callbacks per generation: [1,0,0,0,0,0,0,0]
  PROGRESSBAR pass-N sink ops: {"apply":11} | rAF pending: 1
  ```
  Not a perpetual loop (unlike F14.2), but every settled pass costs 11–12 applies
  and arms one more frame. For contrast, the value setters **are** correctly
  guarded: `PROGRESSBAR setValue(31) again — sink ops: {}` (`ProgressBar.ts:454`,
  `:483`).
- **Proposed change**: hoist `_fill.setX(0)` / `_fill.setY(0)` out of `doLayout`
  (set once at construction — they never change), and guard the two `setSize`
  calls on a changed box, or replace them with `setBounds`, which returns whether
  the rectangle changed and batches the four writes into one apply
  (`Component.ts:4082-4090`). Same shape applies to `ProgressSpinner`'s
  `_arc.setX/setY/setSize` (`ProgressSpinner.ts:306-308`), measured at 6 applies
  on an unchanged inline pass.
- **Risk / blast radius**: `tests/component/display/ProgressBar.test.ts`,
  `tests/component/display/ProgressSpinner.test.ts`. Rides with slice 01's
  `setSize` guard, and should be sequenced with F14.2.
- **Proof at implement time**: sink applies on an unchanged `ProgressBar` /
  `ProgressSpinner` pass (target: the empty-flush floor, currently 11–12 and 6).

---

### F14.10 `Text.render()` re-adds a value-class token `Component.init` has already added

- **Category**: B, J
- **Impact**: **LOW** — one redundant `DOM.sink.apply` per `Text` that has a
  numeric line-height set before first render, which is every `StatusBar` readout,
  `MenuItem` label, `Dialog` title, `PaginationBar` page label, `ComboBox` label
  and every pooled cell/list/tree row label.
- **Where**:
  - `component/input/Text.ts:1510-1521` — `render()`; `:1515-1518` re-asserts `getValueStyleToken("lh")`
  - `core/Component.ts:7581-7585` — `init()` already builds `valueClassTokens` from `_valueStyleTokens` and adds them in the same `apply` as the class chain
  - `core/Component.ts:7657-7663` — `Component.render()` calls `init(element)` before `Text.render()`'s own body runs
- **Evidence**: probe `slice14a.probe.test.ts`:
  ```
  FIRST RENDER addClass payloads: [["ts-ui-component","Text","lh21px"],["lh21px"]]
  ```
  The token is added twice, in two separate applies.
- **Proposed change**: delete `Text.ts:1515-1518`. The JSDoc justifying it
  (`:1501-1509`, "mirrors `CheckboxBox.render()`'s re-assert") predates the
  `init()` catch-up; the generic mechanism now covers it. Check whether
  `CheckboxBox`'s own re-assert and `ComboBox.test.ts:455` ("row 6: … the rendered
  element carries lh31px via the `init()` catch-up") are now the same redundancy —
  that test's own name says the `init()` path is what delivers the token.
- **Risk / blast radius**: `tests/component/input/ComboBox.test.ts:455`,
  `tests/component/input/TextLineHeightValueClassSharing.test.ts`.
- **Proof at implement time**: the probe above asserting a single `lh` addClass.

---

### F14.11 `IconText` builds and throws away a `Glyph` at construction; `setGlyph` has no same-name guard

- **Category**: B, I (the sibling class already solved it), H
- **Impact**: **LOW–MEDIUM** — construction-time waste per `IconText` built with
  `options.glyph`; and per slice 13, a `Glyph` swap is 2 stylesheet-rule deletes +
  2 inserts, the most expensive write class in the target engine.
- **Where**:
  - `component/display/IconText.ts:81` — `this._glyph = new Glyph(glyph)` from the positional argument
  - `component/display/IconText.ts:94-96` — then `if (this._options.glyph !== undefined) this.setGlyph(this._options.glyph)` → `:126-133` `removeComponent` + `new Glyph` + `insertComponent`
  - `component/display/IconText.ts:97-99` — the same shape for `text`
  - `component/display/IconLabel.ts:93-99` — the sibling **already** resolves
    `effectiveGlyph`/`effectiveText`/`effectiveForId` first and builds once, with a
    comment explaining exactly this ("`setGlyph` would rebuild the inner Glyph …
    so we resolve the effective value here once")
  - `component/display/IconText.ts:126-133`, `component/display/IconLabel.ts:138-145` — neither `setGlyph` guards on the current name
- **Hot path**: construction (hot path 6). `setGlyph` is not on a per-frame path
  in this slice's consumers, but the missing guard is the same one slice 04 found
  on `Button.setGlyph`, and the same fix applies.
- **Evidence**: read of both constructors; `IconLabel`'s own comment is the
  precedent. Slice 04/13's measurement of a `Glyph` rebuild is the cost model.
- **Proposed change**: give `IconText`'s constructor `IconLabel`'s
  effective-value resolution (`IconLabel.ts:93-99`), and add
  `if (this._glyph.getGlyphName() === name) return this;` to both `setGlyph`
  methods — matching whatever guard slice 13's `Button.setGlyph` finding lands.
- **Risk / blast radius**: `tests/component/display/IconText.test.ts`,
  `tests/component/display/IconLabel.test.ts` (both assert the post-construction
  glyph/text, which is unchanged).
- **Proof at implement time**: element-creation count for
  `new IconText('a', 't', { glyph: 'a' })` (should be one `Glyph`, not two);
  stylesheet ops for a same-name `setGlyph` (should be zero).

---

### F14.12 `StatusBar` re-lays out the whole bar on every message update, with no same-message guard

- **Category**: D, B
- **Impact**: **MEDIUM** — per status update; in Loom that is per caret move
  during a selection drag and per tab switch.
- **Where**:
  - `component/container/StatusBar.ts:250-268` — `setMessage`, no same-text guard
  - `component/container/StatusBar.ts:299-308` — `setDefaultMessage`, same
  - `component/container/StatusBar.ts:285-287` — `clearMessage` → `setMessage`
  - `component/container/StatusBar.ts:138` — `_messageText.centerInHeight(21)`, the row's baseline anchor
- **Hot path**: `setMessage` → `Text.setText` (F14.1) → `parent.scheduleLayout()`
  on the `StatusBar` → next frame the `HBox` re-resolves **every** widget in the
  bar (message, flex spacer, and each `addLeft`/`addRight` widget), then commits.
- **Evidence**: probe `slice14b.probe.test.ts` on a bar with three right-hand
  widgets:
  ```
  STATUSBAR setMessage — sink ops: {"apply":6} rAF scheduled: 1
                         source calls: {"isConnected":2,"measureText":1}
  STATUSBAR identical setMessage — sink ops: {"apply":6}
  ```
  An unchanged whole-bar pass is comparatively cheap — `{"apply":4}` with all four
  payloads `{}` (slice 01's empty flush) and no source reads beyond
  `isConnected` — so the cost is entirely the update path, not the resting cost.
- **Proposed change**: guard `setMessage` and `setDefaultMessage` on
  `text === this._message` (still cancelling/rearming the timer, which is the one
  side effect that must run). With F14.1's `setText` guard this becomes redundant,
  so treat it as the cheap interim fix or fold it into F14.1's plan.
  Separately, `STATUS_BAR_HEIGHT` (`:17`) and
  `STATUS_BAR_BORDER_TOP_WIDTH` (`:27`) fix the bar's height, so the message
  `Text`'s preferred *height* can never affect the bar — only its width can, and
  only through the `HBox`'s packing. A `StatusBar` could therefore legitimately
  give its message `Text` a min-width floor and skip the relayout entirely, which
  is the library-side answer to Loom's pin for this specific component.
- **Risk / blast radius**: `tests/component/container/StatusBar.test.ts:72-100`
  pins `setDefaultMessage` / `clearMessage` round-trips on changed values only.
- **Proof at implement time**: sink applies + `measureText` count for a repeated
  identical `setMessage`; `ms/frame` on a Loom selection drag.

---

### F14.13 Small dead and duplicated surface in this slice

- **Category**: J, I
- **Impact**: **LOW** (code health)
- **Where / grep counts** (searched `packages/lib/src`, `packages/docs/src`,
  `packages/create-app`, `packages/lib/tests`, and `/home/jika/typescript/loom/src`;
  `packages/lib/dist` excluded):

| Symbol | Where | Hits outside its own declaration |
|---|---|---|
| `Text.getElement` override | `component/input/Text.ts:359-361` | 0 — the body is `return super.getElement(createIfMissing)` verbatim |
| `Text.clearTextShadow` | `component/input/Text.ts:912-920` | 0 |
| `Text.getWordBreak` | `component/input/Text.ts:1364-1366` | 0 (`setWordBreak` has 3 real callers: `Dialog.ts:737`, `Notification.ts:214,528`) |
| `Text.getLineClamp` | `component/input/Text.ts:1391-1393` | 0 (`setLineClamp` has 1: `Notification.ts:212`) |
| `Text.setFontKerning` / `setFontVariant` / `setFontStretch` / `setFontSizeAdjust` | `Text.ts:963/1111/1064/1042` | 0 real consumers — only `Text.applyOptions`'s own dispatch and `Header.ts:122-131`'s forwarding. See F14.8 for the cost their class-tier declarations carry. |
| `StatusBar.removeLeft` | `component/container/StatusBar.ts:218-222` | 0 |
| `StatusBar.removeRight` | `component/container/StatusBar.ts:232-236` | 0 — **and byte-identical to `removeLeft`**: both are `this.removeComponent(component); return this;` |
| `PaginationBarOptions.totalCount` | `component/display/PaginationBar.ts:25` | **Declared and never honoured** — `PaginationBar.applyOptions:132-144` dispatches only `pageSize` and `pageIndex`; `totalCount` appears nowhere else in the file. A caller passing it gets silence. |
| `Legend` positional text | `component/container/Legend.ts:42` | `super(undefined, …)` — `Legend` can never take the positional `text` argument `Text` offers; text arrives only via `options.text`. Harmless but worth naming in the doc. |

- **Proposed change**: delete the five dead members; collapse
  `removeLeft`/`removeRight` into one `remove(component)` (or delete both, since
  `Container.removeComponent` is already public and does the same); either honour
  `totalCount` (dispatch it to `store.setTotalCount`, if the store has one) or
  remove the option.
- **Risk / blast radius**: all public API. Removing a public method is a
  semver-visible change; the changelog is the gate.
- **Proof at implement time**: none needed beyond the type-check and the grep
  counts above re-run.

---

### F14.14 `Link` installs a lifetime `keydown` listener even when it can never be a keydown target

- **Category**: G
- **Impact**: **LOW** — per slice 03 the cost of `Event`'s ancestor walk is keyed
  on the *registered type*, not the registrant count, so one `Link` arms it for
  all. Worth naming because Loom's status-bar cursor readout is a `Link`
  (`EditorController.ts:117`), so any Loom shell registers `keydown` for the app's
  life whether or not anything else does.
- **Where**: `component/input/Link.ts:158` — `Event.addListener(this, "keydown", this.handleKeyDown)`,
  unconditional; `:204-218` — `setInteractive` explicitly does no listener work;
  `:281-284` — `handleKeyDown` self-guards on `isInteractive()` and returns
  immediately for a non-interactive link.
- **Hot path**: 4 (typing) — every keystroke in the document walks the target's
  ancestor chain through `Event`'s subtree dispatch (slice 03: 20 `getId` +
  20 `getParentElement` seam calls on a 20-deep chain, each ancestor interned with
  a `WeakRef` and a finalizer).
- **Evidence**: read of the constructor and `handleKeyDown`; the constructor's own
  comment concedes "a non-interactive link can never be a keydown target anyway,
  since it is not focusable". Not independently measured in this slice.
- **Proposed change**: register the listener from `setInteractive(true)` and
  remove it from `setInteractive(false)`. The comment argues against listener
  churn, but `setInteractive` is a construction-time call in every current
  consumer, so there is no churn to avoid. `SelectableText.ts:71`'s `contextmenu`
  registration has the same shape but a far lower event rate, so leave it.
- **Risk / blast radius**: `tests/component/input/Link.test.ts` pins Enter
  activation and the non-interactive case.
- **Proof at implement time**: registered-type count in the `Event` registry for a
  shell with no interactive `Link`; rides with slice 03's `Event` plan.

---

### F14.15 The docs describe a `Text` theme subscription that no longer exists, and never mention the measurement cost

- **Category**: H (documentation vs implementation)
- **Impact**: **LOW**, but it is the direct cause of Loom's hand-rolled workaround
  being invented instead of asked for.
- **Where**:
  - `packages/lib/docs/components/Text.md:49` — "`Text` subscribes to the active theme on construction so it can re-measure itself on every theme change." It does not: `Text.ts:152-156` uses `Util.textMetricsGeneration()` precisely to avoid a per-instance subscription, and `tests/component/input/TextThemeReflow.test.ts:26` asserts "registers **zero** theme listeners on construction".
  - `packages/lib/docs/concepts/performance.md`, "Disposing Text components" — the registry half is correct; the two code examples' comments ("detach theme listener") are stale for the same reason.
  - `packages/lib/docs/components/Text.md` has no section on `setAutoMeasure`, `measure()`, or the fact that a `setText` costs a document reflow — the three things a consumer needs to know to use `Text` on a high-frequency path.
- **Proposed change**: correct the two stale claims (the disposal advice itself
  stays valid — the *measurement registry* entry is what `destructor` releases,
  `Text.ts:226-229`), and add a short "High-frequency text updates" section once
  F14.1 lands, saying what the library now does automatically and when
  `setAutoMeasure(false)` is still the right tool.
- **Risk / blast radius**: docs only; `npm run docs:api` must stay warning-free.
- **Proof at implement time**: n/a.

---

## Entity inventory

| Entity | Stated function | Owns DOM | Per-layout-pass writes/reads (settled) | Verdict | Findings |
|---|---|---|---|---|---|
| `Text` | "A text-displaying component with comprehensive font and layout controls" | own `<span>`; `#id` rule only when it deviates from `.Text`; shares `.Text` class rule (11 declarations) and `.Text.lh<N>px` value rules | 1 empty `apply` (slice 01's flush); **0** source reads when clean. Stale → 1 `measureText` (nowrap) or 2 (wrapping), each a forced document layout | **over-built** — the font surface is far wider than any consumer uses, and the measurement path has no layout-free mode | F14.1, F14.3, F14.4, F14.6, F14.7, F14.8, F14.10, F14.13, F14.15 |
| `Label` | "A label component backed by a `<label>` element" | `<label>` + one `for` attribute write at render | inherits `Text` | **fits** — 60 lines, one attribute, nothing extra | — |
| `Link` | "A text link … activated by a click or the Enter key" | `<a>`; two module-level class rules (`.Link` + focus ring), created once | inherits `Text` | **fits**, except the unconditional keydown registration | F14.14 |
| `SelectableText` | "Text the reader can select and copy" | inherits; `.SelectableText` class rule (2 declarations); a lazily-built `Menu` | inherits `Text` | **fits** — the lazy `_contextMenu` and the self-guarding listener are the right shape | — |
| `Legend` | "A legend component backed by a `<legend>` element" | `<legend>`; `.Legend` class rule (position + marginLeft) | inherits `Text` | **fits**; writes `position: static` on both the class tier and the instance layer (deduped at flush — redundant, not harmful) | F14.13 (positional text unusable) |
| `IconLabel` | glyph + `<label for>` in an `HBox` | none of its own beyond the container element | delegates to `Glyph` + `Label` | **fits** — the effective-value resolution at `:93-99` is the pattern `IconText` is missing | F14.11 (guard only) |
| `IconText` | glyph + standalone `Text` in an `HBox` | container element | delegates to `Glyph` + `Text` | **over-built** at construction — builds and discards a `Glyph` and a `Text` value | F14.11 |
| `Header` | "A header bar component containing a left-aligned text label" | `<header>`; a **`Border` region clip frame**; one theme subscription per instance | **1 `setRuleStyles` (`clipPath`) + 4 unchanged geometry applies + 2 empty applies** | **over-built** — a full `Border` manager for one west label | F14.5 |
| `Separator` | "the framework's `<hr>` … a one-pixel band" | own element; `.Separator` class rule; a per-instance `#id` rule carrying min/max | 1 empty `apply` | **fits** — leaf, no children, writes its fill constraint once from `init()` | — |
| `Spacer` | "A deliberately invisible leaf … whose only job is to take up space" | own element; `.Spacer` class rule | 1 empty `apply` | **fits**; writes `pointer-events: none` twice at first render (observed; source is `applyStyle`'s replay, slice 02) | — |
| `StatusBar` | "A thin horizontal strip … a transient status message and small indicators" | `<div>` + ARIA live region; children own theirs | 4 empty `apply`s, 12 `isConnected` reads (from `Container`/`HBox`) | **fits** structurally; the update path is the problem | F14.12 |
| `ProgressBar` | "A horizontal progress indicator with a determinate and an indeterminate mode" | 3 elements (self, track, fill); one keyframes rule, module-level | **11–12 applies + 1 extra scheduled pass**, all values unchanged | **mismatch** — `doLayout` re-derives and re-writes constants | F14.9 |
| `ProgressSpinner` | "A circular loading indicator rendered as a rotating arc" | 2 elements (self, arc); `.ProgressSpinnerArc` class rule; one keyframes rule; one theme subscription when size-tracking | inline: 6 applies. **overlay: 9 applies + 1 rAF, forever** | **mismatch** — overlay resize tracking is implemented as a perpetual layout loop | F14.2, F14.9 |
| `PaginationBar` | "A horizontal navigation bar for stepping through pages of a paginated store" | container element; 4 `Button`s + 1 `Text` | delegates | **fits**; `refresh()` fires on six store events and unconditionally re-sets the page text | F14.1 (caller), F14.13 (`totalCount`) |
| `createSpinnerWrap` | "the shared visual recipe for the `Animation.materialize` placeholder" | none | none | **fits** — 6 lines, one caller pattern, genuinely shared by `Tab` and `AbstractWindow` | inherits F14.2/F14.9 via the spinner |

---

## Redundant, duplicated and dead code

Items not already covered as findings.

1. **`StatusBar.removeLeft` and `StatusBar.removeRight` are byte-identical and
   both dead.** `component/container/StatusBar.ts:218-222` and `:232-236`, both
   `this.removeComponent(component); return this;`.
   `grep -rn "removeLeft\|removeRight" packages/lib/src packages/docs/src packages/create-app packages/lib/tests loom/src` → 2 hits, both the declarations.

2. **`Text`'s `getElement` override is a verbatim delegation.**
   `component/input/Text.ts:359-361`. Removing it changes nothing —
   `Component.getElement` already has the same signature and default.

3. **The `truncate` → `textOverflow` correction is written in three places.**
   `Text.clearTextOverflow:1303-1313`, `Text.applySubclassStyles:1494-1499`, and
   `Text.clearLineClamp:1435-1450` each independently substitute `"clip"` for the
   getter-facing `null`, each with its own multi-paragraph comment explaining the
   same cascade hazard. One helper (`resolvedTextOverflowCSS()`) would carry the
   rule once. Not a render cost — `applySubclassStyles` runs only from
   `applyStyle` (first render / `setId` / `sync`), never per pass — but it is
   ~50 lines of comment maintaining one invariant in three copies.

4. **`Text`'s four option-only font setters.** See F14.8 and F14.13:
   `setFontKerning`, `setFontVariant`, `setFontStretch`, `setFontSizeAdjust` have
   no consumer in lib, docs, create-app, tests or Loom, yet each contributes a
   permanent declaration to the widest class rule in the library.

5. **Class-tier value written twice at construction** — `Legend.ts:52`
   (`setPosition(Position.STATIC)` duplicating `ownClassStyleDefaults.position`)
   and `Spacer.ts:91` (`setBackgroundColor("transparent")` duplicating the
   `_defaultOptions` entry passed to `super`). Both are deduped by
   `flushStyleBag` against the class tier, so the net DOM effect is nil, but each
   costs one `writeStyle` (an `_instanceStyle` spread, a `resolvePartialDeclarations`,
   an `_resolvedCache` invalidation) per instance at construction. The comments at
   `Legend.ts:35-40` say the duplication is deliberate for tier agreement; if so
   it should be a shared constant rather than two literals.

6. **Closed from the 2026-08-29 health audit.** Priority-1 item 3 ("`FieldSet` /
   `LabeledFieldSet` leak their `Legend` on every dispose") is **fixed** —
   `component/container/FieldSet.ts:274-278` now disposes `_legend` in
   `destructor()`. No other audit item touches this slice.

---

## Cross-slice notes

- **→ 01 core-component-lifecycle.** `Component.setSize` (`Component.ts:3918-3936`)
  has no unchanged guard, confirmed. **Adding that guard would silently break
  `ProgressSpinner.showOverlay`'s resize tracking** (F14.2): the overlay is
  mounted by a raw `appendChild` and is in nobody's laid-out set, so the
  self-re-arming pass is the *only* thing that resizes it with its target. Slice
  01's fix and F14.2 must land together, with F14.2 first.
- **→ 01 core-component-lifecycle.** The empty-`apply` floor is visible
  everywhere in this slice: 5 applies for a 5-`Text` unchanged pass, 4 for an
  unchanged `StatusBar` pass, all payloads `{"style":{}}`. Confirms
  `InlineStyle.flushDirty`'s missing empty-bag guard on real components.
- **→ 05 layout-base-box-flow-grid.** `Text` overrides three size reports
  (`getPreferredSize:715`, `getMinSize:764`, `getBaseline:584`). Each starts with a
  `needsMeasure()` check (cheap: two field reads) and each calls
  `isVerticalWritingMode()` → `getWritingMode()` (a plain `_options`/`_defaultOptions`
  lookup, no layer walk). `getMinSize` allocates a fresh object on every call.
  None recurses into children. So `Text` is *not* a contributor to slice 05's
  superlinear size-hint cost beyond the allocation.
- **→ 05 / 01: `canSkipUnchangedLayout`.** Every component in this slice is a leaf
  or a two-child composite with no scroll, no measurement that depends on its own
  rectangle (the one exception is a *wrapping* `Text`, F14.4), and no state that
  changes with an identical rectangle. `Separator`, `Spacer`, `Label`, `Legend`,
  a `nowrap` `Text`, `IconText`/`IconLabel` and `Header` could all safely opt into
  `canSkipUnchangedLayout` — but per the briefing that contract is currently inert
  (`LayoutManager.commitBounds:567` calls `child.doLayout()` unconditionally), so
  the opt-in is worth writing only as part of whichever plan makes `applyBounds`
  live.
- **→ 06 layout-split-border-dockregion.** `Header`'s per-pass `clip-path` rule
  mutation (F14.5) is slice 06's `Border.doLayout` finding, charged once per
  `Header`/`WindowHeader` rather than once per `Border` region. Slice 06's count
  of 18 stylesheet mutations per unchanged Loom-shaped pass should be read as
  *plus one per header*.
- **→ 02 core-component-styling.** `StyleTarget`'s missing last-written-value
  filter is what makes F14.5's identical `clipPath: null` a real mutation. And
  `Component.setValueStyleState` → `ensureClassStateRule` is the one rule-creating
  path in this slice; unlike `StyleRule`, `ClassStyleRules._stateBags` has no
  disposal counterpart (F14.3), which is a `ClassStyleRules` seam issue as much as
  a `Text` one.
- **→ 03 core-dom-seam-events.** `ProductionDOMSource.measureText`
  (`DOM.ts:2130-2177`) is a write-then-read in one function — `appendChild` then
  two `getBoundingClientRect` — i.e. a guaranteed forced document layout by
  construction. `measureTexts` (`:2226-2279`) amortises it across a batch but does
  not remove it. The canvas 2D context the seam already owns
  (`:2318-2325`) is the layout-free alternative F14.1 proposes; whichever plan
  owns `DOM.ts` should own that new seam method.
- **→ 13 button-glyph-image.** `IconText.setGlyph` / `IconLabel.setGlyph`
  (F14.11) have the same missing same-name guard slice 04/13 found on
  `Button.setGlyph`. One guard design should serve all three.
- **Seam contract that does not hold**: `docs/concepts/performance.md`'s
  "Avoiding layout thrash" says "Reading `getSize()` between sets. **Every
  `getSize` call forces a flush** so the read is up-to-date." It does not —
  `Component.getSize:3339-3344` returns the cached `_width`/`_height` with no
  flush. `Text.setWidth:691` and `Text.measuredHeight:651` both rely on that being
  free, correctly. The doc sentence is stale and should be corrected by whichever
  plan touches `performance.md`.

---

## Suggested plan grouping

**Plan A — "Text measures without a reflow" (F14.1, F14.4, F14.6, F14.7).**
The single highest-payoff change set in this slice, and the one that retires
Loom's `setAutoMeasure(false)` workaround. In order: add the layout-free
single-line measurement seam on `DOMSource` and route `applyNaturalMetrics`'s
natural probe through it; add `setText`'s same-string guard; take the wrap
re-measure off `setWidth`'s synchronous path and give it a width-keyed memo;
drop the eight redundant `scheduleLayout()` calls in favour of the
`setPreferredSize` relay; filter `wantsBatchedMeasure` on effective visibility.
Depends on slice 03 for the `DOM.ts` seam addition. Measurable on its own:
`measureText` calls per `setText`, per drag frame, and per theme change.

**Plan B — "ProgressSpinner and ProgressBar stop re-laying-out themselves"
(F14.2, F14.9).** Replace the overlay's self-re-arming pass with a real resize
relay; guard or batch the track/fill/arc geometry writes; hoist the constant
`setX(0)`/`setY(0)`. **Must land before** slice 01's `Component.setSize`
unchanged-value guard, which would otherwise break overlay resizing silently.
Measurable as rAF callbacks per generation and applies per unchanged pass.

**Plan C — "Header places its label directly" (F14.5).** Replace the `Border`
manager for plain `Header` (keep it for `WindowHeader` if its stretched controls
need regions). Depends on, or merges with, slice 06's `Border` `clip-path` plan —
if slice 06 lands first, re-measure before deciding whether C is still worth it.

**Plan D — "The value-class tier stops leaking rules" (F14.3).** Either bound the
shared tier or give it a release path in `core/ClassStyleRules.ts`. Touches a
`Component`/`ClassStyleRules` seam shared with `Cell`/`TreeRow`, so it should be
sequenced with slice 02's `StyleTarget` work and coordinated with slices 19–22
(the cell renderers are the heaviest callers).

**Plan E — "Text's option surface shrinks" (F14.8, F14.13, and items 1–5 of
*Redundant, duplicated and dead code*).** Drop the four unused font setters'
class-tier declarations, delete the five dead members, collapse
`removeLeft`/`removeRight`, fix or remove `PaginationBarOptions.totalCount`,
factor the three-way `textOverflow` correction into one helper. Public-API
removals, so changelog-gated; no behavioural risk once the class-tier dedup tests
are green.

**Rides along with a neighbour (too small to plan on their own):**
F14.10 (the duplicate `lh` class add) → Plan A or D, whichever touches `Text`
first. F14.11 (`IconText` construction + `setGlyph` guard) → slice 13's
`Button.setGlyph` plan. F14.12 (`StatusBar.setMessage` guard) → Plan A, which
makes it redundant; land it there rather than separately. F14.14 (`Link`'s
keydown registration) → slice 03's `Event` plan. F14.15 (the stale `Text` docs)
→ Plan A's documentation step, since Plan A is what changes the guidance.
