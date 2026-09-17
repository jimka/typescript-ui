# 13 button-glyph-image — render-work review

Paths below are relative to `packages/lib/src/typescript/lib/` unless stated.
All probe numbers come from `.worktrees/_probes/13-button-glyph-image/` run
against the lib's own vitest setup and modelled DOM.

## Summary

- **`Button.setGlyph` costs 37 sink ops including one stylesheet-rule insert *and*
  one delete, on every call, with no same-name guard.** Two callers hit it on a
  per-frame or near-per-frame path: `ScrollStrip.layoutArrows:801-802` (every
  layout pass of every overflowing tab strip — confirming slice 04) and
  `VideoPlayer.syncFromState:590-591` (every `timeupdate`, ≥4/s during playback).
  Each rule mutation is a full-document restyle in WebKitGTK (~195 ms/frame at
  21k nodes per the cost model). **F13.1**
- **A tab `Button` pays 11 full content-row preferred-size aggregations, 1
  unconditional `scheduleLayout()` and 1 unchanged `data-insets` attribute write
  on every identical `Tab` layout pass**, because `TabBar.applyTabButtonStyles`
  drives three unguarded `Button` setters per entry per pass. Measured on a
  settled 4-tab strip. Multiply by every visible strip in Loom's Dock grid.
  **F13.2**, **F13.3**, **F13.4**
- **`Button.getPreferredSize()` derives live with no memo**: 4 entries per button
  per plain `HBox` pass, 9 per tab-strip pass, each re-aggregating the whole
  content row (`HBox` over glyph + label) plus the perimeter. `Button` is the
  most-instantiated component in the library. **F13.4**
- **Every `Button` with text detaches and re-registers four `Tooltip` listeners on
  every `setText`/`setDescription`, unchanged value or not** (5 identical
  `setText("Save")` calls → 5 attach + 5 detach → 20 `addListener` + 20
  `removeListener`), and carries a permanent per-instance `mousemove` listener.
  **F13.5**
- **A plain `Button('Save')` never runs `_rebuildContentRow`**, so it keeps the
  `_titleColumn` wrapper that the no-description branch exists to drop — one
  extra `Component`, one extra element (4 vs 3 `createElement`), one extra `VBox`
  manager and one extra layout-recursion level per button — and never receives
  the documented optical-centre inset. **F13.6**
- Good news worth protecting: press/release costs exactly one class-token toggle
  plus two viewport-listener registrations, hover while idle costs **zero** sink
  ops, a plain `Button` and a `ToggleButton` materialise **zero** per-instance
  stylesheet rules, and the focus ring is entirely class-tier. The
  `primary-button-interaction-filtering` and class-hierarchy-cascade work paid
  off; nothing below proposes undoing any of it.

## Findings

### F13.1 `Button.setGlyph` re-does the full glyph swap for an unchanged name — two stylesheet-rule mutations per call, on two per-frame callers

- **Category**: B, C, G, D
- **Impact**: HIGH
- **Where**: `component/button/Button.ts:1789-1819` (`setGlyph`);
  `component/container/ScrollStrip.ts:801-802`;
  `component/display/VideoPlayer.ts:590-591`, `:723-726` (`onVideoTimeUpdate`);
  `component/container/TabBar.ts:1532`; `component/container/WindowHeader.ts:460,478`.
- **Hot path** (scroll strip, once per frame per overflowing strip):
  - `Tab.doLayout` → `TabBar.placeStrip:2853`
  - → `TabBar.layoutChrome` → `ScrollStrip.layoutContent:744`
  - → `ScrollStrip.layoutArrows:790`
  - → `lead.setGlyph("angle-left")` / `trail.setGlyph("angle-right")` (`:801-802`)
  - → `new ButtonIconGlyph(name)` → `Glyph` constructor + `Component` constructor
  - → `Button._rebuildContentRow:1599` (`removeAllComponents` ×4, `new HBox`,
    `new Insets`, re-add)
  - → `outgoing.dispose()` → `disposeStyleRule("#<uuid>")` → `DOM.sink.deleteStyleRule`
  - → `recomputePreferredSize:2404` → `_syncGlyphSize` + `computePreferredSize`
  - the new glyph's own `#<uuid>` rule is inserted at first render →
    `DOM.sink.ensureStyleRule`
- **Hot path** (video, every `timeupdate`): `Video "timeupdate"` →
  `VideoPlayer.onVideoTimeUpdate:723` → `syncFromVideo:599` → `syncFromState:580`
  → `_playBtn.setGlyph(...)` + `_muteBtn.setGlyph(...)`. The glyph only ever
  changes on play/pause, but the setter runs on every tick.
- **Evidence**: probe `button.probe.test.ts`, "setGlyph with the SAME name":
  `{"removeElement":3,"apply":20,"createElement":1,"createElementNS":4,"appendChild":4,"setId":1,"ensureStyleRule":1,"setRuleStyles":1,"insertBefore":2,"deleteStyleRule":1,"release":3}`
  — 37 ops, byte-identical to the different-name swap in the next case. The
  inserted and deleted selectors are both `#<uuid>` per-instance rules. Two
  `setGlyph` calls per `ScrollStrip` pass = 2 inserts + 2 deletes per frame per
  strip; the briefing's slice-04 count of "76 of 108 DOM ops from `setGlyph`" is
  consistent with 2 × 37.
- **Proposed change**: early-return from `setGlyph` when
  `this._glyph?.getGlyphName() === name`. That alone removes both per-frame
  callers' cost. `Glyph`'s registry name is immutable by design
  (`docs/components/Glyph.md`: "The registry name is fixed at construction"), so
  name equality is a sound identity test. Optionally also guard the callers
  (`ScrollStrip.layoutArrows` already knows `vertical` is unchanged), but the
  setter guard is the one that covers all 23 call sites.
- **Risk / blast radius**: 23 `.setGlyph(` call sites across the lib; none relies
  on the side effect of a same-name swap (the only observable difference is a
  fresh `Glyph` identity, and `getGlyph()`'s own doc already warns callers not to
  hold a reference across a `setGlyph`). `tests/layout/Tab.tabGlyph.test.ts`
  case 2 ("repeated swaps keep working") alternates names, so it still passes.
  `tests/component/button/Button.test.ts` "re-applies the tint when the glyph is
  swapped" also uses two different names.
- **Proof at implement time**: a probe asserting
  `ensureStyleRule + deleteStyleRule === 0` for `setGlyph(currentName)`; and
  `setRuleStyles`/`deleteStyleRule` per frame under a `ScrollStrip` overflow
  scenario (slice 04 already has the harness), expected 4 → 0.

### F13.2 `TabBar` drives three unguarded `Button` setters per tab per layout pass

- **Category**: B, D
- **Impact**: HIGH
- **Where**: `component/container/TabBar.ts:2558-2596` (`applyTabButtonStyles`),
  called from `prepareStrip:2829`; `component/button/Button.ts:2336-2341`
  (`setInsets`), `:1205-1230` (`setWritingMode`), `:1303-1322`
  (`clearWritingMode`), `:1244-1265` (`setTextAlign`); `core/Component.ts`
  `setInsets` (no unchanged-value guard, writes `data-insets`).
- **Hot path**, once per `Tab` layout pass, per tab entry:
  - `Tab.doLayout` → `TabBar.prepareStrip:2829` → `applyTabButtonStyles:2558`
  - → `entry.button.setInsets(computeTabButtonInsets(...))` — a **fresh `Insets`
    each call**; `Component.setInsets` has no guard, so it writes
    `data-insets` through the sink, then `Button.setInsets` calls
    `recomputePreferredSize()` (1 content-row aggregation)
  - → `entry.button.clearWritingMode()` (horizontal strips) — `super` no-ops on
    its own guard, but `Button.clearWritingMode` runs its body regardless and
    calls `recomputePreferredSize()` again (2nd aggregation)
  - → `entry.button.setTextAlign(this._textAlign)` → `scheduleLayout()`
    unconditionally (see F13.3)
