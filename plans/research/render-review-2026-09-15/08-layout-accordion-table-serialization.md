# 08 layout-accordion-table-serialization — render-work review

Paths are relative to `packages/lib/src/typescript/lib/` unless stated.
Probe files live in `.worktrees/_probes/08-layout-accordion-table-serialization/`
(`accordionpass.test.ts`, `accordiondrag.test.ts`, `tableandserial.test.ts`,
`loomshape.test.ts`, `seedwaste.test.ts`), run with the briefing's command.
Probe fixture: a 4-section accordion (2 open, 2 closed, header 28px, each
section a `VBox` of 3–8 rows) in a 260×700 `Container` — the Loom sidebar
shape — and, for the drag numbers, that container as pane 0 of a horizontal
`Split`.

## Summary

- **Every `Accordion.doLayout` pass mutates the shared stylesheet**, because
  `doLayout` calls `applyContainerTheming()` unconditionally and
  `Component.setBorder` has no unchanged-value guard. Probe: **4 rule
  declarations per pass** (`borderTop/Right/Bottom/Left` on the container's
  `#id` rule), the identical value every time, on pass 2, pass 3, and every
  `Split`-gutter-drag frame; stubbing that one call drops it to **0**. On the
  Loom shape those 4 are 4 of the 9 declarations a whole window-resize frame
  writes, and **all 4** of a gutter-drag frame's — i.e. the Accordion alone
  converts every sidebar-drag frame into a full-document restyle it would not
  otherwise have. `themed: false` writes 4 `none` declarations instead, so the
  cost is unconditional (F08.1).
- **The shrink/fill pipeline runs in full on every resizable pass and its
  result is thrown away.** Probe: stubbing `computeShrinkRatio` and
  `computeFill` after the first pass leaves every section's rectangle
  byte-identical, while removing **2 `getPreferredSize` + 2 `getMinSize` +
  2 `getMaxSize` per open section per pass** (measured 2/3/3 → 0/1/1). Each of
  those is an unmemoised recursive walk of that section's whole subtree (slice
  05) — in Loom, a `Tree`'s full size report, twice per section per frame, for
  a number nothing reads (F08.2).
- **A closed section's content is re-measured and fully re-laid-out on every
  frame.** Probe: 1 `getPreferredSize` + 1 `doLayout` per closed section per
  pass, including on a `Split`-gutter-drag frame, for content the wrapper
  clips to zero height. This is the exact shape `collapsed-panes-leave-render-tree`
  already removed for `Split`/`Border` panes and `undisplay-inactive-tab-pages`
  for `Tab` pages; `Accordion` never got it, and `docs/layouts/Accordion.md`
  has no render-tree paragraph while `Split.md` does (F08.3).
- **`Animation.isReducedMotion()` is a live `matchMedia` call per open section
  per layout pass** (probe: 2 per pass with 2 open), evaluated eagerly inside a
  `&&` chain in `layoutSections`. Same root cause slice 06 raised as F06.12,
  reached here from the layout path rather than a hover path (F08.5).
- **An unchanged 4-section pass issues 38 `DOM.sink.apply` calls, all 38 of
  them carrying an empty style patch**, and a no-op Accordion drag frame 15 —
  slice 01's missing `InlineStyle.flushDirty` empty-bag guard, multiplied by
  the twelve single-property geometry setters `placeSection` uses instead of
  one `setBounds` (F08.6).
- Correcting slice 06: **`Accordion.layoutSections` already has the "a frame
  that changes nothing lays nothing out" gate F06.3 wants for `Split`** —
  probe: 3 over-travel drag frames produced 0 section `doLayout` calls. The
  Accordion side of the F06.10 method table is given in full in F08.7.
- Correcting slices 01/05: **`layout/Table` is a built-in layout manager that
  does call `Component.applyBounds`** (`Table.ts:389`, `:405`).

## Findings

### F08.1 `Accordion.doLayout` rewrites the container's four border longhands on the shared stylesheet, on every layout pass

- **Category**: C (stylesheet-rule write on a hot path), B (unchanged-value write)
- **Impact**: HIGH — per frame on hot path 1, for every `Accordion` in the tree.
  In the target engine one rule mutation is a full-document restyle
  (~195 ms/frame at 21k nodes per the briefing), and this one fires on a path
  that would otherwise touch no stylesheet at all.
- **Where**:
  - `layout/Accordion.ts:1556` — `this.applyContainerTheming()` inside `doLayout`
  - `layout/Accordion.ts:623-635` — `applyContainerTheming`, allocating a fresh
    `{ border: THEMED_BORDER }` literal per call and calling
    `container.setBorder(...)` (themed) or `container.clearBorder()` (not themed)
  - `core/Component.ts:2926-2938` — `setBorder`: no unchanged-value guard; sets
    `_border` to the new object, nulls `_borderWidths`, calls
    `writeStyle({ border: this._border })`
  - `core/Component.ts:2907-2914` — `clearBorder`: same, with `{ border: "none" }`
  - `core/Component.ts:5635-5655` — `writeStyle` → `flushStyleBag` → `commitCSSRule`
  - `core/Component.ts:5915-6015` — `flushStyleBag` compares only against
    *lower style layers*, never against the last written value; a consumer's
    container declares no class-tier border, so `matchesLower` is false and the
    real value is queued
  - `core/StyleTarget.ts:70-72`, `:404-410` — `queueMany` / `StyleRule.flushDirty`:
    no dedup, `setRuleStyles` issued whenever the bag is non-empty
- **Hot path**:
  - `Split.onDrag` / `Body` resize / `Dock` pane resize → `pane.doLayout()`
  - → `LayoutManager.commitBounds` (`layout/LayoutManager.ts:546-569`) → `child.doLayout()`
  - → `Accordion.doLayout` (`:1533`) → `applyContainerTheming()` (`:1556`)
  - → `Component.setBorder` → `writeStyle` → `flushStyleBag` → `_styleRule.queueMany({borderTop,borderRight,borderBottom,borderLeft})`
  - → `commitCSSRule()` → `StyleRule.flush()` → `DOM.sink.setRuleStyles(#id, {...4})`
- **Evidence**: read the whole chain; no layer dedups. Probes:
  - `A1` — 4-section accordion, pass 2 and pass 3: **4 declarations each**, all
    `border*= var(--ts-ui-accordion-border, 1px solid rgb(214,217,222))`.
  - `A1b` — same tree with `themed: false`: **4 declarations**, all `none`. The
    write is unconditional, not a themed-mode cost.
  - `A1c` — three consecutive width-change (drag) frames: **4, 4, 4**.
  - `D1` — Loom shape (`Accordion` sidebar in a `Split`), one gutter-drag frame:
    the whole tree wrote **4** declarations and every one was the Accordion's border.
  - `D1b` — one window-resize frame on the same tree: **9** declarations —
    4 border (this finding), 2 `clipPath` (slice 06 F06.1), `transform`+`width`+
    `transform` (slice 06 F06.2). The Accordion is the single largest contributor.
  - `E2` — stubbing `applyContainerTheming` alone: 4 → **0** declarations per pass.
  - The JSDoc at `:621` claims "Idempotent — `setBorder`/`clearBorder` cache, so
    the repeated call from `doLayout` is cheap." That claim is false: nothing in
    the chain compares against the previously written value.
  - The `_borderWidths = null` side effect is *not* a second cost in practice —
    `core/BorderWidths.ts:71-96` keys a module-level cache on the resolved side
    strings, so the re-measure hits it (probe `C1`: 1 `setBorder`, 1
    `getBorderSize`, **0** `DOM.source.getBorderWidths` per pass). It does still
    re-derive the cache key (`borderToStyle` + 4 regex tests + a string join) per
    `getBorderSize` call.
