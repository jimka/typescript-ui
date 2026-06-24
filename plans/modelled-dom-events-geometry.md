# Modelled DOM Event Delivery + Geometry Oracle — Implementation Plan

## Overview

The offline DOM harness [`tests/dom/TestDOM.ts`](../tests/dom/TestDOM.ts) stubs out two capabilities that keep DOM-heavy component behaviour untestable offline: **event delivery** and **element/hit-test geometry**. The seam interfaces (`DOMSink` / `DOMSource` / `DOMSeams`) in [`src/typescript/lib/core/DOM.ts`](../src/typescript/lib/core/DOM.ts) are already complete — every method these tests need exists. This plan implements the modelled versions of those methods inside `TestDOM.ts`, plus tiny test-injection helpers, so an offline test can construct a synthetic event and assert that it reaches the right component listeners, and can read real rects/hit-test stacks back from committed layout state.

**This is harness-only work. No production code changes.** The framework's `Event` namespace, `Component`, and layout managers are read for their contract but are not modified. Every edit lands in `tests/dom/TestDOM.ts` (and possibly a small companion test-helper file under `tests/dom/`).

The work splits into two independent parts that share one new piece of harness state — a **modelled DOM tree** (handle→parent, id→handle) recorded by the sink and read by the source:

- **A — Event delivery.** Today `RecordingDOMSink.addListener` drops its handler ([`tests/dom/TestDOM.ts:209`](../tests/dom/TestDOM.ts#L209)) and `dispatchEvent` only records the type ([`:217`](../tests/dom/TestDOM.ts#L217)). Replace both with a real registry + a dispatch that walks the modelled tree and invokes the framework's window-level `baseListener`, honouring capture → target → bubble and the `Event` namespace's exact-target vs subtree routing.
- **B — Geometry oracle.** Today `getElementRect` → `{0,0,0,0}` ([`:352`](../tests/dom/TestDOM.ts#L352)), `getScrollMetrics` → zeros ([`:413`](../tests/dom/TestDOM.ts#L413)), `getOffsetSize` → zeros ([`:418`](../tests/dom/TestDOM.ts#L418)), `elementsFromPoint` → `[]` ([`:563`](../tests/dom/TestDOM.ts#L563)). The component-keyed `getViewportRect` oracle ([`:323`](../tests/dom/TestDOM.ts#L323)) is already proven residual-0 against the framework's committed layout (see [`tests/dom/geometry.test.ts`](../tests/dom/geometry.test.ts)). The **handle-keyed** rects are derived **not** from that oracle's cached-field reads but from the **DOM writes the sink actually recorded** — the `left`/`top`/`width`/`height`/`transform` inline-style declarations each component committed through `DOM.sink.apply` — composed through the modelled tree. This makes the seam round-trip honest: `getElementRect(handle)` reflects *what was written to the DOM*, so a setter that caches a value but writes the wrong thing (or nothing) is observable as a divergence from `getViewportRect(component)`. Hit-testing sits on top of these written-rect reads.

---

## Architecture Decisions

### The dispatch must drive the real `baseListener`, not re-implement routing

[`src/typescript/lib/core/Event.ts`](../src/typescript/lib/core/Event.ts) does **not** register a listener per component. It installs exactly one **window-level capture handler** per event type (`baseListener`, [`Event.ts:84`](../src/typescript/lib/core/Event.ts#L84)) via `DOM.sink.addListener(DOM.source.getWindow(), type, baseListener, …)` ([`Event.ts:56`](../src/typescript/lib/core/Event.ts#L56)). All component routing — exact-target match against `listenerMap` ([`Event.ts:103`](../src/typescript/lib/core/Event.ts#L103)) and the descendant-first subtree walk over `subtreeListenerMap` ([`Event.ts:126`](../src/typescript/lib/core/Event.ts#L126)) — lives **inside** that handler and reads back through `DOM.source.getId` / `DOM.source.getParentElement`.

Therefore the harness must **not** re-derive component routing. The modelled `dispatchEvent` only has to reproduce what the browser does to reach `baseListener`: resolve the registered window/document handlers for the event's type and invoke them with the event. `baseListener` then does the rest, provided the modelled source answers `intern`, `getId`, and `getParentElement` truthfully over the modelled tree. This keeps the harness honest — it exercises the framework's real routing code, not a parallel copy.

### A modelled DOM tree recorded by the sink, read by the source

`baseListener` needs three reads to route: `intern(evnt.target)` → handle, `getId(handle)` → id, `getParentElement(handle)` → parent handle (to climb ancestors). Today the modelled source returns `null`/`""` for the tree reads ([`:457`–`:475`](../tests/dom/TestDOM.ts#L457)), and the sink discards parent/child links (`appendChild` records no args, [`:180`](../tests/dom/TestDOM.ts#L180)).

Add a parent-pointer + id index to the shared `TestHandleTable`:
- `appendChild`, `insertBefore` record `child → parent` onto the table.
- `removeChild`, `removeElement` clear the pointer.
- `setId` (already updates the stub, [`:231`](../tests/dom/TestDOM.ts#L231)) additionally maintains an `id → handle` map for `getElementById`.

The source's `getParentElement`/`getParentNode` return the recorded parent, `getElementById` returns the indexed handle, `contains` walks parents, and `querySelector`/`querySelectorAll` stay unimplemented (out of scope — see Non-Goals). This is the minimal tree: enough for `baseListener`'s id-keyed ancestor climb, which is the only tree traversal the event contract requires.

### Synthetic events: target by handle, fields by plain object

A test needs to construct an event whose `target` resolves (through `intern`) to a known component's element handle, carrying coordinates / key / button fields. `baseListener` interns `evnt.target` and reads its id, so `evnt.target` must be a value the modelled `intern` maps back to the element's handle. The harness exposes a test helper `makeEvent(targetHandle, type, init?)` that returns a real `Event`/`CustomEvent`/synthetic object whose `target` is a sentinel the modelled `intern` resolves straight back to `targetHandle` (rather than minting a fresh stub as it does today, [`:318`](../tests/dom/TestDOM.ts#L318)). The helper sets `type`, optional `clientX`/`clientY`, `key`, `button`, and leaves `stopPropagation` intact so the framework's wrap-and-detect logic ([`Event.ts:90`](../src/typescript/lib/core/Event.ts#L90)) works unchanged.

Decision: use a **plain typed sentinel object** carrying `{ type, target, clientX, clientY, key, button, stopPropagation, preventDefault, … }` rather than a jsdom `Event`. The seam never requires a real `Event`; `baseListener` only touches `.type`, `.target`, `.stopPropagation`, and whatever fields the component handler reads. A plain object keeps the harness `node`-environment-friendly and lets a test set arbitrary coordinates. `intern` recognises the sentinel's `target` and returns the embedded handle; for any other target it falls back to minting (today's behaviour).

### Consume-once (`consumeWheel`) needs object identity across listener calls

[`consumeWheel`](../src/typescript/lib/core/SmoothScroller.ts#L31) marks `e._tsScrollConsumed = true` on the event object so an inner scroll container claims a wheel before an ancestor — relying on descendant-first subtree order ([`SmoothScroller.ts:25`](../src/typescript/lib/core/SmoothScroller.ts#L25)). The modelled dispatch must pass **the same event object** to every `baseListener` invocation and through every subtree-ancestor call, so a marker set by the innermost listener is visible to the outer one. `baseListener` already iterates a single `evnt` across the ancestor walk; the harness only has to not clone the event between handlers.

### Geometry: handle-keyed rects derive from the sink's recorded DOM writes, not cached component fields

The existing `getViewportRect` oracle reads **cached `Component` fields** (`getX`/`getY`/`getWidth`/`getHeight`/`getBorderSize`/`getTranslateX`/`getScrollLeft` — e.g. [`Component.ts:2820`](../src/typescript/lib/core/Component.ts#L2820)). That is correct as a *reference layout*, but it must **not** be the source for the handle-keyed reads. Deriving `getElementRect(handle)` from the same cached fields would make the read tautological with the component's own internal state — a test asserting `getElementRect == expected` would only re-assert the cached field and could **never** catch the bug class the DOM seam exists to expose: a setter that caches a value but writes the wrong thing (or nothing) to the DOM. It also forecloses the most valuable seam test — *comparing the component's cached geometry against what was actually written to the DOM*.

So the handle-keyed reads derive from the **DOM writes the sink recorded**. The plumbing already exists: every geometry setter commits an inline-style declaration through `DOM.sink.apply(handle, { style: … })`. `setX`→`setElementStyle("left", this._left + "px")` ([`Component.ts:2843`](../src/typescript/lib/core/Component.ts#L2843)), `setY`→`"top"` ([`:2876`](../src/typescript/lib/core/Component.ts#L2876)), `setWidth`→`"width"` ([`:2699`](../src/typescript/lib/core/Component.ts#L2699)), `setHeight`→`"height"` ([`:2787`](../src/typescript/lib/core/Component.ts#L2787)), and `setTranslate`→`setElementStyle("transform", "translate3d(" + x + "px," + y + "px,0)")` ([`Component.ts:3048`](../src/typescript/lib/core/Component.ts#L3048)). These all flow through `InlineStyle.writeStyle`/`flushDirty` → `DOM.sink.apply(handle, { style })` ([`StyleTarget.ts:302`](../src/typescript/lib/core/StyleTarget.ts#L302)). `RecordingDOMSink.apply` already records every patch ([`:131`](../tests/dom/TestDOM.ts#L131)) and already folds `scrollLeft`/`scrollTop` onto the stub ([`:137`](../tests/dom/TestDOM.ts#L137)); the revision extends that fold to accumulate the **latest** geometry-relevant declarations (`left`/`top`/`width`/`height`/`transform`) per handle onto the stub.

`getElementRect(handle)` then **parses** the accumulated written declarations — `parseFloat` on the `px` strings, and a `translate3d(<x>px,<y>px,0)` (or `translate(...)`) parse for the transform — into a local box, and composes ancestor offsets by climbing the **same modelled tree** the event half records (`table.parent(handle)`), adding each ancestor's **border inset** (see below), subtracting each ancestor's recorded `scrollLeft`/`scrollTop`, and adding the root mount offset. The result mirrors the oracle's composition math ([`TestDOM.ts:338`](../tests/dom/TestDOM.ts#L338)) but sourced — for position, size, and translate — entirely from written values. No `registerComponent` helper and no `handle → Component` map are needed for the written geometry: the sink already knows every handle it wrote to, and the tree already records parentage. `getElementRect` on a handle with no recorded geometry writes returns the zero rect (escape hatch preserved).

**Border insets are the one un-writable input** (see Potential Challenges): border width is committed via `setElementCSSRules`→`StyleRule.writeStyle`→`DOM.sink.setRuleStyle(rule, key, value)` ([`StyleTarget.ts:258`](../src/typescript/lib/core/StyleTarget.ts#L258)), which is keyed by the `CSSStyleRule` object, **not** the handle — `RecordingDOMSink.setRuleStyle` records only `(key, value)` with no handle ([`:154`](../tests/dom/TestDOM.ts#L154)). The recorded-write path therefore cannot attribute a border width to a handle, and there is no cached `Component` to read from a bare handle. Rather than reintroduce a `handle → Component` map (the very cached-field coupling the user rejected), the harness defaults each handle's border inset to **zero** and exposes a per-handle injection — `setBorderInset(handle, insets)` — symmetric with `setNaturalSize`. A composition test that exercises a bordered parent injects that parent's inset explicitly; the common borderless case needs nothing. This keeps the validated geometry (position, size, translate) sourced purely from writes while leaving border an explicit, opt-in test input — never a back-door read of cached component state.

### Hit-testing composes rects through the modelled tree and z-orders by depth

`elementsFromPoint(x, y)` returns the stack of handles whose recorded-write rect contains the point, **topmost first**. The candidate set is every handle the sink recorded geometry writes for; each one's rect is computed by the same `getElementRect` written-value composition above. With no `z-index` model, topmost is defined by **DOM order**: a descendant paints over its ancestor, and a later sibling over an earlier one. The harness orders hits by modelled-tree depth (deepest = topmost), breaking ties by tree sibling order, mirroring the paint order the framework relies on for `DragManager`'s hit-test ([`DragManager.ts:397`](../src/typescript/lib/overlay/DragManager.ts#L397)). This is the modelled analogue of `document.elementsFromPoint`; explicit `z-index` reordering is a Non-Goal.

### Scroll metrics and offset size from committed state

`getScrollMetrics(handle)` returns the handle's recorded scroll offsets (already folded onto the stub, [`:137`](../tests/dom/TestDOM.ts#L137)) plus `clientWidth`/`clientHeight` parsed from the handle's recorded `width`/`height` writes, and `scrollWidth`/`scrollHeight` from its content extent. Offline tests that need a non-trivial `scrollWidth` inject it; absent injection it equals `clientWidth` (no overflow), matching today's zero-overflow assumption but now coherent with the written client box. `getOffsetSize(handle)` returns `offsetTop`/`offsetHeight` derived from the handle's recorded `top` write (relative to its offset parent in the modelled tree) and its recorded `height`.

### Per-handle injectables for `getNaturalSize` and the focus model

`getNaturalSize` ([`:551`](../tests/dom/TestDOM.ts#L551)) has no geometric derivation (intrinsic image size is external data), so it follows the established **per-handle injection** pattern that `getValue` uses via the stub table ([`:428`](../tests/dom/TestDOM.ts#L428)): a `setNaturalSize(handle, w, h)` test helper seeds a `naturalWidth`/`naturalHeight` field on the stub; `getNaturalSize` reads it back (default `{0,0}`). The focus model is symmetric: `DOM.sink.focus(handle)` records the focused handle onto table state, `getActiveElement()` reads it back, and `blur` clears it — turning the dead `null` ([`:433`](../tests/dom/TestDOM.ts#L433)) into a real round-trip so `Dialog`'s focus-trap reads ([`Dialog.ts:626`](../src/typescript/lib/overlay/Dialog.ts#L626)) become testable.

---

## Public API (TypeScript Signatures)

All additions are **test-harness exports** in `tests/dom/TestDOM.ts` — none are library API.

```ts
// New per-handle stub fields (extends HandleStub).
interface HandleStub {
    // …existing: tagName, id, value, scrollLeft, scrollTop
    naturalWidth:  number;
    naturalHeight: number;
    // Accumulated geometry-relevant style writes, folded by sink.apply.
    // Default "" (no write recorded). Parsed by getElementRect.
    styleLeft:      string;   // last written `left`   (e.g. "100px")
    styleTop:       string;   // last written `top`
    styleWidth:     string;   // last written `width`
    styleHeight:    string;   // last written `height`
    styleTransform: string;   // last written `transform` (e.g. "translate3d(3px,7px,0)")
    // Per-handle border inset for composition (un-writable offline; default 0).
    borderInset:    { top: number; right: number; bottom: number; left: number };
}

// TestHandleTable gains tree + index + focus state.
class TestHandleTable {
    setParent(child: Handle, parent: Handle | null): void;
    parent(handle: Handle): Handle | null;
    indexId(handle: Handle, id: string): void;   // called from sink.setId
    byId(id: string): Handle | null;
    setFocus(handle: Handle | null): void;
    focus(): Handle | null;
}

// Sink: real listener registry + tree-aware structural ops + geometry fold.
class RecordingDOMSink {
    // apply now also folds patch.style.{left,top,width,height,transform}
    //   onto the target stub (alongside the existing scrollLeft/scrollTop fold).
    // addListener now stores (target, type, handler); removeListener removes it.
    // dispatchEvent walks to the window handler set and invokes baseListener.
    // appendChild/insertBefore/removeChild/removeElement maintain the parent map.
    // focus/blur update table focus state.
}

// Source: tree reads + written-geometry parsing + hit-test.
class ModelledDOMSource {
    // intern recognises a sentinel target and returns its embedded handle.
    // getParentElement/getParentNode/contains/getElementById read the tree.
    // getElementRect parses the stub's recorded style writes and composes
    //   ancestor offsets through the modelled tree (NOT cached Component fields).
    // getScrollMetrics/getOffsetSize/elementsFromPoint read the same written rects.
    // getActiveElement reads table focus; getNaturalSize reads the stub.
}

// New test-injection helpers (exported alongside installTestDOM).
// (No registerComponent — handle-keyed geometry comes from recorded writes,
//  which the sink already captures; no handle→Component bridge is needed.)
export function makeEvent(
    target: Handle,
    type: string,
    init?: { clientX?: number; clientY?: number; key?: string; button?: number; detail?: unknown }
): Event;
export function setNaturalSize(handle: Handle, width: number, height: number): void;

// Per-handle border inset for geometry composition (border is written
// rule-side and un-attributable per handle offline — default {0,0,0,0}).
export function setBorderInset(
    handle: Handle,
    insets: { top: number; right: number; bottom: number; left: number }
): void;
```

---

## Internal Structure

**Listener registry (sink).** A `Map<Handle, Map<string, Set<handler>>>` keyed by target handle then type. `addListener` adds, `removeListener` deletes. The framework registers all its base listeners on the window handle (`DOM.source.getWindow()`), so in practice this map holds one entry per event type under the window handle, plus whatever a test registers directly.

**Dispatch (sink).** `dispatchEvent(target, event)` resolves the window handle (the table can intern a stable singleton window handle, matching `getWindow`), looks up handlers registered for `event.type` on the window, and invokes each with `event`. It does **not** walk the element tree itself — `baseListener` does, by reading `getParentElement` from the source. The event object passed is the caller's event (from `makeEvent`), preserving identity for `consumeWheel`.

**Window handle stability.** `getWindow()` currently mints a fresh stub each call ([`:448`](../tests/dom/TestDOM.ts#L448)); the registry needs a **stable** window handle so the listener registered by `installBaseListener` and the lookup done by `dispatchEvent` agree. Mint one window handle per `installTestDOM` and return it from every `getWindow()` call.

**Tree map (table).** `Map<Handle, Handle>` child→parent and `Map<string, Handle>` id→handle. `getParentElement` returns `parent(handle)`; `contains(a, b)` climbs `b`'s parents looking for `a`.

**Written-geometry parse (source).** No registration map. `getElementRect(handle)` reads the stub's accumulated `styleLeft/styleTop/styleWidth/styleHeight/styleTransform`, computes the local box as `x = parseFloat(styleLeft) + translateX`, `y = parseFloat(styleTop) + translateY`, `w = parseFloat(styleWidth)`, `h = parseFloat(styleHeight)`, where `(translateX, translateY)` come from parsing `styleTransform` (`translate3d(<x>px,<y>px,0)` or `translate(<x>px,<y>px)`; default `0,0`). It then climbs `table.parent(handle)` to the root, adding each step's local `x`/`y`, the **parent border inset** (`stub.borderInset`, default `{0,0,0,0}`, seeded by `setBorderInset` — the lone non-written input, see Architecture Decisions), and subtracting the parent's recorded `scrollLeft`/`scrollTop`; at the root it adds `config.rootMountOffset`. A handle with no recorded `width`/`height` write returns the zero rect.

```ts
// Sketch of the per-handle local box from recorded writes.
const px = (s: string) => { const n = parseFloat(s); return isNaN(n) ? 0 : n; };
const [tx, ty] = parseTranslate(stub.styleTransform);   // translate3d/translate → [x, y]
const local = { x: px(stub.styleLeft) + tx, y: px(stub.styleTop) + ty,
                w: px(stub.styleWidth), h: px(stub.styleHeight) };
```

**Hit-test (source).** Iterates every handle the sink recorded geometry writes for, computes each `getElementRect`, filters those containing `(x, y)`, sorts by `(treeDepth desc, siblingIndex desc)`.

---

## Ordered Implementation Steps

1. **Extend `HandleStub` + `TestHandleTable`** (`tests/dom/TestDOM.ts`): add `naturalWidth`/`naturalHeight` (default 0), `styleLeft`/`styleTop`/`styleWidth`/`styleHeight`/`styleTransform` (default `""`), and `borderInset` (default `{0,0,0,0}`); add the child→parent map, id→handle index, focus field, and the accessor methods. `mint` seeds the new stub fields.
2. **Stable window handle**: mint one window handle in `installTestDOM`, store it on the table, return it from `ModelledDOMSource.getWindow()`. Verify: two `getWindow()` calls return the same handle.
3. **Sink tree recording**: make `appendChild`/`insertBefore` set the child's parent, `removeChild`/`removeElement` clear it, `setId` also call `table.indexId`. Keep the existing recorded op-log entries (the `recorder.test.ts` assertions must still pass — verify those ops still log; the `appendChild` log entry currently has empty args, so add the handle args carefully and update `recorder.test.ts` only if its expectation needs the new args).
4. **Source tree reads**: implement `getParentElement`, `getParentNode`, `contains`, `getElementById` against the table. Leave `querySelector`/`querySelectorAll`/`getFirstChild` returning their current empties (Non-Goal).
5. **Sink listener registry**: replace `addListener`/`removeListener` bodies to store/remove `(target, type, handler)`; keep the `record(...)` calls so `Event.test.ts`'s install/uninstall accounting still passes.
6. **`makeEvent` helper + `intern` sentinel**: add the exported `makeEvent`; teach `intern` to return the embedded handle for a sentinel target, else mint (today's behaviour).
7. **Sink `dispatchEvent`**: look up window-handle listeners for `event.type` and invoke each with the event; keep the `record('dispatchEvent', event.type)` line so `Event.test.ts:140` still passes.
8. **Focus model**: `sink.focus` sets table focus, `sink.blur` clears it, `source.getActiveElement` reads it. Keep the `record('focus', …)`/`record('blur')` lines.
9. **Sink geometry fold**: extend `RecordingDOMSink.apply` so that, alongside the existing `scrollLeft`/`scrollTop` fold, it copies any `patch.style.left`/`top`/`width`/`height`/`transform` declaration onto the target stub (`null` clears the field to `""`). Keep the `record('apply', …)` line untouched so `recorder.test.ts` stays green.
10. **Handle-keyed geometry (source)**: implement `getElementRect` by parsing the stub's recorded style writes and composing ancestor offsets through `table.parent` (parent border inset from `stub.borderInset`, default zero; ancestor scroll from the stub). Implement `getScrollMetrics`/`getOffsetSize` from the recorded `width`/`height`/`top` writes + stub scroll. Implement `elementsFromPoint` over the handles with recorded geometry, using the tree depth/sibling ordering.
11. **Injectables**: `getNaturalSize` + `setNaturalSize` (stub-backed), and `setBorderInset` (writes `stub.borderInset` for bordered-parent composition tests).
12. **Regression checkpoints**: run the existing suites — `tests/dom/recorder.test.ts`, `tests/dom/geometry.test.ts`, `tests/unit/core/Event.test.ts` must all still pass (the modelled changes are additive; the only intentional behaviour change is `getParentElement` now returning a real parent, which `Event.test.ts:149` notes it could not exercise before — that test asserts only accounting, so it stays green).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `tests/dom/TestDOM.ts` (all harness changes A + B + injection helpers) |
| Modify (only if its op-log expectation changes) | `tests/dom/recorder.test.ts` (`appendChild` now records handle args) |
| Create | `tests/dom/events.test.ts` (new offline event-delivery tests — see Expected Behaviour A) |
| Create | `tests/dom/hit-test.test.ts` (new offline geometry/hit-test tests — see Expected Behaviour B) |

No production files. No `src/` changes.

---

## Expected Behaviour

Each case is derived from the **contract** (`Event.ts` routing, `DOMSource`/`DOMSink` JSDoc, the `consumeWheel` semantics, the residual-0 oracle), not from current stub output. All are **unit-testable offline** unless marked otherwise.

### A — Event delivery

1. **Exact-target match fires, sibling does not** *(offline)*. Register `Event.addListener(compA, "click", h)`. Dispatch `makeEvent(compA.getElement()!, "click")` → `h` runs once with `this === compA`. Dispatch the same on `compB`'s handle → `h` does not run. (Contract: `listenerMap` keyed by element id, [`Event.ts:105`](../src/typescript/lib/core/Event.ts#L105).)
2. **Exact-target match stops the subtree walk** *(offline)*. With both an exact-target listener on the target and a subtree listener on an ancestor, after the exact-target listeners run the dispatcher calls `originalStop()` ([`Event.ts:109`](../src/typescript/lib/core/Event.ts#L109)); the ancestor subtree listener still runs **only if** the exact-target handler did not call `evnt.stopPropagation()`. Assert: no user `stopPropagation` → ancestor subtree listener runs; user `stopPropagation` in the exact-target handler → ancestor subtree listener is skipped (`propagationStopped` short-circuit, [`Event.ts:117`](../src/typescript/lib/core/Event.ts#L117)).
3. **Subtree listener fires on every matching ancestor, descendant-first** *(offline)*. Nest `root → mid → leaf` (modelled tree via `appendChild`). `addSubtreeListener` on `root` and on `mid`. Dispatch on `leaf`'s handle → both fire, **`mid` before `root`** (the walk climbs `getParentElement` from the target upward, [`Event.ts:126`](../src/typescript/lib/core/Event.ts#L126)).
4. **Subtree listener fires when the target is the ancestor itself** *(offline)*. `addSubtreeListener` on `mid`; dispatch on `mid`'s own handle → fires (the walk starts at the target).
5. **Consume-once stops ancestor handling** *(offline)*. Two nested subtree `"wheel"` listeners that each call `consumeWheel(e)`; dispatch one wheel event. The inner (descendant) listener claims it (`true`); the outer ancestor sees `false` and skips — proving the same event object reaches both and the marker survives. (Contract: [`SmoothScroller.ts:31`](../src/typescript/lib/core/SmoothScroller.ts#L31) + descendant-first order.)
6. **Unbound method handlers keep a stable `this`** *(offline)*. Register an unbound component method; on dispatch it is invoked via `listener.apply(component, [evnt])` so `this` is the component regardless of how the reference was passed ([`Event.ts:113`](../src/typescript/lib/core/Event.ts#L113)).
7. **Viewport listener fires regardless of target** *(offline)*. `addViewportListener` then dispatch on an unrelated handle → fires (the base viewport handler ignores target id, [`Event.ts:143`](../src/typescript/lib/core/Event.ts#L143)). Requires the viewport base listener to be registered on the stable window handle and invoked by `dispatchEvent`.
8. **No registered listener → dispatch is a no-op** *(offline)*. Dispatch a type with no listeners → no throw, no handler runs, `record('dispatchEvent', type)` still logged.
9. **`removeListener` of the last listener stops delivery** *(offline)*. After removing the sole listener, a subsequent dispatch does not invoke it (and the base listener is uninstalled — already covered by `Event.test.ts`, now also delivery-observable).
10. **Event coordinates/fields reach the handler** *(offline)*. A handler reading `evnt.clientX`/`evnt.key` sees the values passed to `makeEvent`.

### B — Geometry oracle (derived from recorded DOM writes)

Every rect below is parsed from the inline-style declarations the component **wrote through the sink**, composed through the modelled tree — never from the component's cached fields. The deliberate consequence (case 11a) is that a setter which caches but fails to write is *caught*.

11. **Handle-keyed rect (from writes) equals the intended layout (residual 0)** *(offline)*. After committing layout (`setX/setY/setWidth/setHeight/setTranslate` on a `root → mid → leaf` tree wired with `addComponent`), `getElementRect(leaf.getElement()!)` — parsed from the recorded `left`/`top`/`width`/`height`/`transform` writes and composed through the tree — equals `getViewportRect(leaf)` exactly. The acceptance criterion is **residual 0**, but now it validates the **write path**: the recorded writes compose to the framework's intended layout (e.g. for the `geometry.test.ts` fixture, `x = 1000 + 100 + 10 + 3 = 1113`, `y = 2000 + 50 + 20 + 7 = 2077`). Re-anchored from `geometry.test.ts` ([`geometry.test.ts:40`](../tests/dom/geometry.test.ts#L40)), which today reads `getViewportRect` directly; the new assertion drives `getElementRect(handle)` and compares it to that reference.
11a. **Cached-vs-written divergence is caught (the seam's core value)** *(offline)*. With a component that cached a position but whose corresponding DOM write is missing or wrong, `component.getX() === getElementRect(handle).x` is **false** — the comparison surfaces the divergence. Concretely: commit `setX(50)` (writes `left: 50px` → handle rect x reflects 50 + ancestor offset), assert `getX()` matches the written rect; then simulate a broken setter by recording a `left: 999px` write the cache never saw (or omitting the write) and assert the comparison now **fails**. This is the bug class the oracle exists to expose — a cached-field oracle could never produce it because it would re-assert the cache against itself.
12. **Rect composes through nested offsets + scroll, all from writes** *(offline)*. For `root → mid → leaf` with positions, translate, an injected parent border (`setBorderInset(midHandle, …)`), and a parent `scrollLeft`/`scrollTop` (the scroll written via a `scrollLeft` patch through the sink), the leaf's handle rect matches the accumulated `parentBorder + writtenX + writtenTranslate − parentScroll` chain. Position/size/translate come from recorded writes; the parent border inset comes from the injected `stub.borderInset` (the documented exception — border is written rule-side and un-attributable per handle offline, so it is an explicit test input rather than a cached-field read; see Architecture Decisions / Potential Challenges).
13. **Handle with no recorded geometry write → zero rect** *(offline)*. `getElementRect` on a handle the sink never wrote `width`/`height` to returns `{0,0,0,0}` (escape-hatch contract preserved).
14. **`getScrollMetrics` reports written client box + recorded scroll** *(offline)*. `clientWidth`/`clientHeight` equal the recorded `width`/`height` writes; `scrollTop`/`scrollLeft` equal the values written through the sink; `scrollWidth`/`scrollHeight` default to the client box (no overflow) and equal an injected larger extent when provided.
15. **`getOffsetSize` reports offset-parent-relative top + height from writes** *(offline)*. `offsetTop` equals the recorded `top` write relative to its offset parent in the modelled tree; `offsetHeight` equals the recorded `height` write.
16. **Hit-test returns containing rects, topmost first** *(offline)*. For overlapping written rects, `elementsFromPoint(x, y)` returns only those whose rect contains `(x, y)`, ordered deepest-descendant-first then latest-sibling-first; a point outside all rects returns `[]`.
17. **Hit-test z-order by DOM depth** *(offline)*. A child rect (written fully inside its parent's written rect) appears **before** the parent in the returned stack (descendant paints on top).
18. **`getNaturalSize` round-trips the injected size** *(offline)*. After `setNaturalSize(handle, w, h)`, `getNaturalSize(handle)` returns `{w, h}`; default `{0, 0}`.
19. **Focus model round-trips** *(offline)*. `DOM.sink.focus(h)` then `getActiveElement()` returns `h`; `blur(h)` then `getActiveElement()` returns `null`; focusing a different handle replaces the active one.

### Out of this plan (asserted as Non-Goals, see below)

- `querySelector`/`querySelectorAll`/`getFirstChild` over the modelled tree — **needs-manual-verify / follow-up**; no selector engine offline.
- Real `z-index`/stacking-context ordering in hit-testing beyond DOM depth — **follow-up**.
- `getComputedOverflow`/`getBorderWidths` returning non-default computed values — **follow-up** (today's defaults remain).
- Validating **border** width via the recorded-write path — **out of scope** offline. Border is written rule-side (`setRuleStyle`, keyed by the `CSSStyleRule` object, no handle), so the recorded-write oracle cannot attribute it to a handle; the parent border inset in composition comes from the per-handle `setBorderInset` injection (default zero). The write-path validation covers position, size, and translate (all written inline per handle).

---

## Verification

- **Typecheck**: `npm run typecheck` (or the project's vitest type pass) — the harness changes are typed against the existing seam interfaces.
- **Existing suites stay green**: `npx vitest run tests/dom/recorder.test.ts tests/dom/geometry.test.ts tests/unit/core/Event.test.ts` — additive changes; update only `recorder.test.ts`'s `appendChild` op-log expectation if the recorded args change.
- **New event tests** (`tests/dom/events.test.ts`): cover Expected Behaviour cases 1–10. Use `@vitest-environment jsdom` only if a real `Event` is needed; the plain-sentinel design allows `node`.
- **New geometry/hit-test tests** (`tests/dom/hit-test.test.ts`): cover cases 11–19, with the written-rect residual-0 assertion (case 11) and the divergence-caught assertion (case 11a) as the gate.
- **Residual-0 gate (write path)**: case 11 must show `getElementRect(handle)` — composed from recorded writes — equal to `getViewportRect(component)` field-for-field for several committed layouts; any divergence fails the **write path**, not the cache. Case 11a is the complementary negative: a missing/wrong recorded write makes `component.getX() === getElementRect(handle).x` fail, proving the comparison catches cached-vs-written divergence.
- **No production-surface change**: `git diff --stat` shows only `tests/` files touched. `npm run docs:build` is **not required** (no public API moved).
- **Manual-verify (documented, not automated)**: real browser event capture/passive semantics and native `elementsFromPoint` z-index stacking remain covered by the existing in-app demos; the offline harness intentionally models only the DOM-order subset.

---

## Potential Challenges

- **`recorder.test.ts` coupling**: it asserts the exact op-log including `{ op: 'appendChild', args: [] }`. Recording parent/child args changes that line — update the expectation deliberately, don't silently break it.
- **Window-handle identity**: if `getWindow()` keeps minting fresh handles, the listener registered by `installBaseListener` won't be found at dispatch. The stable-window-handle step (2) is load-bearing for all of part A.
- **`intern` sentinel vs real targets**: the modelled `intern` must still mint for non-sentinel targets (existing callers rely on it). Branch on a sentinel brand, don't replace the mint path wholesale.
- **Subtree order correctness**: descendant-first is produced by `baseListener` walking `getParentElement` upward from the target — the harness must record the tree so the *target's* ancestor chain is correct, or order assertions (case 3) silently pass for the wrong reason.
- **Parsing `px` and `translate(...)` written values**: `getElementRect` must `parseFloat` the recorded `left`/`top`/`width`/`height` strings (each `"<n>px"`) and parse `transform`. `setTranslate` writes the 3D form `translate3d(<x>px,<y>px,0)` ([`Component.ts:3048`](../src/typescript/lib/core/Component.ts#L3048)), so the parser must accept `translate3d` (and a plain `translate(<x>px,<y>px)` for robustness); a `null`/absent transform means `0,0`. Mitigation: a small dedicated parser with a unit test for each form, defaulting to `0` on any unrecognised value.
- **Border written rule-side, not per handle**: border width flows through `setRuleStyle(rule, …)` ([`StyleTarget.ts:258`](../src/typescript/lib/core/StyleTarget.ts#L258)) — keyed by the `CSSStyleRule` object, no handle — so `RecordingDOMSink.setRuleStyle` ([`:154`](../tests/dom/TestDOM.ts#L154)) cannot attribute it to a handle. Mitigation: the composition reads the parent border inset from the per-handle `setBorderInset` injection (default zero), **not** from a cached `Component` field — keeping the validated geometry write-sourced and making border an explicit, opt-in test input. Documented in Architecture Decisions + Non-Goals; only tests with bordered parents need to inject.
- **Box-sizing / content-box vs border-box**: the framework writes `width`/`height` as the CSS box per its `box-sizing`, and the oracle's composition treats the parent **border** as an inset added to children's `left`/`top` (children are positioned inside the parent's border, matching `getViewportRect`'s `border.left + node.getX()` math, [`Component.ts:338`](../src/typescript/lib/core/Component.ts#L338)). The written-rect parser must mirror that exact convention — add the *parent's* border inset when composing a child, never the element's own — or rects drift by a border width. Mitigation: compose identically to `getViewportRect`, asserted by the residual-0 gate (case 11).
- **Composing nested offsets through the tree**: the parse-and-climb must use the **same** modelled tree the event half records (`table.parent`); a handle whose ancestors weren't recorded via `appendChild`/`addComponent` will under-compose. Mitigation: tests build the tree with `addComponent` (which drives `appendChild`), and the residual-0 gate fails loudly on a broken chain.
- **Last-write-wins accumulation**: `apply` may be called many times per handle (re-layout). The fold keeps only the latest `left`/`top`/`width`/`height`/`transform`, and a `null` declaration clears the field — matching production where the newest write wins. Mitigation: fold overwrites unconditionally; never append.

---

## Critical Files

- [`tests/dom/TestDOM.ts`](../tests/dom/TestDOM.ts) — the sole edit target; `RecordingDOMSink`, `ModelledDOMSource`, `TestHandleTable`, `installTestDOM`.
- [`src/typescript/lib/core/DOM.ts`](../src/typescript/lib/core/DOM.ts) — seam interfaces (already complete) and the `ProductionDOMSink`/`ProductionDOMSource` reference semantics each modelled method must match.
- [`src/typescript/lib/core/Event.ts`](../src/typescript/lib/core/Event.ts) — `baseListener` (the routing the harness must drive, not replace), exact-target vs subtree maps, `stopPropagation` wrap, `getWindow` registration.
- [`src/typescript/lib/core/SmoothScroller.ts`](../src/typescript/lib/core/SmoothScroller.ts) — `consumeWheel` marker semantics for case 5.
- [`tests/dom/geometry.test.ts`](../tests/dom/geometry.test.ts) — the residual-0 reference layout; the handle-keyed reads (composed from recorded writes) must match `getViewportRect` here, re-anchoring residual-0 to the write path.
- [`src/typescript/lib/core/StyleTarget.ts`](../src/typescript/lib/core/StyleTarget.ts) — `InlineStyle.writeStyle`/`flushDirty` (geometry → `sink.apply`, the path the oracle parses) vs `StyleRule.writeStyle` (border → `setRuleStyle`, the un-attributable path).
- [`tests/unit/core/Event.test.ts`](../tests/unit/core/Event.test.ts) — the accounting contract that must stay green; its comments mark exactly what was previously inexpressible offline.
- [`tests/dom/recorder.test.ts`](../tests/dom/recorder.test.ts) — the op-log expectation that may need the `appendChild` args update.

---

## Non-Goals

- **No production code changes.** Not `Event.ts`, not `Component.ts`, not `DOM.ts`. If a behaviour cannot be tested without a production hook, it is deferred, not forced.
- **No selector engine.** `querySelector`/`querySelectorAll` stay empty offline — the event and geometry contracts don't need them; adding a CSS matcher is a separate effort.
- **No `z-index`/stacking-context model.** Hit-testing orders by DOM depth + sibling order only; explicit stacking contexts are a follow-up.
- **No computed-style modelling.** `getBorderWidths`/`getComputedOverflow` keep their default returns. The handle-keyed rect's position/size/translate come from the **recorded inline-style writes**; the parent **border inset** in composition comes from the per-handle `setBorderInset` injection (default zero), never a cached `Component` field (border is written rule-side and un-attributable per handle offline — see Architecture Decisions). Validating the border *write* path is out of scope.
- **No worker-transport work.** The seam is worker-ready by design, but serialising the modelled tree across a boundary is out of scope.
