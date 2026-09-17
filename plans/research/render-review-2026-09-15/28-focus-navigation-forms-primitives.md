# 28 focus-navigation-forms-primitives — render-work review

**Summary**

- `SpatialNavigation`'s component tier walks every candidate's ancestor chain **twice** per arrow chord — once inside `isRenderedVisible` and once inside `ancestorGeometry` — and each hop is a `getComputedStyle` in production. Probe: 120 focusables at depth 6 → 120 `isRenderedVisible` + 720 `getComputedOverflow` + 120 `getElementRect`, i.e. ≈1,500 computed-style resolutions and 120 forced `getBoundingClientRect` calls for one keypress (F28.1). Sibling candidates share almost all of those ancestors, so the whole walk is memoizable inside one `moveFocus` call.
- `leafFocusables` is **quadratic in `DOM.source.contains`** for any candidate that is not a native focusable tag. Probe: 1,482 `contains` at n=40, 6,162 at n=80, 25,122 at n=160 — dead-on `n²` (F28.2). Every framework container that sets `tabindex="0"` (`Panel`, `Tree`, `Table`'s `<tbody>`, `ToolBar`, `MenuBar`, `TabBar`) lands in that branch.
- `FieldSet.doLayout` re-clamps the legend every pass, and during a real resize that is **2 stylesheet-rule declarations per frame per titled `FieldSet`** written synchronously from inside the layout pass (probe: 20 frames → 40 rule declarations, 20 of them `maxWidth`). Per the briefing's cost model a rule mutation is a full-document restyle (F28.3).
- `FOCUSABLE_SELECTOR`'s `:not([tabindex="-1"])` guard binds only to its trailing `[tabindex]` branch, so **every roved-off `<button>` still matches** — every tab button, tool-bar button and menu-bar button is a Tab stop and a spatial candidate. That is both a live a11y defect (five `it.todo`s pin it) and the multiplier on F28.1/F28.2 (F28.4).
- `Component.getContentInsets()` allocates a fresh `Insets` — and therefore a fresh `Util.generateUUID()` — on **every** call. Probe: `new Insets(...)` costs **1,216 ns** in node/V8 (196× a plain literal), and one full `doLayout` of a 241-container tree makes 282 of them ≈ 0.34 ms/frame plus 282 objects and 282 36-char strings of GC pressure (F28.5).
- The whole `"target"` tier of `SpatialNavigation` is **inert in any stock app**: `Component.setNavigationTarget(true)` has zero call sites in the library, the demo, the docs app and create-app, so `_lastFocus`, `recordOrigin`, `pruneStaleMemory`, `outermostTargets` and `targetLandings` (~180 lines) serve a candidate set that is always empty — and the component tier pays `pruneStaleMemory` + `recordOrigin` on every move regardless (F28.6).
- The 2026-08-29 audit's Priority-1 #3 (`FieldSet`/`LabeledFieldSet` leaking their `Legend`) is **closed** — see *Redundant, duplicated and dead code*.

---

## Findings

### F28.1 Candidate geometry re-walks every ancestor chain twice, with a live computed-style read per hop

- **Category**: A, G
- **Impact**: HIGH (per keypress on hot path 4; multiplied by the number of focusable elements in the whole document, because the scope root is `<body>`)
- **Where**:
  - `core/SpatialNavigation.ts:522` `collectCandidates`
  - `core/SpatialNavigation.ts:475-496` `ancestorGeometry` — `:476` `getElementRect`, `:480` `getComputedOverflow` per ancestor, `:491` a second `getElementRect` per clip frame
  - `core/Focusable.ts:108-110` `visibleFocusable` → `:109` `isRenderedVisible` per candidate
  - `core/DOM.ts:2612-2626` `ProductionDOMSource.isRenderedVisible` — `getComputedStyle` per ancestor, walking to the document root with no bound
  - `core/DOM.ts:2601-2610` `getComputedOverflow` — one `getComputedStyle` each
  - `core/DOM.ts:2125-2127` `getElementRect` — `getBoundingClientRect`
- **Hot path**:
  - window `keydown` capture (`Event`) → `SpatialNavigation.onKeyDown` (`:734`)
  - → `moveFocus(direction, tier)` (`:674`)
  - → `effectiveRect(origin, root)` (`:685`) → `ancestorGeometry` → 1 `getElementRect` + depth × `getComputedOverflow`
  - → `collectCandidates(root, origin, "component")` (`:522`)
  - → `visibleFocusable(root)` → `querySelectorAll(<body>, FOCUSABLE_SELECTOR)` then **n × `isRenderedVisible`**, each a full ancestor walk with a `getComputedStyle` per level
  - → `rovingGroupMembers(root)` (`:376`) → a second `querySelectorAll` + a second `isRenderedVisible` per roving member
  - → `.map(handle => ancestorGeometry(handle, root))` (`:538`) → **n × `getElementRect`** plus **n × depth × `getComputedOverflow`**
  - the same `visibleFocusable` half runs per **Tab** press too, via `FocusTraversal.onKeyDown` (`:234`) → `visibleFocusable(root)`
- **Evidence**: probe `28-…/spatial-cost.test.ts`, 120 focusables in 12 groups at nesting depth 6, one `SpatialNavigation.move("east","component")`:

      DOM.source.querySelectorAll: 2      DOM.source.isRenderedVisible: 120
      DOM.source.getElementRect: 120      DOM.source.getComputedOverflow: 720
      DOM.source.getParentNode: 848       DOM.source.hasAttribute: 848

  and one `FocusTraversal.next()` over the same tree: `isRenderedVisible: 120`, `hasAttribute: 120`. Scaling is linear in n (40 → 240 → 1440 `getComputedOverflow`). The modelled `isRenderedVisible` (`tests/dom/TestDOM.ts:1370-1378`) is a flag lookup, so the probe counts *calls*; the per-call `getComputedStyle` cost is read from `core/DOM.ts:2612-2626`. In production each of the 120 `isRenderedVisible` calls does one `getComputedStyle` per ancestor — ≈840 at depth 7 — so a single chord costs ≈1,500 computed-style resolutions plus 120 `getBoundingClientRect`.
- **Proposed change**: one pass, one memo, per `moveFocus` call.
  1. Build a `Map<Handle, {overflowClips: boolean; visible: boolean; isClipFrame: boolean; rect: Rect | null}>` local to `moveFocus` and have both `ancestorGeometry` and the visibility filter consult it, so a shared ancestor is read once instead of once per descendant. In the probe fixture that collapses 720 `getComputedOverflow` to 72.
  2. Bound the visibility walk at the scope root: add a `DOMSource.isRenderedVisibleWithin(handle, root)` (or pass the already-known `root` through `visibleFocusable`) so the walk stops where `ancestorsBefore` already stops, instead of climbing to the document every time.
  3. Do the `getElementRect` sweep in one uninterrupted read block before any write (`tryFocusCandidates` at `:635` writes an attribute and calls `focus`, then loops back into `FocusReveal.reveal`, which reads geometry again — see F28.9).
- **Risk / blast radius**: `visibleFocusable` is shared by `FocusTraversal` (`:114`, `:134`, `:234`, `:320`, `:331`, `:342`) and `SpatialNavigation` (`:533`). `tests/core/FocusTraversal.test.ts` (`getTabStops` order, the display:none/visibility:hidden omission case at `:122`) and `tests/unit/core/SpatialNavigation.test.ts` (`:450`, `:675`, `:701`, `:726`, `:749`) pin the observable results; none pins call counts, so a memo is invisible to them.
- **Proof at implement time**: re-run the probe above and assert `getComputedOverflow ≤ distinct ancestors` and `isRenderedVisible` calls unchanged but each bounded; then ms-per-keypress for `Ctrl+Alt+→` in a real WebKitGTK Loom session with the file tree populated.

---

### F28.2 `leafFocusables` runs an O(n²) containment scan over the candidate set

- **Category**: A, H
- **Impact**: HIGH (per arrow chord; quadratic in the number of non-native-tag candidates, which is exactly the set every framework container contributes)
- **Where**: `core/SpatialNavigation.ts:415-428` — `:421-422` `handles.some(other => … DOM.source.contains(handle, other))` and `:423-424` `handles.some(other => … DOM.source.contains(other, handle))`, both inside a `handles.filter(...)`
- **Hot path**: `onKeyDown` (`:734`) → `moveFocus` (`:674`) → `collectCandidates` (`:532`) → `leafFocusables(...)` → two nested scans → `DOM.source.contains` (`core/DOM.ts:2536`, a registry resolve plus a native `Node.contains`).
- **Evidence**: probe `28-…/quadratic-and-writes.test.ts`, candidates that carry only `tabindex="0"` (no native tag, no roving marker):

      n= 40 → contains =  1,482  (0.93 × n²)
      n= 80 → contains =  6,162  (0.96 × n²)
      n=160 → contains = 25,122  (0.98 × n²)

  The all-`<button>` fixture in `spatial-cost.test.ts` reports `contains: 0`, confirming the early `return true` at `:417` is what keeps native leaves out of the quadratic — and that everything else falls into it. In a real app the non-native set is large: `Panel`, `Tree`, `Table`'s `<tbody>`, `ToolBar`, `MenuBar` and `TabBar` all set their own `tabindex="0"`, and F28.4 puts every roved-off member back in the list as well.
- **Proposed change**: decide containment from one ancestor walk instead of an n² pairwise test. `querySelectorAll` already returns document order, and the ancestor walk of F28.1's memo already visits each candidate's chain — record each candidate's ancestor `Set` there, then `containedByAnotherCandidate` is `ancestors.has(other)` against a `Set` of all candidate handles (O(depth) per candidate), and `containsAnIndependentLeaf` is a single reverse pass marking each candidate's ancestors as "has a leaf below". Total O(n × depth) instead of O(n²) DOM calls.
- **Risk / blast radius**: `leafFocusables` has one caller (`:532`). Its semantics are pinned by `tests/unit/core/SpatialNavigation.test.ts:548` ("prefers a composite widget's own content over its wrapping container"), `:570` ("does not drop a native-tag candidate for containing another candidate"), and `:593` ("keeps a tabindex-bearing container over a plain descendant"). All three are outcome assertions, satisfiable by the set-based rewrite.
- **Proof at implement time**: the probe above, asserting `contains` grows linearly (≈ n × depth) rather than as n²; plus the three pinned tests staying green.

---

### F28.3 `FieldSet.doLayout` writes stylesheet-rule declarations every resize frame

- **Category**: C, D
- **Impact**: MEDIUM-HIGH (per frame on hot path 1, per titled `FieldSet` whose width is changing; a rule mutation is a full-document restyle in the target environment)
- **Where**:
  - `component/container/FieldSet.ts:249-254` `doLayout` → `:251` `this.clampLegendWidth()`
  - `component/container/FieldSet.ts:121-138` `clampLegendWidth` → `:135` `this._legend.setMaxSize({ width: innerW, height: Number.MAX_VALUE })`
  - `core/Component.ts:3588-3602` `setMaxSize` → `writeStyle({ maxSize })`
  - `core/Component.ts` `writeStyle` (protected, ≈2430) — on a rendered component it runs `flushStyleBag()` + `commitCSSRule()` + `materialiseRestingRule()` **synchronously**, i.e. a `CSSStyleRule` mutation inside the layout pass
- **Hot path**:
  - rAF layout flush → ancestor `doLayout` → `applyBounds` writes the `FieldSet`'s box
  - → `FieldSet.doLayout` (`:249`) → `super.doLayout()` → `clampLegendWidth` (`:251`)
  - → `getWidth()` (cached, no DOM read) → `getPerimeterSize()` (see F28.7) → `_legend.setMaxSize(...)`
  - → `writeStyle` → `setRuleStyles` on the legend's `#id` rule — **once per frame, while the width keeps changing**
- **Evidence**: probe `28-…/quadratic-and-writes.test.ts`. 20 simulated drag frames on one titled `FieldSet` → 40 rule declarations, of which 20 are `maxWidth` and 20 are a redundant `maxHeight: null`:

      {"selector":"#…","key":"maxWidth","value":"584px"}
      {"selector":"#…","key":"maxHeight","value":null}
      {"selector":"#…","key":"maxWidth","value":"583px"}   …

  The companion probe confirms `setMaxSize`'s value dedup works: 20 layout passes at an *unchanged* width produce **0** rule declarations. So the cost is exactly the resize case, which is the one that matters.
- **Proposed change**: only clamp when the title actually needs clamping. `Text` already knows its own preferred width, so `clampLegendWidth` can compare the legend's preferred width against `innerW` and write `UNBOUNDED` when the title fits — which `setMaxSize`'s dedup then makes free on every subsequent frame. Only a genuinely over-long title pays the per-frame write, and only while it is being squeezed. Second, the `maxHeight: null` half is a removal of a property that was never set: `setMaxSize` should not queue a declaration for an axis whose value is the unbounded sentinel (this is also where F28.15's two-sentinel split bites — `FieldSet.ts:135` passes `Number.MAX_VALUE`, not `UNBOUNDED`).
- **Risk / blast radius**: `clampLegendWidth` has two callers, `setTitle` (`:103`) and `doLayout` (`:251`). No test asserts the clamp's write count; `tests/component/container/FieldSet.test.ts` covers title round-trip and perimeter only. The behaviour to preserve is the ellipsis engaging on a too-long title.
- **Proof at implement time**: the 20-frame probe above, asserting 0 `setRuleStyles` ops for a fitting title and ≤1 per frame for an over-long one; then rule-writes-per-frame from the `StyleRule` counter during a `Split`-gutter drag over a panel containing a `LabeledFieldSet`.

---

### F28.4 `FOCUSABLE_SELECTOR`'s `tabindex="-1"` guard only binds its last branch, so every roved-off native control stays a candidate

- **Category**: H, and a multiplier on F28.1/F28.2
- **Impact**: MEDIUM (per Tab press and per arrow chord; inflates the candidate set by the full membership of every `RovingTabIndex` group in the app — in Loom that is every tab button, tool-bar button and menu-bar button)
- **Where**: `core/Focusable.ts:12`
  `'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'`
- **Hot path**: `FocusTraversal.onKeyDown` (`:234`) → `visibleFocusable` → `findFocusable` (`Focusable.ts:92`) → `querySelectorAll(root, FOCUSABLE_SELECTOR)`; and `SpatialNavigation.collectCandidates` (`:533`) through the same helper.
- **Evidence**: `tests/core/FocusTraversalCompositeWidgets.test.ts:56-79` documents the defect and holds **four live `it.todo`s** for it (`MenuBar`, `ToolBar`, `ButtonGroup`, a `Tab` layout's `TabBar` each expose one stop per item instead of one per widget), plus a fifth at `:122` for the missing `[contenteditable]` branch that makes a resting `CodeEditor` expose **zero** tab stops (asserted as a live gap at `:105-121`). `RovingTabIndex.add` (`:85`) does set `tabindex="-1"` on every inactive member, so the intent is there — the selector just never honours it for a `<button>`. Third symptom: the bare `[href]` branch matches the `<use>` element inside every `Glyph`; `SpatialNavigation` works around that locally with `withoutDecorativeGlyphs` (`:318-320`), `FocusTraversal` does not.
- **Proposed change**: move the eligibility test out of the selector string and into `findFocusable` (`Focusable.ts:92-101`), which already filters on `disabled`: keep a broad selector for the query, then drop any handle whose `tabindex` attribute is `"-1"`. Narrow `[href]` to `a[href], area[href]` so the `Glyph` `<use>` workaround at `SpatialNavigation.ts:318` can be deleted, and add `[contenteditable]:not([contenteditable="false"])` for the `CodeEditor` gap. The blocker the test comment cites — "`core/Focusable.ts` is owned by `plans/directional-panel-navigation.md`" — no longer holds: that plan is still in `plans/` unimplemented, and `SpatialNavigation.ts:205` itself calls it *superseded*, so the file has no live owner.
- **Risk / blast radius**: widest in the slice — `findFocusable` feeds `FocusTraversal`, `SpatialNavigation` and (via `focusCandidates`) the target tier; `Dialog` imports `FOCUSABLE_SELECTOR` for its focus trap. Changing it changes Tab order in every app that enables `FocusTraversal`. The four `it.todo`s become the acceptance tests.
- **Proof at implement time**: flip the four `it.todo`s to real assertions (`stopCount(el) === 1` for `MenuBar`/`ToolBar`/`ButtonGroup`/`TabBar`); then re-run F28.1/F28.2's probes and show n dropping by the roving-member count.

---

### F28.5 Every `getContentInsets()` allocates an `Insets`, and every `Insets` generates a UUID

- **Category**: G
- **Impact**: MEDIUM (once per container per layout pass on hot path 1; ≈0.34 ms/frame plus 282 objects and 282 strings in a 241-container tree, measured in node/V8)
- **Where**:
  - `core/Component.ts:2624-2634` `getContentInsets` — returns `new Insets(...)` on **both** branches, with `// no stored field, mirroring getPerimeterSize`
  - `primitive/Insets.ts:18,31-38` — `Insets extends BaseObject`
  - `core/BaseObject.ts:15-17` → `Util.generateUUID()`
  - `core/Util.ts:363-376` — a 36-char regex `replace` with a per-character callback (32 `Math.random()` calls), a `parseInt`, and a conditional string rebuild
  - callers, one per `doLayout`: `layout/LayoutManager.ts:308`, `HBox.ts:280`, `VBox.ts:278`, `Grid.ts:678`, `Border.ts:1198`, `Fit.ts:233`, `Split.ts:1915`, `Card.ts:308`, `Table.ts:166`, `Tab.ts:2065`, `Accordion.ts:1559` and `:1942`, `HFlow.ts:287`, `VFlow.ts:271`, `Anchor.ts:153`; plus `Component.getContentBounds` (`:3658`), `TabBar.ts:2880`, `FloatingPanel.ts:205`, `CodeEditorSearchPanel.ts:361`
- **Hot path**: rAF flush → `doLayout` top-down → each manager's `doLayout` opens with `container.getContentInsets()` → `new Insets` → `generateUUID`.
- **Evidence**: probe `28-…/insets-alloc.test.ts` and `28-…/form-layout-cost.test.ts`:

      new Insets() x200000: 243.3ms  (1216ns each)
      {literal}    x200000:   1.2ms  (   6ns each)     → 196x
      one full doLayout of 241 containers: 282 getContentInsets() calls
        = 282 Insets allocations = 282 UUIDs ≈ 0.34 ms/frame (node/V8)

  The probe also asserts the two calls return distinct instances with distinct ids, so nothing downstream relies on identity. `getPerimeterSize` (`core/Component.ts:3764-3800`) has the same shape one level cheaper — a fresh plain object per call, no UUID — and the probe counted **16** of those in a single layout pass of a 3-field `LabeledFieldSet`.
- **Proposed change**: two independent, additive steps.
  1. Make `BaseObject`'s id **lazy** — generate on first `getId()` instead of in the constructor. Nothing in the layout path ever asks an `Insets` or a `Point` for its id, so the UUID is pure waste. This alone removes ~95% of the 1,216 ns.
  2. Give `Component` a cached `getContentInsets()` derived value, invalidated by `setInsets`/`clearInsets`/`setPadding`/`clearPadding` — the same three setters that already own the inputs. A single frozen `Insets.ZERO` would additionally collapse the twelve separate `new Insets(0,0,0,0)` module-level defaults (see F28.12).
- **Risk / blast radius**: `BaseObject` is the root of `Component` too, so step 1 touches every framework object — but `Component.getId()` is called constantly, so the lazy path is exercised immediately and the only behavioural change is *when* the string is minted. Step 2 is local to `Component`; the returned `Insets` must then be treated as read-only, which F28.12 shows it already is (zero mutator call sites).
- **Proof at implement time**: re-run the two probes — `new Insets()` per-call ns, and `getContentInsets` calls vs allocations per pass; then ms/frame on the 2×2 editor-grid horizontal drag.

---

### F28.6 The `"target"` tier has no opted-in targets anywhere, and the component tier pays its bookkeeping regardless

- **Category**: H, J
- **Impact**: MEDIUM (dead configuration surface ≈180 lines; plus per-chord waste on the live tier)
- **Where**:
  - `core/SpatialNavigation.ts:217` `_lastFocus`, `:258-264` `pruneStaleMemory`, `:275-281` `recordOrigin`, `:299-303` `outermostTargets`, `:616-625` `targetLandings`, `:522-530` the `tier === "target"` branch
  - `core/SpatialNavigation.ts:691-692` — `pruneStaleMemory()` then `recordOrigin(origin)` run for **both** tiers, before the tier is even consulted
  - `core/Component.ts:2164-2174` `setNavigationTarget`
- **Hot path**: `moveFocus` (`:674`) → `:691` `pruneStaleMemory()` (an `isConnected` per map entry) → `:692` `recordOrigin(origin)` (a walk to `<html>` with a `hasAttribute` per ancestor) → only then the tier-specific work.
- **Evidence**: grep over all of `packages/` (lib source, lib tests, docs app, create-app, lib docs):

      grep -rn "setNavigationTarget" lib/src lib/tests docs/src create-app

  returns the definition (`Component.ts:2164`), the always-dispatch in `applyOptions` (`Component.ts:845`), three `SpatialNavigation` doc references, and two tests that call it with `false` (`tests/component/default-options-fallback.test.ts:820,831`). **No component, demo panel, docs page or scaffold ever calls `setNavigationTarget(true)`.** `main.ts:46` enables the service; `Ctrl+Shift`+arrow therefore searches an empty `querySelectorAll(root, NAVIGATION_TARGET_SELECTOR)` result and always returns `false`. Consequently `_lastFocus` is never populated, and `pruneStaleMemory`/`recordOrigin` at `:691-692` do measurable work for a map that is永 empty.
  Companion dead surface, same grep method over `packages/`: `SpatialNavigation.configure` — 0 call sites outside the module and its test; `FocusTraversal.configure` and `FocusTraversalOptions.wrap` — 0; `FocusHistory.configure` — 0; `FocusTraversal.enable()` — **0 call sites anywhere in `packages/`**, so that whole service ships unexercised outside its own tests; `rankInDirection`, exported from `core/index.ts:49` as public API — 0 consumers.
- **Proposed change**: this is a design call, not a mechanical one, so it belongs in a plan with the user in the loop. Two coherent options: (a) **land the tier** by marking the obvious containers (`Dock` regions, `Split` panes, `Accordion` sections, `Tab` pages) as navigation targets, which is what the chord was built for; or (b) **retire it** and delete `_lastFocus`/`recordOrigin`/`pruneStaleMemory`/`outermostTargets`/`targetLandings`/`SpatialTier`, collapsing the service to one chord. Either way, gate `:691-692` on `tier === "target"` — that is a safe, standalone change under both options.
- **Risk / blast radius**: option (b) removes public API (`SpatialTier`, `SpatialNavigation.move`'s second argument, half of `tests/unit/core/SpatialNavigation.test.ts`). The `:691-692` gate alone risks nothing: `tests/unit/core/SpatialNavigation.test.ts:994,1268,1298,1326` all exercise the memory through *target*-tier moves.
- **Proof at implement time**: for the gate, a probe asserting zero `hasAttribute`/`isConnected` calls attributable to `recordOrigin`/`pruneStaleMemory` on a component-tier move.

---

### F28.7 `FieldSet.legendClearance()` does a live `offsetHeight` read from inside the layout pass, and never invalidates

- **Category**: A, B
- **Impact**: LOW-MEDIUM (2 forced reads per layout pass per titled `FieldSet`, only until a positive measurement lands; plus a permanent staleness bug on theme change)
- **Where**: `component/container/FieldSet.ts:210-239` `legendClearance` — `:226` `getElement()`, `:228` `isConnected`, `:229` `DOM.source.getOffsetSize(element).offsetHeight`; reached from `:195-201` `getPerimeterSize`, which `Component.getInnerSize` (`core/Component.ts:3625`) calls at the top of every manager's `doLayout`
- **Hot path**: rAF flush → `Fit.doLayout` / `Grid.doLayout` → `container.getInnerSize()` (`Component.ts:3619`) → `FieldSet.getPerimeterSize` (`:195`) → `legendClearance` (`:210`) → `getOffsetSize` (`core/DOM.ts:2415-2422`, `el.offsetHeight`) — a forced style+layout flush landing *after* `applyBounds` wrote the box in the same task.
- **Evidence**: probe `28-…/form-layout-cost.test.ts` — `FieldSet.getPerimeterSize()` calls in one `LabeledFieldSet.doLayout()`: **2**. The cache at `:215-217` closes the hole once `offsetHeight > 0`, so steady state is free; the reads persist while the measurement keeps returning 0, which is what a `display:none` ancestor (an inactive `Tab` page, a settled collapsed `Split` pane) produces. The modelled source short-circuits at `:222` (`DOM.source.isModelled()`), so the offline probe cannot observe the read itself — **not verified by probe; read from source**.
  Second half, verified by reading: `_legendClearance` (`:61`) is written once and never cleared. `setTitle` (`:100`) does not reset it, and no theme-change hook touches it, so a font-size or theme switch leaves the fieldset reserving the *old* legend height forever — hot path 7.
- **Proposed change**: measure once, deliberately, out of the layout pass. Take the measurement from an `onFirstLayout`/`afterNextLayout` hook (both exist on `Component`) instead of lazily from a getter the layout pass reaches, and keep the constant fallback until it lands. Clear `_legendClearance` from `setTitle` and from the theme-change callback `Text` already subscribes to, so the reservation tracks the rendered legend.
- **Risk / blast radius**: `getPerimeterSize` feeds `getInnerSize`, `getContentBounds` and `getMinSize` (`:148`). `tests/component/container/FieldSet.test.ts:45,76,85,95` pin clearance = fallback / 0 / fallback, all through the modelled source, so they are unaffected by where the real measurement is taken. `getPerimeterSize` at `:195-201` also *mutates* the object the base returned — safe today only because `Component.getPerimeterSize` allocates fresh each call (`core/Component.ts:3764`); worth a defensive copy if that ever gets cached (see F28.5's step 2, which caches `getContentInsets`, not `getPerimeterSize`).
- **Proof at implement time**: a probe with a non-modelled source asserting zero `getOffsetSize` calls inside `doLayout` after the first pass; plus a theme-switch test asserting the clearance re-measures.

---

### F28.8 `RovingTabIndex.moveTo` rewrites `tabindex` and re-focuses when the target is already active

- **Category**: B, H
- **Impact**: LOW-MEDIUM (per activation event; `TabBar` routes every tab press through it, including a press on the already-selected tab)
- **Where**: `core/RovingTabIndex.ts:127-148` — `:136` guards only the *outgoing* write, `:144-147` writes `tabindex="0"` and calls `focus()` unconditionally; `core/ElementAttributes.ts:30-38` / `:67-70` do no value dedup
- **Hot path**: tab click → `TabBar.onTabPressed` (`component/container/TabBar.ts:2049-2054`) → `this._rovingTabIndex.moveTo(idx)` → `Aria.setTabIndex(0)` (`core/Aria.ts:140-145`) → `applyAriaAttribute` → `setElementAttribute` → `ElementAttributes.queue/set` → `DOM.sink.apply({setAttr:{tabindex:"0"}})`; then `next.focus(this._preventScroll)` → `DOM.sink.focus`.
- **Evidence**: probe `28-…/quadratic-and-writes.test.ts` — three consecutive `group.moveTo(activeIndex)` calls produce `["apply","focus","apply","focus","apply","focus"]`: **3 tabindex writes and 3 `focus()` calls for zero state change**. `tests/core/RovingTabIndex.test.ts:58` ("leaves exactly one item at tabindex 0 when re-selecting the current index") pins the *outcome*, not the write count, so it stays green either way.
- **Proposed change**: early-return from `moveTo` when `clampedIndex === this._activeIndex` **and** the active item already carries `tabindex="0"` — or, more conservatively, hoist the `:144-147` block behind the same `clampedIndex !== this._activeIndex` guard `:136` already uses, keeping an explicit `focusActive()` for callers that genuinely want the focus moved. The unconditional `focus()` is the sharper edge: `moveTo` is also reached from `remove` (`:114`), so removing the active member steals focus as a side effect of a structural mutation.
- **Risk / blast radius**: three consumers — `TabBar.ts:2054`, `ToolBar.ts:199,203` (`moveNext`/`movePrev`, which never target the current index), `ButtonGroup.ts:287,289` (same). Only `TabBar`'s call can hit the no-op case. `tests/core/RovingTabIndex.test.ts:111` ("removing the active item moves active to max(0, idx-1)") depends on `remove` → `moveTo` still updating the index.
- **Proof at implement time**: the probe above, asserting 0 sink ops for three repeat `moveTo(activeIndex)` calls.

---

### F28.9 `SpatialNavigation.onFocusOut` writes to the DOM and interns a handle on every focus transition in the document

- **Category**: B, G
- **Impact**: LOW (per focus change while the service is enabled — every click on a control, every tab switch, every programmatic focus)
- **Where**: `core/SpatialNavigation.ts:713-719` — `:714` `DOM.source.isElement(e.target)`, `:718` `DOM.source.intern(e.target)` then `DOM.sink.apply(handle, { removeAttr: [FOCUS_VISIBLE_ATTR] })`
- **Hot path**: any focus move → window `focusout` capture → `onFocusOut` → one `intern` (a `WeakRef` registry entry plus a `FinalizationRegistry` registration, `core/DOM.ts` `intern` mode) → one `removeAttribute` for an attribute the element almost never carries.
- **Evidence**: read from source. The JSDoc at `:707-710` states the unconditionality is deliberate ("`removeAttr` on an element that never carried the marker is a harmless no-op"). It is harmless *as a DOM write*; the `intern` per event is the part the comment does not cover, and it is the more expensive half. There is also a read/write interleave inside `tryFocusCandidates` (`:635-654`): `FocusReveal.reveal(landing)` (geometry reads) → `DOM.sink.focus` (write, which synchronously fires this `focusout` handler's write) → `DOM.source.getActiveElement()` → loop back into `FocusReveal.reveal` for the next candidate. That only matters when the first candidate refuses focus.
- **Proposed change**: track the one handle the service last marked in a module-level `let _marked: Handle | null`, and have `onFocusOut` clear only that one — comparing `e.target` against it via the identity the seam already guarantees (`docs/concepts/dom-seams.md`: handle equality reproduces element equality). That removes both the per-event `intern` and the per-event write for every transition the service did not drive. Restructure `tryFocusCandidates` to do its reveal reads before the focus write for each candidate.
- **Risk / blast radius**: `tests/unit/core/SpatialNavigation.test.ts:1426,1445,1456` pin the marker's clearing behaviour, including "a focusout for an element that never carried the marker is a harmless no-op" — that test would need restating as "does not write". `component/input/focusRing.ts` reads the attribute (`FOCUS_VISIBLE_ATTR` is exported at `:197` for exactly that).
- **Proof at implement time**: a probe counting `DOM.sink.apply` ops and `DOM.source.intern` calls across N synthetic focus transitions, asserting 0 for transitions the service did not drive.

---

### F28.10 `LabeledGrid.finishRow()` pads short rows with real `Component`s

- **Category**: E, H
- **Impact**: LOW (per pass; each spacer is a DOM element, a stylesheet rule at first render, and a participant in every one of `Grid.measureContent`'s per-child sweeps)
- **Where**: `component/container/LabeledGrid.ts:255-267` — `:263` `this.addComponent(new Component())` inside the padding loop; called from `addRow` (`:166`, `:172`) and `addFullWidthRow` (`:184`)
- **Hot path**: construction (rule materialisation, `performance.md` "CSS rule generation cost") and then every layout pass — `Grid.measureContent` (`layout/Grid.ts:879`) queries `getPreferredSize` + `getMinSize` for *every* child, spacers included.
- **Evidence**: probe `28-…/form-layout-cost.test.ts` — `LabeledGrid({columns: 3})` after two short rows and one full-width row: **13 children, 6 of them empty spacer `Component`s** (46%). Companion count, same probe: one `LabeledGrid.doLayout()` with 8 fields (16 children) issues 48 `getPreferredSize` + 64 `getMinSize` + 48 `getMaxSize` = **160 size queries, ≈10 per child per pass** (see the cross-slice note on `Grid.measureContent`); each spacer pays that too. (`getBaseline` reported 0 in the probe only because the counter patched `Component.prototype` and `Text`/`TextInput` override it — the count is unreliable, the others are not.)
- **Proposed change**: the spacer exists only because `Grid`'s baseline mode refuses explicit placement — `layout/Grid.ts:703-705` states "Explicit col/row placement and rowSpan > 1 are not supported here". Teaching baseline mode to honour a `GridConstraints.col` (or a one-field `skipColumns` on the next child) lets `LabeledGrid` advance `_flowCol` without materialising anything. Failing that, keep the spacers but make them a single shared zero-size sentinel class that opts out of measurement — they must stay *displayed*, since `getLaidOutComponents()` filters undisplayed children and the flow would shift.
- **Risk / blast radius**: `LabeledGrid` is the only `baselineAlign: true` consumer in the library (`grep -rn "baselineAlign" lib/src` → `layout/Grid.ts` and `component/container/LabeledGrid.ts:109` only), so a baseline-mode placement change has exactly one caller. `tests/component/container/LabeledGrid.test.ts:41,57,68` assert child counts, so they pin the current spacer behaviour and would need updating.
- **Proof at implement time**: the spacer-count probe above, asserting 0 spacer components for the same three-row fixture; plus child-count deltas in `LabeledGrid.test.ts`.

---

### F28.11 `primitive/Point.ts` is dead

- **Category**: J
- **Impact**: LOW (code health)
- **Where**: `primitive/Point.ts:10-52`; re-exported at `primitive/index.ts:7`
- **Evidence**:

      grep -rn "new Point(" packages/lib/src packages/docs/src packages/create-app   → 0
      grep -rln "\bPoint\b" packages/{lib,docs,create-app} (excluding dist/)
        → primitive/Point.ts, primitive/index.ts, tests/unit/primitive/Point.test.ts,
          core/Theme.ts:739 (a JSDoc sentence "Point-marker radius"),
          component/diagram/DiagramEdgeLayer.ts:255,256,283,284,580,581 (JSDoc "@param px - Point x."),
          tests/dom/hit-test.test.ts + tests/unit/data/ModelRecord.test.ts (unrelated identifiers)

  Its only consumer is its own unit test. `DiagramEdgeLayer` uses ELK's `ElkPoint`, not this class.
- **Proposed change**: delete `primitive/Point.ts`, its `primitive/index.ts:7` export and `tests/unit/primitive/Point.test.ts`. It is exported from a public subpath, so this is a breaking removal for any external consumer and belongs in a changelog entry.
- **Risk / blast radius**: none inside the repo.
- **Proof at implement time**: the grep above returning zero, and `npm run build` + `docs:api` clean.

---

### F28.12 `Insets` is mutable, its mutators are dead, and 29 shared module-level instances depend on nobody using them

- **Category**: J, H
- **Impact**: LOW (latent correctness hazard; blocks the `getContentInsets` caching in F28.5)
- **Where**:
  - `primitive/Insets.ts:54,74,94,114` `setTop`/`setRight`/`setBottom`/`setLeft`, `:128-135` `set(...)`
  - `core/Component.ts:2520-2522` `getInsets()` returns the shared default instance directly: `this._options.insets ?? this._defaultOptions.insets`
  - 29 module-level `insets: new Insets(...)` default bags, e.g. `component/container/FieldSet.ts:34`, `component/container/StatusBar.ts:60`, `component/menubar/MenuBarButton.ts:60`
- **Evidence**:

      grep -rnE "\.(setTop|setRight|setBottom|setLeft)\(" packages/lib/src packages/lib/tests \
                packages/docs/src packages/create-app   → 1 hit, tests/unit/Insets.test.ts:21

  So every mutator is dead. That is the only reason the shared-default aliasing is not already a bug: `new FieldSet().getInsets().setTop(0)` would retune the top inset of every `FieldSet` and `LabeledFieldSet` in the process, because `_defaultFieldSetOptions.insets` (`FieldSet.ts:34`) is one instance shared by all of them. Twelve of the 29 defaults are `new Insets(0, 0, 0, 0)` — twelve identical allocations, twelve UUIDs, at import time.
  Secondary: the constructor normalises with `top || 0` (`:34-37`) *and* every getter repeats `this._top || 0` (`:45,65,85,105`) — a guard for a state the constructor already excluded, live only through the dead setters. `Point` guards the same concept with `?? 0` (`Point.ts:21-22,31,41`), and `tests/unit/primitive/Point.test.ts:19-21` records that divergence as deliberate — so the two primitives disagree about what a `NaN` coordinate means.
- **Proposed change**: make `Insets` immutable — delete the five mutators, keep the four getters (dropping the redundant `|| 0`), and add a frozen `Insets.ZERO` for the twelve zero defaults. That also makes `getContentInsets` safe to cache (F28.5 step 2) and `getInsets()` safe to keep returning the shared default.
- **Risk / blast radius**: `Insets` is public API on the `primitive` subpath; removing setters is breaking for external consumers. Internally nothing calls them. `tests/unit/Insets.test.ts:19` ("updates an edge through its setter") is the only test to drop.
- **Proof at implement time**: the grep above; plus the F28.5 allocation probe after `Insets.ZERO` lands.

---

### F28.13 Three permanent `Component` sentinels are constructed at module-eval time by the focus services

- **Category**: G, H
- **Impact**: LOW (three never-rendered components per process, counted as live, never disposed; paid by every app that imports anything from `core`)
- **Where**: `core/FocusTraversal.ts:29`, `core/FocusHistory.ts:67`, `core/SpatialNavigation.ts:214` — each `const _owner: Component = new Component();` at module scope. All three modules are re-exported from `core/index.ts:43,47,49`, so importing `@jimka/typescript-ui/core` evaluates all three.
- **Evidence**: `Component`'s constructor (`core/Component.ts:731-785`) runs unconditionally: an `ElementAttributes`, a `Map` for deferred style rules, `trackSelector(this._styleRule.getSelector())`, `resolveClassDefaults`, and `Diagnostics.noteComponentConstructed()` at `:784`. None of the three is ever disposed, so `Diagnostics`' live-component count — the counter `docs/concepts/performance.md:21` tells consumers to watch for leaks — starts at 3 and its three tracked selectors are never released. Construction is JS-only (no DOM), so this is a floor, not a per-frame cost.
- **Proposed change**: the sentinel is only a listener-identity key. Either give `Event` a way to register a viewport listener against a plain string owner id, or share one module-level sentinel across the three services (`core/Focusable.ts` is already the shared home for their common helpers and would be the natural place). Three separate ones buy nothing — the comment in each file explicitly says it copied the pattern from the other two.
- **Risk / blast radius**: `Event.addViewportListener` / `removeViewportListener` key on `component.getId()`, so a shared sentinel is fine as long as each service keeps passing its own distinct handler function (they do). Enable/disable tests in all three suites cover it.
- **Proof at implement time**: a probe reading `Diagnostics.counters` after importing `core` and asserting the live-component count is 0 (or 1).

---

### F28.14 `FocusHistory.isInTableCell` re-implements `ancestorsToDocument` with a different bound

- **Category**: I
- **Impact**: LOW (per focus event; depth `getTagName` calls, no layout forced)
- **Where**: `core/FocusHistory.ts:197-207` — a hand-rolled `for (let h = handle; h !== null; h = DOM.source.getParentNode(h))` loop, versus `core/Focusable.ts:39-49` `ancestorsToDocument`, which exists precisely to bound this walk at `documentElement` and is used by `FocusTraversal.findTabKeyOwner` (`:65`) and `SpatialNavigation.recordOrigin` (`:276`)
- **Evidence**: read from source. `ancestorsToDocument`'s own JSDoc (`Focusable.ts:32-36`) says it is "shared by every marker-attribute ancestor search in `FocusTraversal` and `SpatialNavigation`" — `FocusHistory` is the one ancestor search that does not use it, and it is unbounded, so for a `LayerManager`-portaled overlay it runs one step past `<html>` onto the `document` node (where `getTagName` reads an `undefined` `tagName` rather than throwing, which is why it has never surfaced).
- **Proposed change**: `for (const h of ancestorsToDocument(handle)) { if (tag === "TD" || tag === "TH") return true; }`. One line, same behaviour, bounded.
- **Risk / blast radius**: one caller (`onFocusIn`, `:228`). `tests/unit/core/FocusHistory.test.ts:470` pins the behaviour.
- **Proof at implement time**: the existing test staying green.

---

### F28.15 Two live "unbounded extent" sentinels

- **Category**: I
- **Impact**: LOW (correctness hazard around value dedup; code health)
- **Where**: `primitive/Size.ts:18` `UNBOUNDED = Number.MAX_SAFE_INTEGER`, `:29-31` `isUnbounded` (which explicitly "recognises the legacy `Number.MAX_VALUE` too"), `:42-44` `saturate` (caps at `MAX_SAFE_INTEGER`); against ~20 live `Number.MAX_VALUE` sites including this slice's `component/container/FieldSet.ts:135`
- **Evidence**: `grep -rn "UNBOUNDED" packages/lib/src` → 59 hits; `grep -rn "Number.MAX_VALUE" packages/lib/src` → ~20, in `FieldSet.ts:135`, `ScrollStrip.ts:820,826`, `TabBar.ts:2149,2152,2301,2304,2343,2356,2365,2390,2403`, `ToolBarSeparator.ts:78,81`, plus five demo-panel sites. The two values are not equal, and `Component.setMaxSize` (`core/Component.ts:3588-3592`) dedupes on exact numeric equality — so a maximum written as `Number.MAX_VALUE` and later re-derived through `saturate()` (which clamps to `MAX_SAFE_INTEGER`) compares unequal and gets rewritten. F28.3's probe shows the adjacent symptom: a `maxHeight: null` declaration re-queued every frame alongside `maxWidth`.
- **Proposed change**: mechanical replacement of every `Number.MAX_VALUE` extent with `UNBOUNDED`, then drop the legacy branch from `isUnbounded`'s contract once the sweep is complete.
- **Risk / blast radius**: wide but shallow and grep-complete. `primitive/Size.ts`'s own tests and `tests/component/container/*` cover the affected setters.
- **Proof at implement time**: `grep -rn "Number.MAX_VALUE" packages/lib/src` returning zero.

---

### F28.16 `mergeHandles` de-duplicates with `Array.includes`

- **Category**: G
- **Impact**: LOW (O(n·m) per arrow chord; only material once `rovingGroupMembers` returns a large set, which F28.4's fix would make more likely, not less)
- **Where**: `core/SpatialNavigation.ts:358-360` — `[...first, ...second.filter(handle => !first.includes(handle))]`
- **Evidence**: read from source. `first` is `visibleFocusable(root)` (every focusable in the document), `second` is `rovingGroupMembers(root)`. Handles are branded numbers, so a `Set` is a drop-in.
- **Proposed change**: build `new Set(first)` once and filter against it. Two lines.
- **Risk / blast radius**: one caller (`:533`). Order-preserving semantics are what the JSDoc promises and a `Set` preserves them.
- **Proof at implement time**: rides along with F28.2's probe.

---

### F28.17 `focusCandidates` skips the visibility filter its sibling helper applies

- **Category**: E, I
- **Impact**: LOW (per target-tier move — currently unreachable, see F28.6)
- **Where**: `core/Focusable.ts:120-128` `focusCandidates` calls `findFocusable` (`:92`, no visibility filter), while `visibleFocusable` (`:108`) filters on `isRenderedVisible`. `SpatialNavigation.targetLandings` (`:616-625`) and `tryFocusCandidates` (`:635-654`) consume the unfiltered list.
- **Evidence**: read from source. The failure mode is absorbed downstream — an invisible element silently refuses focus and `:645` `getActiveElement() === landing` catches it — but each such candidate costs a `FocusReveal.reveal` (an ancestor-containment scan over every registered revealer, `core/FocusReveal.ts:66-91`) and a `DOM.sink.focus` before being discarded.
- **Proposed change**: filter in `targetLandings`, not in `focusCandidates` — `Dialog`'s focus trap is the other consumer of the unfiltered helper and deliberately wants it.
- **Risk / blast radius**: `tests/unit/core/SpatialNavigation.test.ts:923` ("tries the next focusable descendant when the remembered one refuses focus") depends on the refuse-and-retry loop existing; filtering only shortens the list it walks.
- **Proof at implement time**: rides along with whichever plan settles F28.6.

---

## Entity inventory

| Entity | Stated function | Owns DOM | Per-layout-pass writes/reads | Verdict | Findings |
|---|---|---|---|---|---|
| `core/FocusTraversal` | Opt-in `Tab`/`Shift+Tab` interception with a Tab-key-owner stand-down and an `Escape` release | none (a sentinel `Component` at `:29`, never rendered); 2 viewport listeners while enabled | none — all work is per keypress: 1 `querySelectorAll` + n × `isRenderedVisible` (each an unbounded ancestor `getComputedStyle` walk) + n × `hasAttribute` | over-built | F28.1, F28.4, F28.13, F28.16 (surface), F28.6 (`wrap` + `configure` + `enable` unused) |
| `core/FocusHistory` | Records the chronological focus trail; `Alt+[` / `Alt+]` walk it | none (sentinel at `:67`); 2 viewport listeners while enabled | none; per focus event: 1 `intern`, 1 depth-bounded `getTagName` walk, 1 `ListenerBag` fire | fits | F28.13, F28.14 |
| `core/Focusable` | Shared focusable-element selector + the four helpers built on it | none (pure helpers over the seam) | none directly; the cost multiplier for both services | mismatch (selector does not implement its stated "every element the framework treats as focusable") | F28.1, F28.4, F28.17 |
| `core/RovingTabIndex` | Exactly one `tabindex=0` per group; `moveTo` transfers it and DOM focus | writes `tabindex` + `data-ts-ui-roving-member` on member components | none (event-driven); per `moveTo`: 1–2 attribute writes + 1 `focus()`, with no unchanged-value guard on the incoming write | fits, with a no-op hole | F28.8 |
| `core/SpatialNavigation` | Two arrow chords: nearest focusable (`component`), nearest marked container (`target`) | none (sentinel at `:214`); 2 viewport listeners while enabled; writes `data-ts-ui-focus-visible` | none; per chord: 2 `querySelectorAll`, n × `isRenderedVisible`, n × `getElementRect`, n × depth `getComputedOverflow`, up to n² `contains`; per focusout: 1 `intern` + 1 `removeAttr` | over-built (half the module serves an unused tier) | F28.1, F28.2, F28.6, F28.9, F28.16 |
| `component/container/FieldSet` | `<fieldset>` container with an embedded `Legend` title | its own `<fieldset>`; raw-appends the `Legend`'s element (`:264`); one `#id` rule each | 2 × `getPerimeterSize` → 2 × `legendClearance` (a live `offsetHeight` read until cached); 1 × `clampLegendWidth` → up to 2 stylesheet-rule declarations when the width changed | fits, with two hot-path holes | F28.3, F28.7, F28.15 |
| `component/container/LabeledFieldSet` | A `FieldSet` whose content is a `LabeledGrid` in a `Fit` | inherits `FieldSet`'s; adds one `LabeledGrid` child | delegates entirely; adds one `Fit` pass | fits | — (inherits F28.3, F28.7) |
| `component/container/LabeledGrid` | Chrome-less baseline-aligned title/field grid | a plain `<div>`; one `Text` label per field; empty `Component` spacers | ≈10 size queries per child per pass via `Grid.measureContent` (48 pref + 64 min + 48 max for 16 children); spacers pay the same | over-built (spacers) | F28.10 |
| `primitive/Axis` | `AxisOrientation`/`AxisPosition`/`AxisEnd`/`AxisSpread` vocabulary | none (types only) | none | fits | audit #8 now resolved — see below |
| `primitive/Border` | `BorderOptions` + `borderToStyle` / `borderSideWidth` | none | none (used by `core/BorderWidths.ts`, `core/ClassStyleRules.ts`) | fits | — |
| `primitive/Edge` | `HorizontalSide` / `VerticalSide` / `Edge` | none | none (10 use sites) | fits | — |
| `primitive/Insets` | Four pixel insets | none | one fresh instance (and one UUID) per `getContentInsets()` call, i.e. per container per pass | over-built (mutable, `BaseObject`-derived) | F28.5, F28.12 |
| `primitive/Placement` | Compass placement enum | none | none (205 use sites) | fits | — |
| `primitive/Point` | 2-D point | none | none | **dead** | F28.11 |
| `primitive/Position` | The three allowed CSS `position` values | none | none | fits | — |
| `primitive/Size` | `Size` + `UNBOUNDED` / `isUnbounded` / `saturate` | none | none | fits, with a split sentinel | F28.15 |
| `primitive/index` | Public `primitive` subpath barrel | none | none | fits (would shed `Point`) | F28.11 |

---

## Redundant, duplicated and dead code

Items not already carried as findings.

**Carried forward from `plans/research/codebase-health-audit-2026-08-29.md`, with current status:**

- **Priority 1 #3 — `FieldSet` / `LabeledFieldSet` leak their `Legend` on every dispose: CLOSED.** `component/container/FieldSet.ts:274-278` now has `protected destructor() { this._legend.dispose(); super.destructor(); }`, and `Component.dispose()` (`core/Component.ts:1001-1003`) routes straight to `destructor()`. `tests/component/dispose-full-teardown.test.ts:439` registers a `FieldSet` row (`{ name: 'FieldSet', covers: ['FieldSet'], make: () => new FieldSet('Group') }`). Landed in `c178da6b` "Dispose raw-appended children discarded or torn down mid-life". `LabeledFieldSet` extends `_FieldSet` and inherits it. No action.
- **Priority 2 #8 — two exported `AxisOrientation`s with incompatible unions: RESOLVED for both duplicates.** `grep -n "AxisOrientation" component/chart/ChartAxis.ts` → no hits (only `AxisRenderOptions` at `:41` remains); `grep -n "AnchorAxis" core/OverlayPosition.ts` → no hits, and `OverlayPosition.ts` now appears in the list of modules importing `primitive/Axis.ts`'s `AxisOrientation`. `primitive/Axis.ts:13` is once again the single declaration.
- **Priority 3 — `component/chart/ChartAxis.ts:41` `AxisRenderOptions`: STILL OPEN.** `grep -rn "AxisRenderOptions" packages/lib/src packages/lib/tests packages/docs/src` (excluding its own file) → **0**. Belongs to slice 26; flagged here because the audit paired it with the `primitive/Axis.ts` entry above.

**Found in this review:**

- **`rankInDirection` is public API with no consumer.** `grep -rn "rankInDirection" packages/lib/src packages/lib/tests packages/docs/src packages/create-app` → 8 hits, all inside `core/SpatialNavigation.ts` itself, plus the barrel export at `core/index.ts:49` and one comment line in its own test. Exported alongside `SpatialCandidate`, `SpatialDirection` and `SpatialTier` for an extension point nobody uses.
- **`FocusTraversal.enable()` has zero call sites in `packages/`.** `grep -rn "FocusTraversal.enable" packages/lib/src packages/docs/src packages/create-app` → 0 (only the JSDoc `{@link}` at `FocusTraversal.ts:11`). `main.ts:45-46` enables `FocusHistory` and `SpatialNavigation` but not this one, so the service ships exercised only by its own tests — which is also why the `FOCUSABLE_SELECTOR` defect of F28.4 has gone unnoticed in the demo.
- **`configure()` is dead on all three services.** `grep -rn "FocusTraversal.configure\|FocusHistory.configure\|SpatialNavigation.configure" packages/lib/src packages/docs/src packages/create-app` → 0 outside the defining modules. With it, `FocusTraversalOptions.wrap`, `FocusHistoryOptions.maxSize` / `back` / `forward`, and `SpatialNavigationOptions.componentModifiers` / `targetModifiers` are all configuration surface with no in-repo consumer. `docs/concepts/accessibility.md:138` documents `SpatialNavigation.configure({ componentModifiers: { alt: true } })` as the escape hatch for the GNOME `Ctrl+Alt`+arrow collision that `SpatialNavigation.ts:203-207` names — so this one is justified surface, not dead weight; the other two are not argued for anywhere.
- **`RovingTabIndex`'s `preventScroll` option has one consumer.** `grep -rn "preventScroll: true" packages/lib/src | grep RovingTabIndex` → `component/container/TabBar.ts:500`. One user, documented rationale (`RovingTabIndex.ts:45-52`); noted for completeness, not for removal.
- **Twelve identical zero-inset defaults.** `grep -rn "insets: *new Insets(0, 0, 0, 0)" packages/lib/src` → 12 (`IconText.ts:31`, `IconLabel.ts:32`, `NumberSpinner.ts:66`, `TabCloseButton.ts:31`, `FloatingPanel.ts:40`, `SpinButton.ts:54`, `AbstractSelectableList.ts:920`, `PickerColumn.ts:97`, and four more). Twelve allocations and twelve UUIDs at import time for one value; collapses to a frozen `Insets.ZERO` under F28.12.
- **Not a finding, checked and cleared:** I expected `Component.applyOptions`'s always-dispatch of `setTabKeyOwner` / `setNavigationTarget` (`core/Component.ts:841,845`) to queue two pointless `removeAttr` entries per component. Probe `28-…/marker-writes.test.ts` shows a freshly rendered plain `Component` emits `removeAttr: ["style"]` only — the queued marker removals never reach the sink. No action.
- **Missing return-type annotations** in slice files, against `CODE_CONVENTIONS.md`: `FieldSet.getTitle()` (`:91`), `FieldSet.getPerimeterSize()` (`:195`), `FieldSet.render()` (`:261`), `Insets.getTop/getRight/getBottom/getLeft` (`:45,65,85,105`), `Insets.render()` (`:142`), `Point.getX/getY/render` (`:31,41,49`). `Component.getPerimeterSize` (`core/Component.ts:3764`) has the same omission, so `FieldSet`'s is inherited style, not a local lapse.

---

## Cross-slice notes

- **→ 05 layout-base-box-flow-grid: `Grid.measureContent` is recomputed 3–5× per pass, and `baselineAlign` doubles the per-child queries.** `layout/Grid.ts:879-955` is called from `getPreferredSize` (`:375`), `getMinSize` (`:434`), `getMaxSize` (`:482`), `:597`, `doLayout`'s baseline branch (`:705`), and `layoutOccupancy` (`:970`) — each call walks every child issuing `getPreferredSize()` + `getMinSize()`, and in baseline mode additionally `getBaseline()` (`:933`), which `doLayout` then asks for a *second* time at `:736` along with a second `getPreferredSize()` at `:729`. Probe (mine, `28-…/form-layout-cost.test.ts`): one `LabeledGrid.doLayout()` with 16 children issues **48 `getPreferredSize` + 64 `getMinSize` + 48 `getMaxSize` = 160 size queries, ≈10 per child per pass**. De-duplicating `measureContent` within a single pass is worth more than anything in my own slice's containers. **This brushes `plans/two-phase-baseline-resolution.md`**, whose Architecture Decisions say "**Do not add a per-pass metrics cache** — that is speculative". I read that as forbidding a cache that survives *across* passes; collapsing several *identical calls inside one pass* is a different change and does not contradict it — but the plan's author should confirm, because two-phase adds a further `getBaselineMetrics()` sweep per baseline-aware manager on top of these ten.
- **→ 05 layout-base-box-flow-grid: baseline mode refuses explicit `col`/`row`.** `layout/Grid.ts:703-705`. That refusal is the sole reason `LabeledGrid` materialises spacer `Component`s (F28.10), and `LabeledGrid` is the library's only `baselineAlign` consumer.
- **→ 03 core-dom-seam-events: `DOMSource.isRenderedVisible` has no bound and no memo.** `core/DOM.ts:2612-2626` walks to the document root with a `getComputedStyle` per level, and is called once per candidate by `Focusable.visibleFocusable`. A `isRenderedVisibleWithin(handle, root)` overload (or returning the walk so callers can memoize shared ancestors) is the seam-level half of F28.1 and belongs in that slice's plan.
- **→ 01 core-component-lifecycle: `getContentInsets` allocates; `BaseObject` mints a UUID eagerly.** `core/Component.ts:2624-2634` and `core/BaseObject.ts:15-17` are the actual edit sites for F28.5; `primitive/Insets.ts` only has to become immutable for the cache to be safe.
- **→ 02 core-component-styling: `setMaxSize` queues a declaration for an unbounded axis.** F28.3's probe shows `maxHeight: null` re-queued every frame alongside a genuinely changing `maxWidth`. The dedup in `Component.setMaxSize` (`:3588-3592`) compares the pair, so a changed width drags the unchanged height's removal along into `flushStyleBag`. A per-key comparison at flush time would drop it.
- **→ 07 layout-tab-tabbar: `TabBar.onTabPressed` calls `moveTo` unconditionally.** `component/container/TabBar.ts:2049-2054`. Pressing the already-selected tab rewrites `tabindex` and re-`focus()`es (F28.8); the fix can live in `RovingTabIndex` or at this call site.
- **→ 14 text-and-small-display: `Legend`'s `Position.STATIC` carve-out is the reason `FieldSet` measures it with `offsetHeight`.** `component/container/Legend.ts:52` and `primitive/Position.ts:14-17` document the exception; `FieldSet.legendClearance` (`:210-239`) is the consequence (F28.7). Any change to how `Legend` sizes itself should reset `FieldSet._legendClearance`.
- **Seam contract I relied on and confirmed holds:** `docs/concepts/dom-seams.md`'s "handle equality reproduces element equality" — F28.9's proposed fix depends on it, and `core/DOM.ts`'s reverse `WeakMap` provides it.
- **Seam contract that does *not* hold as documented:** `docs/concepts/dom-seams.md` describes `DOM.source` as the read seam without distinguishing cached reads from live ones. `isRenderedVisible`, `getComputedOverflow`, `getElementRect` and `getOffsetSize` are all live, layout-forcing reads with no caching, and three of the four are called n-times-per-event from this slice. The seam gives no signal at the call site about which reads are cheap.

---

## Suggested plan grouping

**Plan A — "Focus candidate collection: one walk, one memo" (F28.1, F28.2, F28.16, and the `:691-692` gate from F28.6).**
One coherent change set inside `core/SpatialNavigation.ts` plus one bounded-visibility helper in `core/Focusable.ts` / `core/DOM.ts`. Everything here is internal — no public API, no observable behaviour change — and all of it is measured by a single probe (seam-call counts per keypress at n = 40/120/240). This is the largest payoff in the slice and should go first. Depends on slice 03 for the `isRenderedVisibleWithin` seam addition; coordinate, or land the memo inside `Focusable` first and add the seam overload in slice 03's own plan.

**Plan B — "`FOCUSABLE_SELECTOR` eligibility" (F28.4, F28.17, and the `withoutDecorativeGlyphs` deletion from F28.2's neighbourhood).**
Separately measurable and separately risky: it changes Tab order in every consuming app, and its acceptance tests already exist as four `it.todo`s in `tests/core/FocusTraversalCompositeWidgets.test.ts`. Run it **after** Plan A so the before/after candidate-count numbers are attributable. Note in the plan that the "owned by `plans/directional-panel-navigation.md`" blocker cited in that test file is stale — that plan is unimplemented and `SpatialNavigation.ts:205` calls it superseded.

**Plan C — "Insets allocation on the layout path" (F28.5, F28.12).**
Three edits: lazy `BaseObject` id, immutable `Insets` + `Insets.ZERO`, cached `Component.getContentInsets`. Measured on its own by the allocation probe and by ms/frame on the 2×2 editor-grid drag. Cross-slice (slice 01 owns `Component.ts` and `BaseObject.ts`) — best handed to slice 01's plan with this slice's probe attached, since `primitive/Insets.ts` is the smaller half. Breaking on the public `primitive` subpath, so it needs a changelog entry.

**Plan D — "FieldSet legend measurement and clamping" (F28.3, F28.7, plus `FieldSet.ts:135`'s share of F28.15).**
Self-contained in `component/container/FieldSet.ts`: clamp only when the title actually overflows, move the `offsetHeight` measurement out of the layout pass into a first-layout hook, invalidate the cache on `setTitle` and theme change, and switch to `UNBOUNDED`. One file, one probe (rule declarations per resize frame). Independent of A–C.

**Plan E — "Spatial navigation target tier: land it or retire it" (F28.6).**
Needs a decision from the user before any code moves, so it must not be folded into Plan A. Whichever way it goes, Plan A's `:691-692` gate is a prerequisite-free improvement that should ship with Plan A rather than wait for this.

**Too small to plan — should ride along:**
- F28.8 (`RovingTabIndex.moveTo` no-op guard) → with slice 07's `TabBar` work, or Plan B if that touches `RovingTabIndex`'s marker anyway.
- F28.9 (`onFocusOut` single-handle marker) → with Plan A; same file, same probe.
- F28.10 (`LabeledGrid` spacers) → with slice 05's `Grid` plan, since the real fix is baseline-mode explicit placement.
- F28.11 (delete `Point`) and F28.13 (share the service sentinel) → with whichever dead-code sweep plan the merge produces.
- F28.14 (`isInTableCell` → `ancestorsToDocument`) → one line, with Plan A.
- F28.15 (the `Number.MAX_VALUE` sweep) → a mechanical repo-wide pass of its own; grep-complete, so it needs no design work, but it touches `TabBar`, `ScrollStrip` and `ToolBarSeparator` and should not be smuggled into Plan D.

**Dependency order:** A → B (B's numbers depend on A's memo being in place); C independent; D independent; E gated on a user decision, with its one safe sub-change folded into A.

---

*Probes written for this review live in `.worktrees/_probes/28-focus-navigation-forms-primitives/` (`insets-alloc.test.ts`, `spatial-cost.test.ts`, `quadratic-and-writes.test.ts`, `form-layout-cost.test.ts`, `marker-writes.test.ts`) and run with*
`PROBE_DIR=.worktrees/_probes/28-focus-navigation-forms-primitives npx vitest run --config .worktrees/_probes/vitest.probe.config.ts --silent=false`.
*No file outside that directory and this report was modified.*