- **Evidence**: probe `tabstrip.probe.test.ts`, settled 4-glyph-tab `Tab`, one
  further identical `host.doLayout()`:
  `perTabButton computePreferredSize=[11,11,11,11] getPreferredSize=[9,9,9,9] scheduleLayout=[1,1,1,1]`;
  whole-pass sink ops `{"apply":30}`, of which 6 are attribute writes, all
  `data-insets` values identical to what was already on the element
  (`{"data-insets":"0px 8px 0px 8px"}` ×4 for the tab buttons). `setRuleStyles`
  this pass: 0. The 11 − 9 = 2 extra `computePreferredSize` entries are exactly
  the two `recomputePreferredSize()` calls above.
- **Proposed change**: three independent guards, any of which helps on its own.
  (a) `Component.setInsets`: return early when the four values match the current
  `Insets` (value compare, not identity — `computeTabButtonInsets` allocates).
  (b) `Button.clearWritingMode` / `setWritingMode`: only run the
  child-forwarding + `recomputePreferredSize` body when `super`'s write actually
  changed something (`setWritingMode` needs its own guard added to
  `Component.setWritingMode`, which has none). (c) `Button.setInsets`: skip
  `recomputePreferredSize()` when `super.setInsets` was a no-op.
- **Risk / blast radius**: `Component.setInsets` is used everywhere; a value
  guard changes nothing observable because the attribute value written is
  derived purely from the four numbers. `Button.setInsets`'s recompute is
  documented as serving `MenuBarButton`-style constructor-time inset changes,
  which still fire because the value genuinely changes there. No test in
  `tests/component/button/` asserts an insets write count.
- **Proof at implement time**: re-run `tabstrip.probe.test.ts` and assert
  `computePreferredSize` per tab button drops from 11 to 9 and attribute writes
  per identical pass drop to 0; then ms/frame on the 2×2 editor-grid horizontal
  drag with tab strips populated.

### F13.3 `Button.setTextAlign` calls `scheduleLayout()` on an unchanged value

- **Category**: D
- **Impact**: HIGH (per frame, per tab button)
- **Where**: `component/button/Button.ts:1244-1265`.
- **Hot path**: as F13.2 — `TabBar.applyTabButtonStyles:2578` calls it once per
  entry per pass with `this._textAlign`, which changes only when a consumer calls
  `TabBar.setTextAlign`. The method compares nothing: it forwards to
  `_text.setTextAlign(align)`, overwrites `constraints.anchor` with
  `_anchorForTextAlign(align)`, and then calls `this.scheduleLayout()`
  unconditionally, so every tab button is re-added to `pendingLayouts` and a rAF
  flush is armed on every pass.
- **Evidence**: probe `button.probe.test.ts`, "setTextAlign with the SAME value":
  `scheduleLayout=1 ops={}` — a scheduled layout with zero DOM work behind it.
  Probe `tabstrip.probe.test.ts`, second case: `total tab-button scheduleLayout
  calls = 4` on an identical 4-tab pass, i.e. exactly one per entry.
- **Proposed change**: return early when `align` equals the value already on
  `_text` (`this._text.getTextAlign()`), or at minimum only call
  `scheduleLayout()` when `constraints.anchor` actually changed. `Component`'s
  own per-axis setters are the precedent for the shape.
- **Risk / blast radius**: 3 callers — `TabBar.ts:2578`, `Tab.ts:660` (a
  consumer-driven `setTextAlign`), `Dock.ts:2040` (option dispatch). The guard
  only suppresses the no-op case. No test asserts that `setTextAlign` schedules.
- **Proof at implement time**: a probe asserting `scheduleLayout` is not called
  for `setTextAlign(currentValue)`, plus the `expectNoSelfReschedule` helper
  (`tests/helpers/layoutStability.ts`) applied to a populated `TabBar`; and the
  DiagnosticsOverlay "layout passes per second" reading at idle with a Dock grid
  open.

### F13.4 `Button.getPreferredSize` derives live with no memo, and is entered 4–9 times per button per pass

- **Category**: D
- **Impact**: HIGH (multiplied by instance count)
- **Where**: `component/button/Button.ts:2373-2384` (`getPreferredSize`),
  `:2435-2443` (`computePreferredSize`), `:2404-2422` (`recomputePreferredSize`).
- **Hot path**: any parent layout pass → `LayoutManager` size-gathering →
  `Button.getPreferredSize()` → `computePreferredSize()` →
  `this._content.getPreferredSize()` (an `HBox` aggregation over the glyph and
  the label, each of which re-reports its own preferred/min/max) +
  `this.getPerimeterSize()` (`getBorderSize` + `getInsets` + `getPadding`, and a
  fresh `PerimeterSize` object each call).