- **Proposed change**: move the "apply the default theming once" call out of
  `doLayout`. `Accordion` already overrides `attach(container)`
  (`layout/Accordion.ts:1086`), which is the natural home, and `setThemed`
  (`:607`) already covers runtime changes; `setBorder` works before the element
  exists, so nothing needs the layout pass. If a per-pass re-assert is wanted
  for safety, gate it on a `_containerThemingApplied` flag cleared by
  `setThemed`/`attach`/`detach`. The value is a `var()`, so a theme change needs
  no rewrite. Separately (general fix, route to slice 02's plan):
  `Component.setBorder`/`clearBorder` should compare the incoming spec against
  `_border` and return early when identical — that closes this shape for every
  caller, not just this one.
- **Risk / blast radius**: no test pins the accordion container's border
  (`grep -rn "THEMED_BORDER\|accordion-border\|getBorder()" packages/lib/tests`
  → no accordion hits). `applyContainerTheming` has exactly two callers
  (`:607`, `:1556`). The only behavioural question is a consumer that clears the
  container's border itself after the first layout and relies on the next pass
  re-asserting it — undocumented, and the `setThemed` path covers the supported
  way to change it.
- **Proof at implement time**: probe `E2`'s counter — rule declarations per
  unchanged `Accordion.doLayout` pass, today 4, target 0 — plus `D1`'s
  whole-tree gutter-drag count (today 4, target 0). Then a WebKitGTK Timeline
  recording of the Loom sidebar drag, since this is a restyle-boundary change.

### F08.2 The shrink and fill pipeline runs in full on every resizable pass and its output is discarded

- **Category**: D (avoidable layout pass / work recomputed with unchanged inputs), H
- **Impact**: HIGH — per frame on hot path 1, multiplied by the number of open
  sections, and each unit is a *recursive* size report over that section's whole
  subtree (slice 05: size hints have no memo anywhere).
- **Where**:
  - `layout/Accordion.ts:1575` — `const shrinkRatio = this.computeShrinkRatio(...)`
  - `layout/Accordion.ts:1585` — `const fills = this.computeFill(...)`
  - `layout/Accordion.ts:1591` — `computeResizableHeights(components, containerSize, shrinkRatio, fills)`;
    both values are used only at `:2426`, to seed a section that has no
    `_resizeSizes` entry yet
  - `layout/Accordion.ts:1604` — the open branch of `contentHeightFor`:
    `resizeHeights?.get(i) ?? (openContentHeight(...) + fills.get(i))` — the
    fallback is unreachable while resizable is active, because
    `distributeWithinConstraints` (`:2503`) sets an entry for every index in
    `openIndices` and `layoutSections` skips exactly the sections
    `openIndices` excludes
  - `layout/Accordion.ts:2061-2120` (`computeShrinkRatio`: 1 `getPreferredSize` +
    1 `getMinSize` per open section), `:2167-2227` (`computeFill`:
    `openContentHeight` → pref+min+max, then `fillHeadroom` → a second max)
- **Hot path**: `Split.onDrag`/resize → `pane.doLayout()` → `Accordion.doLayout`
  (`:1533`) → `computeShrinkRatio` (`:1575`) → per open section
  `getPreferredSize()`/`getMinSize()` → `computeFill` (`:1585`) →
  `openContentHeight` (`:2130`) → `getPreferredSize()`/`getMinSize()`/`getMaxSize()`
  → `fillHeadroom` (`:2295`) → `getMaxSize()`. Once per frame.
- **Evidence**: probes `E1`, `E1b`.
  - `E1` — after two settled passes, stubbing `computeShrinkRatio` → 0 and
    `computeFill` → empty and re-running `doLayout` left all four sections'
    `[width, height]` **byte-identical** (`[[260,319],[260,95],[260,269],[260,70]]`
    before and after). Their output changes nothing once every open section has
    a stored size.
  - `E1b` — size reports on one open section for one resizable pass:
    **`[pref 2, min 3, max 3]` with the two stages, `[pref 0, min 1, max 1]`
    without**. So the two stages cost 2 + 2 + 2 recursive reports per open
    section per frame.
  - `A2b` confirms the same 2/3/3 split independently on all four sections.
- **Proposed change**: compute the seed only when it is needed. In `doLayout`,
  decide resizable-mode participation first (the `_resizable && containerSize &&
  openIndices.length > 0` test `computeResizableHeights` already makes), then
  run `computeShrinkRatio`/`computeFill` only when resizable is off *or* at
  least one open section has no `_resizeSizes` entry. Mechanically: split
  `computeResizableHeights` into "resolve open indices + budget + drain pending"
  and "distribute", and pass the seed as a lazily-invoked thunk rather than two
  eagerly-computed values.
- **Risk / blast radius**: `computeShrinkRatio`/`computeFill` are private with
  one caller each. `tests/component/layout/Accordion.manager.test.ts`'s
  "shrink-ratio geometry" and "fill-weight distribution" suites exercise the
  non-resizable path, which is unchanged;
  `tests/component/layout/Accordion.resizable.test.ts` is the gate for the
  resizable path, including the "turning resizable on is visually seamless"
  seeding behaviour that must keep working on the first pass.
- **Proof at implement time**: probe `E1b`'s counter — `getPreferredSize` /
  `getMinSize` / `getMaxSize` calls on one open section per settled resizable
  pass, today 2/3/3, target 0/1/1 — plus `E1`'s equality assertion as a
  regression guard.

### F08.3 A closed section's content is re-measured and fully re-laid-out on every pass, for content clipped to zero height

- **Category**: E (work for invisible content), D
- **Impact**: HIGH — per frame on hot path 1, multiplied by the number of closed
  sections. In Loom each closed sidebar section holds a `Tree`; this is a full
  tree layout plus a full recursive `getPreferredSize` per closed section per
  gutter-drag frame, for content the user cannot see.
- **Where**:
  - `layout/Accordion.ts:1612-1613` — `doLayout` passes `animateShrink = true`
    **and `reflowAll = true`** to `layoutSections`
  - `layout/Accordion.ts:1708` — `if (reflowAll || contentHeight !== oldHeight)`
    → `:1722` `component.doLayout()`, reached for every displayed section,
    open or closed
  - `layout/Accordion.ts:1607` — the closed branch of `contentHeightFor`:
    `components[i].getPreferredSize()`
  - `layout/Accordion.ts:1521-1524` — `placeSection` writes the closed section's
    content at its full preferred height inside a zero-height wrapper
  - `layout/Accordion.ts:1670-1671` — the only `setDisplayed(false)` in the
    method applies to the *header and wrapper* of a section whose content
    component the consumer undisplayed; a merely **closed** section keeps
    header, wrapper and content all displayed
- **Hot path**: `Split.onDrag` → `pane.doLayout()` → `Accordion.doLayout`
  (`:1533`) → `layoutSections(..., reflowAll = true)` (`:1590-1614`) → per closed
  section `contentHeightFor` → `getPreferredSize()` (`:1607`) → `placeSection`
  (`:1706`) → `component.doLayout()` (`:1722`). Once per frame per closed
  section.
- **Evidence**: probes `A2`, `A2b`, `D1`.
  - `A2` — one unchanged pass, closed section: `doLayout 1`, `getPreferredSize 1`.
  - `A2b` — same with `resizable: true`, both closed sections: `doLayout 1`,
    `pref 1` each.
  - `D1` — one **`Split`-gutter-drag frame** on the Loom shape: closed sections'
    `doLayout [1,1]`, `getPreferredSize [1,1]`. The cost is on the drag path,
    not just on a settled pass.
  - `A2` also recorded the closed section's committed content height as `95`
    (its preferred height) inside a wrapper of height 0 — the content is in the
    render tree, clipped, not removed.
  - `wrapper.setContain("layout paint")` (`:1412`) scopes the engine's own
    reflow, but nothing scopes the library's JS-side `doLayout` recursion.
- **Proposed change**: the twin of `collapsed-panes-leave-render-tree`. Once a
  section's close animation settles, `setDisplayed(false)` its content component
  and re-display it before the next open animation starts; while it is out,
  skip its `contentHeightFor` `getPreferredSize` and its `component.doLayout()`.
  The cheap half, if the full render-tree change is deferred: make
  `layoutSections` treat `reflowAll` as "reflow every *open* section" and skip
  the closed ones whose `contentHeight` and width are unchanged — that alone
  removes the per-frame `doLayout` and lets the `getPreferredSize` be cached
  from the last open pass. That plan's `## Architecture Decisions` (content
  clamp suspension via `Component.setContentClampSuspended`, `captureSubtreeScroll`
  guarded on `isEffectivelyVisible()`, snapshot-backed size reports, `detach`
  putting recorded children back by `isDestroyed()`) is the checklist for the
  full version; every hazard it names applies here too, because `Accordion`
  likewise commits a box for content that is out.
