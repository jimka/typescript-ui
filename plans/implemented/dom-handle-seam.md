# DOM Handle Seam — Implementation Plan

## Overview

Today `core/DOM.ts` is the only module that *touches* the DOM, but the library still *holds* live `Element`/`Node` pointers: ~81 element-typed declarations across the lib, ~350 inbound seam call sites that pass an element in, and 13 source methods that hand a live element back out ([DOM.ts:523-751](../src/typescript/lib/core/DOM.ts#L523)). Every one of those 13 returns is a *leak* — a live node escaping the seam.

This plan completes the seam by promoting the validated **opaque-handle** shapes from the prototype ([HandleSeam.prototype.ts](../src/typescript/lib/core/HandleSeam.prototype.ts)) into the real `DOMSink`/`DOMSource`: a branded `Handle = number`, a `HandleRegistry` (forward `Map<Handle, Node | WeakRef<Node>>` + reverse `WeakMap<Node, Handle>`) living inside `core/DOM.ts`, a strong-`retain` / weak-`intern` / `resolve` / `release` lifecycle, and a batched `apply(handle, ElementPatch)` primitive for the hot layout-commit path. Once landed, no `Element`/`Node` ever crosses the seam boundary, making every seam call `postMessage`-serialisable — the worker-transport endgame the [DOM.ts comments](../src/typescript/lib/core/DOM.ts#L86) already gesture at.

The migration touches: `core/DOM.ts` (the seam itself), `core/StyleTarget.ts` (the inline-style flush becomes a batched patch), `core/Component.ts` (`_element`/`_clipFrame`/`_contentFrame` become handles), `core/Event.ts` (event-target interning + the subtree parent walk), `tests/dom/TestDOM.ts` (recording sink + modelled source speak handles), the `local/no-raw-dom` rule (tightened to flag *holding* an element type), and the docs. The 8 identity-comparison sites and the ~13 created-element lifecycle releases are the realistic risk; the other ~330 inbound calls are mechanical.

---

## Architecture Decisions

### A `Handle` is a branded `number`; everything is a uniform numeric handle

Promote the prototype's `type Handle = number & { readonly __handleBrand: unique symbol }` verbatim ([HandleSeam.prototype.ts:41](../src/typescript/lib/core/HandleSeam.prototype.ts#L41)). A raw `number` cannot be passed where a `Handle` is expected, and the live `Node` never escapes. Every element reference in the library becomes a `Handle`.

**Rejected: component roots keyed by string id.** Component roots already carry a stable string `id`, and `Component._element` ([Component.ts:201](../src/typescript/lib/core/Component.ts#L201)) is a cache of `getElementById(getId())` ([Component.ts:603-616](../src/typescript/lib/core/Component.ts#L603)). It is tempting to make a root's "handle" simply its id string and skip a registry entry for the ~80% common case. **Reject it** — for three reasons:

1. **Type safety collapses.** A `Handle = number | string` union defeats the brand: every consumer would need to discriminate, and `apply`/`resolve` would branch on the type. The single-shape numeric handle is what makes the seam mechanically migratable.
2. **Canonicalization still needs the registry.** The 8 identity sites compare a *stored child handle* against an *event-target handle*; the event target arrives as a raw `Node` and must be interned to a numeric handle regardless. A string-id fast path doesn't help there.
3. **The registry cost is bounded and weak.** A root entry is one strong forward `Map` slot plus one reverse `WeakMap` slot, minted lazily on first `getElement`. The forward map holds at most one entry per *live* component (released at dispose); the reverse map is weak. This is far smaller than the per-frame allocation churn the framework already tolerates.

`Component` keeps `getId()` as its public identity (id strings still key `Event`'s listener buckets and the `#id` style selectors); the handle is the *element* reference, minted from `getElementById` inside `getElement`.

### `HandleRegistry` lives inside `core/DOM.ts`, owned by the sink and shared with the source

Promote `HandleRegistry` ([HandleSeam.prototype.ts:88-214](../src/typescript/lib/core/HandleSeam.prototype.ts#L88)) into `core/DOM.ts` as a module-private class. Both `ProductionDOMSink` and `ProductionDOMSource` need it — the sink to `retain`/`release`/`resolve` for writes, the source to `intern` browser-supplied nodes and `resolve` for reads. A single registry instance is constructed at module load and passed to both production implementations; `DOM.reset()` rebuilds all three together so a test never resolves a stale handle.

The registry is **not** part of the public `DOMSink`/`DOMSource` interface — it is an implementation detail of the production pair. Test implementations carry their own handle bookkeeping (see *Test seam* below). `Handle` and `ElementPatch` *are* exported (call sites name them).

### Strong `retain` vs weak `intern` draws the leak-safety line

Promote the two minting modes unchanged. **`retain`** (strong forward entry) is for nodes the framework *owns* — the 13 `createElement`/`createElementNS`/`createDocumentFragment` results: clip frame, content frame, Glyph SVG sprites, VirtualScroller boxes, Panel overlay, Header cover, Theme `<style>`, TableExporter download anchor, the two grow-fragments. These are released at their dispose site. **`intern`** (weak `WeakRef` + `FinalizationRegistry`) is for browser-supplied nodes — event targets, `querySelector`/`elementsFromPoint`/`getActiveElement`/`getParentElement`/`getBody`/etc. results. The GC proof ([handle-seam-gc-proof.mjs](../scripts/handle-seam-gc-proof.mjs)) shows 1000 interned handles all evicted, so interning can never leak even if `release` is never called. `resolve` throws on a released/collected handle, turning use-after-free into a loud failure instead of a silent no-op.

Decision on the line for each method: any **`DOMSink.createElement*` / `createDocumentFragment`** mints via `retain`; every **`DOMSource` element-returning method** (`getActiveElement`, `querySelector`, `querySelectorAll`, `getParentElement`, `getParentNode`, `getFirstChild`, `getDocumentElement`, `getBody`, `getHead`, `getElementById`, `elementsFromPoint`) mints via `intern`; the **event boundary** (`Event.ts` `evnt.target`) interns. `getWindow`/`matchMedia` are special-cased (see below).

### Batched `apply(handle, ElementPatch)` is the hot-path primitive; the inline-style flush compiles to it

Promote `ElementPatch` ([HandleSeam.prototype.ts:51-72](../src/typescript/lib/core/HandleSeam.prototype.ts#L51)) and `HandleSink.apply` ([:334](../src/typescript/lib/core/HandleSeam.prototype.ts#L334)). The field is `style` (singular). The benchmark shows a single trivial write costs ~4% over a direct ref, but on a 5-property layout commit the resolve is a small fraction of the style-write cost and batching recovers most of it. **The migration must steer layout-commit call sites to batched `apply`, not one-write-per-call.**

The concrete lever is `InlineStyle.flush()` ([StyleTarget.ts:76-82](../src/typescript/lib/core/StyleTarget.ts#L76)), which today drains the dirty bag with one `DOM.sink.setStyle` per key. After migration, `InlineStyle` holds a `Handle` (not an `HTMLElement`) and `flush()` builds one `{ style: dirtyBag }` patch and emits a single `DOM.sink.apply(handle, patch)`. This is where every per-frame `setX/setY/setWidth/setHeight` commit lands, so it is the one site whose batching matters; `StyleTarget.set` on an already-attached target stays a single-property `apply` (cold path). The fluent `edit().style().addClass().commit()` builder is promoted for *cold* call sites only — it allocates a builder per call.

### `ElementPatch` covers single-element data writes; cross-element and stateful ops stay discrete

The patch covers only operations that fit *one element + plain data*. These `DOMSink` members **become patch fields** (folded into `apply`): `setStyle`, `addClass`, `removeClass`, `toggleClass`, `setAttribute`, `removeAttribute`, `setDataset`, `setTextContent`, `setScrollLeft`, `setScrollTop`. The patch's existing fields cover all ten.

These **stay discrete handle-taking methods** because they don't fit one element + plain data:

- **Two handles:** `appendChild(parent, child)`, `removeChild(parent, child)`, `insertBefore(parent, node, reference)`.
- **One handle, but not a style/class/attr data write:** `removeElement`, `focus`, `blur`, `click`, `setId`, `setValue`, `setSelectionRange`, `setSelectedIndex`, `setPointerCapture`, `releasePointerCapture`.
- **Event plumbing (target is an `EventTarget`, handler is a function — non-serialisable):** `addListener`, `removeListener`, `dispatchEvent`. These keep taking a `Handle` for the target; the handler stays a function (the worker-transport story for listeners is out of scope — see Non-Goals).
- **Non-element / stylesheet:** `setRuleStyle`, `ensureStyleRule`, `ensureKeyframes`, `requestAnimationFrame`, `cancelAnimationFrame` are untouched (no element handle involved). `createElement*` return a `Handle`; `createDocumentFragment` returns a `Handle` (a retained fragment — see Potential Challenges).

`setRuleStyle` stays element-free (it targets a `CSSStyleRule`, which `StyleRule` already holds behind the seam — `StyleRule` is unaffected by this plan).

### Event-boundary interning and the subtree parent walk reshape to handles

`core/Event.ts` already interns `event.target` into an *id string* via `DOM.source.getId(evnt.target)` ([Event.ts:99](../src/typescript/lib/core/Event.ts#L99)). After migration the raw `evnt.target` is a `Node` the rule forbids holding. The boundary becomes: `const targetHandle = DOM.source.intern(evnt.target)` — `intern` is added to the **public `DOMSource`** surface precisely so the event boundary can convert a raw browser node to a handle without naming `Node`. The id lookup then becomes `DOM.source.getId(targetHandle)`.

The subtree parent walk ([Event.ts:120-132](../src/typescript/lib/core/Event.ts#L120)) currently holds `let element: HTMLElement` and climbs via `getParentElement`. It reshapes to climb in handle space: `let handle: Handle | null = targetHandle; while (handle) { const id = DOM.source.getId(handle); … handle = DOM.source.getParentElement(handle); }`. `getParentElement` now takes and returns a `Handle | null` (interning each ancestor weakly), so no `Element` local survives the walk. `baseViewportListener` and `fireEvent` take/emit handles the same way (`fireEvent` resolves `component.getElement()` to a handle, then `DOM.sink.dispatchEvent(handle, event)`).

### `local/no-raw-dom` tightens to flag *holding* an element type, not just touching one

Today the rule flags member *access* on a DOM-typed receiver ([no-raw-dom.js:203-217](../scripts/eslint/no-raw-dom.js#L203)). Add a **declaration check**: any `Element`/`Node`/`HTMLElement`/`SVGElement`/`DocumentFragment`-typed variable, parameter, class field, or function return *outside `core/DOM.ts`* is a violation. The existing `FLAGGED_TYPE_NAMES` set + `isFromDomLib` confirmation already distinguishes the DOM lib type from a framework `Node`; the new visitors (`PropertyDefinition`, `VariableDeclarator` type annotation, `TSParameterProperty`/`Identifier` with `typeAnnotation`, `FunctionDeclaration`/`MethodDefinition` return annotation, `TSTypeAnnotation`) reuse `typeIsDom` against the *annotated* type. Run it once with `NO_RAW_DOM_IGNORE_BASELINE=1`; the violation list **is** the authoritative migration inventory (exactly as the rule served as the inventory in the prior total-coverage push). `scripts/eslint/no-raw-dom.baseline.json` + `npm run lint:baseline` is the ratchet — it shrinks to `[]` as the migration lands.

### Promote the prototype, then delete it

`HandleSeam.prototype.ts` + its test/bench/gc-proof are throwaway spikes ([HandleSeam.prototype.ts:31-33](../src/typescript/lib/core/HandleSeam.prototype.ts#L31)). On promotion, the shapes move into `core/DOM.ts` and the four prototype files are **deleted** — keeping them would leave a second, divergent registry. The prototype's *tests* are reborn as real tests against the production registry (canonicalization, lifecycle, batched-write, GC eviction) in `tests/dom/handle-registry.test.ts`; the GC proof becomes `scripts/handle-seam-gc-proof.mjs` retargeted at the real registry (or folded into the test with `--expose-gc`). The bench is reborn as `tests/dom/handle-seam.bench.ts` against the real `apply`.

---

## Public API (TypeScript Signatures)

New exports from `core/DOM.ts`:

```typescript
/** Opaque, serialisable element reference. The live Node never escapes the seam. */
export type Handle = number & { readonly __handleBrand: unique symbol };

/** Batched single-element mutation. Plain serialisable data — one postMessage. */
export interface ElementPatch {
    style?:       Readonly<Record<string, string | null>>;
    removeClass?: readonly string[];
    addClass?:    readonly string[];
    toggleClass?: Readonly<Record<string, boolean>>;
    removeAttr?:  readonly string[];
    setAttr?:     Readonly<Record<string, string>>;
    dataset?:     Readonly<Record<string, string>>;
    text?:        string;
    scrollLeft?:  number;
    scrollTop?:   number;
}
```

`DOMSink` — every element parameter changes from `HTMLElement`/`Element`/`Node` to `Handle`; the data-write methods collapse into `apply`:

```typescript
export interface DOMSink {
    // — new batched primitive (replaces setStyle/addClass/removeClass/toggleClass/
    //   setAttribute/removeAttribute/setDataset/setTextContent/setScrollLeft/setScrollTop) —
    apply(handle: Handle, patch: ElementPatch): void;
    edit(handle: Handle): PatchBuilder;                 // cold-path fluent sugar

    // — creation now returns handles (retained) —
    createElement(tag: string): Handle;
    createElementNS(ns: string, tag: string): Handle;
    createDocumentFragment(): Handle;

    // — released at dispose sites —
    release(handle: Handle): void;

    // — discrete handle-taking ops (unchanged shape, Element→Handle) —
    appendChild(parent: Handle, child: Handle): void;
    removeChild(parent: Handle, child: Handle): void;
    insertBefore(parent: Handle, node: Handle, reference: Handle | null): void;
    removeElement(handle: Handle): void;
    focus(handle: Handle, options?: { preventScroll?: boolean }): void;
    blur(handle: Handle): void;
    setValue(handle: Handle, value: string): void;
    setSelectionRange(handle: Handle, start: number, end: number): void;
    setSelectedIndex(handle: Handle, index: number): void;
    setId(handle: Handle, id: string): void;
    click(handle: Handle): void;
    setPointerCapture(handle: Handle, pointerId: number): void;
    releasePointerCapture(handle: Handle, pointerId: number): void;
    dispatchEvent(target: Handle, event: Event): void;
    addListener<T extends Event = Event>(target: Handle, type: string, handler: (event: T) => void, options?: boolean | AddEventListenerOptions): void;
    removeListener<T extends Event = Event>(target: Handle, type: string, handler: (event: T) => void, options?: boolean | EventListenerOptions): void;

    // — element-free; unchanged —
    setRuleStyle(rule: CSSStyleRule, key: string, value: string | null): void;
    ensureStyleRule(selector: string): CSSStyleRule;
    ensureKeyframes(name: string, body: string): void;
    requestAnimationFrame(callback: FrameRequestCallback): number;
    cancelAnimationFrame(handle: number): void;          // note: rAF handle, NOT a DOM Handle
}
```

`DOMSource` — every element parameter/return changes to `Handle`; `intern` is added so the event boundary can convert a raw target:

```typescript
export interface DOMSource {
    /** Converts a raw browser node arriving at an event boundary into a (weak) handle. */
    intern(target: EventTarget): Handle;

    getViewportRect(handle: Handle): Rect;               // was (component: Component) — see note
    getElementRect(handle: Handle): Rect;
    getScrollLeft(handle: Handle): number;
    getScrollTop(handle: Handle): number;
    getScrollMetrics(handle: Handle): ScrollMetrics;
    getOffsetSize(handle: Handle): OffsetSize;
    isConnected(handle: Handle): boolean;
    getValue(handle: Handle): string;
    getActiveElement(): Handle | null;
    contains(ancestor: Handle, node: Handle | null): boolean;
    querySelector(root: Handle, selector: string): Handle | null;
    querySelectorAll(root: Handle, selector: string): Handle[];
    getParentElement(handle: Handle): Handle | null;
    getParentNode(handle: Handle): Handle | null;
    getFirstChild(handle: Handle): Handle | null;
    getBorderWidths(handle: Handle): { top: string; right: string; bottom: string; left: string };
    getComputedOverflow(handle: Handle): { overflow: string; overflowX: string; overflowY: string };
    getInlineStyle(handle: Handle, key: string): string;
    getDocumentElement(): Handle;
    getBody(): Handle;
    getHead(): Handle;
    getElementById(id: string): Handle | null;
    getId(handle: Handle): string;
    getDataset(handle: Handle, key: string): string | undefined;
    getTagName(handle: Handle): string;
    hasAttribute(handle: Handle, key: string): boolean;
    getAttribute(handle: Handle, key: string): string | null;
    getSelectedIndex(handle: Handle): number;
    getSelectedOptionDataset(handle: Handle, key: string): string | undefined;
    getNaturalSize(handle: Handle): { width: number; height: number };
    getFiles(handle: Handle): FileList | null;
    hasPointerCapture(handle: Handle, pointerId: number): boolean;
    elementsFromPoint(x: number, y: number): Handle[];

    // — window / media-query: the live objects already stay behind the seam —
    isWindow(target: Handle | null): boolean;
    getWindow(): Handle;                                 // window interned to a handle for addListener
    matchMedia(query: string): MediaQueryResult;         // unchanged

    // — unchanged (no element) —
    measureText(text: string, options?: TextMeasureOptions): TextMetrics;
    resolveFontSizePx(fontSizeCSS: string): number;
    measureFontMetrics(): { ascent: number; descent: number; capTop: number };
    getThemeVar(name: string): string;
    getViewportSize(): Size;
    getScrollBarWidth(): number;
    isModelled(): boolean;
}
```

> **`getViewportRect` note.** It currently takes `Component` ([DOM.ts:403](../src/typescript/lib/core/DOM.ts#L403), [:1057](../src/typescript/lib/core/DOM.ts#L1057)) because the modelled source walks `getParentComponent()`. **Keep it taking `Component`** — `Component` is a framework type, not a DOM type, so it doesn't violate the rule, and the modelled oracle depends on it. Only the *production* implementation's internal `component.getElement()` changes to resolve a handle. This is the one element-keyed read that stays component-keyed; it is already documented that way ([dom-seams.md:26-32](../docs/concepts/dom-seams.md#L26)).

> **`getWindow` returns a `Handle`.** The window is interned once (weakly is fine — `window` never dies) so `Event`'s `DOM.sink.addListener(DOM.source.getWindow(), …)` keeps working without naming `Window`. `isWindow` then compares handles.

`PatchBuilder` ([HandleSeam.prototype.ts:366-421](../src/typescript/lib/core/HandleSeam.prototype.ts#L366)) is promoted verbatim and exported.

---

## Internal Structure

`Component` field changes ([Component.ts:201,262,272](../src/typescript/lib/core/Component.ts#L201)):

```typescript
private _element     : Handle | undefined;       // was HTMLElement | undefined
private _clipFrame   : Handle | null = null;     // was HTMLElement | null
private _contentFrame: Handle | null = null;     // was HTMLElement | null
```

`getElement()` ([Component.ts:603](../src/typescript/lib/core/Component.ts#L603)) returns `Handle | undefined`; it caches `DOM.source.getElementById(getId())` (now a handle) and `render()` returns a handle. **Public-API ripple:** `getElement()` is a widely-consumed public method returning `HTMLElement`. After migration it returns `Handle`. Every consumer that today does `el.style`/`el.classList`/etc. is already routed through the seam (total coverage), so consumers either (a) pass the handle straight back into a seam call, or (b) compare it (the 8 identity sites). No consumer dereferences it — that's the invariant the prior push established and this rule now enforces structurally.

`createFrame`/`disposeFrame` ([Component.ts:738-762](../src/typescript/lib/core/Component.ts#L738)): `createFrame` returns a `Handle` (retained by `createElement`); `disposeFrame` calls `DOM.sink.removeElement(frame)` **and `DOM.sink.release(frame)`** — the missing `release` is the new required step that the migration must place at every created-element teardown.

`InlineStyle` ([StyleTarget.ts:276-288](../src/typescript/lib/core/StyleTarget.ts#L276)): `_target` becomes `Handle | null`; `attach(handle: Handle)`; `flush()` builds one `{ style: this._dirty }` patch and calls `DOM.sink.apply(this._target, patch)` (the batched hot-path commit); single `set` on an attached target calls `DOM.sink.apply(this._target, { style: { [key]: value } })`.

---

## Ordered Implementation Steps

Phasing rationale: land the *mechanism* (registry + patch + lint clause) and the *true leaks* (element-returning methods) first, then sweep the mechanical inbound sites category-by-category against a shrinking baseline, handling the 13 created-element releases and 8 identity comparisons with care.

### Phase 1 — Mechanism (no call-site changes yet)

1. **Promote the registry + patch + builder into `core/DOM.ts`.** Add `Handle`, `ElementPatch`, module-private `HandleRegistry`, exported `PatchBuilder`. Construct one registry at module load. Wire `DOM.reset()` to rebuild registry + sink + source together. → verify: `npm run typecheck` clean; `core/DOM.ts` still compiles with the *old* signatures (new types are additive at this point).
2. **Add `apply`/`edit`/`release`/`intern` to the production pair**, delegating to the registry and `applyPatchTo` (promote the prototype's fixed-order patch application + `writeStyle`, reusing the existing `ProductionDOMSink.writeDeclaration`). Keep the old element-typed methods in place for now. → verify: new `tests/dom/handle-registry.test.ts` (reborn prototype tests) pass; `tests/dom/handle-seam.bench.ts` runs.
3. **Tighten `local/no-raw-dom`** with the declaration-holding clause (new AST visitors). Run `NO_RAW_DOM_IGNORE_BASELINE=1 npm run lint` → capture the full violation list, then `npm run lint:baseline` to write it. This baseline is the migration inventory. → verify: `npm run lint` green (everything baselined); baseline file non-empty and sorted.

### Phase 2 — Convert the seam signatures (the true leaks first)

4. **Flip every `DOMSink`/`DOMSource` element param/return to `Handle`** in the interface and both production implementations; resolve inside each method, `intern` every browser-returned node, `retain` every created node, fold the 10 data-writers into `apply`. Delete the now-folded sink methods. → verify: `core/DOM.ts` typechecks; the rest of the lib does **not** yet (expected — call sites still pass elements). The baseline now covers all of them.
5. **Convert `StyleTarget.InlineStyle`** to hold a `Handle` and flush via batched `apply`. → verify: typecheck `core/StyleTarget.ts` against the new sink.
6. **Convert `Component`** `_element`/`_clipFrame`/`_contentFrame`/`getElement`/`render`/`createFrame`/`disposeFrame`, placing `release` at `disposeFrame` and `removeElement`. → verify: typecheck `core/Component.ts`.

### Phase 3 — Sweep inbound call sites, category by category

7. **Created-element lifecycle (13 sites — handle with care).** For each `createElement*`/`createDocumentFragment` site (Glyphs ×3, Glyph ×2, VirtualScroller ×2, Header, Panel overlay, Theme `<style>`, TableExporter anchor, Body/Tree grow-fragments, Component frame), thread the returned `Handle` through and add `DOM.sink.release(handle)` at the matching teardown. Audit each for a teardown path; a created element with no release pins a detached node forever. → verify per file: typecheck + the owning component's existing tests.
8. **Mechanical inbound sweep.** Work the baseline down file-by-file: replace each element local/param/field/return with a `Handle`, routing through the seam. Re-run `npm run lint:baseline` after each batch to shrink the file. → verify: baseline strictly shrinks; `npm run typecheck` clean for converted files.
9. **The 8 identity-comparison sites.** Rewrite each to compare canonical handles (handle `===` mirrors element `===` via the reverse map) or use the existing seam predicates:
   - [Tree.ts:642](../src/typescript/lib/component/tree/Tree.ts#L642), [Body.ts:936](../src/typescript/lib/component/table/Body.ts#L936), [TreeBody.ts:766](../src/typescript/lib/component/table/TreeBody.ts#L766): `target === toggleEl/cellEl` → `targetHandle === toggleHandle` (both canonical); the `contains` fallback already routes through `DOM.source.contains(handle, handle)`.
   - [Dialog.ts:754,759](../src/typescript/lib/core/Dialog.ts#L754): focus-trap `getActiveElement() === first/last` → handle `===` (both interned canonically).
   - [ReorderIndicator.ts:82](../src/typescript/lib/core/component/ReorderIndicator.ts#L82): `getParentElement(myEl) === targetEl` → handle `===`.
   - [AutoCompleteField.ts:479](../src/typescript/lib/component/input/AutoCompleteField.ts#L479), [AbstractWindow.ts:756](../src/typescript/lib/core/AbstractWindow.ts#L756): only need a containment predicate — `DOM.source.contains(dropHandle, DOM.source.getActiveElement())` already does it; just thread handles.
   → verify: focus-trap, tree-toggle, table-cell-focus, reorder, autocomplete-blur, window-focus all exercised by existing tests / manual smoke.

### Phase 4 — Boundaries, tests, docs

10. **`core/Event.ts`:** intern `evnt.target` at the boundary ([Event.ts:99,120](../src/typescript/lib/core/Event.ts#L99)); reshape the subtree walk to climb in handle space; `fireEvent`/`baseViewportListener` take/emit handles. → verify: subtree-dispatch tests, event-routing tests.
11. **`tests/dom/TestDOM.ts`:** `RecordingDOMSink` mints synthetic numeric handles (a private counter) on `createElement*` and records `apply` patches verbatim; `ModelledDOMSource` keys its handle→stub map the same way and `intern` returns a stub handle. The geometry oracle's `getViewportRect(component)` is unchanged (still `Component`-keyed). The stub element disappears — the recorder stores `{ op, args }` with handles, never a fake `HTMLElement`. → verify: `npm run test` (recorder.test, geometry/oracle tests).
12. **Delete the four prototype files**; ensure the reborn registry test + bench + gc-proof cover the same properties. → verify: `grep -rn "HandleSeam.prototype" src tests scripts` — expect zero matches.
13. **Update docs** (`docs/concepts/dom-seams.md`, `ARCHITECTURE.md`): the seam now passes *handles*, not elements; describe `Handle`, the registry, retain/intern/release, and `apply`/`ElementPatch`. → verify: `npm run docs:build` 0 errors / 0 link warnings.
14. **Final ratchet:** `npm run lint:baseline` must produce `[]`. → verify: `npm run lint` green with empty baseline; `npm run lint:dom-audit` clean.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/core/DOM.ts` — promote registry/patch/builder; flip all element params/returns to `Handle`; add `apply`/`edit`/`release`/`intern` |
| Modify | `src/typescript/lib/core/StyleTarget.ts` — `InlineStyle` holds a `Handle`, batched `flush` |
| Modify | `src/typescript/lib/core/Component.ts` — `_element`/`_clipFrame`/`_contentFrame`/`getElement`/`render`/`createFrame`/`disposeFrame` to handles + `release` |
| Modify | `src/typescript/lib/core/Event.ts` — intern at boundary; handle-space subtree walk |
| Modify | ~50 lib files holding element types (the baseline inventory) — mechanical `Element`→`Handle` |
| Modify | `src/typescript/lib/component/{display/Glyphs,display/Glyph,table/TableExporter,table/Header,container/VirtualScroller}.ts`, `core/{Panel,Theme}.ts` — created-element `release` placement |
| Modify | `src/typescript/lib/component/{tree/Tree,table/Body,table/TreeBody,input/AutoCompleteField}.ts`, `core/{Dialog,AbstractWindow,component/ReorderIndicator}.ts` — 8 identity sites |
| Modify | `scripts/eslint/no-raw-dom.js` — declaration-holding clause |
| Modify | `tests/dom/TestDOM.ts` — recording sink + modelled source speak handles |
| Modify | `docs/concepts/dom-seams.md`, `ARCHITECTURE.md` |
| Create | `tests/dom/handle-registry.test.ts`, `tests/dom/handle-seam.bench.ts` (reborn from prototype) |
| Delete | `src/typescript/lib/core/HandleSeam.prototype.ts` |
| Delete | `tests/dom/handle-seam.prototype.test.ts`, `tests/dom/handle-seam.prototype.bench.ts` |
| Delete/Retarget | `scripts/handle-seam-gc-proof.mjs` (retarget at the real registry) |

---

## Verification

- **Typecheck:** `npm run typecheck` clean (no `Element`/`Node` escapes outside `core/DOM.ts`).
- **Lint ratchet:** `npm run lint:baseline` produces `[]`; `npm run lint` green; `npm run lint:dom-audit` clean. The empty baseline is the structural proof that no module outside the seam holds an element type.
- **Grep invariants:** `grep -rn "HandleSeam.prototype" src tests scripts` → 0; `grep -rEn ": *(HTMLElement|SVGElement|Element|Node|DocumentFragment)" src/typescript/lib --include=*.ts | grep -v core/DOM.ts` → 0.
- **Tests:** `npm run test` — registry (canonicalization, strong/weak lifecycle, release-throws, GC eviction), batched-write, recorder, geometry-oracle (residual 0 offline), subtree-dispatch, focus-trap.
- **GC proof:** `node --expose-gc scripts/handle-seam-gc-proof.mjs` → PASS (interned handles all evicted).
- **Benchmarks:** `npx vitest bench tests/dom/handle-seam.bench.ts` — confirm batched 5-property commit recovers most of the per-write resolve cost; single trivial write within ~few-% of direct ref. Gate: per-frame layout commit must not regress noticeably.
- **Docs:** `npm run docs:build` → 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning).
- **Manual smoke:** the MiscPanel slow-table on `http://localhost:8015` (`npm run dev`) — scroll, sort, resize columns with F12 open; confirm no resolve-throw, no leak growth, layout commit stays decently fast (the project's perf success bar).

---

## Documentation Impact

- `Handle`, `ElementPatch`, `PatchBuilder` are exported from `core/DOM.ts` → already barrelled via `src/typescript/lib/core/index.ts` (the `DOM` group). Confirm the new types appear in the `core` catalog `index.md` and the sidebar in `docs/.vitepress/config.mts`.
- `docs/concepts/dom-seams.md` is the curated page; rewrite the "seam passes elements" framing to "seam passes opaque handles", document retain/intern/release and the batched `apply`/`ElementPatch`, and update the "what it enables" worker-ready bullet (the seam is now fully serialisable).
- `ARCHITECTURE.md` seam paragraph ([:107](../ARCHITECTURE.md#L107)) and the "empty baseline" enforcement line need the handle framing.
- Cross-bucket JSDoc references use markdown links, not `{@link}`, per `_shared/docs-conventions.md`.

---

## Potential Challenges

- **Registry lifecycle leaks (the genuine new risk).** A missed `release` on a strongly-retained created element pins a detached node forever. Mitigation: the 13 `createElement*` sites are enumerated and each gets a paired `release` at teardown; a test asserts `registry.size` returns to baseline after a component dispose cycle.
- **Hot-path `Map.get`.** Every write now costs one resolve. Mitigation: the layout-commit path funnels through `InlineStyle.flush` → one batched `apply` (one resolve for N style writes), and the bench gates per-frame cost. Single cold writes pay ~4%, which the benchmark already showed acceptable.
- **Per-frame benchmark gate.** The MiscPanel slow-table is the stress test; if batching doesn't recover the resolve cost there, revisit caching the resolved node on the `InlineStyle` buffer (it already holds the handle; it could cache the last-resolved node behind a generation check — out of scope unless the gate fails).
- **Fragment handles.** `createDocumentFragment` returns a retained `Handle`, but a fragment is consumed by `appendChild` and emptied. The fragment handle must be `release`d after the bulk insert (Body/Tree grow paths) or it pins an empty fragment. Mitigation: release immediately after the `appendChild(parent, fragmentHandle)` that drains it.
- **Breaking change to the public `DOMSink`/`DOMSource` API.** Every method signature changes (element → handle). This is a hard break for any external consumer of the seam interfaces. Mitigation: the seam is documented as a framework-internal extension point; the change is called out in docs. `getElement()` returning `Handle` instead of `HTMLElement` is the most visible ripple — but no consumer dereferences it (the prior total-coverage push + the tightened rule guarantee this structurally).
- **`getViewportRect` asymmetry.** It stays `Component`-keyed while every other element read is handle-keyed. Mitigation: documented as the deliberate oracle exception; only the production internals resolve a handle.

---

## Critical Files

- [`src/typescript/lib/core/DOM.ts`](../src/typescript/lib/core/DOM.ts) — the seam to convert; `DOMSink`/`DOMSource`/`ProductionDOMSink`/`ProductionDOMSource`/`DOM`.
- [`src/typescript/lib/core/HandleSeam.prototype.ts`](../src/typescript/lib/core/HandleSeam.prototype.ts) — the validated shapes to promote (registry, patch, builder, fixed-order apply, `writeStyle`).
- [`tests/dom/handle-seam.prototype.test.ts`](../tests/dom/handle-seam.prototype.test.ts) / [`.bench.ts`](../tests/dom/handle-seam.prototype.bench.ts) / [`scripts/handle-seam-gc-proof.mjs`](../scripts/handle-seam-gc-proof.mjs) — the proofs to rebirth.
- [`src/typescript/lib/core/StyleTarget.ts`](../src/typescript/lib/core/StyleTarget.ts) — `InlineStyle.flush` is the hot batched-commit lever.
- [`src/typescript/lib/core/Component.ts`](../src/typescript/lib/core/Component.ts) — `_element`/frames/`getElement`/`createFrame`/`disposeFrame`.
- [`src/typescript/lib/core/Event.ts`](../src/typescript/lib/core/Event.ts) — the event-target interning boundary and subtree walk.
- [`tests/dom/TestDOM.ts`](../tests/dom/TestDOM.ts) — recording sink + modelled source to teach handles.
- [`scripts/eslint/no-raw-dom.js`](../scripts/eslint/no-raw-dom.js), [`update-baseline.mjs`](../scripts/eslint/update-baseline.mjs), [`dom-audit.mjs`](../scripts/eslint/dom-audit.mjs) — the ratchet.
- [`docs/concepts/dom-seams.md`](../docs/concepts/dom-seams.md), [`ARCHITECTURE.md`](../ARCHITECTURE.md) — docs to update.

---

## Non-Goals

- **The worker transport itself.** This plan makes the seam *serialisable* (handles + plain patches); wiring `postMessage` is a separate effort. Event handlers (`addListener`) keep taking a function, which is non-serialisable — the listener-forwarding story is explicitly deferred.
- **Caching the resolved node behind the handle.** Only pursued if the per-frame bench gate fails; default is a plain `Map.get` per resolve.
- **Changing `getViewportRect` to be handle-keyed.** It stays `Component`-keyed (the oracle depends on the component walk).
- **Touching `StyleRule`/`setRuleStyle`/`ensureStyleRule`/`ensureKeyframes`.** Rule-style targets a `CSSStyleRule`, not an element; it stays as-is.
