# Listener Shape Consistency — Implementation Plan

> **Status:** Refreshed 2026-05-29 — no steps shipped yet. `AbstractStore.on/off` still return `void`; `AbstractInput`, `Binding`, `Tree`, `ButtonGroup`, `Scrollbar`, `SpinButton`, `WindowBorder`, `SplitGutter`, `ResizeHandle`, `Cell`, `HeaderCell`, `Header` (table), `Accordion`, `Tab` / `TabPanel`, `BooleanEditor`, and `Button.addActionListener` all match the pre-migration shapes described below. Sibling [`rectify-inline-event-listeners.md`](rectify-inline-event-listeners.md) has *not* yet shipped its `Body.ts` migration, so `Event.addViewportResizeListener` is still present at [Event.ts:454](../src/typescript/lib/core/Event.ts#L454) and called from [Body.ts:66](../src/typescript/lib/core/Body.ts#L66); this plan still inherits that migration (Architecture Decisions § first decision).

## Overview

The framework registers and fires listeners in many shapes today. The canonical event surface — `Event.addListener` / `Event.addSubtreeListener` / `Event.addViewportListener` / `Event.fireEvent` at [core/Event.ts:213](../src/typescript/lib/core/Event.ts#L213), [:303](../src/typescript/lib/core/Event.ts#L303), [:383](../src/typescript/lib/core/Event.ts#L383), [:185](../src/typescript/lib/core/Event.ts#L185) — coexists with ad-hoc `addXxxListener` / `removeXxxListener` pairs, single-slot `setOnXxxCallback` setters with private `_fireXxx` invokers, and the data store's `on('event', fn)` / `off('event', fn)` pair at [data/AbstractStore.ts:804](../src/typescript/lib/data/AbstractStore.ts#L804) / [:821](../src/typescript/lib/data/AbstractStore.ts#L821). The variants disagree on three axes: (1) the registration verb (`addListener` vs `addXxxListener` vs `on` vs `setOnXxxCallback`), (2) whether multiple listeners are supported (multi-listener arrays vs single-slot callbacks), and (3) the firing surface (`Event.fireEvent` dispatched DOM event vs in-class `fireXxx` array walk vs `emit` private method).

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

**Concretely — what gets renamed to `on`/`off`, and what doesn't:**

- `Event.addListener` / `Event.removeListener` / `Event.addSubtreeListener` / `Event.removeSubtreeListener` / `Event.addViewportListener` / `Event.removeViewportListener` / `Event.fireEvent` — **unchanged**, no rename. They are already canonical.
- `Button.addActionListener` — **renamed to `on("click", fn)`** as a typed shorthand wrapping `Event.addListener(this, "click", listener)`; matching `off("click", fn)` added for symmetry. `addActionListener` stays as a `@deprecated` one-line forwarder during the deprecation window; the follow-up plan deletes it once demos migrate.
- The legacy custom-event `addXxxListener` / `removeXxxListener` and `setOnXxxCallback` families — **collapsed to `on`/`off`/`emit`** (full machinery: `_listenerMap`, `emit`). These are: `AbstractInput.addChangeListener` / `removeChangeListener` / `addBindingListener`; `Binding.addChangeListener` / `addCommitListener` / `addRejectListener` / `addBeforeRecordListener`; `Tree.addSelectionListener`; `ButtonGroup.addSelectionListener`; `Scrollbar.addScrollListener` / `removeScrollListener`; `ScrollArrowButton.addTickListener`; `SpinButton.addTickListener`; `WindowBorder.addDragListener` / `removeDragListener`; `SplitGutter.addDragListener` / `removeDragListener`; `ResizeHandle.setOnDragStart` / `setOnDragMove` / `setOnDragEnd`; `Cell.setOnCommit` / `setOnEditEnd`; `HeaderCell.setOnSortClick` / `setOnContextMenu` / `setOnResizeDrag`; `Header.setOnColumnResize` / `setOnColumnContextMenu`; `Accordion.setOnSectionToggle`; `Tab.setOnTabClose` (+ `TabPanel.setOnTabClose` forwarder); `BooleanEditor.setOnChange`.
- `AbstractStore.on` / `off` already use the canonical names; this plan only widens their return type from `void` to `this` and brings `emit` from `private` to `protected`.

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
// AbstractInput.ts:129, :143, :174
addChangeListener(fn: (value: TValue) => void): this { this._changeListeners.push(fn); return this; }
removeChangeListener(fn: (value: TValue) => void): this { /* splice */ }
protected notifyChange(value: TValue): void { for (const fn of this._changeListeners) fn(value); for (const fn of this._bindingListeners) fn(); }
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

`addActionListener` ([Button.ts:439](../src/typescript/lib/component/button/Button.ts#L439)) is a special case: its body is *literally* `Event.addListener(this, "click", listener)`. It belongs in the DOM-routed family, not the custom-event family. **It is renamed to `on` with `"click"` as the only allowed event type** — a typed shorthand over `Event.addListener` rather than a deletion. After migration:

```typescript
// Button.ts — typed shorthand wrapping Event.addListener / Event.removeListener:
on(event: "click", listener: ClickListener): this {
    Event.addListener(this, "click", listener);
    return this;
}

off(event: "click", listener: ClickListener): this {
    Event.removeListener(this, "click", listener);
    return this;
}
```

No `_listenerMap`, no `emit` — Button has no internal multi-listener bag to manage, because `Event.addListener` already supports multiple listeners per `(id, type)` through its own per-id bucket. The typed event union (`"click"` and only `"click"`) makes `button.on("dblclick", fn)` a compile error; any future DOM event Button wants to expose is added by widening the union. `addActionListener` stays during the deprecation window as a one-line `@deprecated` forwarder to `on("click", fn)`; the follow-up demo-migration plan deletes it.

This makes Button's `on` a deliberately thin convenience over `Event.addListener` — same dispatcher, same window-level capture handler, same listener-bucket. The split is therefore "**`Event.X` is the *underlying* DOM-routed API** for everywhere; classes that own a small, canonical set of DOM events MAY expose them as a typed `on`/`off` shorthand; classes that own custom non-DOM events MUST use the `on`/`off`/`emit` full-machinery shape." Currently only Button qualifies for the shorthand; other DOM-event-bearing components keep raw `Event.addListener` at call sites until a similar small-canonical-event-set case appears.

### `setOnXxxCallback(fn)` family — collapse into `on('xxx', fn)`

The setter-of-callback shape:

```typescript
// ResizeHandle.ts:140
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

### Reuse via composition, not inheritance — `ListenerBag<TEvent>` delegate

The multi-listener bag logic — map of buckets, push on `on`, splice on `off`, walk on `emit` — is the same in every emitting class. Three ways to factor that out:

| Option | Verdict |
|---|---|
| **A. Put `on`/`off`/`emit` on `BaseObject`.** | Rejected. Most `BaseObject` subclasses don't dispatch any events; threading an event map into every Insets, Border, Color, Size, … is dead weight. Class-typed `on(event: FooEvent, listener: FooListener)` doesn't compose through a generic base — you'd lose the event-name typing. |
| **B. Shared mixin / interface (`interface EventEmitter<TEvent extends string>`).** | Rejected. TypeScript mixin gymnastics fight the framework's straightforward class hierarchy, and no two classes today share an event vocabulary, so a structural contract earns nothing. |
| **C. Composition via a private `ListenerBag<TEvent>` delegate field.** | **Chosen.** The bag is a tiny utility class (`core/ListenerBag.ts`) holding the `Map<TEvent, Function[]>` + `add` / `remove` / `fire` methods. Each emitting class instantiates one as a private field and writes one-line forwarders for its typed `on` / `off` / `emit`. Per-class boilerplate drops from ≈25 lines to ≈5 lines + the typed overload signatures the host owns either way. |

**Why composition sidesteps options A and B:**

1. **No dead weight.** Only classes that actually emit instantiate a `ListenerBag`. Insets / Border / Color / Size pay nothing.
2. **Typing preserved.** The typed `on(event: FooEvent, listener: FooListener)` overloads stay on the host class with the host's own event union; the bag is generic on `TEvent` and the host instantiates it with its own union. `tree.on("typo", fn)` is still a compile error.
3. **Single source of truth for the bag logic.** Future tweaks (registration-order guarantees, `once`, listener-count introspection) happen in one file.

**Encapsulation:** the bag field is **private**, never exposed. `tree._listeners.fire(...)` from outside the host is not possible because there is no public accessor. The host's `protected emit` forwards into `this._listeners.fire`; that protected method remains the only path to dispatch.

**Cost:** one function-call hop per `add` / `remove` / `fire` (in the noise) and one extra import + one new file. Compared to ≈275 lines of duplicated boilerplate across 11+ classes, the trade is clearly worth it.

### Removal symmetry

Every `add` has a `remove`. Every `on` has an `off`. Every `Event.addListener` has an `Event.removeListener`. No exceptions; the rectify-inline-event-listeners plan calls out one site ([Tooltip.attachToElement](../src/typescript/lib/core/Tooltip.ts#L310)) that has no detach counterpart — out of scope here, but flagged so a future plan addresses it. Anywhere this plan introduces an `on`, the matching `off` is added even if no caller uses it today; the surface is symmetric by construction.

---

## Public API (TypeScript Signatures)

### `ListenerBag<TEvent>` (new utility class — `core/ListenerBag.ts`)

Holds the multi-listener bag for one emitter. Generic on the event-name union.

```typescript
// core/ListenerBag.ts
export class ListenerBag<TEvent extends string> {
    private _buckets: Map<TEvent, Function[]> = new Map();

    /** Append `listener` to the bucket for `event`. */
    add(event: TEvent, listener: Function): void {
        let bucket = this._buckets.get(event);
        if (!bucket) {
            bucket = [];
            this._buckets.set(event, bucket);
        }

        bucket.push(listener);
    }

    /** Remove the first occurrence of `listener` from the bucket for `event`. No-op if absent. */
    remove(event: TEvent, listener: Function): void {
        const bucket = this._buckets.get(event);
        if (!bucket) {
            return;
        }

        const idx = bucket.indexOf(listener);
        if (idx >= 0) {
            bucket.splice(idx, 1);
        }
    }

    /** Invoke every listener registered for `event` with `payload`, in registration order. */
    fire(event: TEvent, ...payload: unknown[]): void {
        const bucket = this._buckets.get(event);
        if (!bucket) {
            return;
        }

        for (const listener of bucket) {
            listener(...payload);
        }
    }
}
```

### Canonical host shape (template — not a real symbol)

The shape every event-emitting class implements: a private `ListenerBag` field plus typed `on` / `off` / `emit` overloads whose bodies forward to the bag.

```typescript
// Conceptual; each class re-declares with its own event union:
class EventfulFoo {
    private _listeners = new ListenerBag<FooEvent>();

    on(event: FooEvent, listener: FooListener): this {
        this._listeners.add(event, listener);
        return this;
    }

    off(event: FooEvent, listener: FooListener): this {
        this._listeners.remove(event, listener);
        return this;
    }

    protected emit(event: FooEvent, ...payload: unknown[]): void {
        this._listeners.fire(event, ...payload);
    }
}
```

The typed payload typing (per-event overloads) lives on the host's `on` / `off` / `emit` methods; `ListenerBag` stays loose on payload (`Function` + `...payload: unknown[]`) because runtime-side typing earns nothing here. The compile-time gate is at the host's overload signatures.

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
| `HeaderCell` ([table/cell/Header.ts:302](../src/typescript/lib/component/table/cell/Header.ts#L302), [:311](../src/typescript/lib/component/table/cell/Header.ts#L311), [:356](../src/typescript/lib/component/table/cell/Header.ts#L356)) | `"sortclick"` `(fieldName, shiftKey)`, `"contextmenu"` `(fieldName, x, y)`, `"resizedrag"` `(delta)` |
| `Header` ([table/Header.ts:154](../src/typescript/lib/component/table/Header.ts#L154), [:163](../src/typescript/lib/component/table/Header.ts#L163)) | `"columnresize"` `(colIndex, delta)`, `"columncontextmenu"` `(fieldName, x, y)` |
| `Accordion` | `"sectiontoggle"` `(panel, isOpen, index)` |
| `Tab` / `TabPanel` | `"tabclose"` `(component)` |
| `BooleanEditor` ([table/cell/editor/Boolean.ts:61](../src/typescript/lib/component/table/cell/editor/Boolean.ts#L61)) | `"change"` `(value)` |

For each, the legacy `setOnXxx(fn)` method becomes a one-line `@deprecated` wrapper: `this.on("xxx", fn); return this;`. *Caveat: setter-style is single-listener; calling it twice today replaces the first callback. The forwarder doesn't replace — it appends. Document this in the deprecation JSDoc.* Removing the legacy setters in the follow-up plan is when the no-replacement semantics finally bind.

### `Button` (typed DOM shorthand)

```typescript
type ButtonEvent = "click";
type ClickListener = (event: MouseEvent) => void;

on(event: "click", listener: ClickListener): this;   // body: Event.addListener(this, "click", listener)
off(event: "click", listener: ClickListener): this;  // body: Event.removeListener(this, "click", listener)

/** @deprecated Use `on("click", fn)`. */
addActionListener(listener: ClickListener): this;    // body: return this.on("click", listener);
```

No `emit`, no `ListenerBag` — Button doesn't host its own custom-event bag. The on/off pair is a typed forwarder over `Event.X`; the dispatcher and the multi-listener bucket stay inside the `Event` class. Every other host in this plan uses `ListenerBag`; Button is the documented exception because its only event is a DOM-routed one.

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

Each emitting class adds approximately this block (illustrative, with `Tree` as the example). The `ListenerBag` delegate carries all the bag logic; the host writes one-line forwarders.

```typescript
// Tree.ts
import { ListenerBag } from "../../core/ListenerBag";

type TreeEvent = "selection";

class Tree extends Component<TreeOptions> {
    // existing fields ...
    private _listeners = new ListenerBag<TreeEvent>();

    on(event: "selection", listener: (nodes: TreeNode[]) => void): this {
        this._listeners.add(event, listener);
        return this;
    }

    off(event: TreeEvent, listener: Function): this {
        this._listeners.remove(event, listener);
        return this;
    }

    protected emit(event: "selection", nodes: TreeNode[]): void {
        this._listeners.fire(event, nodes);
    }

    /** @deprecated Use `on("selection", fn)`. */
    addSelectionListener(listener: (nodes: TreeNode[]) => void): this {
        return this.on("selection", listener);
    }

    // _fireSelectionListeners deleted — call sites now use `this.emit("selection", this.getSelectedNodes())`.
}
```

Per-class cost is one import, one field, three forwarder methods (≈8 lines + the typed overload signatures, which the host owns either way). All the bag mechanics — bucket creation, splice-on-remove, registration-order walk — live in `core/ListenerBag.ts`.

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

After — one delegate field, one `on`/`off`/`emit`:

```typescript
type ResizeHandleEvent = "dragstart" | "dragmove" | "dragend";

private _listeners = new ListenerBag<ResizeHandleEvent>();

on(event: "dragstart", listener: (e: MouseEvent) => void): this;
on(event: "dragmove", listener: (delta: number) => void): this;
on(event: "dragend", listener: () => void): this;
on(event: ResizeHandleEvent, listener: Function): this {
    this._listeners.add(event, listener);
    return this;
}

off(event: ResizeHandleEvent, listener: Function): this {
    this._listeners.remove(event, listener);
    return this;
}

protected emit(event: "dragstart", e: MouseEvent): void;
protected emit(event: "dragmove", delta: number): void;
protected emit(event: "dragend"): void;
protected emit(event: ResizeHandleEvent, ...payload: unknown[]): void {
    this._listeners.fire(event, ...payload);
}

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

### Step 1 — Create `core/ListenerBag.ts`

The shared multi-listener bag utility every emitting class will delegate to.

1. Create `src/typescript/lib/core/ListenerBag.ts` with the class shape defined in **Public API § ListenerBag<TEvent>** above (`add`, `remove`, `fire`; loose `Function` + `...payload: unknown[]` runtime typing; per-event-name typing happens at the host).
2. Export from the `core` barrel ([src/typescript/lib/core/index.ts](../src/typescript/lib/core/index.ts)) so other lib files can import it.
3. Add a brief JSDoc class header explaining the role ("private bag of multi-listener buckets, owned by an event-emitting host; the host writes typed `on`/`off`/`emit` forwarders over it").
4. **Verify:** `npx tsc --noEmit` → 0 errors. `grep -n 'ListenerBag' src/typescript/lib/core/index.ts` → 1 export line.

### Step 2 — `AbstractStore`: widen `on`/`off` to return `this`; swap to `ListenerBag` delegate

1. Replace the existing `private _listenerMap: Map<StoreEvent, StoreListener[]> = new Map();` field with `private _listeners = new ListenerBag<StoreEvent>();`.
2. Rewrite [`AbstractStore.on`:804](../src/typescript/lib/data/AbstractStore.ts#L804) body to `this._listeners.add(event, listener); return this;`. Widen return type from `void` to `this`.
3. Same for [`off`:821](../src/typescript/lib/data/AbstractStore.ts#L821) → `this._listeners.remove(event, listener); return this;`; widen return type.
4. Rewrite [`emit`:839](../src/typescript/lib/data/AbstractStore.ts#L839) body to `this._listeners.fire(event, payload);`. Promote visibility from `private` to `protected` (Architecture Decisions § "`emit` is `protected` — but `AbstractStore.emit` is `private` today").
5. Update JSDoc on `on` / `off` to document the chaining return.
6. **Verify:** `npx tsc --noEmit` → 0 errors. `grep -n '_listenerMap' src/typescript/lib/data/AbstractStore.ts` → 0.

### Step 3 — `AbstractInput`: introduce `on` / `off` / `emit`; deprecate `addChangeListener` / `removeChangeListener` / `addBindingListener`

1. Add `type AbstractInputEvent = "change" | "binding";` near the file top; import `ListenerBag`.
2. Add `private _listeners = new ListenerBag<AbstractInputEvent>();` field.
3. Add typed `on` / `off` overloaded methods + `protected emit` overloads (matching **Public API § Canonical host shape**), bodies forwarding to `this._listeners.add` / `.remove` / `.fire`.
4. Mark `addChangeListener` / `removeChangeListener` / `addBindingListener` `@deprecated`; bodies become `return this.on("change", fn);` / `return this.off("change", fn);` / `return this.on("binding", fn);`.
5. Rewrite `notifyChange(value)` body: replace the two for-loops at [AbstractInput.ts:174-182](../src/typescript/lib/component/input/AbstractInput.ts#L174) with `this.emit("change", value); this.emit("binding");`. Delete the two protected `_changeListeners` / `_bindingListeners` array fields at [:40-41](../src/typescript/lib/component/input/AbstractInput.ts#L40) once `notifyChange` is the sole reader (use grep to confirm).
6. **Verify:** `grep -nE '_changeListeners|_bindingListeners' src/typescript/lib/component/input/AbstractInput.ts` → 0 hits after deletion. `npx tsc --noEmit` → 0 errors.

### Step 4 — `Binding`: introduce `on` / `off` / `emit`; deprecate the four `addXxxListener` methods

1. Add `type BindingEvent = "change" | "commit" | "reject" | "beforerecord";`; import `ListenerBag`.
2. Add `private _listeners = new ListenerBag<BindingEvent>();` field + the typed `on` / `off` / `emit` forwarders per the canonical host shape.
3. Convert each existing `addXxxListener` ([Binding.ts:241, 248, 255, 279](../src/typescript/lib/core/Binding.ts#L241)) to a `@deprecated` forwarder.
4. Replace internal `_changeListeners.push` / `for (const fn of this._changeListeners) fn(...)` patterns with `this.on(...)` / `this.emit(...)`. Delete the four array fields once they're unreferenced.
5. **Verify:** `grep -nE '_(change|commit|reject|beforeRecord)Listeners' src/typescript/lib/core/Binding.ts` → 0. `npx tsc --noEmit` → 0.

### Step 5 — `Tree`, `ButtonGroup`: `addSelectionListener` → `on("selection", fn)`

Same shape as Steps 3-4, applied to the two `addSelectionListener` sites at [Tree.ts:164](../src/typescript/lib/component/tree/Tree.ts#L164) and [ButtonGroup.ts:70](../src/typescript/lib/core/ButtonGroup.ts#L70).

1. Add per-class `type TreeEvent = "selection";` / `type ButtonGroupEvent = "selection";`; import `ListenerBag` in each.
2. Add `private _listeners = new ListenerBag<TreeEvent>();` / `<ButtonGroupEvent>();` field + typed `on` / `off` / `emit` forwarders. Preserve the existing `addSelectionListener` as `@deprecated` forwarder.
3. Convert `_fireSelectionListeners` (Tree) / inline `_selectionListeners.forEach` (ButtonGroup) to `this.emit("selection", nodes)` / `this.emit("selection", button)`.
4. **Verify:** `grep -nE '_selectionListeners|_fireSelectionListeners' src/typescript/lib/component/tree/Tree.ts src/typescript/lib/core/ButtonGroup.ts` → 0.

### Step 6 — `Scrollbar` + nested `ScrollArrowButton`: `addScrollListener` / `addTickListener` → `on(...)`

1. `Scrollbar`: add `type ScrollbarEvent = "scroll";`, `private _listeners = new ListenerBag<ScrollbarEvent>();` field + typed `on` / `off` / `emit` forwarders, `@deprecated` forwarders on `addScrollListener` ([Scrollbar.ts:463](../src/typescript/lib/component/container/Scrollbar.ts#L463)) / `removeScrollListener` ([:474](../src/typescript/lib/component/container/Scrollbar.ts#L474)).
2. `ScrollArrowButton` (same file): `type ScrollArrowEvent = "tick";`, its own `_listeners` bag + forwarders, `@deprecated` forwarder on `addTickListener` ([:144](../src/typescript/lib/component/container/Scrollbar.ts#L144)).
3. Convert `fireScrollListeners` ([:688](../src/typescript/lib/component/container/Scrollbar.ts#L688)) / `fireTicks` ([:256](../src/typescript/lib/component/container/Scrollbar.ts#L256)) to `this.emit(...)`.
4. **Internal call sites** at [:381](../src/typescript/lib/component/container/Scrollbar.ts#L381) and [:390](../src/typescript/lib/component/container/Scrollbar.ts#L390) (`this._arrowStart.addTickListener((): void => this.onArrowTick(-1))`) currently pass inline arrows — they violate the named-function rule. Rewrite to pass a method reference: `this._arrowStart.on("tick", this._onStartTick)` where `_onStartTick = (): void => this.onArrowTick(-1)` is a bound class field, or use the named method directly. Same fix at :390.
5. **Verify:** `grep -n 'fireScrollListeners\|fireTicks\|_scrollListeners\|_tickListeners' src/typescript/lib/component/container/Scrollbar.ts` → 0 (the only `_listeners` reference is the new `ListenerBag` field).

### Step 7 — `SpinButton`: `addTickListener` → `on("tick", fn)`

Mirror Scrollbar's arrow button migration in [SpinButton.ts:49, 125, 175](../src/typescript/lib/component/input/SpinButton.ts#L49).

### Step 8 — `WindowBorder`, `SplitGutter`: `addDragListener` → `on("drag", fn)`

Two sites with structurally identical `_dragListeners: Function[]` arrays. Apply the canonical host shape: add `type WindowBorderEvent = "drag";` / `SplitGutterEvent = "drag";`, swap to `private _listeners = new ListenerBag<…>();`, write the typed `on` / `off` / `emit` forwarders, delete the old `_dragListeners` array + `fireDragListeners` private. **Also fixes the pre-existing bug at [WindowBorder.ts:142](../src/typescript/lib/component/container/WindowBorder.ts#L142)** where `removeDragListener` ([:136](../src/typescript/lib/component/container/WindowBorder.ts#L136)) mistakenly calls `push` instead of `splice` — `ListenerBag.remove` splices correctly. Mention in commit message; no separate plan needed since the buggy code is being deleted.

### Step 9 — `ResizeHandle`: collapse single-slot setters into `on` / `off` / `emit` + public verbs `dragMove(delta)` / `dragEnd()`

1. Add `type ResizeHandleEvent = "dragstart" | "dragmove" | "dragend";`, `private _listeners = new ListenerBag<ResizeHandleEvent>();` field, and the typed `on` / `off` / `emit` forwarders per the canonical host shape.
2. Rewrite the constructor body so the `mousedown` / `click` listeners fire `this.emit("dragstart", e)` / `e.stopPropagation()` instead of calling `_onDragStart?.(e)`.
3. Delete the three `_onDragStart` / `_onDragMove` / `_onDragEnd` fields and the three setters.
4. Replace `fireDragMove(delta)` / `fireDragEnd()` public methods with `dragMove(delta)` / `dragEnd()` (same body: `this.emit("dragmove", delta)` / `this.emit("dragend")`).
5. Add `listeners?: { dragstart?, dragmove?, dragend? }` to `ResizeHandleOptions`; `applyOptions` reads it and dispatches.
6. Update the host call sites in `HeaderCell` ([table/cell/Header.ts:387](../src/typescript/lib/component/table/cell/Header.ts#L387), [:396](../src/typescript/lib/component/table/cell/Header.ts#L396)) to call `this._resizeHandle.dragMove(e.movementX)` / `this._resizeHandle.dragEnd()`.
7. **Verify:** `grep -n '_onDragStart\|_onDragMove\|_onDragEnd\|setOnDragStart\|setOnDragMove\|setOnDragEnd\|fireDragMove\|fireDragEnd' src/typescript/lib/component/table/cell/ResizeHandle.ts` → 0 (allow matches in `@deprecated` forwarders if Step 9.5 keeps them; otherwise 0). The cell host's grep should show only `dragMove` / `dragEnd` calls.

### Step 10 — `Cell`, `HeaderCell`, `Header`: collapse setOn* setters

Apply the canonical shape to:

- [`Cell.setOnCommit` / `setOnEditEnd`:97, :108](../src/typescript/lib/component/table/cell/Cell.ts#L97) → `on("commit", fn)` / `on("editend", fn)`.
- [`HeaderCell.setOnSortClick` / `setOnContextMenu` / `setOnResizeDrag`:302, :311, :356](../src/typescript/lib/component/table/cell/Header.ts#L302) → `on("sortclick", fn)` / `on("contextmenu", fn)` / `on("resizedrag", fn)`.
- [`Header.setOnColumnResize` / `setOnColumnContextMenu`:154, :163](../src/typescript/lib/component/table/Header.ts#L154) → `on("columnresize", fn)` / `on("columncontextmenu", fn)`.

Each public-verb requirement (Step 9's pattern) only kicks in if an external class needs to drive the event; for these three, the event source is the class itself, so no external `dragMove`-style verb is needed.

### Step 11 — `Accordion`, `Tab`, `TabPanel`, `BooleanEditor`

- [`Accordion.setOnSectionToggle`:283](../src/typescript/lib/layout/Accordion.ts#L283) → `on("sectiontoggle", fn)`.
- [`Tab.setOnTabClose`:699](../src/typescript/lib/layout/Tab.ts#L699) + [`TabPanel.setOnTabClose`:136](../src/typescript/lib/component/container/TabPanel.ts#L136) (forwarder) → `on("tabclose", fn)`.
- [`BooleanEditor.setOnChange`:61](../src/typescript/lib/component/table/cell/editor/Boolean.ts#L61) → `on("change", fn)`.

### Step 12 — `Button.addActionListener` → `on("click", fn)` typed shorthand

[`Button.addActionListener`:439](../src/typescript/lib/component/button/Button.ts#L439) is renamed to `on`, with `"click"` as the sole permitted event type. Body stays as `Event.addListener(this, "click", listener); return this;` — **no `ListenerBag`, no `emit`** (Button has no internal custom-event bag; the DOM dispatches clicks and `Event.addListener` already supports multiple listeners per id). Button is the only host in the plan whose `on`/`off` forwards to `Event.X` instead of a `ListenerBag`.

1. Add `type ButtonEvent = "click";` near the file top.
2. Add `on(event: "click", listener: ClickListener): this` — body wraps `Event.addListener(this, "click", listener); return this;`.
3. Add `off(event: "click", listener: ClickListener): this` — body wraps `Event.removeListener(this, "click", listener); return this;` (symmetry; not strictly needed by current consumers, but the plan's removal-symmetry rule requires it).
4. Mark `addActionListener` `@deprecated`; rewrite its body as `return this.on("click", listener);` (one-line forwarder).
5. **Verify:** `npx tsc --noEmit` → 0 errors. `button.on("dblclick", fn)` would be a compile error if attempted; confirm by inserting a probe locally and removing before commit.

The ~30 demo call sites continue to compile via the `@deprecated` forwarder; the follow-up plan migrates them to `button.on("click", fn)` and deletes `addActionListener`. **Demos do not migrate to `Event.addListener(button, "click", fn)`** — they migrate to the new `on` shorthand. The bare `Event.addListener` form remains the canonical surface for DOM-event-bearing components that *don't* offer a typed `on` shorthand (everything except Button today).

### Step 13 — `XOptions` listener bags

For each class touched in Steps 2-10, extend the `XOptions` interface with a `listeners?` field and dispatch from `applyOptions`. Single-callback option fields (`onSectionToggle`, `onTabClose`, `onDragStart`, …) stay during the deprecation window as one-line forwarders that read the field and call `this.on(event, fn)`.

### Step 14 — Final grep gates

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

### Step 15 — Typecheck + docs

- `npx tsc --noEmit` → 0 errors.
- `npm run docs:build` → 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice is the only acceptable warning).
- Manual smoke: open `http://localhost:8015` and exercise the demo panels that wire these listeners (BindingPanel, AccordionDemoPanel, TabDemoPanel, ToolBarPanel, slow-table panel for Tree selection + Cell editing + Column resize, NumberSpinner, SplitPanel, Window resizing, ButtonGroup-via-RadioButton form). Each interaction that previously fired a listener still fires it (verify via console.log inserted ad-hoc, removed before commit).

### Step 16 — Draft the follow-up demo-migration plan

This plan ends with the `@deprecated` forwarders in place — the demo files (`MiscPanel.ts`, `BindingPanel.ts`, `AccordionDemoPanel.ts`, `TabDemoPanel.ts`, `ToolBarPanel.ts`, `SplitPanel.ts`, `LayoutTestPanel.ts`, `MultiSelectListPanel.ts`, plus a handful of lib call sites in `Slider.ts`, `NumberSpinner.ts`, `AbstractPickerField.ts`, `AutoCompleteField.ts`, `ComboBox.ts`, `PaginationBar.ts`, `TablePanel.ts`, `TreeTablePanel.ts`, `VirtualScroller.ts`, `WindowHeader.ts`, `Window.ts`, `Dialog.ts`) keep working unchanged. The follow-up plan migrates them to the canonical `on(...)` form and deletes the deprecated methods + the `XOptions` legacy single-callback fields (`onSectionToggle`, `onTabClose`, `onDragStart`, …).

Done now, while the migration shape is fresh in mind:

1. Invoke the `plan` skill with the brief: *"Migrate all `.addXxxListener(...)` / `.setOnXxx(...)` demo and lib call sites to `.on('xxx', ...)`; then delete the `@deprecated` forwarders, `_fireXxx` private helpers (where still present), and the legacy `onXxx` single-callback fields on `XOptions` interfaces. Scope is captured by `grep -rnE '\.add(Action|Selection|Tick|Drag|Scroll|Change|Binding|Commit|Reject|BeforeRecord)Listener\(|\.setOn[A-Z]\w+\(' src/typescript --include='*.ts'` after this plan ships."*
2. The skill writes the plan to `plans/migrate-listener-deprecations.md` (or whatever name it picks); leave the actual implementation for a later session.
3. Cross-link: this plan's Non-Goals section, the Step 12 Button paragraph, and the call-site-impact callout in **Files to Modify** all reference "the follow-up plan" — once the file exists, those references become concrete links rather than placeholders.

**Verify:** `ls plans/migrate-listener-deprecations.md` (or the chosen filename) succeeds; the plan's Overview enumerates the deprecated symbols this plan introduced.

---

## Files to Modify

| Action | File | Notes |
|---|---|---|
| Create | `src/typescript/lib/core/ListenerBag.ts` | New utility class. The multi-listener bag (`add` / `remove` / `fire`); every host except `Button` instantiates one as a private field. |
| Modify | `src/typescript/lib/core/index.ts` | Re-export `ListenerBag` from the `core` barrel. |
| Modify | `src/typescript/lib/data/AbstractStore.ts` | Swap `_listenerMap` for `ListenerBag<StoreEvent>` delegate; widen `on`/`off` return to `this`; promote `emit` from `private` to `protected`. |
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
| Modify | `src/typescript/lib/component/table/Table.ts` | Update call sites at [:121-122](../src/typescript/lib/component/table/Table.ts#L121) from `setOnColumnResize` / `setOnColumnContextMenu` to `on(...)`. |
| Modify | `src/typescript/lib/component/table/cell/editor/Boolean.ts` | Collapse `setOnChange` into `on("change", fn)`. |
| Modify | `src/typescript/lib/component/table/cell/Boolean.ts` | Update [:51](../src/typescript/lib/component/table/cell/Boolean.ts#L51) caller. |
| Modify | `src/typescript/lib/layout/Accordion.ts` | Collapse `setOnSectionToggle` into `on("sectiontoggle", fn)`. |
| Modify | `src/typescript/lib/layout/Tab.ts` | Collapse `setOnTabClose` into `on("tabclose", fn)`. |
| Modify | `src/typescript/lib/component/container/TabPanel.ts` | Update forwarder at [:136](../src/typescript/lib/component/container/TabPanel.ts#L136). |
| Modify | `src/typescript/lib/component/container/AccordionPanel.ts` | Update forwarder at [:88](../src/typescript/lib/component/container/AccordionPanel.ts#L88). |
| Modify | `src/typescript/lib/component/button/Button.ts` | Add typed `on("click", fn)` / `off("click", fn)` wrapping `Event.addListener` / `Event.removeListener`; rewrite `addActionListener` as a one-line `@deprecated` forwarder. |
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
- Step 14 greps all pass.
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

- **`Tab` is a `LayoutManager`, not a `Component`.** The `ListenerBag` delegate doesn't care — any class can hold one as a private field. `Tab` doesn't have a bag today; adding one is unremarkable. Just don't expect to share helpers with the Component side.
- **Multi-`setOnXxx` clobber semantics change.** A caller doing `cell.setOnCommit(a); cell.setOnCommit(b);` today silently drops `a`. The forwarder `setOnCommit = (fn) => this.on("commit", fn)` appends both. Document in the `@deprecated` JSDoc; flag in the migration commit message. If any consumer depended on the clobber semantics, that bug surfaces during smoke testing — there's no clean way to preserve the misbehaviour through a multi-listener forwarder.
- **Order of listener invocation isn't formally guaranteed.** Today's array-walk is registration order; `Map<event, Function[]>` plus `push` preserves that. Document this in the JSDoc on `on` so consumers don't accidentally depend on it before it's part of the contract — registration order is the contract, but say so.
- **`emit` is `protected` — but `AbstractStore.emit` is `private` today.** Bring it to `protected` so subclasses (e.g. a future server-side `SocketStore`) can emit. No external behavioral change.
- **The `XOptions.listeners` bag's event-name typing.** TypeScript can type each listener payload via a mapped type (`{ [E in FooEvent]?: FooListener<E> }`) — but only if the listener-type lookup is itself a mapped type, which adds complexity. Acceptable simplification: type the bag as `{ [E in FooEvent]?: Function }` and rely on `on(event, fn)`'s overloads to catch type mismatches at the registration site. The bag is a thin forwarder; the real type-checking happens at `on(...)`.
- **Demo file fallout.** The deprecation forwarders mean demo files don't break. But Code Conventions recommend matching the canonical form; once the framework migration lands, the follow-up plan (see Non-Goals) walks the demos. Hand-migrating them in *this* plan triples the diff for no architectural gain.
- **`Event.addListener` already accepts an `options` bag for the passive override.** The new `on`/`off` is for custom (non-DOM) events; there's no analogous passive flag for them. No interaction; just clarify in JSDoc.

---

## Critical Files

- [src/typescript/lib/core/Event.ts](../src/typescript/lib/core/Event.ts) — the canonical DOM-routed listener surface; unchanged by this plan.
- `src/typescript/lib/core/ListenerBag.ts` (new) — the shared multi-listener bag; every emitting host except `Button` instantiates one.
- [src/typescript/lib/data/AbstractStore.ts](../src/typescript/lib/data/AbstractStore.ts) — the canonical custom-event `on`/`off`/`emit` shape; lines [804](../src/typescript/lib/data/AbstractStore.ts#L804), [821](../src/typescript/lib/data/AbstractStore.ts#L821), [839](../src/typescript/lib/data/AbstractStore.ts#L839). After Step 2, internals swap to a `ListenerBag<StoreEvent>` delegate.
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
- **Promoting `on`/`off`/`emit` onto `BaseObject` as inheritable machinery.** Rejected — most subclasses don't emit; the typed-event-union per class won't compose through a generic base. The plan reuses the bag logic via composition (`ListenerBag<TEvent>` delegate) instead.
- **Fixing the `WindowBorder.removeDragListener` splice bug as a standalone change.** It's repaired incidentally when its body becomes `off`'s splice; the fix is mentioned in the commit message but not split into its own plan.
- **Auditing `Event.ts`'s internal `addEventListener` calls.** Those are the four window-level central handlers the API is built on; already correct.