- **Risk / blast radius**: this is the highest-risk finding in the slice. The
  closed section's preferred-height content is load-bearing **during** a close
  animation (the comment at `:1600-1602`), so the change must be gated on
  "closed *and* no `_wrapperAnimations`/`_shrinkAnimations` entry for this
  index". `Accordion.getPreferredSize`/`getMinSize` (`:1233`, `:1297`) read a
  closed section's content only through `_openState`, so they are unaffected;
  but a section whose content has left must keep reporting its own box (the
  content-clamp hazard that plan hit). Gates: `Accordion.manager.test.ts`'s
  "a closed section contributes only its header height to both reports" and
  "a non-displayed section contributes neither header nor content nor gap", and
  the whole of `Accordion.resizable.test.ts`.
- **Proof at implement time**: a probe asserting 0 `doLayout` and 0
  `getPreferredSize` calls on a settled closed section across three
  `Split`-gutter-drag frames (today 3 and 3), then ms/frame on the Loom sidebar
  drag with the file tree collapsed versus open in a WebKitGTK recording.

### F08.4 `openContentHeight` is computed twice per open section per pass in the non-resizable path

- **Category**: D, I (the same computation in two places)
- **Impact**: MEDIUM — per frame on hot path 1 for a non-resizable accordion,
  and each call is 1 `getPreferredSize` + 1 `getMinSize` + 1 `getMaxSize`
  recursion.
- **Where**:
  - `layout/Accordion.ts:2192` — inside `computeFill`, to build `used`
  - `layout/Accordion.ts:1604` — inside `contentHeightFor`'s open branch, the
    same call with the same `(component, shrinkRatio)` arguments
  - `layout/Accordion.ts:2130-2141` — `openContentHeight` itself
- **Hot path**: `Accordion.doLayout` (`:1533`) → `computeFill` (`:1585`) →
  `openContentHeight` per open section; then `layoutSections` (`:1597`) →
  `contentHeightFor` (`:1604`) → `openContentHeight` per open section again.
- **Evidence**: probe `E1c` — a non-resizable pass with 2 open sections made
  **4** `openContentHeight` calls. `A2` independently recorded 3 `pref` / 3
  `min` / 3 `max` per open section per non-resizable pass, of which this
  duplication is one full triple.
- **Proposed change**: have `computeFill` return the per-section content heights
  it already computed alongside the fill map (or memoise `openContentHeight` in
  a `Map<Component, number>` built once per pass and passed to both readers).
  `shrinkRatio` is constant across the pass, so the memo is trivially safe.
- **Risk / blast radius**: `openContentHeight` is private with three callers
  (`:1604`, `:2192`, `:2426`). The `:2426` seed call uses the same arguments, so
  it can share the memo. Gate: `Accordion.manager.test.ts`'s fill and shrink
  suites.
- **Proof at implement time**: probe `E1c`'s counter — `openContentHeight` calls
  per non-resizable pass, today 2 per open section, target 1.

### F08.5 `Animation.isReducedMotion()` is a live `matchMedia` call per open section per layout pass

- **Category**: A (live read on a hot path), G
- **Impact**: MEDIUM — per frame on hot path 1, once per open section. Small on
  its own; it is the same root cause slice 06 raised as F06.12, so the fix has
  another beneficiary.
- **Where**:
  - `layout/Accordion.ts:1704` — `const shrinking = isOpen && animateShrink && !Animation.isReducedMotion() && contentHeight < oldHeight;`
  - `core/Animation.ts:77-79` — `isReducedMotion()` = `DOM.source.matchMedia("(prefers-reduced-motion: reduce)").matches`, no memo
  - `layout/Accordion.ts:2672` — the second call site, in `primeWrapper` (per toggle, fine)
- **Hot path**: `Accordion.doLayout` (`:1533`) → `layoutSections(..., animateShrink = true)`
  (`:1613`) → per open displayed section, the `&&` chain at `:1704` evaluates
  `Animation.isReducedMotion()` → `DOM.source.matchMedia(...)`.
- **Evidence**: probe `A3` — **2** `DOM.source.matchMedia` calls per unchanged
  pass with 2 open sections, and **2** per width-change (drag) pass. The
  operand order is what makes it eager: `contentHeight < oldHeight` (a free
  numeric comparison that is false on the overwhelming majority of passes) sits
  *after* the media query.
- **Proposed change**: two independent parts, either of which works. (a) Reorder
  the conjunction so the numeric `contentHeight < oldHeight` test comes before
  `!Animation.isReducedMotion()` — a one-token change that makes the media query
  reachable only on a frame where a section actually shrinks. (b) The general
  fix slice 06 proposes: memoise `Animation.isReducedMotion()` behind a `change`
  subscription on the `MediaQueryList`. Do (a) here regardless; it is free and
  does not wait on (b).
- **Risk / blast radius**: pure operand reordering, both operands side-effect
  free. No test names reduced motion in the Accordion suites.
- **Proof at implement time**: probe `A3`'s counter — `DOM.source.matchMedia`
  calls per unchanged `Accordion.doLayout` pass, today 1 per open section,
  target 0.

### F08.6 `placeSection` writes geometry through twelve single-property setters, and an unchanged pass issues 38 empty `DOM.sink.apply` calls

- **Category**: G (allocation/write churn), B
- **Impact**: MEDIUM — per frame on hot path 1, multiplied by section count.
  Individually cheap (inline-style writes with no read following them are cheap
  per the cost model); it matters because it is the only per-pass write volume
  left once F08.1–F08.3 are fixed, and because every one of the 38 applies is
  provably empty.
- **Where**:
  - `layout/Accordion.ts:1508-1512` — `header.setX/setY/setWidth/setHeight` + `header.doLayout()`
  - `layout/Accordion.ts:1516-1519` — `wrapper.setX/setY/setWidth/setHeight`
  - `layout/Accordion.ts:1521-1524` — `component.setX/setY/setWidth/setHeight`
  - `layout/Accordion.ts:1791-1795` — `placeGutter`'s four setters plus `setVisible(true)`
  - `core/StyleTarget.ts` `InlineStyle.flushDirty` — lacks the empty-bag guard
    its `StyleRule` sibling has (slices 01, 03, 04)
  - No call in the file uses `Component.setBounds` or `Component.applyBounds`
    (`grep -n "setBounds\|applyBounds" layout/Accordion.ts` → 0 hits)
- **Hot path**: `Accordion.doLayout` → `layoutSections` (`:1647`) →
  `placeSection` (`:1503`) per section per frame.
