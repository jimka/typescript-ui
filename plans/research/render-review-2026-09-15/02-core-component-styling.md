# 02 core-component-styling — render-work review

**Summary**

1. `StyleTarget` has **no last-written-value filter**. Every `set`/`setMany`/`flush`
   reaches `CSSStyleRule.style` (or `element.style`) even when the value is
   byte-identical. `Split.doLayout` → `commitPanes` calls `Component.setClipPath`
   on **every pane on every layout pass**, and `Border.doLayout` does the same per
   region — so a `Split`-gutter drag or window resize issues one stylesheet-rule
   mutation per pane per frame with an unchanged value. At the briefing's measured
   ~195 ms/frame per rule mutation at 21k nodes, this is the single largest item in
   the slice (F02.1, F02.2).
2. A write that lands on an already-materialised rule **fans out to one
   `setRuleStyles` call per property**: `flushStateStyleBag` and `flushStyleBag`'s
   resting-isolation branch both use per-key `set`, so a two-property state write is
   two full-document restyles instead of one (F02.3, probes P7/P9/Q4).
3. **Every component in the app allocates a guarded resting `StyleRule`
   (`#id:not(.undisplayed):not(.invisible)`) at first render that is never
   materialised** — because `Component` itself declares `ownStyleStates`, so
   `isRestingChromeIsolated()` is true for everything. One extra `StyleRule`, one
   Map entry, one tracked selector, one extra `materialiseDeferredRules` iteration
   and one extra teardown disposal per component (F02.4, probes R1/R4).
4. `applyStyle` **wipes the inline style `init()` just flushed**, then replays each
   property as its own `DOM.sink.apply`. A realistic component costs 12 style
   `apply` ops at first render where 1 would do (F02.5, probes P3/Q3) — multiplied
   by every component built at startup.
5. Half the typed setters have a same-value guard and half do not
   (`setBackgroundImage`, `setOutline`, `setTransform`, `setClipPath`, `setBorder`,
   `setOpacity`, … do not), and `setValueStyleState` re-writes its DOM class token
   on every call even when unchanged — the latter on the table/tree cell-rebind
   path (F02.6, F02.7).

Probes live in `.worktrees/_probes/02-core-component-styling/` (22 tests, all
passing). Probe ids `P1–P10`, `Q1–Q8`, `R1–R4` are cited below.

---

## Findings

### F02.1 `StyleTarget` writes through with no same-value filter, so a per-layout-pass `setClipPath` mutates the stylesheet every frame

- **Category**: C (stylesheet-rule write on a hot path), B (unchanged-value write)
- **Impact**: **HIGH** — one full-document restyle per collapsible pane/region per
  animation frame during hot path 1 (`Split`-gutter drag, `Dock` pane resize,
  window resize). Multiplied by the number of `Split`/`Border` panes on screen.
- **Where**:
  - `core/StyleTarget.ts:35-41` (`set`), `:79-83` (`flush`), `:399-410`
    (`StyleRule.writeStyle` / `flushDirty`) — no comparison against the current
    declaration anywhere in the class.
  - `core/Component.ts:2798-2802` (`setClipPath`), `:1893-1901`
    (`setElementCSSRule`), `:1914-1926` (`commitCSSRule`).
  - Callers (other slices): `layout/Split.ts:2002-2006` and `:2137-2146`
    (`commitPanes`); `layout/Border.ts:1265,1272,1315,1372,1414` and `:744-765`
    (`applyRegionClip`).
- **Hot path**:
  1. `SplitGutter` drag → `Split.scheduleDrag` → `Component.scheduleLayout`
  2. rAF `flushPendingLayouts` → `Component.doLayout` → `Split.doLayout`
     (`layout/Split.ts:~1890`)
  3. `Split.doLayout` builds a `clipPath` for **every** pane
     (`"inset(0 0 0 0)"` for a collapsible pane, `null` otherwise) —
     `layout/Split.ts:2002-2006`
  4. `Split.commitPanes` → `placement.component.setClipPath(placement.clipPath)`
     — `layout/Split.ts:2145`
  5. `Component.setClipPath` → `setElementCSSRule("clipPath", v)` →
     `_styleRule.queue(...)` + `commitCSSRule()`
  6. `commitCSSRule` → `materialiseWhenNeeded(_styleRule)` + `_styleRule.flush()`
  7. `StyleTarget.flush` → `StyleRule.flushDirty` → `DOM.sink.setRuleStyles`
  8. `ProductionDOMSink.setRuleStyles` (`core/DOM.ts:1667`) →
     `writeDeclaration(rule.style, "clipPath", v)` (`core/DOM.ts:304`) →
     full-document restyle
- **Evidence**: probe **Q1** — three identical `setClipPath("inset(0 0 0 0)")`
  calls on a rendered component produce three `setRuleStyles` ops:
  `[["#…",{"clipPath":"inset(0 0 0 0)"}] ×3]`. Probe **P10** confirms
  `setClipPath`/`setTransform`/`setCursor` write a rule and **zero** inline
  styles. Two mitigating facts I did confirm: `flushDirty` returns early on an
  empty bag (`core/StyleTarget.ts:405`), and a `null` write onto a component whose
  `#id` rule was never materialised is free (`materialiseWhenNeeded` skips,
  `flush()` returns on a null `_target`) — so the cost lands on every pane that
  *does* have an `#id` rule, and unconditionally on every collapsible pane (real
  value ⇒ materialisation).
- **Proposed change**: add a `_written: Record<string, string | null>` memo to
  `StyleTarget`; `set`/`queue`/`flushDirty` drop a key whose value equals the last
  one written to the live target, and the memo is cleared by
  `StyleRule.dispose` / `InlineStyle.attach`. This is one change that covers every
  rule- and inline-write site in the framework, including the ones in other slices.
  (Complementary, cheaper-still: have `Split`/`Border` skip the `setClipPath` call
  when the resolved value is unchanged — but the seam fix is what stops the next
  caller reintroducing it.)
- **Risk / blast radius**: every style write in the library goes through this
  class. `tests/core/StyleRuleBatchedFlush.test.ts` cases 2 and 9 pin that a
  write-through after materialisation reaches the sink immediately — both use
  *different* values (`red` → `blue`), so a same-value filter does not break them.
  Case 18 pins that a `null` removal on a materialised rule still flushes — also a
  value change. The risk is a caller that relies on re-asserting an identical
  declaration to defeat something else's write to the same rule; I found none
  (`writeGuardedCSSRule` and `pinStateStyle` both target *different* selectors, not
  the same declaration).
- **Proof at implement time**: rule writes per frame during a 2-pane
  `Split`-gutter drag, counted with a recording sink (`setRuleStyles` ops between
  two `flushPendingLayouts` calls) — expect 2+/frame before, 0/frame after; then
  ms/frame on the real WebKitGTK horizontal-gutter drag.

### F02.2 The typed setters for transform / clip-path / contain / animation / appearance write to the shared stylesheet instead of inline

- **Category**: C, H (function/implementation mismatch)
- **Impact**: **HIGH** where the caller is per-frame (`DiagramView` pan, `Split`
  collapse animation), **MEDIUM** otherwise.
- **Where**: `core/Component.ts:2798` (`setClipPath`), `:3276`/`:3314`
  (`setTransform`/`setTransformOrigin`), `:3190`/`:3206` (`setAppearance`),
  `:3233` (`setBorderImage`), `:5000`/`:5016` (`setContain`/`clearContain`),
  `:5043`/`:5059` (`setAnimation`), `:5079` (`setAnimationPlayState`), `:2861`
  (`setColorScheme`) — all route to `setElementCSSRule`.
