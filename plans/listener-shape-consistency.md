# Listener Shape Consistency — Implementation Plan

## Overview

The framework registers and fires listeners in many shapes today. The canonical event surface — `Event.addListener` / `Event.addSubtreeListener` / `Event.addViewportListener` / `Event.fireEvent` at [core/Event.ts:213](../src/typescript/lib/core/Event.ts#L213), [:303](../src/typescript/lib/core/Event.ts#L303), [:383](../src/typescript/lib/core/Event.ts#L383), [:185](../src/typescript/lib/core/Event.ts#L185) — coexists with ad-hoc `addXxxListener` / `removeXxxListener` pairs, single-slot `setOnXxxCallback` setters with private `_fireXxx` invokers, and the data store's `on('event', fn)` / `off('event', fn)` pair at [data/AbstractStore.ts:804](../src/typescript/lib/data/AbstractStore.ts#L804). The variants disagree on three axes: (1) the registration verb (`addListener` vs `addXxxListener` vs `on` vs `setOnXxxCallback`), (2) whether multiple listeners are supported (multi-listener arrays vs single-slot callbacks), and (3) the firing surface (`Event.fireEvent` dispatched DOM event vs in-class `fireXxx` array walk vs `emit` private method).

Picking one canonical (de-)registration shape and one canonical firing shape — applied uniformly across the four families (DOM-routed component events, framework custom events, single-callback handoffs, store events) — collapses cognitive overhead, makes listener removal symmetric everywhere, and lets `grep` find every site of a given listener type with one pattern. Existing constraints stay intact: listeners reference named functions, hover events use `mouseover`/`mouseout`, container delegation uses `addSubtreeListener` (per memory feedback).

This plan defines the canonical shapes, maps every deviation in the codebase to its target migration, and lays out the steps. Runtime semantics (capture vs bubble, exact vs subtree, passive flag) are unchanged.

---

## Architecture Decisions

### Relationship to [`plans/rectify-inline-event-listeners.md`](rectify-inline-event-listeners.md)

This plan **complements, does not supersede,** the inline-listener rectification. That plan fixes inline-arrow handlers passed to `addEventListener` (handler shape — what's on the *right* side of the registration call). This plan fixes the *registration call itself* (the verb on the *left* side). They touch overlapping files (`Body.ts`, `Tooltip.ts`, `Event.ts`) but at different sites:

- `rectify-inline-event-listeners.md` deletes `Event.addViewportResizeListener` and migrates `Body.init()` to `Event.addViewportListener`. **This plan adopts that decision** — `Body.init()` ends up calling `Event.addViewportListener(this, "resize", this._onViewportResize)`, exactly as that plan prescribes. If `rectify-inline-event-listeners.md` ships first, this plan inherits the migrated `Body.ts`; if this plan ships first, the same migration happens here and the other plan's Step 3 is satisfied.
- This plan does **not** touch handler-side shape; inline arrows passed to `Event.addListener` are out of scope here (the named-function rule handles that). The migrations below preserve whatever handler shape the call site already uses.

Order suggestion in `## Ordered Implementation Steps` below picks the migrations that don't collide with `rectify-inline-event-listeners.md` first, then ships `Body.ts` via whichever plan reaches it.

### Two canonical shapes — one for DOM/component events, one for framework-custom events

There are genuinely two registration surfaces in the framework, with different responsibilities:

1. **DOM-routed events** (`click`, `mousedown`, `wheel`, `keydown`, `resize`, …): the `Event` class owns the window-level capture handler and the per-id dispatch. The canonical shape is the existing `Event.addListener(owner, type, handler)` / `Event.addSubtreeListener(owner, type, handler)` / `Event.addViewportListener(owner, type, handler)` triple, with `Event.fireEvent(owner, type, payload?)` to emit. **ARCHITECTURE.md "Event handling" already mandates this surface;** the work here is converting the remaining ad-hoc sites that still expose their own `addXxxListener` over a DOM event into `Event.addListener(owner, "xxx", fn)` and `Event.fireEvent(owner, "xxx", payload)`.

2. **Framework-custom events** (`change`, `tick`, `scroll`, `dragmove`, `selection`, `commit`, `reject`, `beforerecord`, `load`, `pagechanged`, …) — semantic events the framework defines on top of, or independent of, DOM events. These don't necessarily correspond to a DOM event type, may be fired multiple times per pass, and need a multi-listener fan-out the `Event` class isn't designed for (the class routes a single DOM event to per-id handlers; it doesn't multiplex multiple semantic events per id).

The canonical shape for #2 is the existing `AbstractStore` shape, generalised:

```typescript
class Foo extends BaseObject {
    on(event: FooEvent, listener: FooListener): this;
    off(event: FooEvent, listener: FooListener): this;
    protected emit(event: FooEvent, payload: ...): void;   // protected, not part of public API
}
```

`on` returns `this` for chaining (the store API today returns `void` — widen to `this`). `off` is the symmetric removal verb. `emit` is protected and signals "fire all listeners registered for this event name." Both `on`/`off`/`emit` are typed against a per-class `XEvent` string-literal union so the compiler catches typos.

Single-slot callbacks (`setOnSomething(fn)`) collapse into the same shape with a one-event multi-listener bag (`store.on('change', fn)` replaces `store.setOnChangeCallback(fn)`). Single-slot has no real use case the multi-listener form doesn't also serve, and the ResizeHandle / Header / Cell / Boolean call sites are all wrapper-layered (`Header.setOnColumnResize` wires through to `Cell.setOnResizeDrag` which writes a backing field). Collapsing to `on`/`off` removes the wrapper layer.

### Why not collapse #1 and #2 into a single `on`/`off`/`emit` API

Three reasons the two surfaces stay separate:

1. **Window-level capture handler.** The Event class's optimisation — one `window.addEventListener` per DOM event type, ids dispatched in O(1) — is *the* reason it exists. A custom-event `on`/`off`/`emit` API can't use that handler; the events never reach `window`. Forcing custom events through `Event` would either degrade them to per-component `dispatchEvent` calls (defeating the central handler) or require a parallel dispatcher (defeating the unification).

2. **Subtree semantics.** `Event.addSubtreeListener` is built on DOM bubbling — it walks `event.target.parentElement` up the DOM. Custom events don't bubble through the DOM (they don't *exist* in the DOM); subtree dispatch is meaningless for them.

3. **Multiple listeners per (id, type).** `Event.addListener` already supports this (the `compFunc.listeners` array at [Event.ts:14](../src/typescript/lib/core/Event.ts#L14)) — but the `Event` API still routes through a single DOM event. The on/off/emit form needs *no* DOM event at all, and the absence of a routing layer is the point: it's the cheap, in-process pub-sub the Store needs and that custom-event sites duplicate today.

The split is principled: **`Event.X` for anything that originates as a real DOM event**, **`on`/`off`/`emit` for anything that doesn't.**

### Canonical firing shape per family

| Family | Canonical firing call | Why |
|---|---|---|
| DOM event re-dispatch (typed setter wants to notify consumers as if the user had triggered the event) | `Event.fireEvent(this, "change")` / `Event.fireEvent(this, "click")` / `Event.fireEvent(this, "input")` | Already the convention at [Slider.ts:197](../src/typescript/lib/component/input/Slider.ts#L197), [Checkbox.ts:231](../src/typescript/lib/component/input/Checkbox.ts#L231), [ToggleButton.ts:117](../src/typescript/lib/component/button/ToggleButton.ts#L117). Listeners that consumers wire via `Event.addListener(button, "click", fn)` see the synthesized event identically to a real click. |
| Framework custom event | `this.emit("change", payload)` (or `this.emit("tick", ...)`, …) — protected method on the class | Fires every listener registered via `on("change", fn)` in registration order. Mirrors `AbstractStore.emit` at [AbstractStore.ts:839](../src/typescript/lib/data/AbstractStore.ts#L839). |
| Single-slot callback (legacy, being removed) | `this._onXCallback?.(...)` direct invocation | Goes away entirely — replaced by `emit`. |

`Event.fireEvent` dispatches a real `CustomEvent` on the element; the Event class routes it the same way as a native event. `emit` is purely in-process. Both are explicit at the call site about which dispatcher is being used; never ambiguous.

### `addXxxListener` family — collapse into `on('xxx', fn)`

Today's pattern:

```typescript
// AbstractInput.ts:129
addChangeListener(fn: (value: TValue) => void): this { this._changeListeners.push(fn); return this; }
removeChangeListener(fn: (value: TValue) => void): this { /* splice */ }
protected notifyChange(value: TValue): void { for (const fn of this._changeListeners) fn(value); }
```

After:

```typescript
// AbstractInput.ts
on(event: "change", listener: (value: TValue) => void): this;
on(event: "binding", listener: () => void): this;
on(event: AbstractInputEvent, listener: Function): this;
off(event: AbstractInputEvent, listener: Function): this;
protected emit(event: "change", value: TValue): void;
protected emit(event: "binding"): void;
```

Backward compatibility: keep `addChangeListener` / `removeChangeListener` as one-line `@deprecated` wrappers that forward to `on('change', fn)` / `off('change', fn)`. Same for the other consolidated APIs (`addScrollListener`, `addTickListener`, `addSelectionListener`, `addDragListener`, `addActionListener`, …). Wrappers are removed in a follow-up plan after consumer migration — see Non-Goals.

`addActionListener` ([Button.ts:312](../src/typescript/lib/component/button/Button.ts#L312)) is a special case: its body is *literally* `Event.addListener(this, "click", listener)`. It belongs in the DOM-routed family, not the custom-event family. The canonical replacement is the bare `Event.addListener(button, "click", fn)` — leave `addActionListener` as a `@deprecated` shorthand, then remove in the same follow-up.

### `setOnXxxCallback(fn)` family — collapse into `on('xxx', fn)`

The setter-of-callback shape:

```typescript
// ResizeHandle.ts:136
setOnDragStart(fn: (event: MouseEvent) => void): this { this._onDragStart = fn; return this; }
fireDragMove(delta: number): void { this._onDragMove?.(delta); }
```

This is a *one-listener* shape — a second `setOnDragStart` call clobbers the first. None of today's sites have a documented reason to be single-listener; the wrapper layers (`Header.setOnColumnResize` → `Cell.setOnResizeDrag` → `_onResizeCallback`) lose nothing by going multi-listener.

After migration:

```typescript
resizeHandle.on('dragstart', (e) => ...);
resizeHandle.on('dragmove', (delta) => ...);
resizeHandle.on('dragend', () => ...);

// inside ResizeHandle:
protected emit(event: "dragstart", e: MouseEvent): void;
protected emit(event: "dragmove", delta: number): void;
protected emit(event: "dragend"): void;
```

The host's existing `fireDragMove` / `fireDragEnd` calls become `this.emit('dragmove', delta)` / `this.emit('dragend')`. The public surface shrinks from three `setOn*` setters + two `fire*` methods to one `on`/`off`.

`onSectionToggle` (Accordion), `onTabClose` (Tab/TabPanel), `onSortClick` (Header cell), `onContextMenu` (Header cell), `onCommit` / `onEditEnd` (Cell), `onChange` (Boolean editor) all migrate identically.

### Construction-time listener registration — options-bag shape

Existing `XOptions` interfaces expose either single-callback fields (`onSectionToggle?: SectionToggleCallback`, `onDragStart?: ...`) or — in `AbstractStoreOptions` — a `listeners?: { [event]: listener }` bag. Both stay, with a consistent rule: **the option key is `listeners`** for multi-event multi-listener wiring (Store family), or **the option key matches the event name with `on` prefix** for legacy one-shot wiring during the deprecation window (matches existing `ResizeHandleOptions.onDragStart`).

The canonical post-migration shape uses the multi-event bag everywhere:

```typescript
interface ResizeHandleOptions extends ComponentOptions {
    listeners?: {
        dragstart?: (e: MouseEvent) => void;
        dragmove?:  (delta: number) => void;
        dragend?:   () => void;
    };
}
```

`applyOptions` iterates `options.listeners` and dispatches each entry to `on(event, fn)`. The legacy `onDragStart` / `onDragMove` / `onDragEnd` fields stay during the deprecation window as one-line forwarders. The Store form is already in this shape ([AbstractStore.ts:111-120](../src/typescript/lib/data/AbstractStore.ts#L111)).

### Constraints carried forward from memory feedback

- **Hover events use `mouseover` / `mouseout`, not `mouseenter` / `mouseleave`.** ([feedback_event_hover.md](~/.claude/projects/-home-jika-typescript-typescript/memory/feedback_event_hover.md)) The Event class's window-level capture handler doesn't see non-bubbling events. Any migration touching a hover listener must continue to use `mouseover`/`mouseout`. None of the on/off migrations introduce a new hover listener type; the constraint binds future plan-authors and is restated here so the implementer doesn't accidentally type `mouseenter` while moving code.
- **Container delegation uses `addSubtreeListener`, not `addListener`.** ([feedback_event_subtree.md](~/.claude/projects/-home-jika-typescript-typescript/memory/feedback_event_subtree.md)) `addListener` matches only the exact-target id; subtree listening matches the ancestor walk. The migrations below preserve the existing subtree vs exact-id choice at every site; never collapse the distinction in either direction.

### Why not `EventEmitter` / `Node EventEmitter`-style API

The Node `EventEmitter` shape (`on(event, listener)` / `emit(event, ...args)` / `removeListener(event, listener)`) is a natural reference. The plan uses `on` / `off` / `emit` — the same names. The differences are:

- **Typed events.** Each class declares a string-literal union `FooEvent = "x" | "y" | "z"` so `foo.on("typo", fn)` is a compile error. Node's API is loose.
- **No `once`.** No call site in the codebase needs a self-removing listener; adding it now would be speculative. If a real need appears, add `once(event, listener)` separately.
- **No event-bubble / wildcard.** Custom events don't bubble. There's no `'*'` listener; that's a footgun.
- **No `emit` arg spreading.** Each event has a single typed payload object (mirrors the Store's `emit(event, payload)` form at [AbstractStore.ts:839](../src/typescript/lib/data/AbstractStore.ts#L839)). Multi-arg `emit` invites positional bugs.

### `BaseObject` does *not* gain `on` / `off` / `emit`

Tempting to put the multi-listener machinery on `BaseObject` so every class inherits it for free. Rejected:

- Most `BaseObject` subclasses don't dispatch any events. Threading an event map into every framework object (every Insets, Border, Color, Size, …) is dead weight.
- Class-typed `on(event: FooEvent, listener: FooListener)` doesn't compose through a generic base — you'd lose the event-name typing. Each event-emitting class re-declares `on`/`off`/`emit` with its own typed event union.
- A shared mixin / interface could express the contract (`interface EventEmitter<TEvent extends string>`), but no two classes today share an event vocabulary, so a mixin earns nothing.

The duplication is genuine but small (≈30 lines per emitting class for the `_listenerMap`, `on`, `off`, `emit` boilerplate). The alternative — base-class machinery — costs more in lost typing.

### Removal symmetry

Every `add` has a `remove`. Every `on` has an `off`. Every `Event.addListener` has an `Event.removeListener`. No exceptions; the rectify-inline-event-listeners plan calls out one site ([Tooltip.attachToElement](../src/typescript/lib/core/Tooltip.ts#L310)) that has no detach counterpart — out of scope here, but flagged so a future plan addresses it. Anywhere this plan introduces an `on`, the matching `off` is added even if no caller uses it today; the surface is symmetric by construction.

---

## Public API (TypeScript Signatures)

### Canonical mixin shape (template — not a real symbol)

The shape every event-emitting class implements. Not a runtime interface; the framework prefers concrete typed methods over a generic.

```typescript
// Conceptual; each class re-declares with its own event union:
abstract class EventfulFoo {
    private _listenerMap: Map<string, Function[]> = new Map();

    on(event: FooEvent, listener: FooListener): this {
        let bucket = this._listenerMap.get(event);
        if (!bucket) {
            bucket = [];
            this._listenerMap.set(event, bucket);
        }

        bucket.push(listener);
        return this;
    }

    off(event: FooEvent, listener: FooListener): this {
        const bucket = this._listenerMap.get(event);
        if (!bucket) {
            return this;
        }

        const idx = bucket.indexOf(listener);
        if (idx >= 0) {
            bucket.splice(idx, 1);
        }
        return this;
    }

    protected emit(event: FooEvent, ...payload: unknown[]): void {
        const bucket = this._listenerMap.get(event);
        if (!bucket) {
            return;
        }

        for (const listener of bucket) {
            listener(...payload);
        }
    }
}
```

### `AbstractStore` (existing, widened)

```typescript
type StoreEvent = "load" | "add" | "remove" | "datachanged" | "sync" | "beforesync"
                | "loadingchanged" | "pagechanged";

on(event: StoreEvent, listener: StoreListener): this;   // currently returns void
off(event: StoreEvent, listener: StoreListener): this;  // currently returns void
protected emit(event: StoreEvent, payload: ...): void;  // unchanged
```

### `AbstractInput` (replaces `addChangeListener` / `removeChangeListener` / `addBindingListener` / `notifyChange`)

```typescript
type AbstractInputEvent = "change" | "binding";

on(event: "change", listener: (value: TValue) => void): this;
on(event: "binding", listener: () => void): this;
off(event: AbstractInputEvent, listener: Function): this;
protected emit(event: "change", value: TValue): void;
protected emit(event: "binding"): void;

/** @deprecated Use `on("change", fn)`. */
addChangeListener(fn: (value: TValue) => void): this;
/** @deprecated Use `off("change", fn)`. */
removeChangeListener(fn: (value: TValue) => void): this;
/** @deprecated Use `on("binding", fn)`. */
addBindingListener(fn: () => void): this;
```

### `Binding`

```typescript
type BindingEvent = "change" | "commit" | "reject" | "beforerecord";

on(event: "change", listener: (fieldName: string, value: unknown) => void): this;
on(event: "commit", listener: () => void): this;
on(event: "reject", listener: () => void): this;
on(event: "beforerecord", listener: BeforeRecordListener): this;
off(event: BindingEvent, listener: Function): this;
protected emit(event: BindingEvent, ...payload: unknown[]): void;

/** @deprecated */ addChangeListener(...): void;     // → on("change", ...)
/** @deprecated */ addCommitListener(...): void;     // → on("commit", ...)
/** @deprecated */ addRejectListener(...): void;     // → on("reject", ...)
/** @deprecated */ addBeforeRecordListener(...): void; // → on("beforerecord", ...)
```

### `Tree`, `ButtonGroup`, `Scrollbar`, `SpinButton`, `WindowBorder`, `SplitGutter`

Each replaces its single `addXxxListener(fn)` / `private fireXxx()` pair with `on(event, fn)` / `off(event, fn)` / `protected emit(event, ...)` against the obvious event name:

| Class | Event name | Payload |
|---|---|---|
| `Tree` | `"selection"` | `nodes: TreeNode[]` |
| `ButtonGroup` | `"selection"` | `button: RadioButton \| ToggleButton` |
| `Scrollbar` | `"scroll"` | `position: number` |
| `ScrollArrowButton` (inside `Scrollbar.ts`) | `"tick"` | `()` |
| `SpinButton` | `"tick"` | `()` |
| `WindowBorder` | `"drag"` | `e: MouseEvent` |
| `SplitGutter` | `"drag"` | `movement: number` |

Legacy methods (`addSelectionListener`, `addScrollListener`, `addTickListener`, `addDragListener`) stay as `@deprecated` forwarders until follow-up plan removes them.

### `ResizeHandle`, `Cell`, `Header` (table), `Accordion`, `Tab` / `TabPanel`, `BooleanEditor`

Single-slot `_onXCallback` fields + `setOnXxx(fn)` setters + `fireX(...)` invokers collapse into `on('xxx', fn)` / `off('xxx', fn)` / `emit('xxx', ...)`. Per-class event unions:

| Class | Events |
|---|---|
| `ResizeHandle` | `"dragstart"` `(e)`, `"dragmove"` `(delta)`, `"dragend"` `()` |
| `Cell` | `"commit"` `(value)`, `"editend"` `()` |
| `HeaderCell` ([table/cell/Header.ts](../src/typescript/lib/component/table/cell/Header.ts)) | `"sortclick"` `(fieldName, shiftKey)`, `"contextmenu"` `(fieldName, x, y)`, `"resizedrag"` `(delta)` |
| `Header` ([table/Header.ts](../src/typescript/lib/component/table/Header.ts)) | `"columnresize"` `(colIndex, delta)`, `"columncontextmenu"` `(fieldName, x, y)` |
| `Accordion` | `"sectiontoggle"` `(panel, isOpen, index)` |
| `Tab` / `TabPanel` | `"tabclose"` `(component)` |
| `BooleanEditor` ([table/cell/editor/Boolean.ts](../src/typescript/lib/component/table/cell/editor/Boolean.ts)) | `"change"` `(value)` |

For each, the legacy `setOnXxx(fn)` method becomes a one-line `@deprecated` wrapper: `this.on("xxx", fn); return this;`. *Caveat: setter-style is single-listener; calling it twice today replaces the first callback. The forwarder doesn't replace — it appends. Document this in the deprecation JSDoc.* Removing the legacy setters in the follow-up plan is when the no-replacement semantics finally bind.

### `XOptions` listener bag

Each emitting class's options interface gains:

```typescript
interface FooOptions extends ComponentOptions {
    listeners?: {
        [E in FooEvent]?: FooListener<E>;
    };
}
```

Existing single-callback option fields (`onDragStart`, `onTabClose`, `onSectionToggle`) stay during the deprecation window as forwarders. `applyOptions` reads `options.listeners` and dispatches each entry to `on(event, fn)`; this mirrors [AbstractStore.applyOptions:111-120](../src/typescript/lib/data/AbstractStore.ts#L111).

### `Event` namespace (unchanged)

`Event.addListener` / `Event.addSubtreeListener` / `Event.addViewportListener` / `Event.removeListener` / `Event.removeSubtreeListener` / `Event.removeViewportListener` / `Event.fireEvent` stay exactly as today. **No new methods, no renames.** The canonical DOM-event surface is already correct.

`Event.addViewportResizeListener` is being removed by `rectify-inline-event-listeners.md`; this plan inherits that decision (see Architecture Decisions § first decision) and does not re-introduce it.

---

## Internal Structure

### Per-class event-emitter boilerplate

Each emitting class adds approximately this block (illustrative, with `Tree` as the example):

```typescript
// Tree.ts
type TreeEvent = "selection";

class Tree extends Component<TreeOptions> {
    // existing fields ...
    private _listenerMap: Map<TreeEvent, Function[]> = new Map();

    on(event: "selection", listener: (nodes: TreeNode[]) => void): this {
        let bucket = this._listenerMap.get(event);
        if (!bucket) {
            bucket = [];
            this._listenerMap.set(event, bucket);
        }

        bucket.push(listener);

        return this;
    }

    off(event: TreeEvent, listener: Function): this {
        const bucket = this._listenerMap.get(event);
        if (!bucket) {
            return this;
        }

        const idx = bucket.indexOf(listener);
        if (idx >= 0) {
            bucket.splice(idx, 1);
        }

        return this;
    }

    protected emit(event: "selection", nodes: TreeNode[]): void {
        const bucket = this._listenerMap.get(event);
        if (!bucket) {
            return;
        }

        for (const listener of bucket) {
            listener(nodes);
        }
    }

    /** @deprecated Use `on("selection", fn)`. */
    addSelectionListener(listener: (nodes: TreeNode[]) => void): this {
        return this.on("selection", listener);
    }

    // _fireSelectionListeners deleted — call sites now use `this.emit("selection", this.getSelectedNodes())`.
}
```

The boilerplate is genuinely ≈30 lines per class. A shared mixin / utility is rejected (see Architecture Decisions); the duplication is the cost of typed-event support without TypeScript generic gymnastics.

### Collapsing single-slot setters

Take `ResizeHandle` as a worked example. Before — three backing fields, three setters, two fire methods:

```typescript
declare private _onDragStart: ((event: MouseEvent) => void) | null;
declare private _onDragMove:  ((delta: number) => void) | null;
declare private _onDragEnd:   (() => void) | null;

setOnDragStart(fn): this { this._onDragStart = fn; return this; }
setOnDragMove(fn): this { this._onDragMove = fn; return this; }
setOnDragEnd(fn): this { this._onDragEnd = fn; return this; }
fireDragMove(delta): void { this._onDragMove?.(delta); }
fireDragEnd(): void { this._onDragEnd?.(); }
// init() — Event.addListener(this, "mousedown", (e) => this._onDragStart?.(e));
```

After — one map, one `on`/`off`/`emit`:

```typescript
type ResizeHandleEvent = "dragstart" | "dragmove" | "dragend";

private _listenerMap: Map<ResizeHandleEvent, Function[]> = new Map();

on(event: "dragstart", listener: (e: MouseEvent) => void): this;
on(event: "dragmove", listener: (delta: number) => void): this;
on(event: "dragend", listener: () => void): this;
on(event: ResizeHandleEvent, listener: Function): this { /* boilerplate */ }

off(event: ResizeHandleEvent, listener: Function): this { /* boilerplate */ }

protected emit(event: "dragstart", e: MouseEvent): void;
protected emit(event: "dragmove", delta: number): void;
protected emit(event: "dragend"): void;
protected emit(event: ResizeHandleEvent, ...payload: unknown[]): void { /* boilerplate */ }

protected init(element?: HTMLElement): this {
    super.init(element);
    Event.addListener(this, "mousedown", this._onMouseDown);
    Event.addListener(this, "click",     this._onClick);
    return this;
}

private _onMouseDown = (e: MouseEvent): void => this.emit("dragstart", e);
private _onClick = (e: MouseEvent): void => e.stopPropagation();

// Host call sites:
//   resizeHandle.fireDragMove(d)  →  resizeHandle.emit("dragmove", d)
//                                      (only the host can call emit — see "Cross-component emit" below)
```

### Cross-component `emit`

`Header` ([table/cell/Header.ts:370](../src/typescript/lib/component/table/cell/Header.ts#L370)) currently calls `this._resizeHandle.fireDragMove(e.movementX)` — invoking a *public* method on the child. After migration, `emit` is `protected`, so external classes can't call it directly. Three options:

| Option | Verdict |
|---|---|
| A. Make `emit` public. | Rejected — breaks encapsulation; any consumer can fake events. |
| B. Re-expose a public `fireXxx(payload)` that calls `emit` internally. | Rejected — re-introduces the original problem. |
| C. Add a public verb that *triggers the same domain event the child would fire itself*. | **Chosen.** `ResizeHandle.dragMove(delta)` — public, expressive, and the child fires its own event. The Header calls `this._resizeHandle.dragMove(e.movementX)`. The child's `dragMove` body is `this.emit("dragmove", delta)`. |

Pattern: when an outer component needs to drive an inner component's event, define a public verb on the inner component (`dragMove`, `dragEnd`, `selectNode`, `closeTab`, …) whose body is `this.emit(...)`. The verb encodes the domain action; `emit` stays protected. This mirrors how `Slider.setValue(v)` ends with `Event.fireEvent(this, "input")` — the setter is public, the firing is internal.

### Store `emit` is already protected

[AbstractStore.emit:839](../src/typescript/lib/data/AbstractStore.ts#L839) is already `private`. Keep it that way — no cross-class emits in the store family.

---

## Ordered Implementation Steps

Each step ends with a grep checkpoint that should hold before moving on. Steps are ordered to avoid colliding with `rectify-inline-event-listeners.md`.

### Step 1 — `AbstractStore`: widen `on`/`off` to return `this`

1. Change [`AbstractStore.on`:804](../src/typescript/lib/data/AbstractStore.ts#L804) return type from `void` to `this`; add `return this;` before the closing brace.
2. Same for `off` at [:821](../src/typescript/lib/data/AbstractStore.ts#L821).
3. Update JSDoc to document the chaining return.
4. **Verify:** `npx tsc --noEmit` → 0 errors (Stores already return `this` from other setters; the change is additive).

### Step 2 — `AbstractInput`: introduce `on` / `off` / `emit`; deprecate `addChangeListener` / `removeChangeListener` / `addBindingListener`

1. Add `type AbstractInputEvent = "change" | "binding";` near the file top.
2. Add `private _listenerMap: Map<AbstractInputEvent, Function[]> = new Map();` field.
3. Add `on` / `off` overloaded methods, `protected emit` overloads, matching the canonical mixin shape.
4. Mark `addChangeListener` / `removeChangeListener` / `addBindingListener` `@deprecated`; bodies become `return this.on("change", fn);` / `return this.off("change", fn);` / `return this.on("binding", fn);`.
5. Rewrite `notifyChange(value)` body: replace the two for-loops at [AbstractInput.ts:174-181](../src/typescript/lib/component/input/AbstractInput.ts#L174) with `this.emit("change", value); this.emit("binding");`. Delete the two private `_changeListeners` / `_bindingListeners` array fields once `notifyChange` is the sole reader (use grep to confirm).
6. **Verify:** `grep -nE '_changeListeners|_bindingListeners' src/typescript/lib/component/input/AbstractInput.ts` → 0 hits after deletion. `npx tsc --noEmit` → 0 errors.

### Step 3 — `Binding`: introduce `on` / `off` / `emit`; deprecate the four `addXxxListener` methods

1. Add `type BindingEvent = "change" | "commit" | "reject" | "beforerecord";`.
2. Add `_listenerMap`, `on`, `off`, `protected emit` per the canonical shape.
3. Convert each existing `addXxxListener` ([Binding.ts:241, 248, 255, 279](../src/typescript/lib/core/Binding.ts#L241)) to a `@deprecated` forwarder.
4. Replace internal `_changeListeners.push` / `for (const fn of this._changeListeners) fn(...)` patterns with `this.on(...)` / `this.emit(...)`. Delete the four array fields once they're unreferenced.
5. **Verify:** `grep -nE '_(change|commit|reject|beforeRecord)Listeners' src/typescript/lib/core/Binding.ts` → 0. `npx tsc --noEmit` → 0.

### Step 4 — `Tree`, `ButtonGroup`: `addSelectionListener` → `on("selection", fn)`

Same shape as Steps 2-3, applied to the two `addSelectionListener` sites at [Tree.ts:164](../src/typescript/lib/component/tree/Tree.ts#L164) and [ButtonGroup.ts:70](../src/typescript/lib/core/ButtonGroup.ts#L70).

1. Add per-class `type TreeEvent = "selection";` / `type ButtonGroupEvent = "selection";`.
2. Add the canonical machinery; preserve the existing `addSelectionListener` as `@deprecated` forwarder.
3. Convert `_fireSelectionListeners` (Tree) / inline `_selectionListeners.forEach` (ButtonGroup) to `this.emit("selection", nodes)` / `this.emit("selection", button)`.
4. **Verify:** `grep -nE '_selectionListeners|_fireSelectionListeners' src/typescript/lib/component/tree/Tree.ts src/typescript/lib/core/ButtonGroup.ts` → 0.

### Step 5 — `Scrollbar` + nested `ScrollArrowButton`: `addScrollListener` / `addTickListener` → `on(...)`

1. `Scrollbar`: add `type ScrollbarEvent = "scroll";`, canonical machinery, `@deprecated` forwarder on `addScrollListener` / `removeScrollListener`.
2. `ScrollArrowButton` (same file): `type ScrollArrowEvent = "tick";`, machinery, forwarder.
3. Convert `fireScrollListeners` / `fireTicks` to `this.emit(...)`.
4. **Verify:** `grep -n 'fireScrollListeners\|fireTicks\|_scrollListeners\|_tickListeners' src/typescript/lib/component/container/Scrollbar.ts` → only the wrapped `emit` body's reference to `_listenerMap`.

### Step 6 — `SpinButton`: `addTickListener` → `on("tick", fn)`

Mirror Scrollbar's arrow button migration in [SpinButton.ts:49, 125, 175](../src/typescript/lib/component/input/SpinButton.ts#L49).

### Step 7 — `WindowBorder`, `SplitGutter`: `addDragListener` → `on("drag", fn)`

Two sites with structurally identical `_dragListeners: Function[]` arrays. Apply the canonical shape. **Also fixes the pre-existing bug at [WindowBorder.ts:138](../src/typescript/lib/component/container/WindowBorder.ts#L138)** where `removeDragListener` mistakenly calls `push` instead of `splice` — the `off` body splices correctly. Mention in commit message; no separate plan needed since the buggy code is being deleted.

### Step 8 — `ResizeHandle`: collapse single-slot setters into `on` / `off` / `emit` + public verbs `dragMove(delta)` / `dragEnd()`

1. Add `type ResizeHandleEvent = "dragstart" | "dragmove" | "dragend";` and the canonical machinery.
2. Rewrite the constructor body so the `mousedown` / `click` listeners fire `this.emit("dragstart", e)` / `e.stopPropagation()` instead of calling `_onDragStart?.(e)`.
3. Delete the three `_onDragStart` / `_onDragMove` / `_onDragEnd` fields and the three setters.
4. Replace `fireDragMove(delta)` / `fireDragEnd()` public methods with `dragMove(delta)` / `dragEnd()` (same body: `this.emit("dragmove", delta)` / `this.emit("dragend")`).
5. Add `listeners?: { dragstart?, dragmove?, dragend? }` to `ResizeHandleOptions`; `applyOptions` reads it and dispatches.
6. Update the host call sites in `HeaderCell` (table/cell/Header.ts at lines 370, 379) to call `this._resizeHandle.dragMove(e.movementX)` / `this._resizeHandle.dragEnd()`.
7. **Verify:** `grep -n '_onDragStart\|_onDragMove\|_onDragEnd\|setOnDragStart\|setOnDragMove\|setOnDragEnd\|fireDragMove\|fireDragEnd' src/typescript/lib/component/table/cell/ResizeHandle.ts` → 0 (allow matches in `@deprecated` forwarders if Step 8.5 keeps them; otherwise 0). The cell host's grep should show only `dragMove` / `dragEnd` calls.

### Step 9 — `Cell`, `HeaderCell`, `Header`: collapse setOn* setters

Apply the canonical shape to:

- [`Cell.setOnCommit` / `setOnEditEnd`:97, :108](../src/typescript/lib/component/table/cell/Cell.ts#L97) → `on("commit", fn)` / `on("editend", fn)`.
- [`HeaderCell.setOnSortClick` / `setOnContextMenu` / `setOnResizeDrag`:296, :305, :339](../src/typescript/lib/component/table/cell/Header.ts#L296) → `on("sortclick", fn)` / `on("contextmenu", fn)` / `on("resizedrag", fn)`.
- [`Header.setOnColumnResize` / `setOnColumnContextMenu`:124, :133](../src/typescript/lib/component/table/Header.ts#L124) → `on("columnresize", fn)` / `on("columncontextmenu", fn)`.

Each public-verb requirement (Step 8's pattern) only kicks in if an external class needs to drive the event; for these three, the event source is the class itself, so no external `dragMove`-style verb is needed.

### Step 10 — `Accordion`, `Tab`, `TabPanel`, `BooleanEditor`

- [`Accordion.setOnSectionToggle`:283](../src/typescript/lib/layout/Accordion.ts#L283) → `on("sectiontoggle", fn)`.
- [`Tab.setOnTabClose`:699](../src/typescript/lib/layout/Tab.ts#L699) + [`TabPanel.setOnTabClose`:136](../src/typescript/lib/component/container/TabPanel.ts#L136) (forwarder) → `on("tabclose", fn)`.
- [`BooleanEditor.setOnChange`:36](../src/typescript/lib/component/table/cell/editor/Boolean.ts#L36) → `on("change", fn)`.

### Step 11 — `Button.addActionListener` deprecation

[`Button.addActionListener`:312](../src/typescript/lib/component/button/Button.ts#L312)'s body is literally `Event.addListener(this, "click", listener); return this;`. Mark `@deprecated`, keep the body. The follow-up plan removes it and migrates the ~30 demo call sites to bare `Event.addListener(button, "click", fn)`.

### Step 12 — `XOptions` listener bags

For each class touched in Steps 2-10, extend the `XOptions` interface with a `listeners?` field and dispatch from `applyOptions`. Single-callback option fields (`onSectionToggle`, `onTabClose`, `onDragStart`, …) stay during the deprecation window as one-line forwarders that read the field and call `this.on(event, fn)`.

### Step 13 — Final grep gates

```bash
# Every event-emitting class exposes the canonical `on` method:
grep -rnE '^\s+on\(event:.*listener' src/typescript --include="*.ts" | wc -l
# Expect: ≥ 12 (Store + the 11 classes touched here; deprecation forwarders count too).

# No more `addXxxListener` outside Event.ts and the deprecation forwarders:
grep -rnE 'add[A-Z]\w*Listener\b' src/typescript --include="*.ts" | grep -v '@deprecated' | grep -v '/core/Event\.ts'
# Expect: only deprecation comments + the Event.addListener / addSubtreeListener /
# addViewportListener canonical API.

# No `setOnXxxCallback` field literals (i.e. fields ending in `Callback`):
grep -rnE 'private _on[A-Z]\w*Callback' src/typescript --include="*.ts"
# Expect: 0.

# Every fireXxx outside Event.fireEvent is now in `@deprecated` forwarders or removed:
grep -rnE '\bfire[A-Z]\w+\(' src/typescript --include="*.ts" | grep -v 'Event\.fireEvent' | grep -v '@deprecated'
# Expect: 0.
```

### Step 14 — Typecheck + docs

- `npx tsc --noEmit` → 0 errors.
- `npm run docs:build` → 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice is the only acceptable warning).
- Manual smoke: open `http://localhost:8015` and exercise the demo panels that wire these listeners (BindingPanel, AccordionDemoPanel, TabDemoPanel, ToolBarPanel, slow-table panel for Tree selection + Cell editing + Column resize, NumberSpinner, SplitPanel, Window resizing, ButtonGroup-via-RadioButton form). Each interaction that previously fired a listener still fires it (verify via console.log inserted ad-hoc, removed before commit).

---

## Files to Modify

| Action | File | Notes |
|---|---|---|
| Modify | `src/typescript/lib/data/AbstractStore.ts` | `on`/`off` return `this`. |
| Modify | `src/typescript/lib/component/input/AbstractInput.ts` | Add `on`/`off`/`emit`; rewrite `notifyChange`; deprecate `addChangeListener`/`removeChangeListener`/`addBindingListener`. |
| Modify | `src/typescript/lib/core/Binding.ts` | Add `on`/`off`/`emit`; deprecate four `addXxxListener` methods. |
| Modify | `src/typescript/lib/component/tree/Tree.ts` | Add `on`/`off`/`emit`; deprecate `addSelectionListener`. |
| Modify | `src/typescript/lib/core/ButtonGroup.ts` | Add `on`/`off`/`emit`; deprecate `addSelectionListener`. |
| Modify | `src/typescript/lib/component/container/Scrollbar.ts` | Two emitter migrations (`Scrollbar`, `ScrollArrowButton`). |
| Modify | `src/typescript/lib/component/input/SpinButton.ts` | Add `on`/`off`/`emit`; deprecate `addTickListener`. |
| Modify | `src/typescript/lib/component/container/WindowBorder.ts` | Add `on`/`off`/`emit`; deprecate `addDragListener`/`removeDragListener` (and fix the splice bug). |
| Modify | `src/typescript/lib/component/container/SplitGutter.ts` | Add `on`/`off`/`emit`; deprecate `addDragListener`. |
| Modify | `src/typescript/lib/component/table/cell/ResizeHandle.ts` | Collapse three setters + two fire methods into `on`/`off`/`emit` + public verbs `dragMove`/`dragEnd`. |
| Modify | `src/typescript/lib/component/table/cell/Cell.ts` | Collapse two `setOn*` into `on`/`off`/`emit`. |
| Modify | `src/typescript/lib/component/table/cell/Header.ts` | Collapse three `setOn*` into `on`/`off`/`emit`; update local emits. |
| Modify | `src/typescript/lib/component/table/Header.ts` | Collapse two `setOn*` into `on`/`off`/`emit`. |
| Modify | `src/typescript/lib/component/table/Table.ts` | Update call sites at [:115-116](../src/typescript/lib/component/table/Table.ts#L115) from `setOnColumnResize` / `setOnColumnContextMenu` to `on(...)`. |
| Modify | `src/typescript/lib/component/table/cell/editor/Boolean.ts` | Collapse `setOnChange` into `on("change", fn)`. |
| Modify | `src/typescript/lib/component/table/cell/Boolean.ts` | Update [:40](../src/typescript/lib/component/table/cell/Boolean.ts#L40) caller. |
| Modify | `src/typescript/lib/layout/Accordion.ts` | Collapse `setOnSectionToggle` into `on("sectiontoggle", fn)`. |
| Modify | `src/typescript/lib/layout/Tab.ts` | Collapse `setOnTabClose` into `on("tabclose", fn)`. |
| Modify | `src/typescript/lib/component/container/TabPanel.ts` | Update forwarder at [:136](../src/typescript/lib/component/container/TabPanel.ts#L136). |
| Modify | `src/typescript/lib/component/container/AccordionPanel.ts` | Update forwarder at [:88](../src/typescript/lib/component/container/AccordionPanel.ts#L88). |
| Modify | `src/typescript/lib/component/button/Button.ts` | Mark `addActionListener` `@deprecated`; body unchanged. |
| Modify | `src/typescript/lib/core/Body.ts` | Apply the same `_onViewportResize` migration `rectify-inline-event-listeners.md` mandates (if that plan hasn't shipped first). |

**Demo call-site impact** — every demo file that calls `.addActionListener(...)` / `.addSelectionListener(...)` / `.addTickListener(...)` keeps working via the deprecation forwarders. The follow-up plan migrates the demos:

```bash
# Demo files using deprecated APIs (sample search):
grep -rnE '\.add(Action|Selection|Tick|Drag|Scroll|Change|Binding|Commit|Reject|BeforeRecord)Listener\(' src/typescript --include="*.ts"
# Expect ≈40-60 hits across MiscPanel, BindingPanel, AccordionDemoPanel, TabDemoPanel,
# ToolBarPanel, SplitPanel, LayoutTestPanel, NumberSpinner (lib), main.ts, etc.
```

No files created, none deleted.

---

## Verification

- `npx tsc --noEmit` → 0 errors after each step and at the end.
- `npm run docs:build` → 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning). Verify `@deprecated` methods render with their deprecation marker in the generated API pages.
- Step 13 greps all pass.
- Manual smoke on `http://localhost:8015`:
  - **Store events:** load a table that uses `store.on('load', ...)`. Reload data; listener fires.
  - **AbstractInput:** Slider drag fires `change` listener bound via the new `slider.on("change", fn)` *and* a legacy `slider.addChangeListener(fn)` in the same demo.
  - **Binding:** edit a bound field; `binding.on("change", (field, value) => ...)` and `binding.addChangeListener` both fire.
  - **Tree selection:** clicking a tree node fires the selection listener via both surfaces.
  - **Scrollbar:** drag the thumb on the slow-table scrollbar; `addScrollListener` consumers receive updates.
  - **Tab close:** close a closeable tab; `on("tabclose", ...)` fires.
  - **Accordion section toggle:** click an accordion header; `on("sectiontoggle", ...)` fires; `singleOpen` mode still closes siblings.
  - **Column resize:** drag a header resize handle; the column resizes (verifies `ResizeHandle.dragMove` public verb + `Header.on("columnresize", ...)`).
  - **Button click:** click any demo button; `button.addActionListener(...)` still fires (forwarder), and a parallel `Event.addListener(button, "click", ...)` listener fires too.

---

## Documentation Impact

- **JSDoc `@deprecated` tags** on every legacy method get a `@see` reference to the canonical `on(...)` call. Typedoc renders these in the generated API pages.
- **`docs/concepts/events.md`** (if exists; otherwise add a stub under `docs/concepts/`) — covers the two surfaces. State the rule plainly: "DOM events → `Event.X`. Framework custom events → `on`/`off`/`emit`." Cross-link the two from each other.
- **`docs/recipes/`** — any recipe demonstrating listener wiring updates its examples to the new shape. Specifically check `docs/recipes/binding.md`, `docs/recipes/data-stores.md`, `docs/recipes/forms.md` for stale code.
- **Per-class curated pages** (`docs/components/`, `docs/layouts/`, `docs/data/`) — verify the listener sections aren't quoting deprecated methods. Each curated page that mentions `addXxxListener` gets updated to `on("xxx", ...)`.
- **JSDoc cross-bucket references** (`{@link Event}` vs the new per-class `on` method): the new `on` methods are same-bucket references — `{@link Tree.on}` resolves from inside `component/tree`. Cross-bucket references to the `Event` class stay as markdown links per [`_shared/docs-conventions.md`](.claude/skills/_shared/docs-conventions.md).
- **Run `npm run docs:build`** and confirm 0 errors / 0 link warnings.
- **No barrel changes.** All the methods are new on existing exported classes; no new symbols need re-exporting.

---

## Potential Challenges

- **Generic-base alternative would catch typos better.** Per-class `type FooEvent` literal unions get the typing job done, but they don't compose. A shared `EventEmitter<TEvent extends string, TPayload extends Record<TEvent, unknown[]>>` mixin would centralise the boilerplate and still type-check event names — at the cost of TypeScript declaration-merging / mixin gymnastics that fight the framework's straightforward class hierarchy. Default: stay with per-class duplication; revisit if the boilerplate proves painful after the third or fourth class.
- **`Tab` is a `LayoutManager`, not a `Component`.** The `on`/`off`/`emit` shape doesn't care — `LayoutManager` extends `BaseObject` and can host the same machinery — but `Tab` doesn't have a `_listenerMap` today. Adding it is fine; just don't expect to share helpers with the Component side.
- **Multi-`setOnXxx` clobber semantics change.** A caller doing `cell.setOnCommit(a); cell.setOnCommit(b);` today silently drops `a`. The forwarder `setOnCommit = (fn) => this.on("commit", fn)` appends both. Document in the `@deprecated` JSDoc; flag in the migration commit message. If any consumer depended on the clobber semantics, that bug surfaces during smoke testing — there's no clean way to preserve the misbehaviour through a multi-listener forwarder.
- **Order of listener invocation isn't formally guaranteed.** Today's array-walk is registration order; `Map<event, Function[]>` plus `push` preserves that. Document this in the JSDoc on `on` so consumers don't accidentally depend on it before it's part of the contract — registration order is the contract, but say so.
- **`emit` is `protected` — but `AbstractStore.emit` is `private` today.** Bring it to `protected` so subclasses (e.g. a future server-side `SocketStore`) can emit. No external behavioral change.
- **The `XOptions.listeners` bag's event-name typing.** TypeScript can type each listener payload via a mapped type (`{ [E in FooEvent]?: FooListener<E> }`) — but only if the listener-type lookup is itself a mapped type, which adds complexity. Acceptable simplification: type the bag as `{ [E in FooEvent]?: Function }` and rely on `on(event, fn)`'s overloads to catch type mismatches at the registration site. The bag is a thin forwarder; the real type-checking happens at `on(...)`.
- **Demo file fallout.** The deprecation forwarders mean demo files don't break. But Code Conventions recommend matching the canonical form; once the framework migration lands, the follow-up plan (see Non-Goals) walks the demos. Hand-migrating them in *this* plan triples the diff for no architectural gain.
- **`Event.addListener` already accepts an `options` bag for the passive override.** The new `on`/`off` is for custom (non-DOM) events; there's no analogous passive flag for them. No interaction; just clarify in JSDoc.

---

## Critical Files

- [src/typescript/lib/core/Event.ts](../src/typescript/lib/core/Event.ts) — the canonical DOM-routed listener surface; unchanged by this plan.
- [src/typescript/lib/data/AbstractStore.ts](../src/typescript/lib/data/AbstractStore.ts) — the canonical custom-event `on`/`off`/`emit` shape; lines [804](../src/typescript/lib/data/AbstractStore.ts#L804), [821](../src/typescript/lib/data/AbstractStore.ts#L821), [839](../src/typescript/lib/data/AbstractStore.ts#L839).
- [src/typescript/lib/component/input/AbstractInput.ts](../src/typescript/lib/component/input/AbstractInput.ts) — broadest emitter (every input subclass inherits `change`); migrate first after Store.
- [ARCHITECTURE.md](../ARCHITECTURE.md), "Event handling" — the named-function rule and the `Event.X` mandate this plan reinforces.
- [CODE_CONVENTIONS.md](../CODE_CONVENTIONS.md), "Framework rules" — the typed-setter rule (the `on`/`off`/`emit` shape is the listener-side typed-setter equivalent).
- [plans/rectify-inline-event-listeners.md](rectify-inline-event-listeners.md) — sibling plan; this plan inherits its `Body.ts` migration and its `addViewportResizeListener` removal.
- [plans/implemented/migrate-listeners-to-event.md](implemented/migrate-listeners-to-event.md) — historical context for why `Event.addListener` is the canonical DOM-routed shape (already shipped).
- Memory: [feedback_event_hover.md](~/.claude/projects/-home-jika-typescript-typescript/memory/feedback_event_hover.md), [feedback_event_subtree.md](~/.claude/projects/-home-jika-typescript-typescript/memory/feedback_event_subtree.md) — the constraints carried forward.

---

## Non-Goals

- **Removing the `@deprecated` forwarders.** A separate plan migrates the ≈40-60 demo call sites to the canonical `on(...)` form, then deletes the deprecated methods. Doing both in one plan triples the diff and inflates the merge surface.
- **Migrating `Tooltip.attachToElement` listeners.** Tooltip uses raw `addEventListener` on arbitrary external elements; ARCHITECTURE.md's raw-DOM-helper carve-out applies. Out of scope here, out of scope in `rectify-inline-event-listeners.md`.
- **Changing runtime semantics — capture vs bubble, passive vs active, exact-target vs subtree.** Every migration preserves the existing dispatch behaviour. Subtree listeners stay subtree, exact-id listeners stay exact-id; `mouseover`/`mouseout` stay `mouseover`/`mouseout` (never `mouseenter`/`mouseleave`).
- **Adding `once(event, listener)` to the `on`/`off`/`emit` API.** No current call site needs it. Speculative.
- **Adding event-bubbling to custom (non-DOM) events.** No call site needs it; the absence is the simplifier.
- **Merging the two surfaces** (`Event.X` and `on`/`off`/`emit`) into a single unified API. Rejected for cause in the Architecture Decisions — the window-level capture handler and the subtree semantics are the differentiators.
- **Promoting `on`/`off`/`emit` onto `BaseObject` as inheritable machinery.** Rejected — most subclasses don't emit; the typed-event-union per class won't compose through a generic base.
- **Fixing the `WindowBorder.removeDragListener` splice bug as a standalone change.** It's repaired incidentally when its body becomes `off`'s splice; the fix is mentioned in the commit message but not split into its own plan.
- **Auditing `Event.ts`'s internal `addEventListener` calls.** Those are the four window-level central handlers the API is built on; already correct.