- **Evidence**: probes `A4`, `B1`, `B2`.
  - `A4` — one unchanged 4-section pass: **39 sink ops**, 1 `setRuleStyles`
    (F08.1) and **38 `apply`**.
  - `B2` — breakdown of those 38: **38 of 38 carry an empty style patch**
    (`{"total":38,"emptyStyleOnly":38,"withStyle":0}`); the aggregated style-key
    histogram is `{}`. Nothing real is written on an unchanged pass; the guarded
    per-axis setters correctly suppress the values, and what reaches the sink is
    the trailing auto-commit flush slice 01 identified.
  - `B1` — one real Accordion gutter-drag frame: 40 applies, 26 empty, 14 real.
    Three **no-op** over-travel frames: **45 applies, 45 empty, 0 real**.
  - `D1` — one `Split`-gutter-drag frame on the Loom shape: 76 applies, 34 empty.
- **Proposed change**: two parts. (a) Replace each four-setter block with the
  batched `setBounds(x, y, w, h)` the rest of the library's managers use
  (`LayoutManager.commitBounds`), or with `applyBounds` — see F08.7's note on
  `canSkipUnchangedLayout`. (b) Give `InlineStyle.flushDirty` the empty-bag
  guard; that is a `core` one-liner already claimed by slices 01/02/03, and this
  slice's number (38 per pass, 15 per no-op drag frame) is one more data point
  for it rather than a separate change.
- **Risk / blast radius**: `placeSection` is shared by `doLayout` and
  `onGutterDrag`, and the file's own JSDoc (`:1636-1645`) records that a
  calculate-then-commit split of `layoutSections` was evaluated and rejected
  (`plans/implemented/accordion-layout-sections-calc-commit-split.md`). This
  proposal is *not* that: it batches the four writes of one rectangle, leaving
  the coordination order untouched. Gates: both Accordion suites' geometry
  assertions.
- **Proof at implement time**: a probe counting `DOM.sink.apply` calls per
  unchanged 4-section pass (today 38, all empty) and per no-op drag frame
  (today 15).

### F08.7 The `Accordion` side of slice 06's F06.10 — and the one place where `Accordion` is already ahead of `Split`

- **Category**: I (duplication)
- **Impact**: LOW (code health) — but, as slice 06 said, it is why each fix has
  to be written twice. Recorded here because slice 06 asked slice 08 to give
  the Accordion side of each pair.
- **Where** — completing F06.10's table with what each Accordion method does:

  | `Split.ts` | `Accordion.ts` | the Accordion side |
  |---|---|---|
  | `scheduleDrag` `:1412-1418` | `scheduleGutterDrag` `:1975-1981` | identical: latch `{gutterIndex, position}` into `_pendingGutterDrag`, arm `_dragRafHandle` once |
  | `flushDrag` `:1425-1437` | `flushGutterDrag` `:1988-2000` | identical body: clear the handle, bail on a null payload, clear it, dispatch |
  | `onDragEnd` `:1449-1458` | `onGutterDragEnd` `:2018-2036` | cancel rAF, synchronous `flushGutterDrag()`, clear `_dragUpper`/`_dragLower`, emit `sectionresize` with `getSectionSizes()` |
  | `clampMain` `:843-850` | `clampSectionHeight` `:2279-2284` | `Util.clamp(value, min?.height ?? 0, max?.height ?? +∞)` — the same one-axis clamp, height instead of the split's main axis |
  | `effectiveResizeWeight` `:830-832` + `isResizePinnedMain` `:885-887` | `effectiveWeight` `:2229-2233` | `constraints?.weight ?? 0`, then `explicit > 0 ? explicit : (fillHeight ? 1 : 0)`; unset and explicit `0` collapse to the same pinned state, unlike `Split` |
  | the three-tier refill `:2482-2547` | `resizePinnedSections` `:2250-2269` + `distributeWithinConstraints` `:2503-2596` | pins leave the budget first, the free set rescales by `remaining/freeStored`, one violator is pinned per iteration until none violates; pins yield wholesale when `pinnedTotal > openBudget` or nothing is weighted |
  | `onDragStart` `:1292-1308` | `onGutterDragStart` `:1808-1836` | snapshots `_dragOpenIndices` (every open+displayed index), `_dragGutterUpperPos`, `_dragUpper`/`_dragLower`, `_dragLastPointer`; incremental (frame-delta) rather than `Split`'s absolute origin+offset |