- **Hot path**: `DiagramView.ts:1005` — `this._contentHost.setTransform(...)` on
  every pan/zoom pointer move → `setElementCSSRule("transform", …)` →
  `setRuleStyles` → full-document restyle **per `mousemove`**. `Split.ts:2145` /
  `Border.ts:744` as in F02.1.
- **Evidence**: probe **P10** (`setTransform` produced
  `[["#…",{"transform":"translate(1px, 2px) scale(1.5)"}]]` and zero inline
  writes). `setTranslate` (slice 01, `core/Component.ts:4647`) already writes
  `transform` **inline** through `_inlineStyle`, and `replayGeometryStyles`
  (`:6521`) replays it inline — so the class already contains the precedent, and
  `getTransform`'s own JSDoc (`:3259-3263`) documents the two-surface split as a
  known wart.
- **Proposed change**: move the per-instance, animation-capable properties
  (`transform`, `transformOrigin`, `clipPath`) onto `_inlineStyle`, matching
  `setTranslate`/`setTransition`/`setWillChange`/`setOpacity`, which are already
  inline for exactly this reason (see `setTransition`'s JSDoc at `:5106-5118`).
  Leave `contain`/`animation`/`appearance`/`colorScheme` on the rule — they are
  set once. This also collapses the two-transform-surface wart: one surface, one
  cached value.
- **Risk / blast radius**: inline beats `#id`, so any component that sets
  `transform` via `setElementCSSRule` *and* relies on a state rule overriding it
  would change behaviour — grep shows 7 `setTransform` call sites, none with a
  competing state rule. `replayGeometryStyles`'s `(0,0)` skip
  (`core/Component.ts:6519-6523`) exists specifically so a rule-driven rotation is
  not clobbered; that comment and guard would be revisited by this change.
- **Proof at implement time**: `setRuleStyles` ops per `mousemove` in a
  `DiagramView` pan probe (expect N → 0); `setRuleStyles` per frame in a `Split`
  collapse animation.

### F02.3 A write onto an already-materialised rule fans out to one `setRuleStyles` call per property

- **Category**: C
- **Impact**: **MEDIUM-HIGH** — every per-instance state write and every
  resting-isolation write multiplies its document-wide restyle count by its
  property count. Per event (a `setPressedBackgroundColor`-style API call, a
  `Cell`/`Row` tint update, a re-render).
- **Where**:
  - `core/StyleTarget.ts:48-50` — `setMany` loops `set`, and `set` writes through
    (`:35-41`) once `_target` exists.
  - `core/Component.ts:6083` — `flushStateStyleBag` calls `rule.setMany(queued)`.
  - `core/Component.ts:5999` — `flushStyleBag`'s isolation branch calls
    `this.restingStyleRule.set(key, toWrite)` inside the per-key loop.
  - `core/Component.ts:5836` — `pinStateStyle` calls `rule.setMany(...)`.
- **Hot path**: hot path 5/6 — `Button`/`ToggleButton` per-instance state setters
  (`component/button/Button.ts:2463-2857`, 24 call sites), `Cell`/`Row` re-tint,
  and any `setId`-driven re-render.
- **Evidence**: probe **P7** — `writeStateStyle('.probeon', {backgroundColor,
  shadow})` on a materialised state rule produced **two** ops:
  `[["#….probeon",{"backgroundColor":"green"}],["#….probeon",{"boxShadow":"2px 2px red"}]]`,
  versus **one** op for the same two keys on the first (unmaterialised) flush.
  Probe **P9** — a re-render wrote the isolated rule as two ops and the bare `#id`
  rule as one batch. Probe **Q4** — three isolated setters, three ops.
- **Proposed change**: make `StyleTarget.setMany` queue-then-flush (`queueMany` +
  `flush`) rather than looping `set`, and have `flushStyleBag`'s isolation branch
  accumulate into a local bag and call `restingStyleRule.queueMany(bag)` once
  (the deferred materialisation gate at `core/Component.ts:6185` already handles
  the commit). No test pins per-key `setMany` write-through — `grep -rn "setMany"
  packages/lib/tests` returns only `StyleRuleBatchedFlush.test.ts:38` (a
  pre-materialisation queue) and unrelated `ModelRecord.setMany` hits.
- **Risk / blast radius**: ordering. `flushStyleBag`'s comment at
  `core/Component.ts:5991-5998` explains the resting rule is deliberately
  *queued-only* during `applyStyle` so `applySubclassStyles` can still correct it;
  batching makes that stronger, not weaker.
- **Proof at implement time**: a probe asserting exactly one `setRuleStyles` op
  per `writeStateStyle` call regardless of key count (rewrite of P7 as an
  assertion).

### F02.4 Every component allocates a guarded resting `StyleRule` at first render that is never materialised

- **Category**: G (allocation churn), H (over-broad mechanism), J (cache nothing
  reads)
- **Impact**: **MEDIUM** — one wasted `StyleRule` object, one `Map` entry, one
  retained selector string, one extra `materialiseDeferredRules` iteration per
  render and one extra `dispose()` + `disposeStyleRule` per teardown, **per
  component**. Hot path 6 (construction / first render) and teardown, multiplied by
  the whole component count of the app.
- **Where**:
  - `core/Component.ts:6128-6130` — `isRestingChromeIsolated()` is
    `restingGuardSuffix(this.constructor) !== ""`.
  - `core/Component.ts:431-440` — `Component` itself declares `ownStyleStates`
    (`.undisplayed`, `.invisible`), so `restingGuardSuffix` is non-empty for
    **every** class that does not override the list.
  - `core/Component.ts:6139-6167` — `restingIsolationKeys()` therefore always
    contains `display` and `visibility`.
  - `core/Component.ts:5990-5999` — `flushStyleBag` routes those two keys onto
    `this.restingStyleRule`, whose getter (`:6174-6176`) calls
    `createStyleRule(...)` (`:1266-1275`), allocating and tracking the selector.
  - `core/Component.ts:5651` — `materialiseRestingRule()` runs the same getter on
    every `writeStyle` of a rendered component.
- **Hot path**: `Component.getElement(true)` → `render` → `init`
  (`core/Component.ts:7587`) → `applyStyle` (`:6478`) → `flushStyleBag` →
  `visibility` is a `FRAMEWORK_BASELINE_KEYS` member with no instance opinion →
  `matchesLower` ⇒ `toWrite = null` → `isolationKeys.has("visibility")` ⇒
  `restingStyleRule.set("visibility", null)` ⇒ allocation.
- **Evidence**: probe **R4** — a stock `new Component()` after one render:
  `deferred suffixes: [":not(.undisplayed):not(.invisible)"]`,
  `ownedSelectors: ["#…", "#…:not(.undisplayed):not(.invisible)"]`,
  `restingMaterialised: false`. Probe **R1** — same for
  `new Component({backgroundColor:'#fff'})`. Probe **R3** — a `Button` carries
  three deferred rules (`:not(.pressed):not(:hover)`, `.pressed`,
  `:hover:not(.pressed)`).
- **Proposed change**: in `flushStyleBag`, only touch `restingStyleRule` when
  `toWrite !== null` **or** the rule slot already exists
  (`this._restingStyleRule !== undefined`); same guard in
  `materialiseRestingRule`. A component that never overrides an isolated key then
  allocates nothing. Separately worth asking whether `Component`'s own
  `.undisplayed`/`.invisible` should count towards `restingGuardSuffix` at all —
  the guarded rule can never be needed for them (`setDisplayed`/`setVisible`
  deliberately never cache into `_instanceStyle` on the `false` leg, see
  `core/Component.ts:2316-2327`), so excluding the root class's own two states
  from the isolation computation would make `isRestingChromeIsolated()` false for
  everything except the classes the mechanism was actually built for.
- **Risk / blast radius**: `tests/core/RestingChromeIsolation.test.ts`,
  `tests/component/**/…stateClassHoisting.test.ts`,
  `tests/component/button/ToggleButton.selectedClassHoisting.test.ts` pin the
  isolation routing for Button/Checkbox/RadioButton/ToggleButton — those classes
  declare real chrome states and keep their guarded rule under either variant of
  this fix. The narrower "only allocate on a real value" variant is
  behaviour-identical by construction (a null-only rule never materialises today
  either — `materialiseWhenNeeded`, `core/Component.ts:6613-6617`).
- **Proof at implement time**: a probe asserting `_deferredStyleRules.size === 0`
  and `_ownedSelectors.length <= 1` after a stock `Component` renders; live
  `styleRuleCounts().instance` on a Loom project open.

### F02.5 `applyStyle` wipes the inline style `init()` just flushed, then rewrites it one property per `DOM.sink.apply`

- **Category**: B, G
- **Impact**: **MEDIUM-HIGH** on hot path 6 (construction / first render):
  measured 12 style `apply` ops for one component where 1 batched op suffices.
  Multiplied by every component an app builds; also paid again on every
  `setId`/`sync` re-render.
- **Where**:
  - `core/Component.ts:7557` — `init` calls `_inlineStyle.attach(element)`, which
    flushes the whole queued bag as one `apply`.
  - `core/Component.ts:6400` — `applyStyle`'s first act is
    `DOM.sink.apply(element, { removeAttr: ["style"] })`, discarding it.
  - `core/Component.ts:6498-6523` (`replayGeometryStyles`) and `:6534-6580`
    (`applyMiscInlineStyles`) then call `this._inlineStyle.set(...)` per property —
    and `set` writes through (`core/StyleTarget.ts:35-41`) because the buffer is
    now materialised, so each is its own `DOM.sink.apply`.
- **Evidence**: probe **Q3** — `Component({opacity, zIndex, transition,
  willChange, pointerEvents, writingMode, touchAction})` with bounds set produced
  **12** style applies at first render:
  one 7-property batch (immediately wiped), then
  `{width},{top},{left},{height},{pointerEvents},{writingMode},{touchAction},{zIndex},{willChange},{transition},{opacity}`.
  Probe **P3** shows the same shape for a smaller component (1 batch + wipe + 4
  singles).
- **Proposed change**: two independent halves.
  (a) Have `replayGeometryStyles` / `applyMiscInlineStyles` use
  `this._inlineStyle.queue(...)` and let `applyStyle` end with one
  `commitElementStyle()`, so the replay is one batched `apply`.
  (b) Do not flush at `init`-time only to wipe: either move
  `_inlineStyle.attach` after `applyStyle`'s wipe, or perform the wipe through
  the buffer (`_inlineStyle` knows its own queued set) so nothing is written
  then thrown away.
- **Risk / blast radius**: `applyStyle`'s wipe is load-bearing for the
  *re-render* case (`setId`, `sync`) where stale inline values must go; keep it
  there. `tests/core/ElementAttributeReplay.test.ts:345` documents that the
  render path re-writes `data-*` on every render and depends on the attach
  ordering — read it before reordering. Subclasses overriding `applyStyle`
  (`Markdown.ts:860`, `TabBar.ts:283`) call `super` first, so a trailing commit
  in the base would run before their additions; the commit should therefore live
  where `materialiseStyleRule()` already does (end of the base `applyStyle`) and
  subclass additions keep auto-commit semantics.
- **Proof at implement time**: a probe counting `apply` ops carrying a `style`
  payload for one first render (12 → 2); total `DOM.sink` op count for building a
  1000-component tree.

### F02.6 Same-value guards are present on about half the typed setters and missing on the rest

- **Category**: B
- **Impact**: **MEDIUM** — every unguarded setter turns a no-op call into a
  stylesheet-rule mutation (per F02.1's cost model). Frequency depends on caller;
  `setBorder` and `setCursor` are called from hover/enable paths, `setClipPath`
  and `setTransform` from layout and pointer paths.
- **Where**: guarded — `setBackgroundColor` (`:2657`), `setBackground` (`:2705`),
  `setForegroundColor` (`:2821`), `setCursor` (`:2975`), `setTouchAction`
  (`:3015`), `setBorderRadius` (`:3056`), `setShadow` (`:3099`), `setContain`
  (`:5001`), `setAnimation` (`:5044`), `setTransition` (`:5125`),
  `setWillChange` (`:5355`), `setUserSelect` (`:5429`), `setPadding` (`:2572`),
  `setZIndex` (`:2264`), `setOverflowX/Y` (`:4762`/`:4807`).
  Unguarded — `setBackgroundImage` (`:2758`), `setClipPath` (`:2798`),
  `setColorScheme` (`:2861`), `setBorder` (`:2926`), `setOutline` (`:3156`),
  `setAppearance` (`:3190`), `setBorderImage` (`:3233`), `setTransform` (`:3276`),
  `setTransformOrigin` (`:3314`), `setPointerEvents` (`:5224`), `setWritingMode`
  (`:5268`), `setOpacity` (`:5310`), `setWhiteSpace` (`:5389`),
  `setAnimationPlayState` (`:5079`), `setInsets` (`:2531`).
- **Evidence**: probe **Q2** — repeat `setBackgroundImage('url(a.png)')` and
  `setOutline('1px solid red')` each wrote the rule again while a repeat
  `setBackgroundColor('#fff')` wrote nothing. Probe **P4** — a repeat
  `setBorder({border:'1px solid red'})` re-wrote all four side longhands (in
  production that is the multi-key path, i.e. a `rule.style.cssText` read plus a
  full reparse — `core/DOM.ts:1683-1693`). Probe **P5** — a repeat `setInsets`
  with an equal-valued `Insets` re-wrote `data-insets`.
- **Proposed change**: F02.1's `StyleTarget` memo makes every one of these a
  no-op at the seam without touching 15 setters, and is the preferred fix. Where
  the setter also has a non-CSS side effect (`setBorder` invalidates
  `_borderWidths` and subscribes a theme listener; `setInsets` writes a
  `data-*` attribute) add the value guard in the setter too so the side effect is
  skipped as well — `setBorder`'s `_borderWidths = null` on an unchanged spec
  forces a re-`getComputedStyle` on the next `getBorderSize()`, which is a forced
  style read (category A) it need not pay.
- **Risk / blast radius**: `setBorder` accepts a fresh `BorderOptions` object per
  call, so its guard must compare the four resolved side strings (reuse
  `borderToStyle`), not object identity. `setInsets`' guard must compare the four
  `Insets` sides, matching `setPadding`'s existing shape (`:2573-2579`).
- **Proof at implement time**: rule writes per hover-enter/-leave cycle on a
  `Button` with `setEnabled` toggling; `setRuleStyles` count for a repeated
  `setBorder` with an equal spec (1 → 0).

### F02.7 `setValueStyleState` re-applies its DOM class token and re-derives its guard on every call, even when nothing changed

- **Category**: B, G
- **Impact**: **MEDIUM** — per pooled cell per data rebind during hot path 2
  (`Table`/`Tree` virtual scroll) and hot path 6 (data refresh).
- **Where**: `core/Component.ts:6293-6308`. The token is recomputed (`:6294`), the
  declarations re-resolved (`:6295`), `valueClassGuardSuffix` (`:6323-6333`) calls
  `isRestingChromeIsolated()` → `restingGuardSuffix` (array `map` + `join`
  allocation) and builds a fresh `Set` via `restingIsolationKeys()`,
  `ensureSharedStateRule` is called (memoized downstream, but still a `Map`
  lookup chain), and then `DOM.sink.apply(element, { removeClass, addClass })`
  runs unconditionally.
- **Hot path**: `Table`/`Tree` scroll → `Body` rebinds a pooled row → `Cell`
  re-tints → `component/table/cell/Cell.ts:551`
  `this.setValueStyleState("bg", color, { backgroundColor: color })` → the above,
  once per visible cell. Also `component/input/Text.ts:1200` (line-height) and
  `component/list/ListItem.ts:111`.
- **Evidence**: probe **P8** — a second `setValueStyleState('bg','red',…)` with
  the identical token still emitted `{"removeClass":[],"addClass":["bgred"]}`.
- **Proposed change**: early-return when
  `this._valueStyleTokens.get(prefix)?.token === token` (the shared rule is
  already ensured and the class token is already on the element). Keep the write
  when the element was not present at the previous call, since `init` replays the
  token from `_valueStyleTokens` (`core/Component.ts:7584`) only for tokens
  recorded before the element existed.
- **Risk / blast radius**: `getValueStyleToken` consumers
  (`Text.ts:1515`, `ComboBox.ts:576`, `ListItem.ts:128`) read the recorded token
  at render time and would be unaffected. The recorded `layer` must still be
  refreshed if `patch` changed while `cssValue` did not — in practice the token
  is derived from `cssValue`, and every call site derives both from the same
  value, so an equality check on the token is sufficient; assert that in the
  plan.
- **Proof at implement time**: `apply` ops per `Table` scroll frame under a
  recording sink with a fixed row pool (expect one fewer per visible cell).

### F02.8 `setStyleState` drops the entire per-key resolve memo, so the next layout pass re-walks and re-allocates every style layer

- **Category**: G, D (layout work recomputed with unchanged inputs)
- **Impact**: **MEDIUM** — hot paths 3 and 5 (hover, tab/card switch) and every
  pooled-row rebind. `Row.updateStateClasses` toggles three states
  (`component/table/Row.ts:330-332`) and `Cell` three more (`cell/Cell.ts:564-566`)
  per rebind, each dropping the whole memo for that component.
- **Where**: `core/Component.ts:6224` (`this._resolvedCache = null` in
  `setStyleState`); the re-derivation is `resolveStyleValue` (`:5686-5703`) →
  `styleLayers()` (`:5511-5530`) → `instanceLayer()` (`:5537-5539`), which calls
  `resolvePartialDeclarations(this._instanceStyle)` — a fresh object plus one
  writer invocation per authored key — **on every `styleLayers()` call**, not
  once per instance-layer change. `layersBelowInstance()` (`:5569-5582`) allocates
  a fresh array per call too, and `flushStyleBag` calls it once per flush
  (`:5924`).
- **Hot path**: `Table.Body` scroll → `Row.setData` → three `setStyleState`
  calls → memo null → parent `doLayout` → `getContentInsets()`/`getPerimeterSize()`
  → `getPadding()` → `resolveStyleValue("padding")` → full layer walk +
  allocations, per row, per cell.
- **Evidence**: probe **Q6** — after four getter calls the memo held 8 entries;
  a single `setStyleState('.probeon', true)` left it `null`. Read confirms
  `styleLayers()` has no cache and `instanceLayer()` re-resolves unconditionally
  (the JSDoc at `:5532-5536` states the resolved half is "cheap to recompute" —
  that is true per key but it is recomputed per *layer walk*, i.e. per memo miss,
  not per instance-layer change).
- **Proposed change**: cache the resolved instance layer alongside
  `_instanceStyle` (invalidated in `writeStyle` / `cacheStyleValue` only), and
  cache the `styleLayers()` array keyed on `(activeStates generation,
  instance-layer generation)`. A `setStyleState` toggle then invalidates only the
  layer array, not the resolved instance bag, and only the keys a state actually
  declares can change answer — a finer invalidation (drop only the keys in
  `classStateLayer(selector).resolved` plus the instance state layer's) is the
  stronger version.
- **Risk / blast radius**: correctness of `resolveStyleValue` / `resolveFontValue`
  / `resolveOverflowAxis` / `resolveStateStyleValue` all hang off this memo;
  `tests/core/StyleLayers.test.ts`, `InstanceStyleLayer.test.ts`,
  `InstanceStateLayer.test.ts`, `StyleStates.test.ts` are the pinning suites.
- **Proof at implement time**: a probe counting `resolvePartialDeclarations`
  invocations (via a spy on the module) across one simulated scroll frame with a
  20-row pool.

### F02.9 `restingGuardSuffix` / `restingIsolationKeys` / `isRestingChromeIsolated` allocate on every call and are memoized nowhere

- **Category**: G
- **Impact**: **LOW-MEDIUM** — per `writeStyle` on a rendered component, per
  `setValueStyleState`, per `writeGuardedCSSRule`. All three results are pure
  functions of the constructor.
- **Where**: `core/ClassStyleRules.ts:912-914` (`restingGuardSuffix` — `map` +
  `join` per call over the memoized state list); `core/Component.ts:6139-6167`
  (`restingIsolationKeys` — builds a fresh `Set` and re-runs the
  `background`/`borderColor` widening every call); `:6128-6130`
  (`isRestingChromeIsolated` calls `restingGuardSuffix` just to compare against
  `""`).
- **Evidence**: read of all three; no cache map exists in either module for these
  three, unlike `_resolvedStates` / `_levels` / `_classChains` / `_resolvedTraits`
  / `_traitStyleDefaults`, which are all memoized per ctor in the same file.
- **Proposed change**: memoize both per canonical ctor in `ClassStyleRules.ts`
  next to `_resolvedStates` (the isolation-key widening is derivable from
  `resolveStyleStates(ctor)` alone, so it belongs there, not on `Component`), and
  express `isRestingChromeIsolated` as `resolveStyleStates(ctor).length > 0 &&
  !isIsolationSuppressed()` so it allocates nothing.
- **Risk / blast radius**: `suppressIsolation` is a per-*instance* opt-out
  (`core/Component.ts:6115-6123`) and must stay outside the per-ctor memo.
- **Proof at implement time**: allocation count / `restingGuardSuffix` call count
  in a first-render probe for 1000 components.

### F02.10 Debug-only `data-*` attributes are written on the render path, unbatched, and `data-insets` is written twice

- **Category**: J (no reader outside tests), B, G
- **Impact**: **MEDIUM** on hot path 6 — three extra `DOM.sink.apply` ops per
  component at first render, each its own handle resolve; plus one per
  `setInsets` / `setMinSize` / `setMaxSize` / `setPreferredSize` call thereafter.
- **Where**: `core/Component.ts:6035-6047` (`onStyleResolved` writes `data-minSize`
  / `data-maxSize` whenever a size key resolves — which is *always* at first
  render, since `applyStyle` seeds the full framework-baseline key set);
  `:6576-6579` (`applyMiscInlineStyles` writes `data-insets` on every render);
  `:2533` and `:2550` (`setInsets`/`clearInsets` already wrote the same value);
  `:3444` (`setPreferredSize`).
- **Evidence**: probe **P3** — the first-render apply sequence contains
  `{"setAttr":{"data-minSize":"0px 0px"}}`, `{"setAttr":{"data-maxSize":"inf inf"}}`
  and `{"setAttr":{"data-insets":"0px 0px 0px 0px"}}` as three separate ops.
  Reader grep over `packages/` excluding `dist`: the only consumers are
  `tests/component/Component.test.ts:106,131,156,169`,
  `tests/component/input/SingleLineHeightValueClassSharing.test.ts:324-336` and
  `tests/component/default-options-fallback.test.ts:141`; nothing in
  `lib/src`, `packages/docs`, `packages/create-app`, or `lib/src/typescript/lib/diagnostics/`
  reads them.
- **Proposed change**: gate the four `data-*` serialisations behind the existing
  diagnostics switch (`core/Diagnostics.ts`) so production writes none, or drop
  them and let the tests assert the cached values through the getters they
  already have. At minimum remove the duplicate: `applyMiscInlineStyles` re-writes
  `data-insets` with the value `setInsets` already wrote through the same buffer.
- **Risk / blast radius**: the six test assertions above; `ElementAttributes`
  replays retained attributes on re-attach, so removing them also shrinks the
  `attach` patch (`tests/core/ElementAttributeReplay.test.ts:345` comments on this
  exact behaviour).
- **Proof at implement time**: `apply` op count for one first render (expect −3);
  attribute ops per `Text` re-measure.

### F02.11 `ElementAttributes` has no same-value filter, and `Aria.setTabIndex` / `setRole` bypass the guard every other ARIA setter has

- **Category**: B
- **Impact**: **LOW-MEDIUM** — hot path 4 (keyboard navigation): `RovingTabIndex.moveTo`
  writes `tabindex` on the incoming item unconditionally, including when the index
  did not change.
- **Where**: `core/ElementAttributes.ts:30-38` (`set`) and `:47-55` (`remove`) —
  the retained `_state` is updated and the patch is applied without comparing.
  `core/Aria.ts:791-798` — the private `setAttribute` **does** guard
  (`if (this._attributes.get(name) === value) return;`), but `setRole` (`:105-110`)
  and `setTabIndex` (`:140-145`) call `applyAriaAttribute` directly and skip it.
  `core/RovingTabIndex.ts:144-147` calls `setTabIndex(0)` on the active item even
  when `clampedIndex === this._activeIndex`.
- **Evidence**: probe **P1** — `attr('data-x','a')` twice and `setTabIndex(0)`
  twice produced four `setAttr` ops. Probe **Q7** — repeat `setTabIndex(0)` and
  `setRole('button')` wrote again; repeat `setSelected(true)` did not.
- **Proposed change**: move the comparison into `ElementAttributes.set`/`remove`
  (`if (this._state.get(key) === value && this._handle) return;`), which fixes
  `setRole`/`setTabIndex` and every `setDataAttribute` / `setElementAttribute`
  caller at once. Guard `RovingTabIndex.moveTo`'s second write on an actual index
  change, mirroring the `prev` branch at `:136-138`.
- **Risk / blast radius**: `attach()` replays from `_state` regardless, so a
  filtered write is still replayed onto a rebuilt element.
  `tests/core/ElementAttributeReplay.test.ts` and `tests/core/Aria.test.ts` pin the
  replay and the existing guard.
- **Proof at implement time**: attribute ops per arrow-key press in a
  `RovingTabIndex` probe (2 → 1, and 1 → 0 for a no-op move).

### F02.12 One `ThemeManager` listener per bordered component, with an O(n) unsubscribe

- **Category**: G
- **Impact**: **LOW-MEDIUM** — listener array growth proportional to the number of
  components that ever called `setBorder`, and an O(n) `filter` (a fresh array
  allocation) per unsubscribe, so tearing down N components is O(N²) allocations.
- **Where**: `core/Component.ts:2930-2933` — `setBorder` subscribes
  `() => this._borderWidths = null` once per instance;
  `core/Theme.ts:1342-1347` — `onThemeChange` returns a disposer that rebuilds the
  whole array; `core/Theme.ts:1449` — `reflowText` iterates every listener.
- **Evidence**: read. The shared cache this per-instance listener duplicates
  (`core/BorderWidths.ts:37,99,112`) is already cleared globally on theme change;
  the per-instance listener exists only to drop the `_borderWidths` field.
- **Proposed change**: replace the per-component subscription with a module-level
  theme generation counter in `BorderWidths.ts` (incremented by the single existing
  `clearBorderWidths` subscription); `getBorderSize` compares the stored generation
  against the current one and treats `_borderWidths` as stale on mismatch. That
  removes N listeners and the whole `_borderThemeSubscribed` flag. Separately,
  back `ThemeManager.themeListeners` with a `Set` so unsubscribe is O(1).
- **Risk / blast radius**: `tests/core/BorderWidths.test.ts` and
  `tests/core/Theme*` pin the invalidation. The `Set` change also affects
  `Text`/`Table`/`Tree`/`CodeEditor` subscriptions; iteration order over a `Set` is
  insertion order, matching the array.
- **Proof at implement time**: `ThemeManager._themeListenerCount()` after building
  and disposing a 1000-component tree.

### F02.13 Class-tier rules are inserted one-at-a-time during the first render of the first instance of each class

- **Category**: C, D
- **Impact**: **MEDIUM** on startup — each `new StyleRule({scope:"class", …})`
  with the default `materialize: true` performs an `insertRule` plus a
  `setRuleStyles`, i.e. two stylesheet mutations, and they land interleaved with
  the first layout pass rather than batched.
- **Where**: `core/ClassStyleRules.ts:201` (framework rule), `:616`
  (`resolveClassLevel`), `:800` (`resolveStateLevels`), `:985`
  (`ensureClassStyleRule` flat path), `:1121` (`ensureClassStateRule`), `:1299`
  (`ensureTraitStyleRule`) — all construct a `StyleRule` without
  `materialize: false`, so the constructor calls `ensure()`
  (`core/StyleTarget.ts:365-367`).
- **Hot path**: `Component.init` → `applyStyle` → `ensureClassStyleRule`
  (`core/Component.ts:6405`) → the walk above, on the first instance of each class.
- **Evidence**: probe **R3** — a single `Button('Hi')` first render issued
  `ensureStyleRule` + `setRuleStyles` for `.Button.pressed`,
  `.Button:hover:not(.pressed)`, `.Button`, `.Text` and `.ButtonLabelText` —
  10 stylesheet mutations for one button. `ProductionDOMSink.ensureStyleRule`
  (`core/DOM.ts`) is index-backed so there is no `cssRules` scan, but each
  `insertRule` is still a document-wide restyle under the briefing's cost model.
- **Proposed change**: give the class/trait/state tiers a deferred materialisation
  path like the instance tier already has — collect newly-resolved class rules
  during a render pass and insert them in one batch at the end of the frame
  (a single `insertRule` of a concatenated block, or one `ensure()` sweep after
  the layout flush). The existing `stylerib-batched-flush` work batched the
  *declaration* write; the insertion count is untouched.
- **Risk / blast radius**: ordering is load-bearing —
  `resolveClassLevel`'s doc (`core/ClassStyleRules.ts:559-573`) relies on an
  ancestor's rule being inserted before a descendant's so plain `.ClassName`
  selectors resolve without `:where()`. A batch must preserve the existing
  ancestor-first order. `tests/core/ClassHierarchyCascade.test.ts` and
  `ClassStateHierarchyCascade.test.ts` pin it.
- **Proof at implement time**: `ensureStyleRule` + `setRuleStyles` op count for a
  Loom-shaped first render; ms to first paint on the real harness.

### F02.14 `setOverflow` / `clearOverflow` run two full resolve-flush-commit cycles

- **Category**: B, I
- **Impact**: **LOW** — two stylesheet-rule writes where one would do, per call.
- **Where**: `core/Component.ts:4724-4727` and `:4734-4736` — both delegate to the
  per-axis setters, each of which calls `writeStyle` (`:4762-4772`,
  `:4807-4817`), and `writeStyle` flushes and commits immediately on a rendered
  component (`:5648-5651`).
- **Evidence**: read. `Panel`'s `autoScroll` routes through these
  (`core/Component.ts:4848-4850`).
- **Proposed change**: `setOverflow` should issue one
  `writeStyle({ overflowX: v, overflowY: v })`. The per-axis resolution
  (`resolveOverflowAxis`) already handles both keys per layer, so the authored
  shape is unchanged.
- **Risk / blast radius**: `getOverflow()` returns null when the axes disagree
  (`:4708-4713`), unchanged by this. `tests/core/…Overflow…` / `Panel*` suites.
- **Proof at implement time**: `setRuleStyles` ops for one `setOverflow("auto")`
  (2 → 1).

### F02.15 `writeStyle` resolves the same bag twice per setter call

- **Category**: G
- **Impact**: **LOW** — one extra object allocation and one writer-table pass per
  style setter call on a rendered component.
- **Where**: `core/Component.ts:5642` resolves `patch`; `:5923` (inside the
  `flushStyleBag` it then calls) resolves the whole `_instanceStyle`, which is a
  superset of `patch`. The same shape repeats in `writeStateStyle`
  (`:5800` vs `flushStateStyleBag`'s `:6074`).
- **Evidence**: read.
- **Proposed change**: fold into F02.8's cached resolved instance layer —
  `writeStyle` can then take the patch keys from the cached delta instead of a
  second resolution.
- **Risk / blast radius**: none beyond F02.8.
- **Proof at implement time**: ride along with F02.8's `resolvePartialDeclarations`
  call counter.

### F02.16 Shipped themes declare large-radius blurred shadows on full-height surfaces

- **Category**: F (paint-heavy styling) — **not verified** against a real
  WebKitGTK recording.
- **Impact**: **LOW-MEDIUM**, unquantified. Software Cairo re-rasterises a blurred
  shadow over the whole shadowed box; the briefing records ~21–57 ms/frame for a
  viewport-sized blurred inset shadow before the 2026-09-14 edge-strip fix.
- **Where**: `core/themes/ModernTheme.ts:300` (`drawer.shadow:
  '4px 0 24px rgba(0,0,0,0.25)'` — a full-viewport-height panel), `:305`
  (`rail.shadow: '2px 0 12px …'` — also full height), `:293` (`dialog.shadow:
  '4px 8px 24px …'`), `:327` (`drag.ghost.shadow: '2px 4px 12px …'`, repainted per
  drag frame); `DarkTheme.ts` / `ClassicTheme.ts` carry the same shapes.
- **Hot path**: any ancestor resize repaints a full-height `Rail` or `Drawer`
  including its blur; a `Drawer` slide animates the shadowed box every frame.
- **Proposed change**: apply the same treatment the scroll shadow already got —
  replace the full-box blurred shadow with an edge strip (a fixed-width gradient
  element along the lit edge) for `drawer` and `rail`, or reduce the blur radius
  for those two tokens only. Leave `dialog` (modal, static) and `drag.ghost`
  (small box) alone.
- **Risk / blast radius**: visual change to two theme tokens across all three
  built-in themes; `Rail`/`Drawer` are slice 10's components and would own the
  edge-strip mechanics.
- **Proof at implement time**: ms/frame on a real WebKitGTK window resize with a
  `Rail` open, before/after — per the `loom-perf-needs-real-webkit-recording`
  rule, Chromium numbers do not settle this one.

---

## Entity inventory

| Entity | Stated function | Owns DOM | Per-layout-pass writes/reads | Verdict | Findings |
|---|---|---|---|---|---|
| `Component` typed style setters (`core/Component.ts:2520-3340`, `4988-5460`) | One setter/getter/clearer per CSS property; the layering property writes through `writeStyle`, everything else through `setElementCSSRule` / `setElementStyle` (ARCHITECTURE.md §"Always cache in memory") | The component's `#id` rule and its inline style | None on their own, but `setClipPath` is called per pane per pass by `Split`/`Border`, and each such call is one `setRuleStyles` | `mismatch` — inconsistent guards, and three properties sit on the rule surface that belong inline | F02.1, F02.2, F02.6, F02.14 |
| `Component` layer machinery (`styleLayers`, `instanceLayer`, `layersBelowInstance`, `resolveStyleValue`, `resolveOverflowAxis`, `resolveFontValue`, `resolveStateStyleValue`, `matchesLowerTier`) | Resolve "what value does this component have for key K" across state / instance / trait / class tiers, memoized per key | none | Reads only; memo hits during a clean resize, full re-walk + allocations after any `setStyleState` | `over-built` — correct, but re-derives the instance layer on every walk and invalidates at whole-cache granularity | F02.8, F02.15 |
| `Component.writeStyle` / `cacheStyleValue` / `writeStateStyle` / `pinStateStyle` | Cache the authored value unconditionally; defer the class-tier dedup to flush | `#id` and `#id<guardedSuffix>` rules | one flush + commit per call; per-key rule writes on the state/isolated path | `fits`, with a batching defect | F02.3, F02.15 |
| `Component.flushStyleBag` / `flushStateStyleBag` / `onStyleResolved` | Drain pending CSS keys, compare against the lower tiers, queue real value or explicit removal | `#id`, `#id<guard>` rules; `data-minSize`/`data-maxSize` attrs | once per render and once per setter call on a rendered component | `over-built` — the comprehensive-write policy emits 7–9 always-null removals per rule write, and the isolation branch is un-batched | F02.3, F02.4, F02.10 |
| `Component.applyStyle` / `replayGeometryStyles` / `applyMiscInlineStyles` / `applySubclassStyles` / `materialise*` | Write the complete style state onto a (possibly rebuilt) element in one render pass | root element inline style, `#id` rule, every deferred rule | once per first render and per `setId`/`sync`; 12 style `apply` ops measured for one component | `mismatch` — the leading inline wipe discards `init`'s own flush and forces a per-property replay | F02.5, F02.10 |
| `Component` state tier (`setStyleState`, `isStyleState`, `restingIsolationKeys`, `restingGuardSuffix`, `restingStyleRule`, `writeGuardedCSSRule`, `suppressIsolation`) | Toggle a declared state's DOM class; keep a resting-chrome write from outranking that state's shared rule | one class token; one lazily-created `#id<guard>` rule | class toggle only (no rule write — confirmed by probe P6) | `over-built` — `Component`'s own two states make every component "isolated", so every component allocates a guarded rule it never uses | F02.4, F02.9 |
| `Component.setValueStyleState` / `clearValueStyleState` / `getValueStyleToken` | Point an instance at a shared `.ClassName.<token>` rule so N instances with the same value share one rule | one class token | one unconditional `apply` per call; called per cell per rebind | `fits`, missing a no-op guard | F02.7 |
| `StyleTarget` (abstract) | Deferred-write style buffer: queue until materialised, then write through | none directly | — | `mismatch` — "deferred write" without a written-value memo means every repeat write reaches the target | F02.1, F02.3 |
| `StyleRule` | Materialise and write one shared-stylesheet `CSSStyleRule`, cached module-wide by selector | one `CSSStyleRule` per selector | one `setRuleStyles` per `flush`, one per key after materialisation | `fits` at the caching level, `mismatch` at the write level | F02.1, F02.3, F02.13 |
| `InlineStyle` | Deferred-write buffer for `element.style` | one element's inline style | one batched `apply` per `flush`; one `apply` per `set` after attach | `fits`, but `applyStyle` uses `set` where `queue` is meant | F02.5 |
| `ElementAttributes` | Retained attribute buffer that replays its whole state onto a rebuilt element | one element's attributes | one `apply` per `set`/`remove` | `over-built` — the `queue`/`queueRemove`/`flush` batching half has no production caller | F02.11, dead-code §2 |
| `Aria` | Typed WAI-ARIA accessor over the component's attribute channel | element attributes, via `Component.applyAriaAttribute` | per focus move / selection change | `fits`, with two ungated setters and triple state bookkeeping | F02.11, dead-code §3 |
| `ClassStyleRules` resting tier (`resolveDeclarations`, `resolvePartialDeclarations`, `classDeviations`, `deviationsFrom`, `resolveClassLevel`, `ensureClassStyleRule`, `getStyleClassChain`, `chainParticipates`) | Hoist class-uniform declarations onto one shared `.ClassName` rule per class, as a delta against the nearest participating ancestor | framework `:where(.ts-ui-component)` rule + one rule per deviating class | once per class per process (memoized in `_levels`/`_bags`/`_classChains`) | `fits` — the memoization is real and I confirmed every walk is cached | F02.13 |
| `ClassStyleRules` state tier (`resolveStyleStates`, `resolveStateLevels`, `buildResolvedStates`, `guardedSuffixFor`, `stateRuleName`, `ensureClassStateRule`, `restingGuardSuffix`) | Resolve a class's declared toggle states into ordered, `:not()`-guarded shared rules | one `.ClassName<guardedSuffix>` rule per deviating level per state | once per class (memoized in `_resolvedStates`/`_stateLevelLayers`/`_stateBags`); `restingGuardSuffix` is **not** memoized | `fits`, minus the un-memoized suffix | F02.9, F02.13 |
| `ClassStyleRules` trait tier (`resolveStyleTraits`, `resolveTraitStyleDefaults`, `ensureTraitStyleRule`, `traitTopStateConflictKeys`, `traitClassName`) | Let unrelated classes/instances share one `(0,2,0)` rule for a named declaration bag | one `.ts-ui-component.ts-ui-trait-<name>` rule per trait | `ensureTraitStyleRule` is memoized; `traitTopStateConflictKeys` is **not**, and runs per trait per render — twice per first render (`init` at `Component.ts:7578`, `applyStyle` at `:6424`) | `over-built` — the conflict check re-derives `resolveDeclarations` + `deviationsFrom` that `ensureTraitStyleRule` already computed | dup §4 |
| `StyleTraits` (`INPUT_CHROME_TRAIT`, `GLYPH_XS_INK_TRAIT`, `GLYPH_MD_INK_TRAIT`) | Three hand-authored shared declaration bags | none (data) | none | `fits` — the frozen-literal theme-scale caveat is documented in place | — |
| `ThemeManager` / `Theme` / `defineTheme` / `themeToVars` | Apply ~252 design tokens as CSS custom properties on `:root` in one call; notify subscribers | `:root` and `<body>` inline style; one `<style>` element for the font faces | once per theme change: one batched `apply` of ~260 properties + N listener callbacks | `fits` — no per-component rule re-flush, matching `docs/concepts/theming.md`'s "no re-render needed" | F02.12 |
| `BaseTheme` / `ClassicTheme` / `DarkTheme` / `ModernTheme` | Token data | none | none | `fits`, with paint-cost tokens worth revisiting | F02.16 |

---

## Redundant, duplicated and dead code

1. **`StyleTarget.hasQueuedWrites()` — zero callers.**
   `grep -rn "\bhasQueuedWrites\b" --include=*.ts packages | grep -v /dist/` → 2 hits:
   the declaration (`core/StyleTarget.ts:96`) and a cross-reference in
   `hasQueuedDeclarations`' own JSDoc (`:103`). `hasQueuedDeclarations` is the one
   everything actually calls.

2. **`ElementAttributes`' batching half has no production caller.**
   `grep -rn "\bsetAutoCommitAttributes\b" --include=*.ts packages | grep -v /dist/`
   → 9 hits: the declaration (`core/Component.ts:1846`), two JSDoc
   cross-references, and six uses in `tests/core/ElementAttributeReplay.test.ts`.
   `Component.getAutoCommitAttributes` (`:1837`) has **zero** non-`dist` hits
   beyond its own declaration, `commitElementAttributes` (`:1859`) only the
   `setAutoCommitAttributes` call site, and `ElementAttributes.queue`/`queueRemove`
   only that same `_autoCommitAttributes` branch. `ElementAttributes.isMaterialized()`
   (`core/ElementAttributes.ts:138`) has zero callers in `lib/src`. The whole
   `_autoCommitAttributes` / `_pending` mechanism is speculative generality
   `docs/concepts/dom-seams.md` describes as "off by default"; nothing turns it on.

3. **Public style properties with zero callers anywhere in `packages/`** (source,
   tests, docs app, create-app — `dist` excluded). Each is a `get`/`set`/`clear`
   trio plus a private backing field on the framework's most-read class:
   - `setAppearance` / `getAppearance` / `clearAppearance` + `_appearance`
     (`core/Component.ts:3179-3214`, `:562`) — 2–3 hits each, all self-references.
   - `setBorderImage` / `getBorderImage` / `clearBorderImage` + `_borderImage`
     (`:3222-3251`, `:563`).
   - `clearTransform` (`:3289`), `getTransformOrigin` (`:3302`),
     `clearTransformOrigin` (`:3327`).
   - `getColorScheme` (`:2854`), `clearColorScheme` (`:2874`).
   - `clearContain` (`:5016`), `clearPointerEvents` (`:5237`).
   `setTransform` / `setTransformOrigin` / `setContain` / `setColorScheme` /
   `setPointerEvents` do have callers; only the listed getters/clearers do not.

4. **The trait conflict check duplicates `ensureTraitStyleRule`'s own resolution.**
   `core/ClassStyleRules.ts:1337-1338` (`traitTopStateConflictKeys`) recomputes
   `resolveDeclarations({ ...FRAMEWORK_DEFAULTS, ...trait.declarations })` and
   `deviationsFrom(resolved, FRAMEWORK_DECLARATIONS)` — byte-identical to
   `:1289-1290` inside `ensureTraitStyleRule`, which memoizes its result in
   `_traitBags`. The conflict check is not memoized and runs twice per first
   render per declared trait (`Component.ts:7578` and `:6424`).

5. **`classDeviations` is a one-caller special case of `deviationsFrom`.**
   `core/ClassStyleRules.ts:416-427` is exactly
   `deviationsFrom(resolveDeclarations(defaults), FRAMEWORK_DECLARATIONS)`;
   its single caller is `:977`.

6. **`Aria` keeps three parallel copies of the same state.** `_role` (`:89`),
   `_tabIndex` (`:90`) and `_attributes` (`:91`) duplicate what
   `ElementAttributes._state` already retains for the same component — and the two
   dedicated fields are exactly the two that skip the same-value guard (F02.11).
   Routing `setRole`/`setTabIndex` through the private `setAttribute` (with a
   name-prefix opt-out) would collapse all three into one.

7. **Stale references to methods that no longer exist.** All verified by grep over
   non-`dist` `*.ts`:
   - `core/ClassStyleRules.ts:7` — "`Component.applyStyle` consults through
     `writeRuleDeclaration`"; `writeRuleDeclaration` has 0 definitions.
   - `core/ClassStyleRules.ts:248-249` — "see `applyChromeStyles` /
     `applyBoxAndVisibilityStyles`"; both have 0 definitions.
   - `ARCHITECTURE.md:312` — instructs overriding `getRestingExclusionSuffixes()`;
     0 definitions (replaced by `restingGuardSuffix`/`ownStyleStates`).
     `ARCHITECTURE.md:274` and the §"The class tier is hierarchy-aware" prose name
     the type `ClassStyleDefaults`; the type is `StyleBag` (0 definitions of
     `ClassStyleDefaults`).
   - `component/input/Checkbox.ts:179` and `component/input/RadioButton.ts:119` —
     "render-time reconciliation (`reconcileRuleDeclaration`…)"; 0 definitions.

8. **Two prior-audit items in this slice are now closed** — no action needed.
   `plans/research/codebase-health-audit-2026-08-29.md` Priority 3 lists
   `core/ClassStyleRules.ts:124,648` (`ResolvedStyleBag`, `ResolvedStyleState`) as
   orphaned *exports*; both are now module-private
   (`type ResolvedStyleBag` at `:124`, `interface ResolvedStyleState` at `:648`, no
   `export` keyword). `Component.getCSSRule()` and `Component.clearPosition()` from
   the same list no longer exist (0 grep hits).

9. **Not a duplication, checked and cleared**: `resolveDeclarations`
   (`core/ClassStyleRules.ts:224`) and `resolvePartialDeclarations` (`:401`) look
   like the same function but encode different defaulting contracts
   (absent-key fallbacks + truthy gates vs. presence-driven, so `clearX()` is
   distinguishable from never-set). The JSDoc at `:210-222` states this and the
   behaviour matches. Likewise `STYLE_WRITERS` / `FONT_WRITERS` are a deliberate
   two-level table, not a copy.

---

## Cross-slice notes

- **→ 06 layout-split-border-dockregion**: `Split.commitPanes`
  (`layout/Split.ts:2137-2146`) calls `setClipPath` on **every** pane on **every**
  layout pass, and `Border.doLayout` (`layout/Border.ts:1265,1272,1315,1372,1414`)
  does the same per region in both branches. With today's `StyleTarget` each call
  is a stylesheet-rule mutation. Even after F02.1's seam fix, the resolved value
  should be compared before the call — see F02.1's Proposed change.
- **→ 27 diagram**: `DiagramView.ts:1005` drives pan/zoom through
  `Component.setTransform`, which is a `CSSStyleRule` write per pointer move
  (F02.2). The `_contentHost` should use `setTranslate` (inline) or the property
  should move inline.
- **→ 01 core-component-lifecycle**: (a) `init()` flushes `_inlineStyle` at
  `core/Component.ts:7557` and `applyStyle` immediately wipes it at `:6400` — the
  fix spans both halves of the file (F02.5). (b) `getBorderSize()`
  (`:3685-3714`) calls `measureBorderWidths` → `DOM.source.getBorderWidths`, a
  `getComputedStyle` read; `setBorder` nulls `_borderWidths` **even when the spec
  is unchanged** (`:2928`), so an idempotent `setBorder` forces that read again.
  Guarding `setBorder` (F02.6) removes a forced style read from the layout path.
  (c) `setPreferredSize` (`:3444`) writes the debug-only `data-preferredSize`
  attribute — same family as F02.10.
- **→ 03 core-dom-seam-events**: `ProductionDOMSink.deleteStyleRule`
  (`core/DOM.ts`, the `for (let idx = 0; idx < sheet.cssRules.length; idx += 1)`
  loop) is **O(total rules)** per disposal. Because this slice allocates up to two
  per-instance selectors per component (F02.4), tearing down a large subtree is
  O(N × R). The index map it already keeps for `ensureStyleRule` could store the
  index, or the sheet could be rebuilt on bulk teardown.
- **→ 04 core-panel-scrolling**: `Panel.setNativeScrollbarHidden`
  (`core/Panel.ts:1650-1653`) writes both an `#id` rule declaration and a
  `::-webkit-scrollbar` state rule; if its caller is reachable per pass it
  inherits F02.1's cost. I did not trace its callers.
- **Seam contract that does not hold**: `docs/concepts/dom-seams.md` states "the
  per-frame inline-style flush in `StyleTarget` batches its whole dirty bag into a
  single `apply`". That holds only while the buffer is **unmaterialised**; after
  `attach`/`ensure`, `set` and `setMany` write through one property at a time
  (`core/StyleTarget.ts:35-41,48-50`), which is exactly the per-frame case. Probes
  P7, P9, Q3 and Q4 all show the fan-out. Whatever else is done, this sentence and
  the code should be brought back into agreement.

---

## Suggested plan grouping

**Plan A — "Same-value filtering at the style seam"** (F02.1, F02.6, F02.11,
F02.14). One change set in `core/StyleTarget.ts` + `core/ElementAttributes.ts`
adding a last-written-value memo, plus the handful of setter-level guards whose
*side effects* must also be skipped (`setBorder`'s `_borderWidths` invalidation,
`setInsets`' `data-*` write) and `setOverflow`'s single-write collapse. Highest
payoff, self-contained, measurable on its own (rule writes per drag frame). No
dependencies. Should land first — it removes the per-frame hazard that Plans B
and C would otherwise have to work around.

**Plan B — "Batched rule writes"** (F02.3, F02.13). `StyleTarget.setMany`
queue-then-flush, `flushStyleBag`'s isolation branch accumulating into one
`queueMany`, and deferred/batched materialisation of the class, state and trait
tiers. Depends on Plan A only in that A's memo makes B's batches smaller;
otherwise independent. Measured by rule-mutation count per render and per state
write.

**Plan C — "One batched write per render"** (F02.5, F02.10). Stop the
`init`-flush/`applyStyle`-wipe round trip, queue the geometry and misc inline
replays into one commit, and drop or gate the debug-only `data-*` attributes.
Touches the `init`/`applyStyle` seam, so it needs slice 01's findings in hand —
coordinate with whatever 01 proposes for `init`. Measured by `DOM.sink` op count
for a first render.

**Plan D — "Stop allocating the guarded resting rule for every component"**
(F02.4, F02.9). Narrow version: allocate only on a real declaration, memoize
`restingGuardSuffix`/`restingIsolationKeys` per ctor. Broader version: exclude
`Component`'s own `.undisplayed`/`.invisible` from the isolation computation, so
`isRestingChromeIsolated()` is true only for classes that declare real chrome
states. Independent of A–C; the broader version needs an explicit decision, since
`plans/implemented/state-tier-full-unification.md` deliberately unified
`Component`'s two states into the same mechanism.

**Plan E — "Layer-resolution caching"** (F02.8, F02.15, F02.7). Cache the
resolved instance layer and the `styleLayers()` array, narrow `setStyleState`'s
invalidation, and give `setValueStyleState` its no-op guard. Best measured
against a `Table`/`Tree` scroll scenario, so it should be planned alongside slices
18/19's findings rather than in isolation.

**Plan F — "Theme listener fan-out"** (F02.12). Small and independent: replace
the per-component border theme subscription with a generation counter in
`core/BorderWidths.ts`, and back `ThemeManager.themeListeners` with a `Set`.

**Too small to plan on their own — ride along**: F02.16 (theme shadow tokens)
belongs with slice 10's `Rail`/`Drawer` work, since the edge-strip mechanics live
there; the dead-code and stale-comment items in §"Redundant, duplicated and dead
code" (1–7) should ride along with whichever of Plans A–D touches the same file,
except item 3 (the unused public property trio surfaces), which is an API removal
and needs its own deprecation decision.
