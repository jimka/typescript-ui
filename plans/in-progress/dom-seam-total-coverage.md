# Total DOM-Seam Coverage — Enforced — Implementation Plan

## Overview

Extend the merged `DOMSink` / `DOMSource` seam ([core/DOM.ts](../src/typescript/lib/core/DOM.ts), documented in [docs/concepts/dom-seams.md](../docs/concepts/dom-seams.md)) so that **every** DOM interaction in the library funnels through it, and make future raw access a lint error. This is the firm directive: only [core/DOM.ts](../src/typescript/lib/core/DOM.ts) (and one irreducible production-measurement leaf in [core/Util.ts](../src/typescript/lib/core/Util.ts)) may touch a real DOM API. The plan **reverses** the "Deliberately un-seamed" section of [dom-seams.md:57-63](../docs/concepts/dom-seams.md#L57) — events, traversal, `getComputedStyle`, `scrollIntoView`, canvas, and globals are now all in scope.

The plan is **one artefact, two phases**:

- **Phase 1 — the enforcement rule first.** A new type-aware ESLint rule (`local/no-raw-dom`) whose violation set *is* the authoritative inventory — no separate manual audit. It flags any access whose receiver type derives from a DOM-lib type (`Element`/`Node`/`Document`/`Window`/`CSSStyleDeclaration`/`DOMTokenList`/…) plus the free DOM globals (`document`, `window`, `getComputedStyle`, `matchMedia`, `requestAnimationFrame`, …), exempting only [core/DOM.ts](../src/typescript/lib/core/DOM.ts) and the documented `Util` leaf. A **secondary check** (fixture corpus + independent cross-check) proves the rule has no false negatives. The rule lands at `warn` with a tracked baseline so CI stays green through Phase 2.
- **Phase 2 — migrate every violation.** Extend `DOMSink`/`DOMSource` with the methods each surfaced category needs, route every call site through them, rework `setStyle` to take the element (`setStyle(element, key, value)`) plus a sibling `setRuleStyle` for the rule-style path, relocate the `Util` measurement so the lone exemption is `core/DOM.ts`, shrink the baseline to zero, and flip the rule to `error`.

Why type-aware and not syntactic: a raw grep over `.style` returns **77** hits (many are `CSSStyleDeclaration` locals or data-object `.style`), `.contains` returns **23** (mostly `Element.contains` but mixed with `Set.contains`-style data calls), `.children`/`window.`/`.id`/`activeElement` are dominated by framework `Window` components, tree-node data models, `_options.id`, and the static `Tooltip.activeElement` field. The existing local rules (`no-element-style`, `forward-super-options`) are purely syntactic (AST name matching) and would massively over- and under-count here. Only the TypeScript type-checker distinguishes `el.style` from `cssDecl` or `optionsBag.style`, so "must not skip anything" requires type services.

---

## Architecture Decisions

### The rule is **type-aware**, gated to the lib, justified against the syntactic precedent

`local/no-raw-dom` uses typescript-eslint's type services: `context.sourceCode.parserServices.getTypeAtLocation(node)` on the *receiver* of every `MemberExpression`, `CallExpression`, and the binding source of every destructuring/`VariableDeclarator`. It reports when the receiver's type (or any type in its `extends` chain / union members) is one of the DOM-lib structural types:

`Element`, `HTMLElement`, `SVGElement`, `Node`, `Document`, `Window`, `DOMTokenList`, `NamedNodeMap`, `HTMLCollection`, `NodeList`, `MediaQueryList`, `CSSStyleSheet`, `CSSStyleRule` — resolved by symbol identity against the TS DOM lib, not by name string. **`CSSStyleDeclaration` is deliberately NOT in the flagged set**: `element.style` is already caught via its *element* receiver (the `el` in `el.style` is `HTMLElement`, flagged), and the only legitimate `CSSStyleDeclaration`-typed locals after migration live inside the seam (`writeDeclaration`, `getBorderWidths`) in `core/DOM.ts`; flagging the type as well would contradict the valid-corpus case `cssDecl.borderTopWidth` and is unnecessary for total coverage (so a user type *named* `Element` is not falsely flagged, and a subclass like `HTMLInputElement` *is* flagged via its base chain). Plus, by AST shape, the free DOM globals that have no element receiver: the identifiers `document` and `window` (resolved to the lib `Document`/`Window` globals), and the global calls `getComputedStyle`, `matchMedia`, `requestAnimationFrame`, `cancelAnimationFrame`. `CSS.escape` is **excluded** — it is a pure string utility with no DOM I/O ([Glyphs.ts:162/188](../src/typescript/lib/component/display/Glyphs.ts#L162)), so it is not DOM *interaction* and is out of the rule's scope; the directive is "all DOM interaction through the seam," and a stateless string escape touches no DOM.

This is the central design decision and it is **justified by the over-counting the inventory greps prove**: a syntactic rule cannot tell `el.style` (flag — element receiver) from a `CSSStyleDeclaration` local `cs.borderTopWidth` (not flagged — the type is out of the set, and after migration this read lives inside `getBorderWidths` in the seam) or `config.style` (a data object, never flag); cannot tell `element.contains(x)` from `set.contains`; cannot tell the global `window.matchMedia` from the framework `Window`-component `window.on("close", …)` in [Rail.ts:991](../src/typescript/lib/core/Rail.ts#L991); cannot tell `element.children` from a tree-node `node.children` ([Tree.ts:311](../src/typescript/lib/component/tree/Tree.ts#L311)) or `LayerManager` node `children` ([LayerManager.ts:348](../src/typescript/lib/core/LayerManager.ts#L348)). Type-awareness makes the rule catch everything *by construction* (any DOM-typed receiver, no name list to maintain) rather than chasing a hand-curated allow/deny list that silently rots.

**Hybrid carve-out (syntactic, not typed):** the bare `document` / `window` identifiers and the four global calls (`getComputedStyle`/`matchMedia`/`requestAnimationFrame`/`cancelAnimationFrame`) are matched by **AST identifier shape**, because they are free globals with no member-receiver to type-check — but the rule still confirms each resolves to the DOM-lib global symbol (not a shadowing local named `window`) before reporting, and **skips any identifier that is the operand of a `typeof`** (feature-detection guards like `typeof window` touch no DOM). Everything member-access-based is typed. This is the minimal, justified hybrid the brief invites: typed core for receivers, a few global-identifier checks for the receiver-less globals.

### Enabling type info in `eslint.config.js` — scoped, with the lint-time cost noted

[eslint.config.js](../eslint.config.js) currently sets only `languageOptions.parser: tseslint.parser` with **no** `parserOptions.project` — so type services are unavailable today. The typed rule needs them. Decision: add `languageOptions.parserOptions.projectService: true` (typescript-eslint 8's faster successor to `project`, already a dependency at `^8.0.0`) **only** on the config block that applies `local/no-raw-dom` (the `src/typescript/lib/**/*.ts` files). The other blocks (`no-element-style`, `forward-super-options`, `naming-convention`) stay untyped and pay nothing.

**Tradeoff (call it out):** type-aware linting builds a TS program, so `npm run lint` goes from milliseconds to a few seconds (one program build over ~172 lib files). This is acceptable because (a) `lint` is not on the hot dev loop, (b) `projectService` reuses one program across files, and (c) the typecheck already builds the same program for `tsc -p tsconfig.lib.json`. The rule-unit tests (`.test.mjs`) run the rule through `RuleTester` with an **inline** `parserOptions.project` pointed at a tiny fixture tsconfig, so they need no repo-wide program and stay fast.

### `local/no-raw-dom` ships at `warn` with a tracked **baseline file**, shrinking to zero

CI must not go red for the whole of Phase 2. Mechanism options considered: (a) rule at `warn` globally; (b) per-line `eslint-disable` with reasons; (c) a generated baseline/ignore file. **Decision: a baseline file** (`scripts/eslint/no-raw-dom.baseline.json`) listing the currently-known violation sites (file + ruleId + message-id), with the rule reporting at `error` for *new* sites and suppressing *baselined* ones. This is easier to track to zero than scattered disables (one file shrinks monotonically; a reviewer greps its length) and keeps real new violations as hard errors throughout Phase 2 (option (a)'s global `warn` would let new raw access slip in unnoticed; option (b) scatters the inventory across 30+ files and is un-greppable as a single shrinking list).

The baseline is generated once by a `--update-baseline` flag on the rule's companion script (run via an `npm run lint:baseline` entry) right after Phase 1's rule lands. Each Phase 2 migration step **deletes the now-green entries** from the baseline; the final step asserts the baseline is empty (`[]`) and flips the suppression off so the rule is plain `error`.

> Implementation note: ESLint has no built-in baseline in v9 core, so the baseline is implemented inside the rule itself — the rule reads `no-raw-dom.baseline.json` (a `Set` of `"<relpath>:<line>:<messageId>"` keys) at `create()` time and skips `context.report` for a keyed match. Simpler and dependency-free versus pulling in `eslint-nibble`/`@progfay/eslint-baseline`. The key is path+line+messageId (not raw line text) so reformatting a line doesn't silently un-baseline it; a Phase 2 edit that changes a baselined line's number is expected to also remove it from the baseline (that file is being migrated).

### Phase 2 keeps the seam **element-passing**, not id-handle-based

Every new method follows the existing precedent: live `Element`/`HTMLElement`/`Node` values are still passed in and (for `createElement` etc.) returned. The seam is *not* rewritten to id-handles or proxies — that virtualization is explicitly a **Non-Goal** (see below). New reads are synchronous and return plain data where feasible; new writes are one-way (worker-forwardable). Production implementations stay thin one-line pass-throughs.

### `setStyle` is reworked to take the element; `setRuleStyle` covers the rule-style path

Today `DOM.sink.setStyle(style: CSSStyleDeclaration, key, value)` is handed an already-resolved `CSSStyleDeclaration`. The `.style` read that resolves it happens **inside** `StyleTarget.write` ([StyleTarget.ts:99-104](../src/typescript/lib/core/StyleTarget.ts#L99)), which reads `this._target.style` at [StyleTarget.ts:34/79/94](../src/typescript/lib/core/StyleTarget.ts#L34) off `T extends { style: CSSStyleDeclaration }`. Those three `.style` reads are themselves DOM access the total-coverage rule must catch — so the `.style` resolution must move *into* the sink.

**Crucial wrinkle:** `StyleTarget<T>` is the shared base of **two** subclasses — `InlineStyle extends StyleTarget<HTMLElement>` ([StyleTarget.ts:326](../src/typescript/lib/core/StyleTarget.ts#L326)) writes to an element's inline `element.style`, and `StyleRule extends StyleTarget<CSSStyleRule>` ([StyleTarget.ts:249](../src/typescript/lib/core/StyleTarget.ts#L249)) writes to `CSSStyleRule.style` — **and a `CSSStyleRule` has no element.** A single `setStyle(element, …)` cannot cover the rule path. Decision: **two sink methods**, discriminated by target kind:

```typescript
setStyle(element: HTMLElement, key: string, value: string | null): void;     // resolves element.style internally
setRuleStyle(rule: CSSStyleRule, key: string, value: string | null): void;   // resolves rule.style internally
```

`StyleTarget.write` is made abstract (or the `_target.style` read is delegated to a per-subclass hook): `InlineStyle` calls `DOM.sink.setStyle(this._target, key, value)`, `StyleRule` calls `DOM.sink.setRuleStyle(this._target, key, value)`. Both production bodies share the identical custom-property/camelCase branch that lives in today's `ProductionDOMSink.setStyle` ([DOM.ts:386-400](../src/typescript/lib/core/DOM.ts#L386)) — extracted into a private `writeDeclaration(style, key, value)` helper the two call, so the logic is written once and the only difference is `element.style` vs `rule.style` resolution. This retires every `element.style` *write-resolution* through the seam while keeping the rule path covered.

**Perf (highest-risk item):** the inline-style write is on the MiscPanel slow-table hot path. The production `setStyle`/`setRuleStyle` stay monomorphic single-property methods (one `.style` read + one branch + one assignment), so the JIT inlines them exactly as it does the current `setStyle`. The extra method (`setRuleStyle`) does not add a polymorphic branch on the hot path: `InlineStyle` always calls `setStyle`, `StyleRule` always calls `setRuleStyle`, so each call site is monomorphic in its sink method. The `writeDeclaration` helper is a private monomorphic call both inline. Explicit perf verification (MiscPanel benchmark, DevTools open) is a required Phase 2 checkpoint.

> The **~77 raw `element.style.*` reads at call sites** the brief references are the structural-write sites in [Theme.ts](../src/typescript/lib/core/Theme.ts), [VirtualScroller.ts](../src/typescript/lib/component/container/VirtualScroller.ts), [Glyphs.ts](../src/typescript/lib/component/display/Glyphs.ts), table cover/row/body, `Util.select("body").style.pointerEvents`, and `DragManager`'s `document.body.style.cursor` — the one-shot, deliberately-raw-element style writes that never went through `StyleTarget`. These migrate to the new `DOM.sink.setStyle(element, key, value)` form (see categories below). The `StyleTarget`-resolved writes already ride the seam; this rework just moves the `.style` resolution off the three `StyleTarget` lines so they too stop being raw DOM access.

### The shared-stylesheet `CSSStyleSheet` / `CSSStyleRule` path is seamed, not exempt

`StyleTarget` does not only touch `element.style` — its `StyleRule` machinery walks the shared `<style id="Base">` sheet's `CSSStyleSheet`/`CSSStyleRule` members directly: `style.sheet` ([StyleTarget.ts:174](../src/typescript/lib/core/StyleTarget.ts#L174)), `sheet.cssRules` / `sheet.insertRule` in the rule lookup ([StyleTarget.ts:201-221](../src/typescript/lib/core/StyleTarget.ts#L201)), and `sheet.cssRules` / `rule.type` / `CSSRule.KEYFRAMES_RULE` / `rule.name` / `sheet.insertRule` in `ensureKeyframes` ([StyleTarget.ts:306-315](../src/typescript/lib/core/StyleTarget.ts#L306)). The total-coverage rule flags every one of these (`CSSStyleSheet`/`CSSStyleRule` are in the flagged set), so simply returning a *live* sheet for callers to walk would NOT retire them — the baseline could never reach `[]`. Decision: **relocate the rule-management primitives into the seam** so no call site touches a `CSSStyleSheet`/`CSSStyleRule` member:

- `sink.ensureStyleRule(selector: string): CSSStyleRule` — find-or-insert a rule for `selector` in the main sheet (encapsulating the `cssRules` walk + `insertRule`), returning the live `CSSStyleRule` the caller hands straight to `setRuleStyle`.
- `sink.ensureKeyframes(name: string, framesCss: string): void` — find-or-insert the `@keyframes name { … }` block (encapsulating the keyframes-rule scan + `insertRule`).
- The `_getMainSheet` bootstrap (create-or-find `<head>`/`<style id="Base">` and the `style.sheet` read) moves **into `core/DOM.ts`** as the private backing of those two methods, so the `document`/`head`/`.sheet` touches live in the sole exempt file.

The returned `CSSStyleRule` is a live object used only via `setRuleStyle` (already seamed) — consistent with the element-passing decision. This closes the one path that would otherwise keep the baseline non-empty. `StyleTarget`'s former `_getMainSheet` / rule-lookup / `ensureKeyframes` become thin forwards to the sink (or are deleted in favour of the sink methods); the earlier sketch of a `getMainStyleSheet()` returning a live sheet is **dropped** because it leaks the walk.

### `Util` measurement is the lone leaf — relocate it so the only exemption is `core/DOM.ts`

[core/Util.ts](../src/typescript/lib/core/Util.ts) holds the production canvas/probe text-measurement that `ProductionDOMSource.measureText`/`measureFontMetrics` already delegate to ([DOM.ts:506-513](../src/typescript/lib/core/DOM.ts#L506)): the canvas `getContext("2d")` ([Util.ts:366](../src/typescript/lib/core/Util.ts#L366)), the DOM `<span>` probes ([Util.ts:98/119/134/139/163/169-171](../src/typescript/lib/core/Util.ts#L98)), the probe `getComputedStyle` ([Util.ts:170](../src/typescript/lib/core/Util.ts#L170)), `getBoundingClientRect` ([Util.ts:136-137](../src/typescript/lib/core/Util.ts#L136)), the scrollbar-width bootstrap ([Util.ts:476-507](../src/typescript/lib/core/Util.ts#L476)), and the viewport read ([Util.ts:451-452](../src/typescript/lib/core/Util.ts#L451)).

Decision: **prefer relocating the irreducible measurement primitives into `core/DOM.ts`** (as private functions or `ProductionDOMSource` methods) so the **only** lint exemption is `core/DOM.ts`. Concretely, the canvas/probe/bootstrap bodies move next to `ProductionDOMSource`; `Util` keeps its pure-arithmetic public surface (`measureTextMetrics`, `lineHeightPx`, `opticalCenterOffset`, …) which calls back through `DOM.source`. If a clean relocation proves to fracture the measurement cache (`invalidateTextMetricsCache`, the `metricsCtx` singleton), **fall back to keeping `core/Util.ts` as the single documented leaf** the rule exempts (matching the existing dom-seams.md holdout language). The plan's default is one exemption (`core/DOM.ts`); the leaf is the documented fallback if relocation risk outweighs the purity gain. `Util.select` ([Util.ts:442](../src/typescript/lib/core/Util.ts#L442)) — a `document.querySelector` helper — has **two** caller shapes (the earlier sketch's "only pointer-events" claim was wrong): the eight `…style.pointerEvents` body drag-guards (→ `sink.setBodyPointerEvents`, globals category), and three element lookups — `Body.getElement` returning the `<body>` ([Body.ts:49](../src/typescript/lib/core/Body.ts#L49), → `source.getBody()`) and `Component.getElement`/`Component.sync`'s by-id lookup ([Component.ts:604](../src/typescript/lib/core/Component.ts#L604) and [Component.ts:3922](../src/typescript/lib/core/Component.ts#L3922), → a new `source.getElementById(id)`). With all callers rehomed, `Util.select` is **removed**, so its `document.querySelector` needs no exemption.

### Events ride a sink/source surface, mirroring the existing one-way-write / sync-read split

Per [ARCHITECTURE.md:9](../ARCHITECTURE.md#L9), the `Event` class is *already* the listener abstraction for component-routed DOM events; the genuinely-raw `addEventListener` sites are the **18** low-level native hooks the brief lists. These do not get folded into the `Event` pub-sub system (that would conflate the two surfaces ARCHITECTURE.md keeps separate); instead the **raw native hook itself** routes through new sink methods so the *DOM call* is seamed while the `Event` routing semantics are untouched:

- `sink.addListener(target, type, handler, options?)` / `sink.removeListener(target, type, handler, options?)` — the verbatim `element.addEventListener` / `removeEventListener`, including [Event.ts](../src/typescript/lib/core/Event.ts)'s own window-level capture hooks ([Event.ts:54/79/394/444](../src/typescript/lib/core/Event.ts#L54)), `Animation`'s `transitionend` ([Animation.ts:137/220/230](../src/typescript/lib/core/Animation.ts#L137)), `Tooltip`'s mouse hooks ([Tooltip.ts:414-447](../src/typescript/lib/core/Tooltip.ts#L414)), `Popover`'s ancestor `scroll` ([Popover.ts:884/896](../src/typescript/lib/core/Popover.ts#L884)), and `Glyph`'s `matchMedia(...).addEventListener` ([Glyph.ts:117](../src/typescript/lib/component/display/Glyph.ts#L117)).
- `sink.dispatchEvent(target, event)` — `Event.fireEvent`'s `element.dispatchEvent` ([Event.ts:193/195](../src/typescript/lib/core/Event.ts#L193)).
- `source.getActiveElement(): Element | null` — `document.activeElement` reads ([Dialog.ts:625/750/755](../src/typescript/lib/core/Dialog.ts#L625), [AutoCompleteField.ts:477](../src/typescript/lib/component/input/AutoCompleteField.ts#L477), [AbstractWindow.ts:756](../src/typescript/lib/core/AbstractWindow.ts#L756)).

`Event` listening on *self* via `Event.addListener(this, …)` is unchanged at call sites — only `Event.ts`'s internal `window.addEventListener` terminus moves to `sink.addListener`. The modelled source/sink no-op or record these (events have no offline geometry payoff but must be *seamed*, not skipped — the directive is total coverage).

### Traversal, computed style, canvas, globals, misc props each get a thin source/sink method

The directive puts the previously un-seamed categories in scope. Each maps to a thin method (full surface in **Public API**); the production body is the verbatim former call. Routing them gives the *seam totality* the directive demands and lets the modelled source answer (or stub) them offline:

- **Traversal** ([23 `.contains`](../src/typescript/lib/core/Menu.ts#L113) + [3 `querySelector(All)`](../src/typescript/lib/core/Dialog.ts#L726) + `closest`/`matches`/`parentElement`/`parentNode`): `source.contains(a, b)`, `source.querySelector(root, sel)`, `source.querySelectorAll(root, sel)`, `source.closest(el, sel)`, `source.matches(el, sel)`, `source.getParentElement(el)`, `source.getParentNode(node)`. (`AutoCompleteField.matches` [527](../src/typescript/lib/component/input/AutoCompleteField.ts#L527) is a **component method**, not `Element.matches` — the typed rule excludes it; verified.)
- **Computed style:** route the theme-var read `getComputedStyle(documentElement).getPropertyValue(varName)` at [Component.ts:2386](../src/typescript/lib/core/Component.ts#L2386) to the existing `source.getThemeVar(varName)` (the brief's missed theme-var read — verified: it is `var()`-fallback resolution inside `estimateBorderSideWidth`). The element-specific computed reads — `Component.getBorderSize`'s `getComputedStyle(element)` border widths ([Component.ts:2336](../src/typescript/lib/core/Component.ts#L2336)) and `Popover.collectScrollAncestors`'s overflow scan ([Popover.ts:914](../src/typescript/lib/core/Popover.ts#L914)) — get dedicated source methods returning plain data: `source.getBorderWidths(element): {top,right,bottom,left}` and `source.getComputedOverflow(element): {overflow,overflowX,overflowY}` (the `overflow` shorthand is included because [Popover.ts:914](../src/typescript/lib/core/Popover.ts#L914) tests all three — dropping it would silently narrow the scroll-ancestor check). The `Util` probe `getComputedStyle` ([Util.ts:170](../src/typescript/lib/core/Util.ts#L170)) stays inside the relocated measurement leaf.
- **Canvas:** `source.getCanvasContext(): CanvasRenderingContext2D | null` wrapping the `getContext("2d")` ([Util.ts:366](../src/typescript/lib/core/Util.ts#L366)) — part of the measurement relocation; or, if `Util` stays the leaf, it stays there.
- **Globals:** `source.matchMedia(query): { matches; addChangeListener(fn) }` for `Animation` ([Animation.ts:72](../src/typescript/lib/core/Animation.ts#L72)) and `Glyph` ([Glyph.ts:116-117](../src/typescript/lib/component/display/Glyph.ts#L116)); `sink.requestAnimationFrame(fn): number` / `sink.cancelAnimationFrame(handle)` for the **27** raf/caf sites (`Animation`, `SmoothScroller`, `VirtualScroller`, `AbstractWindow`, `Accordion`, `CollapseSupport`, `Dock`, `Component`; the baseline is the authoritative count); `source.getDocumentElement()` / `source.getBody()` / `source.getHead()` as the parent handles the **20+** `DOM.sink.appendChild(document.documentElement, …)` overlay sites already pass (those reads of `document.documentElement`/`document.body`/`document.head` are the only remaining raw `document` touches); `source.getViewportSize` already exists for `Util.getViewportSize` ([Util.ts:451-452](../src/typescript/lib/core/Util.ts#L451)); `source.elementsFromPoint(x, y)` for `DragManager` hit-testing ([DragManager.ts:397](../src/typescript/lib/core/DragManager.ts#L397)); a `sink.setBodyCursor(value)` + `sink.setBodyPointerEvents(value)` pair for `DragManager`'s `document.body.style.cursor` ([DragManager.ts:374/627](../src/typescript/lib/core/DragManager.ts#L374)) and the `Util.select("body").style.pointerEvents` drag-guards in `Scrollbar`/`SplitGutter`/`WindowBorder`/`cell/Header` (replacing `Util.select`); a `sink.applyRootThemeStyles(styles)` (or routing through `setStyle(documentElement, …)`) for [Theme.ts:1230-1236](../src/typescript/lib/core/Theme.ts#L1230)'s root/body style writes.
- **Misc element props:** `sink.setId(element, id)` for the `.id` writes ([StyleTarget.ts:170](../src/typescript/lib/core/StyleTarget.ts#L170), [Component.ts:1128/4477](../src/typescript/lib/core/Component.ts#L1128)); `source.hasAttribute(el, key)` / `source.getAttribute(el, key)` for the reads at [Component.ts:901/918](../src/typescript/lib/core/Component.ts#L901) and [Dialog.ts:726](../src/typescript/lib/core/Dialog.ts#L726); `sink.insertBefore(parent, node, ref)` for [Component.ts:675/709/4060](../src/typescript/lib/core/Component.ts#L675), [Popover.ts:778](../src/typescript/lib/core/Popover.ts#L778), [IconLabel.ts:101](../src/typescript/lib/component/tree/renderer/IconLabel.ts#L101); `sink.click(element)` for [FileField.ts:118](../src/typescript/lib/component/input/FileField.ts#L118) and [TableExporter.ts:153](../src/typescript/lib/component/table/TableExporter.ts#L153) (the `child.click()` in [ToolBar.ts:675](../src/typescript/lib/component/menubar/ToolBar.ts#L675) and `_textField.select()` in the cell editors are **Component methods**, excluded by type — verified); `sink.setDataset(el, key, value)` / `source.getDataset(el, key)` for [ListItem.ts:99](../src/typescript/lib/component/list/ListItem.ts#L99); `sink.createDocumentFragment()` for [Tree.ts:835](../src/typescript/lib/component/tree/Tree.ts#L835) / [Body.ts:709](../src/typescript/lib/component/table/Body.ts#L709); `source.getTagName(el)` for [Body.ts:943](../src/typescript/lib/component/table/Body.ts#L943); the **three `<select>` accesses** in `AbstractListComponent` — `source.getSelectedOptionDataset(select, "key")` for the option-by-index dataset read at [AbstractListComponent.ts:135](../src/typescript/lib/component/list/AbstractListComponent.ts#L135) (encapsulating `element[element.selectedIndex].dataset.key` in one method so the index-access on the `<select>` is seamed), `source.getSelectedIndex(select)` for the read at [AbstractListComponent.ts:145](../src/typescript/lib/component/list/AbstractListComponent.ts#L145), and `sink.setSelectedIndex(select, idx)` for the write at [AbstractListComponent.ts:160](../src/typescript/lib/component/list/AbstractListComponent.ts#L160); `source.getElementById(id)` for the by-id lookups in `Component.getElement`/`sync` ([Component.ts:604](../src/typescript/lib/core/Component.ts#L604)/[3922](../src/typescript/lib/core/Component.ts#L3922)) that today go through `Util.select("#"+id)`; `source.getFirstChild(node)` for the `popoverEl.firstChild` reference read at [Popover.ts:778](../src/typescript/lib/core/Popover.ts#L778). The shared-stylesheet bootstrap and its `CSSStyleSheet`/`CSSStyleRule` walk are covered by `sink.ensureStyleRule`/`ensureKeyframes` per the stylesheet decision above (not a live-sheet getter). `scrollIntoView` / `scrollTo`: a grep (below) confirms **no** raw `scrollIntoView`/`scrollTo` call sites currently exist in the lib (the only `scrollBy` hits are the framework `SmoothScroller.scrollBy`, not `Element` — correctly not flagged by the typed rule), so no method is added for them (Simplicity First — speculative API for zero callers is out); the rule still forbids any future one.

### Convention compliance and unavoidable deviations

`~/core/DOM.js` alias + `.js` extensions on every new import; JSDoc mirrors the existing seam entries exactly; plain-data returns where feasible (`{top,right,bottom,left}`, `{overflowX,overflowY}`, `{matches, …}`); one-way sink writes; synchronous source reads; production methods monomorphic and JIT-inlinable. The seam returns live `Element`/`CSSStyleRule`/`CanvasRenderingContext2D` in a few places (`createElement`, `getParentElement`, `querySelector`, `ensureStyleRule`, `getCanvasContext`) — this **already** matches the existing `createElement`/`createElementNS` returns and is sanctioned by the element-passing decision; the worker-virtualization that would replace live returns with handles is a Non-Goal. No `CODE_CONVENTIONS.md` rule is violated; the one architectural note is that **events stay split** (`Event` for routing, sink for the native terminus) rather than merging — consistent with [ARCHITECTURE.md:13](../ARCHITECTURE.md#L13).

---

## Public API (TypeScript Signatures)

Added to [core/DOM.ts](../src/typescript/lib/core/DOM.ts), exported from the core barrel ([core/index.ts:11-12](../src/typescript/lib/core/index.ts#L11)). Signatures only; JSDoc mirrors the existing entries.

```typescript
export interface DOMSink {
    // …existing…

    // Style rework — element- and rule-keyed (replaces the CSSStyleDeclaration-keyed setStyle):
    setStyle(element: HTMLElement, key: string, value: string | null): void;
    setRuleStyle(rule: CSSStyleRule, key: string, value: string | null): void;

    // Events (one-way):
    addListener(target: EventTarget, type: string, handler: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
    removeListener(target: EventTarget, type: string, handler: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void;
    dispatchEvent(target: EventTarget, event: Event): void;

    // Globals / scheduling:
    requestAnimationFrame(callback: FrameRequestCallback): number;
    cancelAnimationFrame(handle: number): void;

    // Structural / misc writes:
    setId(element: Element, id: string): void;
    insertBefore(parent: Node, node: Node, reference: Node | null): void;
    setDataset(element: HTMLElement, key: string, value: string): void;
    createDocumentFragment(): DocumentFragment;
    click(element: HTMLElement): void;
    setBodyCursor(value: string): void;
    setBodyPointerEvents(value: string): void;
    setSelectedIndex(element: HTMLSelectElement, index: number): void;

    // Shared-stylesheet rule management (encapsulates the CSSStyleSheet/CSSStyleRule walk;
    // the <head>/<style id="Base">/.sheet bootstrap is the private backing inside core/DOM.ts):
    ensureStyleRule(selector: string): CSSStyleRule;   // find-or-insert; returned rule goes to setRuleStyle
    ensureKeyframes(name: string, framesCss: string): void;
}

export interface DOMSource {
    // …existing…

    // Events / focus:
    getActiveElement(): Element | null;

    // Traversal:
    contains(ancestor: Node, node: Node | null): boolean;
    querySelector(root: ParentNode, selector: string): Element | null;
    querySelectorAll(root: ParentNode, selector: string): Element[];     // plain array, not live NodeList
    closest(element: Element, selector: string): Element | null;
    matches(element: Element, selector: string): boolean;
    getParentElement(element: Element): Element | null;
    getParentNode(node: Node): Node | null;

    // Computed style (plain data):
    getBorderWidths(element: Element): { top: number; right: number; bottom: number; left: number };
    getComputedOverflow(element: Element): { overflow: string; overflowX: string; overflowY: string };

    // Globals / environment:
    matchMedia(query: string): { matches: boolean; addChangeListener(fn: (matches: boolean) => void): void };
    getDocumentElement(): HTMLElement;
    getBody(): HTMLElement;
    getHead(): HTMLElement;
    getElementById(id: string): HTMLElement | null;
    elementsFromPoint(x: number, y: number): Element[];
    getCanvasContext(): CanvasRenderingContext2D | null;   // only if the Util leaf is relocated; else omitted

    // Misc reads:
    hasAttribute(element: Element, key: string): boolean;
    getAttribute(element: Element, key: string): string | null;
    getDataset(element: HTMLElement, key: string): string | undefined;
    getTagName(element: Element): string;
    getSelectedIndex(element: HTMLSelectElement): number;
    getSelectedOptionDataset(element: HTMLSelectElement, key: string): string | undefined;
    getFirstChild(node: Node): Node | null;
}
```

Test seam ([tests/dom/TestDOM.ts](../tests/dom/TestDOM.ts)): `RecordingDOMSink` records each new write (`addListener`/`dispatchEvent`/`requestAnimationFrame`/`setId`/`insertBefore`/`click`/… push `{op,args}`; `requestAnimationFrame` returns a fake handle and may invoke synchronously or no-op per the harness; `createDocumentFragment` returns a stub). `ModelledDOMSource` answers each new read: `getActiveElement` returns a modelled/null value, traversal answers from recorded stubs or returns null/empty/false, `getBorderWidths`/`getComputedOverflow` from injected config (defaulting to zeros / `"visible"`), `matchMedia` returns `{matches:false, addChangeListener: no-op}`, `getCanvasContext` returns a stub or null, `ensureStyleRule` returns a stub `CSSStyleRule` (with a `style` object) and `ensureKeyframes` is a no-op record, `elementsFromPoint` returns `[]`, `getSelectedIndex` returns `-1`, `getSelectedOptionDataset` returns `undefined`, `getElementById` returns `null` (or a recorded stub), `getFirstChild` returns `null`; `setSelectedIndex` is a recorded write. `makeStubElement` ([TestDOM.ts:53-69](../tests/dom/TestDOM.ts#L53)) currently has only `tagName`, `id`, `style`, `isConnected`, `scrollLeft`, `scrollTop`, `value`, `setAttribute`, `removeAttribute`, `getElementsByTagName`, `remove` — so it must **add** `getAttribute()`, `hasAttribute()`, `dataset`, `selectedIndex`, `firstChild`, and a `cloneNode`/`appendChild` no-op pair sufficient for the new modelled reads (the parenthetical "already present" was wrong; only `tagName` and `style` pre-exist).

The existing `setStyle(style: CSSStyleDeclaration, …)` recorder ([TestDOM.ts:82-84](../tests/dom/TestDOM.ts#L82)) changes signature to `setStyle(element: HTMLElement, …)` and gains `setRuleStyle(rule, …)`.

---

## Ordered Implementation Steps

### Phase 1 — the rule, the inventory, the secondary check

1. **Author `scripts/eslint/no-raw-dom.js`** — the type-aware rule per the Architecture Decisions. Receiver-type resolution via `parserServices.getTypeAtLocation`; DOM-lib type identity matched by symbol against `Element`/`Node`/`Document`/`Window`/`DOMTokenList`/`NamedNodeMap`/`HTMLCollection`/`NodeList`/`MediaQueryList`/`CSSStyleSheet`/`CSSStyleRule` and their subclasses (NOT `CSSStyleDeclaration` — caught via the element receiver, per Architecture Decisions); the receiver-less globals (`document`, `window`, `getComputedStyle`, `matchMedia`, `requestAnimationFrame`, `cancelAnimationFrame`) by identifier shape with a global-symbol confirmation (`CSS.escape` is deliberately NOT flagged — pure string utility, no DOM I/O). **The rule skips identifiers that are the operand of a `typeof`** (`typeof window`, `typeof window.matchMedia` at [Glyph.ts:116](../src/typescript/lib/component/display/Glyph.ts#L116)) — a `typeof` guard performs no DOM access, it is environment feature-detection, so it is not DOM interaction and needs no seam method. Message ids per category (`event`, `traversal`, `computedStyle`, `canvas`, `global`, `style`, `misc`) so the baseline and the docs can group them. The rule exempts `core/DOM.ts` (always) and the documented `Util` leaf (only if the Step-9 relocation keeps it). Baseline-suppression: read `no-raw-dom.baseline.json` at `create()`, skip `report` for keyed `"<relpath>:<line>:<messageId>"` matches.
2. **Author `scripts/eslint/no-raw-dom.test.mjs`** — the **secondary check (false-negative corpus)**. A `RuleTester` with an inline `parserOptions.project` against a fixture tsconfig, asserting EVERY access form is reported (see Verification for the enumerated corpus): direct read, direct write, method call, computed `el['scrollLeft']`, destructured `const { scrollLeft } = el`, aliased element (`const a = el; a.style…`), element returned from a helper (`getEl().style…`), `document`/`window` globals, `getComputedStyle`/`matchMedia`/raf, plus `valid` cases proving the over-counted shapes are NOT reported (`cssDecl.borderTopWidth`, `config.style`, `node.children` on a data type, `set.contains(x)`, the framework `Window`-component `window.on(…)`, the static `Tooltip.activeElement`, `component.matches(…)`, `button.click()` on a Component, and `CSS.escape(s)` — a pure string utility, not DOM interaction). Wired into `test:lint` in `package.json` ([package.json:102](../package.json#L102)).
3. **Wire the rule into `eslint.config.js`** — register `"no-raw-dom": noRawDom` under the `local/` plugin, add a `src/typescript/lib/**/*.ts` block with `languageOptions.parserOptions.projectService: true` and `rules: { "local/no-raw-dom": "error" }` (baseline handles the existing sites). → verify: `npm run lint` runs (slower, type-aware) and reports **zero** non-baselined errors.
4. **Generate the baseline.** Add an `npm run lint:baseline` script that runs the rule with a `--update-baseline` env flag (the rule writes every reported key to `no-raw-dom.baseline.json` instead of erroring). Commit the baseline — **this file is the authoritative inventory** (its grouped-by-messageId contents enumerate every category and count). → verify: `npm run lint` is green with the baseline in place; the baseline length matches the inventory below.
5. **Independent cross-check (no false negatives in the real tree).** Add an `npm run lint:dom-audit` script: an `ast-grep`/grep sweep that emits every DOM-lib-typed member access and global, reconciled against the rule's reported set. Acceptance criterion (assert in the script, fail non-zero on mismatch): **every DOM access in `src/typescript/lib` is either inside `core/DOM.ts` (or the documented `Util` leaf) or present in the rule's output (baseline ∪ live errors).** Two independent mechanisms agreeing is the proof the rule skips nothing.

> End of Phase 1: the baseline file is the inventory; the corpus + cross-check prove totality. No source behaviour has changed.

### Phase 2 — migrate every violation (each step removes its sites from the baseline)

6. **Rework `setStyle` + add `setRuleStyle`; seam the stylesheet rule path.** Extend `DOMSink` per the API; extract `writeDeclaration(style,key,value)` shared by both production bodies; make `StyleTarget` resolve `.style` in the subclass (`InlineStyle`→`setStyle(this._target,…)`, `StyleRule`→`setRuleStyle(this._target,…)`) so [StyleTarget.ts:34/79/94/99-104](../src/typescript/lib/core/StyleTarget.ts#L34) no longer read `.style`. Relocate the `CSSStyleSheet`/`CSSStyleRule` rule management into the seam: move the `_getMainSheet` bootstrap ([StyleTarget.ts:152-174](../src/typescript/lib/core/StyleTarget.ts#L152)), the rule lookup ([201-221](../src/typescript/lib/core/StyleTarget.ts#L201)), and `ensureKeyframes` ([306-315](../src/typescript/lib/core/StyleTarget.ts#L306)) into `ProductionDOMSink.ensureStyleRule`/`ensureKeyframes` (the `<head>`/`.sheet`/`cssRules`/`insertRule` touches now live in `core/DOM.ts`); `StyleRule` calls `DOM.sink.ensureStyleRule(selector)` and hands the returned rule to `setRuleStyle`. Update `RecordingDOMSink` signatures. → verify: typecheck; app renders identically; theme/keyframe animations still apply; **MiscPanel slow-table perf benchmark unmoved (DevTools open)**; remove the StyleTarget style + stylesheet entries from the baseline.
7. **Migrate raw `element.style.*` write sites** to `DOM.sink.setStyle(element, key, value)`: `Theme.ts` root/body writes ([1230-1236](../src/typescript/lib/core/Theme.ts#L1230)), `VirtualScroller` setup + transform ([80-95/365-374](../src/typescript/lib/component/container/VirtualScroller.ts#L80)), `Glyphs` sprite ([120-123](../src/typescript/lib/component/display/Glyphs.ts#L120)), table `Header`/`Row`/`Body`/`cell/Header` covers + selection styles, `Tree` row styles, `layout/Table` cover, and the `document.body.style.cursor` / `…pointerEvents` drag-guards via `setBodyCursor`/`setBodyPointerEvents`. → verify: theme toggle, virtual scroll, glyph sprite, table headers/selection, drag cursor all render; remove these `style` entries from the baseline.
8. **Add + route the event seam** (`addListener`/`removeListener`/`dispatchEvent`, `getActiveElement`): `Event.ts` window hooks + `dispatchEvent`, `Animation`, `Tooltip`, `Popover`, `Glyph`, and the `document.activeElement` reads. → verify: clicks/keyboard/hover/transitions/dialog focus-trap all work; remove `event` entries.
9. **Relocate the `Util` measurement leaf into `core/DOM.ts`** (canvas/probe/bootstrap/`getComputedStyle(probe)`), or — fallback — document `core/Util.ts` as the lone exemption and add it to the rule's exempt set. (`Util.select` is removed in Step 10 once its element-lookup callers move to `getBody`/`getElementById` — not here.) → verify: text metrics + baselines unchanged (±1px); scrollbar width + viewport size unchanged; remove `canvas`/measurement entries (or record the documented leaf).
10. **Add + route traversal + computed-style + globals + misc methods** across the surfaced sites (Menu/Tooltip/Tree/TabBar/Body/Notification/LayerManager/Window/AbstractWindow/Dialog `contains`; `querySelector(All)` in Glyphs/Dialog; `getParentElement`/`getParentNode`; `getBorderWidths`/`getComputedOverflow`; `matchMedia`; raf/caf across the 27 sites; `getDocumentElement`/`getBody`/`getHead`/`getElementById`/`elementsFromPoint`; `setId`/`insertBefore`/`setDataset`/`getDataset`/`hasAttribute`/`getAttribute`/`getTagName`/`getSelectedIndex`/`setSelectedIndex`/`getSelectedOptionDataset`/`getFirstChild`/`click`/`createDocumentFragment`; `Component.getBorderSize` 2336 + theme-var 2386). Re-home the `Util.select` callers here too: `Body.getElement`→`getBody`, `Component.getElement`/`sync`→`getElementById`, the body pointer-events guards→`setBodyPointerEvents`; then delete `Util.select`. → verify per category against the demo screens; remove `traversal`/`computedStyle`/`global`/`misc` entries.
11. **Extend `tests/dom/TestDOM.ts`** — `RecordingDOMSink` records all new writes; `ModelledDOMSource` answers all new reads (events no-op/record, traversal from stubs/null, `getActiveElement` modelled, `matchMedia`/`getCanvasContext`/`ensureStyleRule` stubbed, `ensureKeyframes` no-op, computed reads from injected config); extend `makeStubElement` (`getAttribute`/`hasAttribute`/`dataset`/`selectedIndex`/`firstChild`, `createDocumentFragment` stub). → verify: existing offline geometry/baseline checks still pass; a smoke check asserts a recorded new write + a modelled new read.
12. **Retire the baseline to zero + flip to `error`.** Assert `no-raw-dom.baseline.json` is `[]`; remove the baseline-suppression read from the rule (or leave it inert) so `local/no-raw-dom` is a plain `error`; the only exempt path is `core/DOM.ts` (+ the documented `Util` leaf if kept). → verify: `npm run lint` green with an **empty** baseline; the cross-check (`lint:dom-audit`) reports every DOM access inside the exempt files only.
13. **Docs.** Rewrite [dom-seams.md](../docs/concepts/dom-seams.md): delete the "Deliberately un-seamed" section ([57-63](../docs/concepts/dom-seams.md#L57)), replace the "Documented production-only holdouts" with "the seam is total — only `core/DOM.ts` touches the DOM" plus the full method list grouped by category, and update the verification-grep inventory. Update [ARCHITECTURE.md:103-107](../ARCHITECTURE.md#L103) "Minimize direct DOM access" to state the lint rule now enforces totality, and touch up [ARCHITECTURE.md:9](../ARCHITECTURE.md#L9) (which still reserves raw `addEventListener` for the `Event` module) so it agrees with the new reality — the native terminus is now `sink.addListener`, whose production body is the raw call. → verify: `npm run docs:build` 0 errors / 0 link warnings.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `scripts/eslint/no-raw-dom.js` (type-aware rule + baseline suppression) |
| Create | `scripts/eslint/no-raw-dom.test.mjs` (false-negative corpus — secondary check) |
| Create | `scripts/eslint/no-raw-dom.baseline.json` (generated inventory; shrinks to `[]`) |
| Create | `scripts/eslint/fixtures/tsconfig.json` (+ tiny fixtures) for the rule tester's type info |
| Modify | `eslint.config.js` (register rule + `projectService` on the lib block) |
| Modify | `package.json` (`test:lint` += no-raw-dom test; `lint:baseline`, `lint:dom-audit` scripts) |
| Modify | `src/typescript/lib/core/DOM.ts` (new sink/source methods; `setStyle` rework + `setRuleStyle` + `writeDeclaration`; relocated `Util` measurement leaf) |
| Modify | `src/typescript/lib/core/index.ts` (any new exported return types) |
| Modify | `src/typescript/lib/core/StyleTarget.ts` (`.style` resolves in subclass; `setId`; stylesheet rule-lookup/keyframes/`_getMainSheet` relocate to `sink.ensureStyleRule`/`ensureKeyframes`) |
| Modify | `src/typescript/lib/core/Util.ts` (measurement relocated / documented leaf; remove `Util.select`; viewport already seamed) |
| Modify | `src/typescript/lib/core/Event.ts` (window hooks + `dispatchEvent` via sink) |
| Modify | `src/typescript/lib/core/Component.ts` (`.id`, `insertBefore`, `hasAttribute`/`getAttribute`, `getBorderWidths`, theme-var 2386, raf) |
| Modify | `src/typescript/lib/core/Theme.ts` (root/body style writes via sink) |
| Modify | `src/typescript/lib/core/{Animation,Tooltip,Popover,Menu,Dialog,Notification,LayerManager,Window,AbstractWindow,Rail,DragManager,SmoothScroller,Dock,AnimatedDropdown,Drawer}.ts` (events, traversal, globals, raf, computed-overflow, elementsFromPoint, body cursor) |
| Modify | `src/typescript/lib/layout/{Accordion,CollapseSupport,Border,Split,Table}.ts` (raf, parentNode, cover style) |
| Modify | `src/typescript/lib/component/**` — `Glyph`, `Glyphs`, `VirtualScroller`, `Scrollbar`, `SplitGutter`, `WindowBorder`, table `Header`/`Row`/`Body`/`cell/Header`/`TableExporter`, `Tree`/`TreeBody`/`TreeRow`/`renderer/IconLabel`, `AutoCompleteField`, `FileField`, `ListItem`/`AbstractListComponent`, `ToolBar`, `DropZoneOverlay`/`DragFeedback`/`ReorderIndicator`/`DragGhost` (per-category routing) |
| Modify | `tests/dom/TestDOM.ts` (record new writes; model new reads; extend stub) |
| Modify | `docs/concepts/dom-seams.md` (rewrite un-seamed → total) |
| Modify | `ARCHITECTURE.md` ("Minimize direct DOM access" → lint-enforced totality) |

---

## Verification

**Phase 1**
- `npm run test:lint` — the new `no-raw-dom.test.mjs` passes alongside the two existing rule tests. The corpus asserts ALL of these are **reported**: `el.style.width = "1px"` (write), `const c = el.style` (read), `el.classList.add("x")` (method), `el["scrollLeft"]` (computed), `const { scrollLeft } = el` (destructure), `const a = el; a.scrollTop` (alias), `getEl().style.top` (helper return), `document.activeElement` / `window.innerWidth` (globals), `getComputedStyle(x)` / `matchMedia(q)` / `requestAnimationFrame(fn)` (global calls), `el.addEventListener(...)`, `el.contains(y)`, `el.querySelector(s)`, `el.getAttribute(k)`, `el.dataset.key`. And ALL of these are **NOT reported** (`valid`): `cssDecl.borderTopWidth` (a `CSSStyleDeclaration` local), `config.style` (data object), `treeNode.children` (data type), `mySet.contains(x)` (non-Element), `windowComponent.on("close", fn)` (framework `Window`), `Tooltip.activeElement` (static field), `component.matches(s)` (Component method), `button.click()` (Component method).
- `npm run lint` — green with the committed baseline (type-aware; expect a multi-second program build, the noted tradeoff).
- `npm run lint:dom-audit` — the independent cross-check reports every DOM access is inside `core/DOM.ts` / the documented `Util` leaf or in the rule's output; exits zero.
- The baseline file enumerates the inventory, grouped by messageId (events, traversal, computedStyle, canvas, global, style, misc).

**Phase 2**
- `npm run typecheck` — clean after each migration batch.
- `npm run lint` — green throughout (each step removes only now-green baseline entries); the **final** state: `no-raw-dom.baseline.json` is `[]` and the rule is `error`.
- Category greps return zero outside `core/DOM.ts` (+ documented `Util` leaf): `grep -rnE '\.(addEventListener|removeEventListener|dispatchEvent)\(' …`, `getComputedStyle\(`, `\.getContext\(`, `\b(matchMedia|requestAnimationFrame|cancelAnimationFrame)\(`, `\bdocument\.`/`\bwindow\.(matchMedia|innerWidth|innerHeight|active)`, `\.querySelector`, `\.contains\(` (typed-Element only), `\.style\b` — each filtered to exclude `DOM.sink.`/`DOM.source.`/comments, as in [dom-sink-source.md](implemented/dom-sink-source.md). The *authoritative* check is the empty baseline + clean `lint:dom-audit`; the greps are the human-readable corroboration.
- `npm run test` (vitest) — existing offline geometry + baseline checks pass; a new smoke check round-trips one new write/read through the test seam.
- App renders/behaves identically on every demo screen: theme toggle, drag (cursor + hit-test), tooltips, dialog focus-trap, virtual scroll, glyph sprites, table selection/headers, tree, autocomplete, file field, picker.
- **MiscPanel slow table: benchmark unmoved with DevTools open** (the `setStyle` rework perf gate).
- `npm run docs:build` — 0 errors, 0 link warnings (typedoc TS-version notice excepted).

---

## Documentation Impact

- The new `DOMSink`/`DOMSource` methods extend already-exported interfaces; any new plain-data return shapes that become named interfaces (e.g. a `BorderWidths`) export from [core/index.ts](../src/typescript/lib/core/index.ts) with `@category Core`. Most returns are inline object literals needing no new symbol.
- [docs/concepts/dom-seams.md](../docs/concepts/dom-seams.md): delete "Deliberately un-seamed", rewrite "Documented production-only holdouts" into a "the seam is total" statement + full categorised method list + the lint-rule discipline; refresh the verification-grep inventory.
- [ARCHITECTURE.md](../ARCHITECTURE.md) "Minimize direct DOM access" ([103-107](../ARCHITECTURE.md#L103)): state that `local/no-raw-dom` now lint-enforces totality and `core/DOM.ts` is the sole DOM-touching module.
- The ESLint rule docs string (in `no-raw-dom.js` `meta.docs.description`) documents the type-aware contract and the two exempt files, matching the precedent in [no-element-style.js](../scripts/eslint/no-element-style.js).
- No new component/recipe page; this is infrastructure. No cross-bucket `{@link}` issues (all symbols in `core`).

---

## Potential Challenges

- **Phase ordering** — the rule must land and baseline *before* migration so the violation set is the inventory; mitigation: Steps 1-5 are strictly before any source migration, and the baseline keeps CI green meanwhile.
- **Baseline-to-zero discipline** — a migration step that forgets to delete its baselined entries leaves dead suppressions; mitigation: Step 12 asserts the baseline is `[]`, and `lint:dom-audit` fails if any baselined key no longer corresponds to a live (now-removed) violation.
- **Typed-rule lint-time cost** — `projectService` builds a TS program; mitigation: scoped to the one lib block, off the hot dev loop, reusing the same program shape as `typecheck`; rule tests use a tiny fixture tsconfig, not the repo program.
- **`setStyle` rework perf + rule-style path** — the inline write is the hot path and `CSSStyleRule` has no element; mitigation: two monomorphic methods (`setStyle`/`setRuleStyle`) sharing one private `writeDeclaration`, each call site monomorphic in its method, guarded by the MiscPanel benchmark.
- **`Util` leaf relocation vs cache** — moving the canvas/probe code may fracture `metricsCtx`/`invalidateTextMetricsCache`; mitigation: relocate the whole measurement unit (cache included) into `core/DOM.ts`, or fall back to the documented single `Util` leaf exemption.
- **False positives from third-party DOM-lib subtypes** — `HTMLInputElement`/`SVGSVGElement` etc. must flag (they derive from `Element`); a user type accidentally structurally matching `{ style }` must not; mitigation: match by the DOM-lib **symbol** (declared-type identity), not structural shape, and cover both in the corpus.
- **Events that legitimately stay raw inside `Event.ts`** — `Event.ts`'s own window terminus is now a sink call, but the sink's *production* body still calls `window.addEventListener`; that body is inside `core/DOM.ts`, the sole exempt file, so no contradiction.

---

## Critical Files

- [core/DOM.ts](../src/typescript/lib/core/DOM.ts) — the seam to extend; existing `DOMSink`/`DOMSource`/`Production*` shape + JSDoc to mirror; `setStyle` body ([386-400](../src/typescript/lib/core/DOM.ts#L386)) to refactor; `getThemeVar` ([516-518](../src/typescript/lib/core/DOM.ts#L516)) the theme-var read 2386 routes to.
- [core/StyleTarget.ts](../src/typescript/lib/core/StyleTarget.ts) — `StyleTarget<T extends {style}>` ([21](../src/typescript/lib/core/StyleTarget.ts#L21)), the `.style` reads ([34/79/94](../src/typescript/lib/core/StyleTarget.ts#L34)) and `write` ([99-104](../src/typescript/lib/core/StyleTarget.ts#L99)), `InlineStyle` ([326](../src/typescript/lib/core/StyleTarget.ts#L326)) / `StyleRule` ([249](../src/typescript/lib/core/StyleTarget.ts#L249)) split, `_getMainSheet` ([153-174](../src/typescript/lib/core/StyleTarget.ts#L153)), `style.id` ([170](../src/typescript/lib/core/StyleTarget.ts#L170)).
- [scripts/eslint/no-element-style.js](../scripts/eslint/no-element-style.js) + [.test.mjs](../scripts/eslint/no-element-style.test.mjs) and [forward-super-options.js](../scripts/eslint/forward-super-options.js) — the local-rule precedent (flat config, `local/` plugin, sibling `.test.mjs`, `RuleTester`).
- [eslint.config.js](../eslint.config.js) — flat config; the per-block `files`/`rules` pattern; **no `parserOptions.project` today** (must be added for the typed rule).
- [tests/dom/TestDOM.ts](../tests/dom/TestDOM.ts) — `RecordingDOMSink`/`ModelledDOMSource`/`makeStubElement`/`installTestDOM` to extend.
- [plans/implemented/dom-sink-source.md](implemented/dom-sink-source.md) + [dom-seam-scroll-focus-input.md](implemented/dom-seam-scroll-focus-input.md) — the two prior seam plans whose conventions (one-way writes, plain-data reads, JIT-monomorphic pass-throughs, grep-inventory style) this plan matches.
- [core/Util.ts](../src/typescript/lib/core/Util.ts) — the measurement leaf (`getContext` 366, probes 98/119/134-139/163-171, scrollbar bootstrap 476-507, viewport 451-452) to relocate or document; `Util.select` ([442](../src/typescript/lib/core/Util.ts#L442)) to remove.

---

## Non-Goals

- **The worker transport / id-handle virtualization.** The seam stays element-passing (live `Element`/`CSSStyleSheet`/`CanvasRenderingContext2D` still cross it); replacing live nodes with serialisable handles and adding a `postMessage` boundary is a separate future, explicitly out.
- **Folding the raw native event hooks into the `Event` pub-sub system.** The two surfaces stay split per [ARCHITECTURE.md:13](../ARCHITECTURE.md#L13); only the native DOM terminus is seamed.
- **`scrollIntoView` / `scrollTo` methods** — a grep confirms zero raw call sites in the lib today; no speculative API is added (the rule still forbids future ones).
- **Refactoring the inline-arrow handlers on the re-routed listener sites** — `sink.addListener` fronts only the native `addEventListener` *terminus*; the local closures passed at e.g. [Animation.ts:137/220](../src/typescript/lib/core/Animation.ts#L137) are untouched (Surgical Changes), and ARCHITECTURE.md:23's named-handler guidance for the raw escape hatch is unchanged — not re-litigated here.
- **Adopting typescript-eslint's broader `recommended` preset** — out of scope; the typed program is enabled only for `local/no-raw-dom`, per the existing [eslint.config.js](../eslint.config.js#L4) comment deferring the preset cleanup.
- **Migrating demo-app code under `src/typescript/*` (non-`lib`)** — the rule and migration are scoped to `src/typescript/lib/**`, matching the existing rule scoping.
- **Removing the `Util` measurement leaf's irreducible browser dependency** — it is relocated into `core/DOM.ts` or kept as the lone documented exemption; the canvas/probe measurement itself is not rewritten.