- **Evidence**: read both files. Two corrections to F06.10:
  1. **`Accordion` already has the no-op-drag-frame skip F06.3 proposes for
     `Split`.** `layoutSections`'s `if (reflowAll || contentHeight !== oldHeight)`
     (`:1708`) means a drag frame that moves nothing lays nothing out, and
     `onGutterDrag`'s dead-zone bookkeeping (`:1922`, `this._dragLastPointer +=
     Math.sign(frameDelta) * delta`) is a second mechanism `Split`'s
     origin+offset model has no equivalent of. Probe `B1`: three over-travel
     drag frames past the lower section's floor produced **0** `doLayout` calls
     on either section and 0 rule writes (heights `[596,20]` before and after).
     So F06.3's fix should be ported *from* `Accordion` *to* `Split`, not
     written twice.
  2. **Slice 06's guess about the gutters is right.** `Accordion` constructs its
     gutters with `{ collapsible: false, expandedBackground: "transparent" }`
     (`:1766`) and never calls `setOpaque`, so **F06.2 does not apply** (no
     `setDirection`/`setStripMode` rewrite per pass — confirmed by probe `A1`,
     which shows no `transform`/`width` declarations), while **F06.7 and F06.12
     do** (`SplitGutter.ts:230-231` registers the subtree listeners
     unconditionally; `applyHoverState` `:719-720` calls `matchMedia`
     unconditionally). See F08.9 for why F06.7's fix is incomplete without
     `Accordion`.
- **Proposed change**: as slice 06 said — extract the rAF drag-frame buffer
  (`schedule`/`flush`/`cancel`) into one `layout/`-owned helper used by both.
  Add: port `Accordion`'s `contentHeight !== oldHeight` reflow gate into
  `Split.onDrag` rather than inventing a new one there.
- **Risk / blast radius**: `tests/component/layout/Accordion.resizable.test.ts`
  and `tests/overlay/DragManager.pointerCoalescing.test.ts` are the gates, as
  slice 06 recorded. `Accordion.detach` (`:1160-1172`) also drives the buffer
  and would move with it.
- **Proof at implement time**: the existing coalescing tests pass unchanged;
  line count in the two managers drops by the extracted body.

### F08.8 Every Accordion gutter carries a `visibility:hidden` `CollapseButton` that never leaves the render tree

- **Category**: E (work for invisible content)
- **Impact**: MEDIUM — one per gutter, charged on every ancestor resize in the
  target engine (the briefing's "hidden content still costs" rule; the measured
  9 ms/frame figure is per hidden CodeMirror, so a button is far smaller, but it
  is pure waste and a `display` toggle removes it).
- **Where**:
  - `layout/Accordion.ts:1766` — `new SplitGutter("vertical", { collapsible: false, ... })`
  - `component/container/SplitGutter.ts:196-205` — the `CollapseButton` is
    constructed unconditionally and hidden with
    `this._collapseButton.setVisible(this._collapsible)`
  - `core/Component.ts:431-440` — `.invisible` resolves to `visible: false`, i.e.
    CSS `visibility: hidden`, which keeps the subtree in the render tree
  - `component/container/SplitGutter.ts:276-282` — `setCollapsible` uses
    `setVisible` too
- **Hot path**: any ancestor resize — `Split` gutter drag, window resize — pays
  the engine-side layout of a hidden subtree that no JS touches.
- **Evidence**: probe `D2` — the accordion's gutter reports
  `collapse button isVisible false, isDisplayed true`. The JS side is already
  free (`gutter.getLaidOutComponents().length === 0`, and the button's
  `doLayout` ran **0** times per accordion pass), so the cost is purely the
  render tree. This is the same `setVisible`-instead-of-`setDisplayed` shape
  slice 07 found in `Tab.setBarVisible(false)`.
- **Proposed change**: `SplitGutter` should use `setDisplayed` rather than
  `setVisible` for the collapse button, or not construct it at all when
  `collapsible` is false and construct it lazily if `setCollapsible(true)`
  arrives later. This is a `SplitGutter` change — slice 06's file — reported
  here because `Accordion` is the only in-library consumer that instantiates it
  in the permanently-hidden configuration.
- **Risk / blast radius**: `SplitGutter` is used by `Split`, `Border` (through
  `CollapseSupport`) and `Accordion`; `Split`/`Border` default to
  `collapsible: true`, so they are unaffected by a `display`-based hide.
  `tests/component/container/SplitGutter.*` are the gates.
- **Proof at implement time**: a probe asserting the button is `isDisplayed()
  === false` on a non-collapsible gutter; then the render-tree node count in a
  WebKitGTK recording of the sidebar drag.

### F08.9 `Accordion` is a second permanent registrant of subtree `mouseover`/`mouseout`, so slice 06's F06.7 fix alone will not remove the per-mousemove ancestor walk

- **Category**: A / G, and a correction to a cross-slice finding
- **Impact**: MEDIUM — per pointer event, document-wide. Not additive per
  registrant, but it keeps the whole mechanism alive after the named fix.
- **Where**:
  - `layout/Accordion.ts:1403-1404` — `Event.addSubtreeListener(header, 'mouseover', ...)`
    and `'mouseout'`, **per section**, installed in `createSection` and never removed
  - `core/Event.ts:296-345` — the subtree dispatch keys on `subtreeListenerMap.get(evnt.type)`:
    the ancestor walk (with a `DOM.source.getId` + `DOM.source.getParentElement`
    per level) runs for **every** event of a type that has *any* subtree
    registration, regardless of which component registered it
  - `layout/Accordion.ts:805-828`, `:831-849` — the handlers then filter with
    `DOM.source.isNode` + `DOM.source.intern` + `DOM.source.contains` on
    `relatedTarget`, i.e. they want a boundary crossing of the header element
- **Evidence**: `grep -rn "addSubtreeListener(.*'mouseover'" packages/lib/src/typescript/lib/`
  → 3 hits: `layout/Accordion.ts:1403`, `component/container/SplitGutter.ts:230`,
  `overlay/Notification.ts:249`. `Notification` only registers while a toast is
  up; `SplitGutter` and `Accordion` register for the app's life. A Loom sidebar
  with four sections installs **8** such listeners (4 `mouseover` + 4
  `mouseout`). Slice 06's F06.7 proposes moving `SplitGutter` to exact-target
  listeners; with `Accordion` still registering, `subtreeListenerMap` still
  holds both types and slice 03's measured 16 `getId` + 15 `getParentElement`
  per crossing on a 14-deep target is unchanged.
- **Proposed change**: `Accordion`'s headers want `mouseenter`/`mouseleave`
  semantics, not `mouseover`/`mouseout` — the handlers' first act is to discard
  every event whose `relatedTarget` is inside the header. `core/Event.ts:149`
  already names `mouseenter`/`mouseleave` in its button-filter doc, and
  `SpinButton`/`Scrollbar` register `mouseleave` as viewport listeners, so the
  seam exists. Switching the two registrations to non-bubbling
  `mouseenter`/`mouseleave` on the header element deletes both the subtree
  registration **and** the three `DOM.source` reads per crossing. If the
  framework's routing cannot deliver non-bubbling events to an exact-target
  registration, this becomes a `core/Event` gap to raise rather than a local
  workaround. Either way, sequence it with F06.7 so the `mouseover` type ends
  up with zero subtree registrants.
- **Risk / blast radius**: hover drives the tool-reveal behaviour only
  (`revealHeaderTools`/`hideHeaderTools`, `:758`/`:780`). `Notification.ts:242-247`
  records a past reason for preferring `mouseover`/`mouseout` on a root with a
  non-empty subtree — read that comment before switching, since it may be the
  same hazard. No Accordion test covers hover today (probe `B5` had to call the
  handlers directly).
- **Proof at implement time**: slice 06's `hoverwalk.test.ts` counter —
  `DOM.source.getId` + `getParentElement` calls for one unrelated mouseover —
  run with a live Accordion in the tree; target 0 after both fixes.

### F08.10 The manager's re-apply setters have no unchanged-value guard, and `setThemed` writes four rule declarations on a no-op

- **Category**: B, C, D
- **Impact**: MEDIUM on the `setThemed` path (a stylesheet write for nothing),
  LOW for the rest (per event, not per frame).
- **Where** — every one of these writes and relayouts even when the value is
  already what is being set:
  - `layout/Accordion.ts:604-616` — `setThemed`: re-applies container theming
    (4 rule declarations) + `applySectionTheming` per header + `scheduleLayout`
  - `layout/Accordion.ts:401-411` — `setCompact`: `header.setCompact` per header
    + `relayoutHost()`
  - `layout/Accordion.ts:453-461` — `setChevronSide`: `header.setChevronSide`
    per header + `scheduleLayout` (the *header's* own `setChevronSide` **is**
    guarded, `AccordionHeader.ts:320-322` — so the manager's fan-out is the
    unguarded half)
  - `layout/Accordion.ts:486-494` — `setChevronGlyph`
  - `layout/Accordion.ts:509-513` — `setSpacing` → `relayoutHost()`
  - `layout/Accordion.ts:543-547` — `setFillHeight` → `scheduleLayout`
  - `layout/Accordion.ts:571-575` — `setResizable` → `scheduleLayout`
  - `layout/Accordion.ts:686-695` — `setToolsVisibility` → `setToolsRevealed`
    per header
  - `layout/Accordion.ts:321-347` — `setSingleOpen` → `relayoutHost()`
    unconditionally, even when no section was closed by the switch
- **Evidence**: probe `B4` — `setThemed(true)` on an already-themed accordion
  wrote **4 rule declarations** (`borderTop/Right/Bottom/Left`). The others were
  read, not probed: each begins by assigning the field with no comparison.
  Slice 02's finding ("15 of `Component`'s typed setters guarded, 15 not") is
  the same pattern one level down.
- **Proposed change**: a leading `if (this._x === value) return this;` on each.
  `setThemed`, `setCompact`, `setSpacing` and `setSingleOpen` are the ones worth
  doing first: they are the ones a consumer plausibly calls from a settings
  observer that fires on every settings change.
- **Risk / blast radius**: `setSingleOpen`'s guard must not skip the initial
  `false → false` call from `applyOptions` if any consumer relies on the
  relayout it currently triggers; it does not close anything in that case, so
  the relayout is already a no-op in substance. Gates: the "open/close
  coordination + events" suite in `Accordion.manager.test.ts`.
- **Proof at implement time**: a probe asserting 0 rule declarations and 0
  `scheduleLayout` calls for a same-value call to each setter.

### F08.11 `setHeaderHeight` never relayouts, and `setAnimationDuration` never reaches an existing header's chevron

- **Category**: H (function/implementation mismatch)
- **Impact**: LOW — correctness, not render work. Included because both are
  one-line asymmetries against their own siblings in the same file.
- **Where**:
  - `layout/Accordion.ts:370-375` — `setHeaderHeight` assigns `_headerHeight` and
    `_headerHeightExplicit` and returns. Every other metric setter in the file
    (`setCompact` `:401`, `setSpacing` `:509`, `setSingleOpen` `:321`) ends in
    `relayoutHost()`, and the header height feeds `effectiveHeaderHeight()`
    (`:381`), which every geometry path reads. Setting it after construction
    leaves the stack at the old height until some unrelated layout.
  - `layout/Accordion.ts:434-438` — `setAnimationDuration` assigns
    `_animationDuration`. The wrapper/header/content transitions are rebuilt
    from that field at toggle time (`buildHeaderTransition` `:2792`,
    `buildWrapperTransition` `:2803`, `buildContentTransition` `:2815`), so they
    do pick it up — but the **chevron's** timing is pushed once, at
    `createSection` (`:1380`, `header.setAnimationTiming(this._animationDuration,
    ACCORDION_EASING)`), and is never re-pushed. After a
    `setAnimationDuration(500)` the panel animates for 500 ms while the chevron
    still rotates over 200 ms.
- **Evidence**: read; not probed. The docs table
  (`docs/layouts/Accordion.md`) lists both as runtime setters
  ("each has a matching setter for runtime updates").
- **Proposed change**: `setHeaderHeight` ends in `relayoutHost()` like its
  siblings; `setAnimationDuration` loops `this._headers` calling
  `setAnimationTiming(ms, ACCORDION_EASING)`, exactly as `setCompact`,
  `setChevronSide` and `setChevronGlyph` already loop.
- **Risk / blast radius**: both are additive. No test calls either after the
  first layout.
- **Proof at implement time**: a test that sets each after a first layout and
  asserts the observable change.

### F08.12 `layout/Table.calculate` resolves the column list twice on adjacent lines

- **Category**: G (allocation churn), I
- **Impact**: LOW — per pass, small, but it is on a `Table`'s own resize path
  and the duplicate is literal.
- **Where**:
  - `layout/Table.ts:167-168` —
    `const columns = container.getColumns(); const columnCount = container.getColumns().length;`
  - `component/table/Table.ts:450-452` — `getColumns()` → `getSourceColumns()`
  - `component/table/Table.ts:463-467` — `getSourceColumns()` = `getEffectiveHiddenSet()` + a `filter`
  - `component/table/Table.ts:1245-1256` — `getEffectiveHiddenSet()` allocates
    two `Set`s and a mapped array and walks every field of the model
- **Hot path**: `Table.doLayout` (`:126`) → `calculate` (`:143`) → the two
  adjacent calls, once per pass.
- **Evidence**: probe `C2` — an unchanged `layout/Table` pass made **3**
  `getColumns` calls (two of them this pair). Otherwise the manager is clean:
  **0 rule declarations** on an unchanged pass and on a width-change pass, 13
  applies of which 12 empty, 1 `getContentInsets`. The `commit`-phase reads
  (`header.getContentBounds()` at `:309`, `header.getHeight()`/`footer.getHeight()`
  at `:412-413`) resolve from cached in-memory geometry, not the DOM, so the
  "read back committed state" the JSDoc describes is **not** a forced sync
  layout.
- **Proposed change**: `const columnCount = columns.length;`.
- **Risk / blast radius**: none; `columns` is already in scope one line above.
- **Proof at implement time**: probe `C2`'s `getColumns` counter, today 3,
  target 2.

### F08.13 `LayoutSerialization` captures transient children under a `Split` but not under a `Tab`

- **Category**: I (the same rule applied in one of two places), J-adjacent
- **Impact**: LOW — cold path (save/restore), but it produces a `console.warn`
  and a bogus node on every restore of a layout whose root `Split` held
  transient chrome.
- **Where**:
  - `layout/LayoutSerialization.ts:206-209` — `serializableChildren` filters
    `constraints?.transient === true`
  - `layout/LayoutSerialization.ts:216` — the `Split` branch uses
    `component.getComponents().map(nodeFor)`, **not** `serializableChildren`
  - `layout/LayoutSerialization.ts:232` — the `Tab` branch uses
    `serializableChildren(component).map(nodeFor)`
  - `layout/LayoutSerialization.ts:325-352` — `collectLeaves` detaches transient
    children on *both* paths, so the captured node can never be re-homed
  - `layout/LayoutSerialization.ts:474-481` — `materializeNode` then warns
    ``no component for panelId "..."`` and skips it
- **Evidence**: probe `C3` — a `Split` with one `transient: true` child
  serialized to
  `{"kind":"split","children":[{"kind":"panel","panelId":"panel-a",...},{"kind":"panel","panelId":"placeholder",...}],"ratios":[0.5,0.5],...}`.
  The ratio array is *not* skewed (`populateContainer` re-aligns through
  `placed`), so this is noise plus a warning, not corruption.
- **Proposed change**: use `serializableChildren(component)` in the `Split`
  branch too, and drop the corresponding `ratios`/`collapsed` entries for the
  filtered indices (`getPaneRatios()` is indexed over the live pane list, so the
  filter must map indices, not just shorten the array).
- **Risk / blast radius**: `tests/component/layout/LayoutSerialization.test.ts`
  is the gate. The Dock's empty-state placeholder is the only in-library
  transient child (`Dock.showEmptyState`), and it sits under a `Tab`, which is
  already filtered — so the fix has no in-library behaviour change today.
- **Proof at implement time**: probe `C3`'s assertion, inverted: the Split node
  carries one child, not two.

### F08.14 `Accordion.detach` leaves the container border and half the manager's state behind, and re-reads the child list per iteration

- **Category**: H, G
- **Impact**: LOW — teardown path.
- **Where**:
  - `layout/Accordion.ts:1133-1222` — `detach`. It clears `_headers`,
    `_panelWrappers`, `_openState`, `_resizeGutters`, `_resizeSizes`,
    `_gutterPairs`, both animation maps and the drag buffer — but **not** the
    border it wrote on the container (`applyContainerTheming`, `:623`), nor
    `_resizePinned`, `_pendingSectionSizes`, `_tools`, `_hoveredHeader`,
    `_resizeFactor`. A manager swap therefore leaves the host painting the
    accordion's all-round border.
  - `layout/Accordion.ts:1181` — `const components = container ?
    container.getComponents() : [];` sits **inside** the `for` loop over
    `_headers`, so the same array is fetched once per section.
- **Evidence**: read; not probed. Compare `Split.detach`/`Border.detach`, which
  `collapsed-panes-leave-render-tree`'s round-4 audit had to extend precisely
  because a detach left consumer-visible state behind.
- **Proposed change**: hoist the `getComponents()` call above the loop; clear the
  remaining fields; and clear the container border when `_themed` was on (the
  mirror of what `applyContainerTheming` wrote). The last part interacts with
  F08.1's fix — do them together, since both concern "who owns the container's
  border".
- **Risk / blast radius**: a consumer that set its own border on the container
  *before* attaching an accordion would have it cleared on detach; the
  conservative form is to record whether the accordion wrote it and only clear
  what it wrote. `tests/component/layout/ManagerChrome.styleRuleDisposal.test.ts`
  is the nearest gate.
- **Proof at implement time**: a test that attaches an `Accordion`, detaches it,
  and asserts the container's `getBorder()` is back to what it was.

## Entity inventory

| Entity | Stated function | Owns DOM | Per-layout-pass writes/reads | Verdict | Findings |
|---|---|---|---|---|---|
| `Accordion` (`layout/Accordion.ts`) | Stack vertically collapsible sections, each a clickable header + an animated content panel | Per section: an `AccordionHeader` and a wrapper `Component` raw-appended to the container's element; a pooled `SplitGutter` per adjacent open pair; the container's own border | **Writes** (4-section fixture, 2 open): 1 `setRuleStyles` carrying 4 border declarations; 38 `DOM.sink.apply`, all 38 empty; 12 geometry setters per section + 4 per gutter. **Reads**: 2 `pref` + 3 `min` + 3 `max` per open section (resizable) or 3/3/3 (not), 1 `pref` per closed section, 1 `matchMedia` per open section, 1 `getInnerSize` + 1 `getContentInsets` on the container. **Recurses**: `doLayout()` on every section, open *and* closed | over-built on the sizing pipeline; mismatch on the closed-section handling | F08.1, F08.2, F08.3, F08.4, F08.5, F08.6, F08.7, F08.9, F08.10, F08.11, F08.14 |
| `AccordionConstraints` (`layout/AccordionConstraints.ts`) | Per-section label, initial open state, glyph, tools | none | none | fits | — (38 lines, no logic) |
| `AccordionPanel` (`component/container/AccordionPanel.ts`) | `Container` that owns an `Accordion` and exposes `addSection` | none of its own | none of its own — pure delegation | fits | — |
| `AccordionHeader` (`component/container/AccordionHeader.ts`) | One section's header row: chevron, title button, tool group, in an `HBox` | its own `div` + 3 child components; `.AccordionHeader` / `.AccordionHeaderTitleButton*` class-tier rules | 1 `doLayout()` per pass (unconditional, from `placeSection:1512`); its own chrome is class-tier, so **0** rule writes per pass | fits | F08.10 (the manager's unguarded fan-out), dead getters below |
| `AccordionIndicator` (`component/container/AccordionIndicator.ts`) | The rotating chevron cell | a `span`; the shared `.AccordionIndicator` rule; a per-instance `.expanded` rule | **0** per unchanged pass — `setLineHeight` (`:142-150`) is guarded on `_lineHeight`, so its `setElementCSSRule("lineHeight")` fires only when the header height actually changes | fits — the one component in the slice with a correct write guard on a rule-backed property | — |
| `Table` (`layout/Table.ts`, the manager) | Position header/body/footer bands of a `Table` component and drive its virtual-scroll render | none of its own | **0** rule declarations; 13 applies (12 empty) on an unchanged 3-column pass; 3 `getColumns`, 1 `getContentInsets`; `calculate`/`commit` split is real and the `commit`-phase read-backs are cached, not DOM | fits | F08.12 |
| `TableLayoutOptions` (`layout/Table.ts:19-20`) | Construction options for the above | none | none | dead — an empty interface extending `LayoutManagerOptions`, adding nothing | see dead-code list |
| `LayoutSerialization` (`layout/LayoutSerialization.ts`) | Capture/restore `Split` ratios, `Tab` order + active index, and `Window` rects, keyed by panel id | none | cold path only — `serializeLayout` walks the tree once; `restoreLayout` parks, disposes and rebuilds | fits, with one asymmetry | F08.13 |
| `layout/index.ts` | Public barrel for the layout package | none | none | fits — `layout/Table` is correctly *not* exported (one importer, `component/table/Table.ts:4`) | — |

## Redundant, duplicated and dead code

Counts exclude `packages/lib/dist/` and `packages/**/docs/api/` (generated).

- **`Accordion.off(event, listener)`** (`layout/Accordion.ts:1060-1064`) — zero
  callers. `grep -rn --include=*.ts -F ".off(" packages/lib/src packages/lib/tests packages/docs/src`
  → 94 hits, none on an `Accordion`. Same shape slice 06 reported for
  `SplitGutter.off` and `CollapseButton.off`; it is the `on`/`off` symmetry, so
  removal is an API decision, not a cleanup.
- **`Accordion.getChevronSide()`** (`:445-447`) and
  **`AccordionHeader.getChevronSide()`** (`AccordionHeader.ts:337-339`) — zero
  callers each. `grep -rn --include=*.ts "getChevronSide" packages/` → 2 hits,
  both declarations.
- **`AccordionHeader.isExpanded()`** (`AccordionHeader.ts:309-311`) — zero
  callers. `grep -rn --include=*.ts "isExpanded()" packages/lib/src packages/lib/tests`
  → 1 hit, the declaration. The state is read through the indicator instead.
- **`Accordion.getToolsVisibility()`** (`:674-676`) and
  **`Accordion.getChevronGlyph()`** (`:475-477`) — zero callers, and no test.
  Both are documented in `docs/layouts/Accordion.md`'s options table, so they are
  public surface with no consumer rather than strictly dead.
- **`AccordionIndicator.clearExpanded()`** (`AccordionIndicator.ts:272-274`) —
  only caller is its own test
  (`tests/component/container/AccordionIndicator.test.ts:37`).
- **`TableLayoutOptions`** (`layout/Table.ts:19-20`) — an empty interface
  extending `LayoutManagerOptions` with no members; `Table`'s constructor takes
  it and forwards to `applyOptions`. One importer (itself). Either give it a
  member or take `LayoutManagerOptions` directly.
- **`Accordion.computeTotalMinSize()`** (`:1465-1487`) returns a `Size` whose
  `height` is documented as "always `0` (unused)" and whose only caller
  (`:1568`) reads `.width`. A `number` return would say what it means; the
  `Size` shape exists only to match `BoxLayout`'s override signature, which
  `Accordion` does not actually satisfy on the Y axis.
- **`Accordion.applySectionTheming()`** (`:646-667`) writes `setBackground` /
  `setForegroundColor` / `setBorder` on each header with the *same three
  constants* `AccordionHeader`'s `ownClassStyleDefaults`
  (`AccordionHeader.ts:151-155`) already supplies from the class tier. The
  writes cost nothing at runtime (`flushStyleBag`'s `matchesLower` is true, so
  they queue `null` removals that never materialise —
  `tests/component/container/AccordionHeader.themedChromeDedup.test.ts` pins
  exactly that), which makes the imperative half redundant rather than harmful.
  The `!_themed` branch (`clearBackground`/`clearForegroundColor`/`clearBorder`)
  is the only part that does anything.
- **`LayoutSerialization.panelIdOf()`** (`:185-187`) — a one-line wrapper around
  `component.getId()` with 3 call sites and a doc comment explaining the id
  convention. The comment is the value; the indirection is not.
- **`Accordion.expandAll`/`collapseAll`** (`:919-947`) call
  `openSection`/`closeSection` per index, and each of those ends in
  `relayoutHost()` → `scheduleLayout()` + `notifyIntrinsicSizeChanged()`. Probe
  `B3b`: `collapseAll()` on 4 sections made 25 sink applies and no rule writes —
  `scheduleLayout` coalesces, so this is cosmetic, but a single trailing
  `relayoutHost()` would be the honest shape.

## Cross-slice notes

- **→ 06 layout-split-border-dockregion (correcting F06.3):** `Accordion`
  already implements the fix F06.3 proposes for `Split`. Probe `B1`: three
  over-travel gutter-drag frames produced **0** `doLayout` calls on either
  adjacent section and **0** rule writes, because `layoutSections` gates the
  reflow on `reflowAll || contentHeight !== oldHeight` (`Accordion.ts:1708`) and
  `onGutterDrag` advances `_dragLastPointer` only by the travel actually applied
  (`:1922`). Port that gate to `Split.onDrag` rather than writing a new one.
- **→ 06 (confirming the F06.10 hand-off):** F08.7 gives the Accordion side of
  all seven method pairs. F06.2 does **not** apply to Accordion's gutters
  (`collapsible: false`, `setOpaque` never called — probe `A1` shows no
  `transform`/`width` declarations per pass); F06.7 and F06.12 do.
- **→ 06 (extending F06.7):** fixing `SplitGutter`'s subtree `mouseover`/
  `mouseout` alone will **not** remove `Event`'s ancestor walk in a Loom shell —
  `Accordion` installs two subtree listeners per section
  (`Accordion.ts:1403-1404`), so the `mouseover`/`mouseout` entries in
  `subtreeListenerMap` survive. F08.9 has the detail; the two must ship
  together to move the number.
- **→ 06 (extending F06.12):** `Animation.isReducedMotion()`'s live `matchMedia`
  is reached from `Accordion.layoutSections` **per open section per layout
  pass**, not only from hover and collapse paths — probe `A3`: 2 per pass with 2
  open sections, including on drag frames. Memoising it in `core/Animation`
  gains a per-frame beneficiary, not just a per-event one.
- **→ 01 core-component-lifecycle / 05 layout-base-box-flow-grid (correcting
  "no built-in layout manager uses `Component.applyBounds`"):** `layout/Table`
  does, twice — `menuButton.applyBounds(...)` (`layout/Table.ts:389`) and
  `col.applyBounds(...)` in the footer loop (`:405`). The comment at `:380-387`
  explains why (the button is positioned by this manager rather than by the
  header's own `Absolute`, so it needs `applyBounds`'s cascade). `Accordion`
  uses neither `setBounds` nor `applyBounds` anywhere
  (`grep -n "setBounds\|applyBounds" layout/Accordion.ts` → 0 hits) — it writes
  twelve single-property setters per section (F08.6). Both the accordion's
  header and its wrapper are manager-owned chrome whose rectangle is
  frequently unchanged, so they are plausible `canSkipUnchangedLayout`
  candidates once that contract is made live.
- **→ 01 / 03 / 04 (`InlineStyle.flushDirty` empty-bag guard):** one more
  measurement for that one-liner — **38 empty applies** per unchanged 4-section
  `Accordion` pass (probe `B2`: 38 of 38), **15** per no-op Accordion drag
  frame (probe `B1`: 45 over three frames), **34 of 76** on a whole
  `Split`-gutter-drag frame in the Loom shape (probe `D1`).
- **→ 02 core-component-styling:** `Component.setBorder` (`:2926`) and
  `clearBorder` (`:2904`) belong on the "unguarded typed setter" list — both
  write four longhands and invalidate `_borderWidths` with no comparison against
  the current spec. `Accordion.doLayout` is the per-frame caller that makes it
  matter (F08.1), but the fix is general.
- **→ 05 layout-base-box-flow-grid:** `Accordion.getMaxSize()` (`:1361-1363`)
  allocates a fresh `{ width: UNBOUNDED, height: UNBOUNDED }` per call, and the
  host asks for it 4 times per resize frame (probe `D1b`: `pref 1, min 4, max 4`
  from `Split.recalculateSizes`). A frozen module constant would do. More
  importantly, each of those 4 `getMinSize()` calls runs a full walk of the
  accordion's sections with a `getMinSize()` on every open one — slice 06's
  F06.4 multiplied by this manager's own fan-out.
- **→ 07 layout-tab-tabbar:** the `setVisible`-instead-of-`setDisplayed` shape
  you found in `Tab.setBarVisible(false)` has a twin in
  `SplitGutter`'s collapse button, which `Accordion` instantiates permanently
  hidden (F08.8).
- **→ 19/20/21 table-*:** `layout/Table` itself is clean on the render-work axis
  (0 rule writes per pass, cached read-backs, a real calculate/commit split).
  The per-pass cost a real table pays lives in `header.renderColumnWindow`
  (`layout/Table.ts:346`) and `body.renderWindow` (`:422`), which this slice does
  not own.
- **Seam contracts relied on that do hold:** `StyleRule.flushDirty`'s empty-bag
  guard (`core/StyleTarget.ts:404-407`) — which is why an Accordion pass makes
  exactly one `setRuleStyles` call rather than four; and `Component.setVisible`/
  `setDisplayed`'s idempotent short-circuits (`core/Component.ts:2234-2236`,
  `:2312-2314`), which is why `placeGutter`'s per-pass `setVisible(true)` and
  `layoutSections`'s per-pass `setDisplayed(true)` cost nothing.
- **Seam contract that does not hold:** `docs/concepts/layout-system.md`'s "a
  child handed the exact rectangle it already has is not re-laid-out". As slices
  01 and 05 reported, nothing opts in; `Accordion` additionally cannot get it
  even in principle today, because it bypasses `commitBounds` entirely and calls
  `component.doLayout()` directly (`:1722`).

## Suggested plan grouping

**Plan A — "an Accordion layout pass writes nothing to the stylesheet"**
(F08.1, plus F08.10's `setThemed` guard and F08.14's border half). One coherent
change set with one number: rule declarations per `Accordion.doLayout` pass,
today **4**, target **0** — and, on the Loom shape, declarations per
`Split`-gutter-drag frame, today 4, target 0. Three small edits: move
`applyContainerTheming` out of `doLayout` into `attach`, guard `setThemed`, and
make `detach` release what `attach` wrote. Highest payoff per line in the slice,
no dependency on any other slice. It is the direct sibling of slice 06's Plan A
and should be measured in the same WebKitGTK recording, because together they
decide whether a sidebar drag frame touches the stylesheet at all. If slice 02
lands a `setBorder` guard or a `StyleTarget` last-written-value filter first,
Plan A shrinks to the `attach`/`detach` tidy-up — but do not wait for it: the
call-site fix also removes the per-pass `_borderWidths` invalidation and the
per-pass object allocation.

**Plan B — "an Accordion pass measures each section once"** (F08.2 + F08.4 +
F08.5). One measurable number: size reports per open section per settled pass,
today 2 `pref` + 3 `min` + 3 `max` (resizable) / 3+3+3 (not), target 0+1+1 /
1+1+1, plus `matchMedia` calls per pass, today 1 per open section, target 0.
Three edits inside one method's dependency graph: gate the shrink/fill seed on
"some open section needs seeding", memoise `openContentHeight` for the pass, and
reorder the `&&` chain at `:1704`. Independent of Plan A; sequence it *after*
Plan A so the rule-write noise is out of the measurement. **Depends on slice 05**
only in the sense that it should not contradict a general size-hint memo — if
slice 05 lands one, Plan B shrinks to the seed gate alone, which is still the
larger half.

**Plan C — "a closed section leaves the render tree"** (F08.3). One file plus
the `Component` seams `collapsed-panes-leave-render-tree` already built
(`setContentClampSuspended`, `isDestroyed`). Biggest risk and biggest ceiling in
the slice: it removes a full subtree `doLayout` **and** a full recursive
`getPreferredSize` per closed section per frame, which in Loom is a `Tree`. It
should be its own plan, not folded into B, because it needs that plan's whole
hazard checklist (animation gating, scroll capture, content clamp, detach
liveness) and its own docs paragraph in `docs/layouts/Accordion.md`. Sequence it
after Plan B so the seed-pass noise does not mask the gain. A cheap first
increment — skip only the reflow and the `getPreferredSize` for a *settled*
closed section, leaving it in the render tree — is worth shipping first and
measuring on its own.

**Plan D — "the pointer path has no subtree walkers"** (F08.9). Must ship with
slice 06's Plan D; on its own neither half moves the per-mousemove number.
Switch `Accordion`'s header hover to `mouseenter`/`mouseleave`, and confirm
against `Notification.ts:242-247`'s recorded reason for the opposite choice
before committing. Measure with slice 06's `hoverwalk.test.ts` counter, with a
live Accordion in the tree.

**Rides along, too small to plan**: F08.6's `setBounds` batching rides with
Plan B (which already rewrites the geometry half of `layoutSections`); its
`InlineStyle.flushDirty` half belongs to slice 01/02/03's `core` one-liner and
this slice only adds a count. F08.7's `RafDragBuffer` extraction rides with
slice 06's Plan B, as that reviewer proposed — with the correction that the
reflow gate travels `Accordion` → `Split`, not the other way. F08.8 is a
`SplitGutter` edit and belongs to slice 06's tidy-up. F08.11, F08.12, F08.13 and
the rest of F08.10 and F08.14 are a single "correctness and tidy-up" commit with
no measurement attached; F08.13 in particular changes no in-library behaviour
today and exists to stop the two branches drifting further.