- **Evidence**: probe `button2.probe.test.ts`: four glyph `Button`s in a settled
  `HBox`, one identical further `doLayout()` →
  `getPreferredSize=[4,4,4,4] computePreferredSize=[4,4,4,4]`. Probe
  `tabstrip.probe.test.ts`: 9 `getPreferredSize` / 11 `computePreferredSize` per
  tab button per identical `Tab` pass. The class JSDoc states the live derivation
  is deliberate ("Deriving live … means the button always tracks its current
  label / glyph"), and that is the right contract — but nothing caches the result
  between the several queries within one pass.
- **Proposed change**: memoise `computePreferredSize()`'s result on the instance,
  invalidated by the five things that can change it: `_content`'s reported
  preferred size, the perimeter, the label text, the glyph identity, and the
  theme. The cheapest correct version is a per-layout-pass memo (cleared on the
  same signal `recomputePreferredSize` already reacts to, plus a pass token), so
  the 9-per-pass re-entry collapses to 1. This composes with, and does not
  contradict, the general size-hint memo slices 01 and 05 propose; if that
  general memo lands, `Button` needs only to declare its invalidation inputs.
- **Risk / blast radius**: every `Button` subclass that overrides
  `computePreferredSize` (`MenuBarButton`, `TabCloseButton`, `SpinButton`,
  `TabButton`) — the override contract is documented in `docs/components/Button.md`
  ("Subclasses customise the size by overriding the protected
  `computePreferredSize()`"), so the memo must live in `getPreferredSize`, not in
  `computePreferredSize`, or subclass overrides stop being consulted. Pinned by
  `Button.test.ts` "keeps a consumer-set preferred size when a later internal
  recompute runs" and "keeps the same preferred height whether the title is shown
  or hidden".
- **Proof at implement time**: re-run `button2.probe.test.ts` /
  `tabstrip.probe.test.ts` and assert `computePreferredSize` per button per
  identical pass drops to 1; then ms/frame on the 2×2 editor-grid drag.

### F13.5 `_rebuildTooltip` re-attaches four listeners per `setText`, and every labelled `Button` carries a permanent `mousemove` listener

- **Category**: G
- **Impact**: MEDIUM
- **Where**: `component/button/Button.ts:1425-1449` (`_rebuildTooltip`), called
  unconditionally from `setText:1176`, `setDescription:1383`,
  `clearDescription:1411`, `setTooltipSuppressed:1469`;
  `overlay/Tooltip.ts` `attach` (first statement is `Tooltip.detach(component)`,
  then four fresh closures and four `Event.addListener` calls).
- **Hot path**: any `setText` → `_rebuildTooltip` → `Tooltip.attach` →
  `Tooltip.detach` (4 `Event.removeListener`) + 4 `Event.addListener`
  (`mouseover`, `mousemove`, `mouseout`, `mousedown`), each with a newly
  allocated closure capturing `cursorX`/`cursorY`.
- **Evidence**: probe `listeners.probe.test.ts`:
  - `Button("Save")`: `addListener=8 ['mouseover','mousemove','mouseout','mousedown','mousedown','keydown','keyup','blur']`,
    `addSubtreeListener=3 ['pointerdown','pointerover','pointerout']` — **11
    listener registrations per labelled Button**, four of them Tooltip's.
  - `Button({text:''})`: only 4 (`mousedown`, `keydown`, `keyup`, `blur`) — the
    tooltip half is skipped when there is no text, confirming the four are
    Tooltip's.
  - `5x setText("Save")`: `Tooltip.attach=5 detach=5 Event.addListener=20 removeListener=20`.
- **Proposed change**: two parts. (a) `_rebuildTooltip` should remember the last
  composed string and return early when it and `_tooltipSuppressed` are both
  unchanged. (b) `Tooltip.attach` (slice 11) should update the text of an
  existing attachment instead of detach-and-reattach when the component already
  has one — that is the structural fix and removes the churn for every
  `Tooltip.attach` caller, not just `Button`.
- **Risk / blast radius**: `Tooltip.attach` is the public attach API; a
  same-component re-attach currently relies on `detach` first to avoid double
  registration, so (b) must keep that invariant. `Button.test.ts`'s `showText`
  tooltip cases assert composed tooltip text, not listener counts.
- **Proof at implement time**: a probe asserting `Event.addListener` count is 0
  across five identical `setText` calls; and the DiagnosticsOverlay "listener
  registrations" counter while retitling tabs.

### F13.6 A plain text `Button` keeps the `_titleColumn` wrapper its own rebuild logic exists to drop

- **Category**: H, D
- **Impact**: MEDIUM (one extra element + one extra layout node on the most
  instantiated component)
- **Where**: `component/button/Button.ts:787-824` (constructor wiring),
  `:1667-1688` (`_rebuildContentRow`'s no-description branch), `:1698-1700`
  (optical-centre inset).
- **Hot path**: construction only, but the extra node is charged on **every**
  layout pass thereafter — `Fit` → `_content` (`HBox`) → `_titleColumn` (`VBox`)
  → `_text`, instead of `Fit` → `_content` (`HBox`) → `_text`.
- **Evidence**: the constructor builds `_content[_titleColumn[_text]]` at
  `:792-798` and then dispatches `setText(effectiveText)` at `:815`.
  `setText` does **not** call `_rebuildContentRow`, so the no-description branch
  — whose own comment explains exactly why the column must be dropped ("The
  column reports a null baseline … which would hide the title's baseline from
  `_content` and leave the glyph centred") — never runs for the common case.
  Probe `topology.probe.test.ts`:
  - `Button("Save")` → `_content` children `['Component']` (the column), insets
    `0px 0px 0px 0px`, 4 `createElement`.
  - the same button after a `{glyph}` + `clearGlyph()` round trip → `_content`
    children `['ButtonLabelText']`, 3 `createElement`.
  The optical-centre inset `_rebuildContentRow:1698-1700` computes is likewise
  never applied to a plain text button, so the documented optical centring only
  takes effect on buttons that happen to have gone through a rebuild.
- **Proposed change**: call `_rebuildContentRow()` once at the end of the
  constructor (after the late `setText`/`setGlyph`/`setDescription` dispatch and
  before `recomputePreferredSize()`), and drop the constructor's provisional
  `_titleColumn.addComponent(this._text)` wiring. That makes one code path own
  the topology, which is what the method's own doc claims ("The single point that
  (re)parents those shared children").
- **Risk / blast radius**: subclasses that re-anchor `_content`
  (`SplitButton` via `_afterRebuildContentRow`, `TabButton`, `MenuBarButton`)
  already survive rebuilds today, since a `setGlyph` triggers one. The visible
  change is the optical inset now applying to plain text buttons — a deliberate
  ~1 px shift the feature was designed for, but it will move rendered baselines,
  so it needs a look before it ships. `Button.test.ts` asserts no topology.
- **Proof at implement time**: re-run `topology.probe.test.ts` and assert plain
  and round-tripped buttons produce identical `_content` children and identical
  `createElement` counts; DOM node count in the DiagnosticsOverlay on a Loom
  screen (expect −1 per labelled button).

### F13.7 `clearDescription()` strands the description `Text` — element, rule, theme subscription and measurement-registry entry all leak

- **Category**: J, G
- **Impact**: MEDIUM
- **Where**: `component/button/Button.ts:1407-1415`.
- **Hot path**: `clearDescription()` → `this._description = null` →
  `_rebuildContentRow()` → `_titleColumn.removeAllComponents()` (detach only) →
  the `Text` instance is now referenced by nothing and is never disposed.
  `destructor():891` does `this._description?.dispose()`, but the field is
  already `null` by then.
- **Evidence**: probe `topology.probe.test.ts`, third case — after
  `clearDescription()`, `_titleColumn` has 0 children and `getDescription()`
  returns `null`; the `Text` created at `:1367` is unreachable. Contrast
  `setGlyph:1811` and `clearGlyph:1837`, which both hold the outgoing instance in
  a local and call `outgoing?.dispose()` for exactly this reason, with a comment
  saying so. `docs/concepts/performance.md` § "Disposing Text components" spells
  out the consequence: the leaked `Text` keeps its entry in the framework's
  measurement registry, so it is re-measured in every batch measurement, and
  keeps its theme subscription, so it does work on every theme change.
- **Proposed change**: mirror `clearGlyph` — capture the outgoing `Text` in a
  local, null the field, rebuild, then `outgoing?.dispose()`.
- **Risk / blast radius**: one caller in the lib
  (`component/table/cell/Filter.ts`); `getDescription()` already documents that
  the returned instance must not be held across a mutation, by analogy with
  `getGlyph()`. No test covers `clearDescription`.
- **Proof at implement time**: a probe asserting the live `Component` count and
  the stylesheet rule count are unchanged across a
  `setDescription`/`clearDescription` round trip; the DiagnosticsOverlay
  "stylesheet rules" counter is the in-app equivalent.

### F13.8 Every state-style and Glyph font setter mutates a stylesheet rule with no unchanged-value guard

- **Category**: B, C
- **Impact**: MEDIUM
- **Where**: `component/button/Button.ts` — the twelve `setPressedX` / `setHoverX`
  setters at `:2462`, `:2497`, `:2532`, `:2566`, `:2602`, `:2636`, `:2671`,
  `:2705`, `:2739`, `:2775`, `:2811`, `:2845`, plus the six `clearX` variants
  that write a pinned value; `component/button/ToggleButton.ts:199-249` (four
  `setSelectedX`); `component/display/Glyph.ts:367-372` (`setFontSize`),
  `:412-417` (`setLineHeight`), `:443-448` (`setTextAlign`), `:595-609`
  (`setAnimationDuration`); `core/Component.ts:5788-5808` (`writeStateStyle` —
  "Writes unconditionally"), `:6059-6089` (`flushStateStyleBag`),
  `core/StyleTarget.ts:35-41` (`StyleTarget.set` — no same-value compare before
  `DOM.sink.setRuleStyles`), `core/Component.ts:5079-5084`
  (`setAnimationPlayState`, also unguarded).
- **Hot path**: none of these is reached per frame today (confirmed: the tab-strip
  probe records `setRuleStyles this pass: 0`). They are reached per *event* on
  `setChromeless`/`setFlat` flips, per theme change, and per `applyOptions`
  re-apply. The finding is that the guard is missing everywhere, so any future
  per-frame caller inherits a full-document restyle, and the existing per-event
  callers pay one for nothing.
- **Evidence**: probe `button.probe.test.ts`, "pressed/hover setters re-write the
  stylesheet rule with an unchanged value": three `setRuleStyles` ops for three
  calls whose values were already in place, e.g.
  `["#<uuid>:hover:not(.pressed)",{"backgroundColor":"rgb(1, 2, 3)"}]` written
  twice. Probe `glyph-image.probe.test.ts`, "setFontSize / setLineHeight /
  setTextAlign with unchanged values": `{"setRuleStyles":3}` with payloads
  `{lineHeight:"1"} {textAlign:"center"} {fontSize:"12px"}` — all identical to
  what was already set. `setAnimationDuration` unchanged: `{"setRuleStyles":1}`.
- **Proposed change**: add a same-value short-circuit in `StyleTarget.set` (and
  therefore `setMany`) against a per-target last-written map. That is one change
  covering every `StyleRule` and `InlineStyle` consumer in the library, not just
  this slice, and it composes with slice 04's `InlineStyle.flushDirty`
  empty-bag guard. A narrower alternative is a guard in
  `Component.writeStateStyle` alone.
- **Risk / blast radius**: library-wide — this is a `core/StyleTarget.ts` change
  and belongs with slice 02/03's findings rather than owned here. The one
  deliberate exception is `Component.pinStateStyle:5820`, whose entire purpose is
  "never deduped … even when the two values happen to coincide"; it must keep
  bypassing the guard (it already bypasses `flushStateStyleBag`).
- **Proof at implement time**: a probe asserting `setRuleStyles` count is 0 for a
  repeated same-value `setPressedShadow`; DiagnosticsOverlay stylesheet-write
  counter during a theme toggle.

### F13.9 `Glyphs.ensureGlyphSymbolMounted` runs a `DOM.source.querySelector` per glyph instance

- **Category**: G
- **Impact**: MEDIUM (per glyph construction; per frame wherever F13.1's callers
  construct glyphs)
- **Where**: `component/display/Glyphs.ts:136-145` (`ensureGlyphSymbolMounted`),
  `:153-171` (`_addSymbolToSprite`, whose idempotency test is
  `DOM.source.querySelector(_spriteElement, '#' + escapeSelector(id))`);
  called from `component/display/Glyph.ts:707` in `createRootElement`.
- **Hot path**: `new Glyph(name)` → first `getElement()` → `createRootElement:699`
  → `ensureGlyphSprite()` → `ensureGlyphSymbolMounted(name)` →
  `_addSymbolToSprite` → one `querySelector` against the sprite, every time,
  even though the module already knows which symbols it has mounted. On the
  `ScrollStrip`/`VideoPlayer` paths of F13.1 this is once per glyph per frame.
- **Evidence**: probe `glyph-image.probe.test.ts`: ten `new Glyph('probe-a')`
  instances → `DOM.source.querySelector calls = 10`, all with the same argument
  `"#ts-glyph-probe-a"`.
- **Proposed change**: keep a module-level `Set<string>` of mounted symbol ids
  alongside `_spriteMounted`, add to it in `_addSymbolToSprite`, remove in
  `_removeSymbolFromSprite`, and test it instead of querying. `querySelector` is
  not itself a forced-layout read, but it is a DOM traversal behind the seam on a
  path that runs per instance.
- **Risk / blast radius**: `Glyphs.ts` has three internal callers
  (`registerGlyph`, `unregisterGlyph`, `ensureGlyphSymbolMounted`) and no
  external ones; the set and the DOM must be kept in step across `DOM.reset()`,
  which already resets `_spriteMounted`/`_spriteElement` — the new set must be
  cleared on the same signal. `tests/component/display/Glyph.test.ts` registers
  and unregisters SVG glyphs, which exercises both directions.
- **Proof at implement time**: re-run the probe and assert `querySelector` calls
  drop to 1 per distinct glyph name rather than 1 per instance.

### F13.10 `Button.getPreferredSize` skips the min/max clamp `Component` applies, so a `Button` can report a preferred size below its own minimum

- **Category**: H (correctness)
- **Impact**: MEDIUM
- **Where**: `component/button/Button.ts:2373-2384`; contrast
  `core/Component.ts` `getPreferredSize`, which ends in
  `this.clampPreferredToConstraints(preferredSize, ownMin, ownMax)`.
- **Hot path**: n/a — a contract break, not a cost.
- **Evidence**: `Button.getPreferredSize` returns `super.getPreferredSize()` (and
  therefore the clamp) only on the pinned branch; the auto-sized branch returns
  `this.computePreferredSize()` raw. Probe `button2.probe.test.ts`: a `Button`
  with `setMinSize({width: 300, height: 0})` reports `min={width:300,height:30}`
  and `pref={width:38,height:30}`. `docs/concepts/sizing.md` § "The size
  invariant" states the framework "resolves on read with **min winning**: a
  preferred below the minimum is lifted to the minimum".
- **Proposed change**: run the auto-derived value through
  `clampPreferredToConstraints` with the component's own min/max constraints, the
  same way the base class does. Note that `clampWidth`/`clampHeight` still
  enforce the envelope on the *committed* size, so this changes what the button
  reports upward, not what it ends up rendering — but a `Grid`/`HBox` track sized
  from the report currently gets the wrong number.
- **Risk / blast radius**: every `Button` subclass that sets a minimum —
  `TabCloseButton`, `SpinButton`, `MenuBarButton` (which pins height via
  `computePreferredSize`). No test pins the current unclamped behaviour (the full
  `Button.test.ts` `it(...)` list is in `tests/component/button/Button.test.ts`;
  none mentions min or max).
- **Proof at implement time**: a probe asserting
  `getPreferredSize().width >= getMinSize().width` for a `Button` with an
  explicit minimum.

### F13.11 `Image.getMinSize` rebuilds and re-resolves the whole instance style bag twice per call

- **Category**: G
- **Impact**: MEDIUM where `Image` is used; LOW in Loom (no `Image` instances)
- **Where**: `component/display/Image.ts:931-941`; `core/Component.ts`
  `instanceLayer()` — `return { authored: this._instanceStyle, resolved: resolvePartialDeclarations(this._instanceStyle) }`,
  i.e. a fresh object plus a full declaration resolution on every call.
- **Hot path**: any layout pass → size gathering → `Image.getMinSize()` → two
  `this.instanceLayer()` calls (lines 932 and 936), each allocating and
  re-resolving. Per slice 05, `getMinSize` is entered several times per child per
  pass.
- **Evidence**: probe `glyph-image.probe.test.ts`: one `getMinSize()` call →
  `resolvePartialDeclarations calls = 2`.
- **Proposed change**: hoist to a single `const authored = this.instanceLayer().authored.minSize;`
  and test that; better still, `Component` should expose a cheap
  `hasAuthoredMinSize()` so no caller needs to materialise a layer to answer a
  boolean. The second form is a `core/Component.ts` change (slice 01/02).
- **Risk / blast radius**: `Image.getMinSize` only; the two conditions are
  identical today, so collapsing them is behaviour-preserving.
- **Proof at implement time**: re-run the probe and assert
  `resolvePartialDeclarations` calls per `getMinSize` drop to 0.

### F13.12 `ButtonIconGlyph`'s shared class rule is defeated whenever the theme's title line height is not 14 px, and each glyph button then materialises its own `#id` rule

- **Category**: B, H
- **Impact**: MEDIUM (one extra per-instance stylesheet rule per glyph button)
- **Where**: `component/button/Button.ts:336` (`BUTTON_ICON_GLYPH_SIZE = {14, 14}`),
  `:338-341` (`_defaultButtonIconGlyphOptions`), `:352-362` (`ButtonIconGlyph`),
  `:1742-1768` (`_syncGlyphSize`, which writes `Math.round(_text.getLineHeight())`).
- **Hot path**: first render of any glyph `Button`.
- **Evidence**: probe `rules.probe.test.ts`. A plain `Button('Save')`
  materialises **zero** per-instance rules (only shared class rules:
  `.Button.pressed`, `.Button:hover:not(.pressed)`, `.Button`, `.Text`,
  `.ButtonLabelText`, and three `.ts-ui-component` rules). A glyph `Button`
  materialises **two** rules: `.ButtonIconGlyph` with
  `{minWidth:'14px',minHeight:'14px',maxWidth:'14px',maxHeight:'14px'}` and a
  per-instance `#<uuid>` with the same four keys at `16px`, because
  `_syncGlyphSize` resolved a 16 px line height under the probe's font. The
  class rule is written and then immediately outranked for every instance.
  The constant's own comment acknowledges the coupling: "The square size
  `_syncGlyphSize`'s line-height auto-track resolves to under the shipped default
  theme".
- **Proposed change**: derive the `ButtonIconGlyph` class default from the same
  resolved theme metric `_syncGlyphSize` uses (a `ThemeManager.getResolvedScale()`
  read at class-rule materialisation, as `Glyph.glyphDefaultSize()` at
  `component/display/Glyph.ts:179-183` already does), rather than a frozen
  literal — or drop the class default and let `setValueStyleState` share one rule
  per distinct resolved size, which is what that mechanism exists for.
- **Risk / blast radius**: `plans/implemented/glyph-icon-size-dedup.md` and
  `glyph-icon-trait-dedup.md` designed this dedup; changing the default is
  within their intent (they wanted one shared rule), but their Architecture
  Decisions should be read first. Pinned by
  `tests/component/button/Button.test.ts` "ButtonIconGlyph style hoisting" —
  "a rendered Button's unpinned leading glyph writes nothing to its own `#id`
  rule", which the probe shows is **already false** under a non-14 px font, so
  that test is passing only because the test font happens to agree in its own
  scenario. Worth checking before planning.
- **Proof at implement time**: a probe asserting zero `#<uuid>` rules for a glyph
  `Button` under two different theme scales; DiagnosticsOverlay stylesheet-rule
  count on a Loom screen with glyph tabs.

### F13.13 Nine more `Button` / `Image` setters with no unchanged-value guard

- **Category**: B, D
- **Impact**: MEDIUM to LOW (none on a per-frame path today)
- **Where and cost**:
  | Setter | Line | What an unchanged call costs |
  |---|---|---|
  | `setShowText` | `Button.ts:2971` | `_text.setText` + `_rebuildContentRow` + `_resolveInsets` + `recomputePreferredSize` |
  | `setShowDescription` | `:2942` | `_rebuildContentRow` + `recomputePreferredSize` |
  | `setDescriptionUnderGlyph` | `:2914` | `_rebuildContentRow` + `recomputePreferredSize` |
  | `setDescription` | `:1365` | `_rebuildContentRow` + `_rebuildTooltip` (F13.5) + `recomputePreferredSize` |
  | `setText` | `:1167` | `_text.setText` (which itself re-writes the same text), `_rebuildTooltip`, `_reflectAccessibleName` |
  | `setGlyphColor` / `setDescriptionColor` | `:1866` / `:1883` | forwards to a child `setForegroundColor` |
  | `pinGlyphSize` | `:1904` | cheap — the three inner `Component` setters all guard |
  | `Image.setSrc` / `setSrcset` / `setSizes` | `Image.ts:281`, `:318`, `:354` | `resetLoadState`, an attribute write, `_naturalSize = null`, and a fresh `decodeImage` |
- **Evidence**: probe `button.probe.test.ts`: three unchanged `show*` /
  `descriptionUnderGlyph` calls → `rebuilds=3`, sink ops
  `{"apply":14,"removeElement":6,"insertBefore":6}`. Unchanged `setText("Save")`
  → three writes: `{"text":"Save"}` (the child `Text` re-writing the identical
  string — a slice-14 gap), `{"removeAttr":["aria-label"]}` (`_reflectAccessibleName:1482`
  calls `getAria().clearLabel()` unconditionally, and `Aria.clearLabel` has no
  guard either), and an empty `{"style":{}}` apply (slice 04's
  `InlineStyle.flushDirty` empty-bag gap, reproduced here). Probe
  `glyph-image.probe.test.ts`: `Image.setSrc` with the same url →
  `decodeImage=1` plus an attribute write, i.e. a full reload cycle.
  `TabBar.positionCloseButtons:2745-2752`'s claim that "Both setters no-op when
  the value is unchanged" is **correct** for `pinGlyphSize` — verified:
  `Component.setMinSize`/`setMaxSize`/`setPreferredSize` all guard.
- **Proposed change**: a same-value early return in each. `setText` additionally
  should not clear an `aria-label` that was never set — guard
  `_reflectAccessibleName` on `getAria()` actually holding one.
- **Risk / blast radius**: `setShowText`'s guard interacts with
  `applyOptions:984-986`, which deliberately re-dispatches `setShowText` to force
  a resync when a subclass's tail `applyOptions` carries `showText` without
  `text`; that path relies on the call having an effect, so it needs an explicit
  force parameter or a different resync hook. `Button.test.ts`'s `showText`
  block (11 cases) pins the observable behaviour.
- **Proof at implement time**: a probe asserting zero sink ops for each setter
  called with its current value.

### F13.14 `Glyph.render`'s inline width/height replay never fires for a default-sized glyph

- **Category**: J (unreachable branch), H
- **Impact**: LOW
- **Where**: `component/display/Glyph.ts:745-763`.
- **Evidence**: `render()` reads `this._options.preferredSize`, but a glyph's
  default size is seeded into `_defaultOptions` (`:274-280`), not `_options`.
  Probe `glyphrender.probe.test.ts`: for `new Glyph('probe-a')`,
  `_options.preferredSize` is `undefined` at render and the root receives only an
  empty `{}` style apply; for `new Glyph('probe-a', {preferredSize:{24,24}})` it
  receives `{} {width:'24px'} {height:'24px'}` — three separate applies for two
  values. So the documented safety net ("so SVG glyphs appended raw via
  `glyph.getElement(true)` outside a framework layout don't fall back to the
  user-agent's 300×150 default") is inert in exactly the default case it exists
  to protect, and in the case where it does fire it costs three sink ops.
- **Proposed change**: read the resolved size (`getPreferredSizeConstraint()`,
  which folds the class default) rather than the raw `_options`, and write both
  axes in one `DOM.sink.apply` instead of two `setElementStyle` calls.
- **Risk / blast radius**: only affects glyphs rendered outside a layout pass; a
  laid-out glyph gets its box from `writeBounds` either way.
- **Proof at implement time**: a probe asserting a default-sized `Glyph`'s root
  carries `width`/`height` after `getElement(true)`.

### F13.15 `Image.getPreferredSize` is now a pure pass-through — the briefing's "known bug" is already fixed, the override is dead

- **Category**: J
- **Impact**: LOW (correction to the review's premise)
- **Where**: `component/display/Image.ts:787-789`.
- **Evidence**: the method body is `return super.getPreferredSize();` with no
  other statement. `git log -S "return super.getPreferredSize();" -- …/Image.ts`
  points at commit `0e7b07db` "Cache and publish Image's natural size instead of
  reading the DOM live", which replaced the live natural-size read with the
  `_naturalSize` cache plus the `_hasExplicitPreferredSize` gate at `:190`,
  `:595-599`, `:714-731`. Probe `glyph-image.probe.test.ts`: an `Image` with
  `setPreferredSize({120, 40})` reports `{width:120,height:40}`, i.e. the pin
  wins. **The bug that `getPreferredSize` reports raw natural size and ignores
  `preferredSize` no longer reproduces on `master`.** What remains is an override
  that adds nothing but a doc comment.
- **Proposed change**: delete the override and move its doc comment onto the
  class, or keep it purely as a documentation anchor with an explicit comment
  saying so. Either way this is code health, not behaviour.
- **Risk / blast radius**: none — removing an override that only calls `super` is
  observationally identical.
- **Proof at implement time**: `tests/component/display/Image.test.ts` passes
  unchanged.

### F13.16 `Button`'s option surface has a documented-but-unused tail

- **Category**: H, J
- **Impact**: LOW (code health; ~150 lines of `Button.ts`)
- **Where**: `component/button/Button.ts` — the option fields and their
  setter/getter/clearer trios.
- **Evidence**, greps run over `packages/lib/src`, `packages/docs/src`,
  `packages/create-app`, `packages/lib/tests` and `/home/jika/typescript/loom/src`
  (`grep -rn "\.<name>(" … | wc -l`), excluding `Button.ts`'s own internal
  round-trip calls:

  | API | lib src | docs app | create-app | tests | Loom |
  |---|---|---|---|---|---|
  | `descriptionUnderGlyph` opt, `setDescriptionUnderGlyph`, `isDescriptionUnderGlyph` | 0 | 0 | 0 | 0 | 0 |
  | `descriptionColor` opt, `setDescriptionColor` | 0 | 0 | 0 | 0 | 0 |
  | `pressedBorderRadius` / `hoverBorderRadius` opts + 4 accessors | 0 | 0 | 0 | 0 | 0 |
  | `getHoverForegroundColor` | 0 | 0 | 0 | 0 | 0 |
  | `clearPressedForegroundColor` | 0 | 0 | 0 | 0 | 0 |
  | `getPressedBorderRadius` / `getHoverBorderRadius` | 0 | 0 | 0 | 0 | 0 |
  | `chromeless` opt / `setChromeless` | 0 | 0 | 0 | 4 | 0 |
  | `glyphColor` / `setGlyphColor` | 0 | 0 | 0 | 1 | 0 |
  | `pressedBorder` / `setPressedBorder` | 0 | 0 | 0 | 1 | 0 |
  | `hoverForegroundColor` / `setHoverForegroundColor` | 0 | 0 | 0 | 1 | 0 |
  | `setHoverBorder` | 1 (`TabButton.ts:327`) | 0 | 0 | 0 | 0 |

  The `descriptionUnderGlyph` pair is the largest single item: it is the sole
  reason `_outerColumn` and `_innerRow` (`:494-495`) and the whole three-way
  branch in `_rebuildContentRow:1637-1688` exist, and nothing in the repo ever
  sets it to anything but its `true` default. `setGlyphColor` /
  `setDescriptionColor` each have exactly one caller: `Button.applyOptions`
  itself (`:994`, `:998`).
  `chromeless` is notable separately: probe `rules.probe.test.ts` shows a
  chromeless `Button` is the only variant that materialises **per-instance**
  stylesheet rules — two of them, `#id.pressed` (4 declarations, from
  `pinPressedToResting:2145`) and `#id` (17 declarations, 9 of which are `null`
  no-op removals). `MenuBarButton` was migrated off it to declared class-tier
  chrome (`component/menubar/MenuBarButton.ts:101-125`), so the expensive path
  now has no in-library user at all.
- **Proposed change**: nothing to remove unilaterally — every one of these is
  documented public API in `docs/components/Button.md`, so this is a
  deprecate-and-remove decision for the maintainer, not a refactor. The report's
  recommendation is: (a) keep the twelve `pressedX`/`hoverX` setters, they are
  the documented theming surface; (b) consider collapsing `descriptionUnderGlyph`
  to the `true` behaviour and deleting `_outerColumn`/`_innerRow` and one of the
  three `_rebuildContentRow` branches, which is the biggest simplification
  available in this file; (c) leave `chromeless` alone but note in its doc that
  it costs two per-instance rules and that declared class-tier chrome (the
  `MenuBarButton` shape) is the cheaper way to get the same look.
- **Risk / blast radius**: public API removal. Not a render-work change.
- **Proof at implement time**: n/a (line count, bundle size).

### F13.17 The three `glyphs/<style>/index.ts` barrels have no importer anywhere in the repo

- **Category**: J, H
- **Impact**: LOW (bundle risk, not render work)
- **Where**: `glyphs/index.ts` (4 lines, `export * as solid|regular|brands`),
  `glyphs/solid/index.ts` (2002 lines of `export *`),
  `glyphs/regular/index.ts` (275), `glyphs/brands/index.ts` (589).
- **Evidence**: `grep -rn "from \"~/glyphs/index\|~/glyphs/solid/index\|~/glyphs/regular/index\|~/glyphs/brands/index" packages/lib/src --include=*.ts`
  → 0 hits. `grep -rn "typescript-ui/glyphs'" packages/docs/src packages/create-app`
  → 0 hits. Every in-library consumer imports the per-icon module
  (`import { file } from "~/glyphs/solid/file.js"`), which is the shape
  `docs/components/Glyphs.md` calls "Per-style (preferred) — guarantees one path
  string in the bundle". The barrels back the published `./glyphs`,
  `./glyphs/solid`, `./glyphs/regular`, `./glyphs/brands` export subpaths
  (`packages/lib/package.json:85-104`), so they are live public API — but the
  `export * as ns` re-export shape in `glyphs/index.ts` forces a bundler to
  materialise a namespace object over all ~2,860 modules (12 MB of source), and
  most bundlers will not tree-shake that. The doc page's claim that the bulk form
  is "Tree-shaking-friendly when the bundler is strict" is optimistic and
  untested here (not verified against a real bundler run).
- **Proposed change**: either drop the `./glyphs` bulk subpath and the namespace
  barrel from the docs and the export map, keeping the three per-style barrels
  and the per-icon subpath; or measure a real bundle with `@jimka/typescript-ui/glyphs`
  imported and document the actual number. Nothing here affects render work.
- **Risk / blast radius**: published export map — a semver decision.
- **Proof at implement time**: a bundle-size check for a fixture app importing
  one icon via each style.

### F13.18 Small unchanged-value writes at first render, and a `Glyph.getBaseline` doc/code mismatch

- **Category**: B, H
- **Impact**: LOW
- **Where**:
  - `component/button/Button.ts:3003-3007` — `render()` writes
    `toggleClass: { flat: this.isFlat() }` unconditionally, so every non-flat
    button (the overwhelming majority) pays a class-token write of `false`.
    Same shape in `component/button/ToggleButton.ts:292-296` for `selected`.
  - `component/display/Glyph.ts:328-332` — `getBaseline` returns
    `size.height - 3`, while its own JSDoc says "The anchor is 4px above the
    bottom edge" and "@returns The preferred height minus 4". Probe
    `glyph-image.probe.test.ts`: a 16×16 glyph reports baseline 13, not 12.
  - `component/display/Glyph.ts:663-677` — `applyOptions`'s min/max re-pin
    produces two redundant attribute writes per glyph at first render; probe
    `glyph-image.probe.test.ts` shows `data-minSize` and `data-maxSize` written
    once batched and then once each again, with identical values.
- **Proposed change**: gate the `render()` class toggle on the flag being true;
  fix the `getBaseline` JSDoc (or the constant — the code is the shipped
  behaviour, so the doc is the thing to correct); fold the min/max re-pin so it
  runs before the element exists.
- **Risk / blast radius**: `TabCloseGlyphCentring.test.ts` and
  `GlyphIconScale.test.ts` may encode the `-3`; check before touching the number
  rather than the comment.
- **Proof at implement time**: sink-op count at first render for a plain
  `Button` (40 today) and a `Glyph` (11 today).

### F13.19 `plans/button-primary-press-filtering-exploration.md` is stale

- **Category**: (doc health)
- **Impact**: LOW
- **Where**: `plans/button-primary-press-filtering-exploration.md`.
- **Evidence**: the briefing lists it as an open plan not to contradict. It
  describes a design that has since shipped as
  `plans/implemented/primary-button-interaction-filtering.md`: the `.pressed`
  class, the no-pointer-capture decision, and the subtree/viewport listener split
  are all in `Button.ts` today (`:558-712`). Its line references no longer
  resolve — it cites "`Button.ts:385`" for the generated `:active` rule and
  "`Button.ts:1482`" for the action event; the current file has
  `ownStyleStates`/`setStyleState` at `:408-443`/`:585-592` and `on("action")` at
  `:1932`. It also proposes `createStyleRule(".pressed")`, which the
  `button-meta-class-dedup` / `class-hierarchy-cascade` work replaced with
  declared class-tier states. **None of the findings above contradicts the
  shipped design**; F13.1–F13.4 are all about setters the press path does not
  touch.
- **Proposed change**: move it to `plans/implemented/` beside its successor, or
  mark it superseded, so a future reviewer does not treat it as a live
  constraint.

## Entity inventory

| Entity | Stated function | Owns DOM (elements, rules) | Per-layout-pass writes / reads | Verdict | Findings |
|---|---|---|---|---|---|
| `Button` (`component/button/Button.ts`, 3015 lines) | Push button with text label and configurable pressed/hover appearance | 1 `<button>` root + `_content` + `_titleColumn` + `_text` = 4 elements; **0 per-instance rules** when plain, 2 when `chromeless`, +1 (the glyph's) when it carries a glyph. Shares 5 class rules | Nothing of its own (no `doLayout` override). Charged: 4 `getPreferredSize` / 4 `computePreferredSize` per plain `HBox` pass; 9 / 11 plus 1 `scheduleLayout` plus 1 `data-insets` attribute write per `Tab` pass | over-built | F13.1–F13.6, F13.10, F13.12, F13.13, F13.16, F13.18 |
| `ButtonLabelText` (`Button.ts:314-328`) | `Button`'s title label with class-default align/weight/size | none of its own; shares `.ButtonLabelText` | via `Text` | fits | — |
| `ButtonIconGlyph` (`Button.ts:352-362`) | Leading glyph with a shared min/max class rule | shares `.ButtonIconGlyph`; **materialises its own `#id` rule whenever the resolved line height ≠ 14** | size reports only | mismatch | F13.12 |
| `ToggleButton` (`component/button/ToggleButton.ts`, 304 lines) | `Button` that flips selected on click | inherits `Button`'s; **0 per-instance rules**; adds 1 class rule `.ToggleButton.selected:not(.pressed):not(:hover)` | inherits `Button`'s | fits | F13.8 (4 `setSelectedX`), F13.18 |
| `Glyph` (`component/display/Glyph.ts`, 771 lines) | Small icon from the registry, SVG `<use>` or Unicode char | `<span>` root + `<svg>` + `<use>` (tracked handles); `#id` rule only when its size deviates from the class default; 3 shared animation class rules + 3 `@keyframes`, injected once | size reports only; no writes | fits | F13.8, F13.9, F13.12, F13.14, F13.18 |
| `Glyphs` (`component/display/Glyphs.ts`, 198 lines) | Name → `GlyphDef` registry + the single hidden `<svg>` sprite | 1 app-lifetime sprite on `<body>`, 1 `<symbol>` + `<path>` per distinct SVG glyph | none | fits, with one avoidable read | F13.9 |
| `Image` (`component/display/Image.ts`, 1040 lines) | `<img>` sized from natural dimensions, with loading/broken states and aspect-ratio locking | 1 `<img>`; 2 class rules (`.loading`, `.broken`); 2 native listeners | `setWidth`/`setHeight` are guarded; `getMinSize` allocates + re-resolves twice per call | fits (one dead override) | F13.11, F13.13, F13.15 |
| `focusRing` (`component/input/focusRing.ts`, 127 lines) | Shared `:focus-visible::after` / `:focus-within::after` ring rules | 2 shared `selector`-scope rules per registered base selector, inserted at module import | none — purely class-tier, nothing per instance, nothing per frame | fits | — |
| `glyphs/{solid,regular,brands}/index.ts` | Re-export barrels for the 2,860-icon corpus | none (data) | none | dead (in-repo) | F13.17 |

Per the briefing's question about the layout contract: **`Button` never commits
child bounds itself** — it installs a `Fit` manager (`Button.ts:782`) and lets
`LayoutManager.commitBounds` do the work, so it inherits slice 01/05's finding
that `applyBounds` and `canSkipUnchangedLayout` are inert. `Button` is a
reasonable `canSkipUnchangedLayout` candidate once F13.4's memo lands: its
content row's geometry depends only on its own rectangle and its label/glyph
content, both of which already have change notifications
(`recomputePreferredSize`, `notifyIntrinsicSizeChanged`).

Per the briefing's question about hover/press/release: **`Button`'s own cost here
is already minimal**. Probe `press.probe.test.ts` — `pointerdown` produces two
`Event.addViewportListener` registrations and one
`apply({addClass:['pressed']})`; `pointerup` produces the two matching removals
and one `apply({removeClass:['pressed']})`; **20 hover in/out cycles with no
press produce 0 sink ops**, because `_onPointerOver`/`_onPointerOut`
(`Button.ts:621-649`) return immediately unless the pointer id matches an active
press. `setStyleState` (`Component.ts:6213-6233`) has a same-value guard and
writes only a class token — no rule mutation. The focus ring is two shared
`selector`-scope rules created once at module import. The only per-Button
pointer-move cost is the `mousemove` listener `Tooltip.attach` installs
(F13.5).

## Redundant, duplicated and dead code

Items not already covered by a finding above.

1. **Two independent opt-outs for one job in `_syncGlyphSize`.**
   `_glyphSyncedSize` (`Button.ts:513`) and `_glyphSizePinned` (`:522`) both
   exist to stop the line-height sync from clobbering a caller-chosen glyph size;
   `_glyphSyncedSize`'s own JSDoc admits it "is unreliable on its own" and that
   `_glyphSizePinned` "is the authoritative opt-out". `_glyphSyncedSize` is still
   load-bearing for the escape hatch `docs/components/Button.md` documents
   ("override it by sizing the glyph explicitly via `getGlyph().setPreferredSize(...)`"),
   so it is not dead — but the two mechanisms should be described as one policy
   in one place rather than two fields with overlapping comments. Category I.
2. **`Button.getFill()` / `getAnchor()` vs `setTextAlign`.** The `anchor` option
   (`Button.ts:170`) is read once, in the constructor, to place `_content`
   (`:802-805`). `setTextAlign:1256-1260` then overwrites
   `constraints.anchor` directly with `_anchorForTextAlign(align)`, so on any
   button whose `setTextAlign` is called (every tab button, every pass — F13.3)
   the `anchor` option is silently discarded. `docs/components/Button.md`
   § "Content anchor" documents `anchor` without mentioning the interaction.
   `grep -rn "anchor" /home/jika/typescript/loom/src --include=*.ts` → 5 hits, so
   Loom does use it. Category I / doc gap.
3. **`Component.setWritingMode` has no unchanged-value guard**
   (`core/Component.ts`), unlike its `clearWritingMode` sibling, which does. A
   vertical `TabBar` therefore writes the identical `writing-mode` inline style
   on every tab button on every pass. Cross-slice (01/02), surfaced here because
   `TabBar.applyTabButtonStyles:2572` is the caller. Category B.
4. **`Aria.clearLabel` has no guard** (`core/Aria.ts`): it calls
   `applyAriaAttribute("aria-label", null)` even when no label was ever set, which
   is one of the three writes an unchanged `Button.setText` produces (F13.13).
   Cross-slice (02). Category B.
5. **`Text.setText` re-writes an identical string** — the `{"text":"Save"}` sink
   op in the unchanged-`setText` probe comes from the child `Text`, not from
   `Button`. Cross-slice (14). Category B.
6. **Zero-caller public API in this slice**, greps run over `packages/lib/src`,
   `packages/docs/src`, `packages/create-app`, `packages/lib/tests` and
   `/home/jika/typescript/loom/src`:
   - `Glyph.getAnimated()` — 0 callers (`grep -rn "\.getAnimated(" …` → 0).
   - `Glyph.clearAnimated()` — 1 caller, the docs app demo only.
   - `Glyph.getAnimationDuration()` — 1 caller, `tests/` only.
   - `Button.setDescriptionUnderGlyph` / `isDescriptionUnderGlyph` — 0 callers
     anywhere (F13.16).
   - `Button.getPressedBorderRadius` / `getHoverBorderRadius` /
     `getHoverForegroundColor` / `clearPressedForegroundColor` — 0 callers
     anywhere, including inside `Button.ts` itself.
   - `Image.getPreferredSize` override — a pure `super` call (F13.15).
   None of these is a render-work cost; they are surface to consider for a
   deprecation pass.

## Cross-slice notes

- **→ 02 core-component-styling / 03 core-dom-seam-events**: `StyleTarget.set`
  (`core/StyleTarget.ts:35-41`) writes through to `DOM.sink.setRuleStyles` with
  no same-value compare. A guard there fixes F13.8 for every consumer in the
  library at once, not just this slice. `Component.pinStateStyle:5820` must be
  exempted — bypassing dedup is its entire purpose.
- **→ 02 core-component-styling**: `Component.instanceLayer()` allocates a fresh
  object and runs `resolvePartialDeclarations` over the whole instance style bag
  on every call. `Image.getMinSize` calls it twice per invocation (F13.11); any
  other size report that consults it pays the same.
- **→ 01 core-component-lifecycle**: `Component.setInsets` has no
  unchanged-value guard and writes `data-insets` through the sink on every call
  (F13.2); `Component.setWritingMode` has none either while `clearWritingMode`
  does. Contrast `setPreferredSize` / `setMinSize` / `setMaxSize`, which all
  guard correctly — verified, and that is what makes `TabBar.positionCloseButtons`'
  `pinGlyphSize` genuinely free.
- **→ 02 core-component-styling**: `Component.setAnimationPlayState:5079` writes
  a stylesheet rule with no guard. `Glyph.onEffectiveVisibilityChange:562-572`
  is the caller for animated glyphs on every tab switch / collapse.
- **→ 04 core-panel-scrolling**: confirming your finding from the other end —
  `ScrollStrip.layoutArrows:801-802`'s two `setGlyph` calls cost 37 sink ops
  each, including one `ensureStyleRule` **and** one `deleteStyleRule`. The
  cheapest fix is the guard in `Button.setGlyph` (F13.1), not in `ScrollStrip`.
  Your `InlineStyle.flushDirty` empty-bag finding also reproduces here: an empty
  `{"style":{}}` apply appears in `Glyph`'s first render and in every unchanged
  `Button.setText`.
- **→ 07 layout-tab-tabbar**: `TabBar.applyTabButtonStyles:2558-2596` is the
  single largest per-frame `Button` cost in the library (F13.2, F13.3). The
  setters it drives are all no-ops on a settled strip; guarding them in `Button`
  fixes it without `TabBar` changing, but `TabBar` could also skip the whole loop
  when neither `_compact`, `_orientation`, `_textAlign` nor the entry set has
  changed since the last pass. `TabBar.positionCloseButtons:2745`'s comment
  claiming both setters no-op is accurate — leave it.
- **→ 11 overlay-popups-layers-animation**: `Tooltip.attach` detaches and
  re-registers four listeners with four fresh closures on every call, including
  when the target component and the text are both unchanged (F13.5). An
  update-in-place path would remove churn for every caller.
- **→ 14 text-and-small-display**: `Text.setText` re-writes an identical string
  through the sink; `Text.getLineHeight` is read once per `Button._syncGlyphSize`,
  i.e. 2× per tab button per `Tab` pass.
- **→ 26 charts-canvas-video**: `VideoPlayer.syncFromState:590-591` calls
  `setGlyph` twice on every `timeupdate` (`:723-726`), for glyphs that change
  only on play/pause. With F13.1's guard this becomes free; without it, it is two
  stylesheet inserts and two deletes at ≥4 Hz during playback.
- **Contract that does not hold**: `docs/concepts/sizing.md` § "The size
  invariant" promises `min ≤ preferred` on read. `Button.getPreferredSize`
  bypasses the clamp (F13.10), so the promise is false for every auto-sized
  `Button`. `docs/concepts/layout-system.md`'s `applyBounds` skip contract is
  inert for `Button` too, as slices 01 and 05 already established.

## Suggested plan grouping

**Plan A — "Button setter guards" (highest payoff, self-contained, measurable).**
F13.1 (`setGlyph` same-name guard), F13.3 (`setTextAlign` no-op guard), F13.13
(the remaining unguarded setters, including the `_reflectAccessibleName` fix).
One coherent change set inside `Button.ts` with no dependency on any other slice.
Measured by: `setRuleStyles`/`deleteStyleRule` per frame under a `ScrollStrip`
overflow scenario; `scheduleLayout` calls per identical `Tab` pass. F13.18's
`render()` class-toggle guard is too small to plan and should ride along here.

**Plan B — "Unchanged-insets and writing-mode guards".** F13.2. Touches
`Component.setInsets`, `Component.setWritingMode` and `Button`'s three overrides.
Depends on nothing, but overlaps slice 01's territory — it should be handed to
whoever owns the `Component` setter-guard pass if one is planned, and folded into
that plan rather than duplicated. Measured by: attribute writes and
`computePreferredSize` entries per identical `Tab` pass (6 → 0 and 11 → 9).

**Plan C — "Button preferred-size memo".** F13.4, and F13.10 rides along (the
clamp belongs in the same method). This is the single biggest per-frame win but
also the highest risk, because four subclasses override `computePreferredSize`
and the invalidation inputs must be exhaustive. **Should follow, and probably
merge into, slices 01 and 05's general size-hint memo** — if that lands,
`Button` needs only to declare its inputs and this plan shrinks to a few lines.
Do not start it before that decision is made. Measured by:
`computePreferredSize` entries per button per identical pass (11 → 1), then
ms/frame on the 2×2 editor-grid horizontal drag.

**Plan D — "Button content-row topology and description lifecycle".** F13.6
(single rebuild path, which also makes the optical inset apply uniformly) and
F13.7 (dispose the outgoing description `Text`). One change set; F13.16(b) —
collapsing `descriptionUnderGlyph` and deleting `_outerColumn`/`_innerRow` —
would fold naturally into it **if** the maintainer agrees to drop the option, so
that decision gates the scope. Measured by: DOM node count and live `Component`
count on a Loom screen; a round-trip probe for the leak.

**Plan E — "Glyph sprite and render fixes".** F13.9 (mounted-symbol set instead
of a `querySelector`), F13.14 (resolved-size read + one batched write), F13.18's
`getBaseline` doc correction and the min/max double-write. Small, independent,
and worth doing alongside Plan A because Plan A's `setGlyph` guard removes most
of the glyph-construction traffic that makes F13.9 matter — so if Plan A ships
first, Plan E drops to LOW and can wait.

**Plan F — "ButtonIconGlyph class-default theme coupling".** F13.12 on its own,
because it needs a decision (derive from the theme scale, or use
`setValueStyleState`) and it touches a test whose premise the probe contradicts.
Depends on reading `plans/implemented/glyph-icon-size-dedup.md` first.

**Not worth planning separately; hand to the named slice.** F13.8 → the
`StyleTarget.set` guard belongs in slice 02/03's plan. F13.11 → slice 02's
`instanceLayer` allocation plan, with the two-call collapse in `Image` as a
one-liner rider. F13.5 → slice 11's `Tooltip` plan, with `Button._rebuildTooltip`'s
same-string guard as a rider.

**Code-health only, no measurement, batch into one housekeeping change.** F13.15
(delete the dead `Image.getPreferredSize` override), F13.19 (retire the stale
exploration plan), the zero-caller list in § Redundant/dead code, and F13.17 if
the maintainer decides the bulk glyph barrel should go.
