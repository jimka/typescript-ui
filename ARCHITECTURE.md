# Architecture Guidelines

Binding architectural rules for the framework. Every implementation plan (built via the `plan` skill) and every code change (executed via the `implement` skill, or written directly) must adhere to these.

## Event handling

The framework has **two event surfaces, split by the origin of the event**:

1. **DOM-routed events** (`click`, `mousedown`, `wheel`, `keydown`, `input`, `resize`, …) go through the `Event` class — `Event.addListener(this, type, handler)`, `Event.addSubtreeListener`, `Event.addViewportListener`, with `Event.fireEvent(this, type, payload?)` to dispatch. The `Event` class owns a single window-level capture handler per DOM event type and routes each event to per-id listener buckets. The `Event` module and the few primitives that need a native hook the Event API cannot model today (a `MediaQueryList`, a non-`Component` ancestor element, a one-shot `transitionend` on a raw node) register it through `DOM.sink.addListener` — the native `addEventListener` terminus lives behind the seam like every other DOM call. Extend the `Event` API rather than introducing new native-listener sites.

2. **Framework-custom events** (`change`, `binding`, `selection`, `tick`, `scroll`, `dragmove`, `commit`, `tabclose`, `sectiontoggle`, `contextmenu`, the store's `load` / `datachange` / …) — semantic events the framework defines on top of, or independent of, the DOM — go through a typed `on` / `off` / `emit` pub-sub surface backed by a private `ListenerBag<TEvent>` delegate (`core/ListenerBag.ts`). Each emitting class declares a string-literal `XEvent` union (so `foo.on("typo", fn)` is a compile error), writes one-line `on` / `off` forwarders into the bag, and dispatches through a `protected emit(event, payload)`. Listeners fire in registration order; every `on` has a matching `off`.

**The split is principled: `Event.X` for anything that originates as a real DOM event; `on` / `off` / `emit` for anything that doesn't.** The two never merge — the window-level capture handler and the subtree (DOM-bubbling) semantics only make sense for real DOM events, while custom events need an in-process multi-listener fan-out with no DOM routing.

A DOM-routed listener registered through `Event.addListener` / `addSubtreeListener` / `addViewportListener` tells the dispatcher what to do with the event by **return value**, not by calling `stopPropagation()` itself: nothing or `false` leaves the event untouched, `true` stops propagation, `{ prevent: true }` calls `preventDefault()`, and `{ stop: true, prevent: true }` does both. A subtree listener that returns a stop disposition ends the ancestor walk after every listener on its own component has run. Calling `stopPropagation()` directly still halts native DOM propagation (it is the event's own method) but no longer influences the dispatcher's walk — only a returned disposition does; `preventDefault()` is unaffected either way. This return protocol does not extend to `on` / `off` / `emit`: a `ListenerBag` fan-out has no DOM event to stop. A registration passed to `addListener` / `addSubtreeListener` may also set `stop` / `prevent` directly in the options bag — an unconditional floor OR'd with the listener's own returned disposition, for a handler whose outcome never actually varies by branch; a handler whose disposition depends on runtime state must leave the floor unset and keep using the return value.

`addListener` and `addSubtreeListener` (not `addViewportListener`, which is unfiltered) default to firing only for a primary-button press for a short list of press-initiating types (`mousedown`, `mouseup`, `click`, `dblclick`, `pointerdown`, `pointerup`); every other type defaults to `"any"`, since only those few actually represent an initiating press. A registration's `button: "aux" | "any"` opts a listener into non-primary or every-button delivery regardless of its type's default. See [Events](packages/lib/docs/concepts/events.md) for the full breakdown.

A class that owns a primary user gesture MAY expose it as a typed **semantic** `on` / `off` **shorthand** whose body wraps `Event.addListener(this, …)` / `Event.removeListener(this, …)`. The canonical case is the **`"action"`** event — the component's main interaction — which every interactive control exposes: `Button.on("action", fn)` (DOM `click`), `Checkbox.on("action", fn)` (DOM `click`), `Slider.on("action", fn)` (DOM `input`), `ComboBox.on("action", fn)` (DOM `change`), `ToggleButton.on("action", fn)` (DOM `change`), `List.on("action", fn)` (DOM `change`). **The public event name is semantic (`"action"`), deliberately decoupled from whichever DOM event the body registers** — consumers wire intent ("the control was actioned"), not the implementation's DOM type. This is sugar over the DOM surface, not the custom-event machinery: there is no `ListenerBag` and no `emit`, because `Event.addListener` already multiplexes listeners per id. Value-bearing inputs additionally expose the inherited custom `"change"` / `"binding"` events (via the `ListenerBag`) for the committed-value and data-binding paths — distinct from the DOM-routed `"action"`. Classes that emit custom (non-DOM) events MUST use the full `on` / `off` / `emit` + `ListenerBag` shape. When an outer component needs to drive an inner component's custom event, the inner component exposes a public domain verb (e.g. `ResizeHandle.dragMove(delta)`) whose body calls its own `emit` — `emit` stays `protected`, never called across class boundaries.

Construction-time listener wiring uses an options `listeners?` bag — a **closed** map of exactly the events the component exposes through `on()`, each typed to that overload's listener, so an inapplicable key (a raw DOM event the component doesn't surface, a foreign component's event, a typo) is a compile error. The bag is dispatched to `on(event, fn)` by the shared protected `Component.applyListeners(options?.listeners)` helper, called from the **constructor body** after `super()` returns — never from `applyOptions`, which runs inside `super()` before the `ListenerBag` field initializes. This is the deferred-dispatch face of the `super()`-cascade field trap (see [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md), *Fields written during the `super()` cascade*): a plain cached field that can hold its value through `super()` uses `declare` instead, but the `ListenerBag` needs a real instance, so its dispatch is deferred to after `super()` rather than the field being left bare. A class that exposes no `on()` surface carries no `listeners` option at all.

**Every class that accepts a `listeners` bag is responsible for its own `applyListeners` call — the base never wires a subclass's bag.** A base that is itself instantiable wires the bag only when it is the *directly-constructed* class: `Button` guards its call (by instance identity, since `callable()` routes construction through a Proxy that defeats `new.target`) so a plain `new Button(...)` wires its bag, while `ToggleButton` / `SpinButton` are skipped and each calls `applyListeners` from its own constructor after `super()`. This is what keeps a subclass event whose `ListenerBag` only exists post-`super()` (e.g. `SpinButton`'s `tick`) from being wired early or twice. The rule to remember when adding a subclass: if it declares a `listeners` bag — or widens an inherited one — it MUST call `this.applyListeners(options?.listeners)` in its own constructor body; a missing call silently drops the bag.

### Listeners must reference a named function

The `handler` (or `listener`) argument must always be a reference to a named function — a method on the component (`this.handleClick`) or a module-level function. Never pass an inline arrow function or function expression. A named reference is removable via `removeListener`, surfaces by name in stack traces, and is grep-able for audits; an inline closure is none of those. The rule applies equally to the raw `addEventListener` escape hatches above.

### A component must not listen to another component's events through `Event`

`Event.addListener(otherComponent, type, handler)` (and every other `Event` API call) is reserved for listening on **self** — `Event.addListener(this, …)` from inside a component, registering a listener on its own element. Calling any `Event` API against *another* `Component` instance is a bypass: it reaches past that component's named-method surface, couples the caller to the target's internal DOM and event routing, and prevents the target from changing how it dispatches events without silently breaking callers.

Every `Component` owns the event surface its consumers can subscribe to and exposes it through the typed `on(event, fn)` / `off(event, fn)` pair on the class itself — `Button.on("action", fn)`, `Tab.on("tabclose", fn)`, `Tree.on("selection", fn)`, `Scrollbar.on("scroll", fn)`, and so on. The consumer routes through `on`; the class owns the internal `Event.addListener(this, …)` (for the DOM shorthand) or `emit(…)` (for a custom event) call. When a consumer needs an event a component doesn't yet expose, widen that component's `XEvent` union and add the `on` overload — never reach for the raw `Event` API from outside.

The rule holds even when the bypass looks local (e.g. a parent component writing `Event.addListener(this._button, "click", …)` against a child it just constructed). The named-method surface is the contract; the raw call is not.

#### Accepted exception: the cell-editor subsystem

There is one documented, provisional carve-out: the table cell-editor subsystem (`Cell`, `CellEditorPool`, and the `ComboEditor` / `StringEditor` / `NumberEditor` editors) listens on the private inner control it constructed — a `CellEditor` / `CellRenderer`, or the editor's own inner `ComboBox` / `TextField` — for `"blur"` / `"keydown"` / `"input"` / `"dblclick"` to drive commit-on-blur, key proxying, and edit activation. These sites are marked with a `// Internal cell-editor wiring: listens on a privately-owned child; see the cell-editor carve-out in ARCHITECTURE.md.` comment. This is an accepted exception, **not** a licence to reach past any other component's surface. The framework-consistent fix — widening typed semantic `on()` DOM shorthands (`"blur"` / `"keydown"` / `"input"` / `"dblclick"`) onto `TextField`, `ComboBox`, `CellEditor`, and `CellRenderer` and routing these sites through them — is the intended end state; it is deferred because `TextField` / `ComboBox` are input components owned by a separate in-flight plan, and bundling a broad input-surface change into unrelated work would collide with it. Do not add new cross-component `Event` listening outside this named carve-out.

### Hover detection uses `mouseover` / `mouseout`

Because every DOM-routed event reaches the framework through a single window-level capture handler, hover wiring must use the **bubbling** `mouseover` / `mouseout` pair, never the non-bubbling `mouseenter` / `mouseleave`. Non-bubbling events do not propagate to the window capture handler in Chrome, so `Event.addListener(this, "mouseenter", …)` silently never fires. When you need true enter/leave semantics (ignoring moves between descendants), filter on `event.target` / `event.relatedTarget` inside the `mouseover` / `mouseout` handler rather than reaching for the non-bubbling events.

## One DOM element per class

A class owns exactly one DOM element. If a sub-element needs independent behaviour (event routing, its own CSS rule, layout), extract it into a `Component` subclass. Trivial non-interactive helpers (e.g. a resize-handle div) can stay as raw children.

## Compose before specializing

A thing that can be assembled from components the framework already provides — a container with a layout manager arranging existing pieces — must be built that way, not as a new specialized `Component` or `LayoutManager` subclass. This is the component-level twin of the manager hierarchy under [*Positioning is always absolute*](#positioning-is-always-absolute): just as a missing layout behaviour should extend an existing manager before it becomes a new primitive, a new piece of UI should be a composition of existing components before it becomes a new specialized one.

The bar is **not** "can it be composed" — almost anything can be. The bar is **"does composing it actively reduce total complexity and code, summed across every component involved."** A new specialized component earns its place only when it deletes more code and conceptual load than it adds; equivalently, composition is the wrong call only when it would merely *relocate* complexity across a component seam rather than remove it. Possibility is not justification — run the count, in both directions, before deciding.

The decision turns on what the would-be component mostly *is*:

- **Mostly arrangement → compose.** If its substance is "these existing pieces, positioned thus," a container plus `HBox` / `VBox` / `Grid` / `Card` / `Border` / `Fit` expresses it with no new class. Building a specialized component here just reimplements geometry the managers already own.
- **Mostly coordination → specialize.** When the mass of the thing is an irreducible coordinator — a state machine, a lifecycle, cross-child orchestration that no layout manager or child component contains — a dedicated class is correct, because composition can only move that logic across a boundary, never dissolve it.

Worked carve-out: `Tab` stays a specialized manager rather than being rebuilt as `VBox` / `HBox` + `TabBar` + `Card`. The strip is already an extracted component (`TabBar`) and the show-one-child primitive already exists (`Card`), so the *arrangement* genuinely is composable — yet `Tab`'s mass is coordination (lazy-load state machine, tear-off windows, cross-tab fade, tab-sync, and a parent-inset absorption that `VBox` / `HBox` cannot even express). Recomposing it would delete a little rect arithmetic while retaining the whole coordinator *and* adding a content container, cross-boundary selection wiring, and an extra DOM level — relocating complexity, not reducing it. So the composition is both possible and wrong: the count, not the possibility, is what decides.

## Keep presentation state out of data Models

A data `Model` holds domain state only — the fields that represent the record. Presentation and UI state — selection, hover, expanded/collapsed, scroll position, sort order, in-flight edit buffers — never live on the Model; they belong to the component rendering it. The Model is the binding source of truth shared across views, so folding view state into it breaks that contract: multiple views of the same record would contend over one field, and the transient flags would leak into anything that persists the Model.

## Positioning is always absolute

Every framework `Component` is positioned with `position: absolute`. Coordinates come from the parent's `LayoutManager` via `setX` / `setY` / `setWidth` / `setHeight`. No `position: relative`, no `position: sticky`, no `display: flex` / `display: grid` on a `Component` to lay out its children. The framework's containing-block math, scroll arithmetic, baseline alignment, and `overflow: auto` propagation all assume absolute children.

If a layout manager can't express what a component needs:

- **Add the feature to an existing manager.** Most missing behaviours fit cleanly into `HBox` / `VBox` / `Grid` / `Border` / `Tab` / `Accordion` / `Fit` / `Card` / `Absolute`. Add a constraint, an option, or an axis flag rather than a new layout primitive.
- **Override `doLayout` on the owning component.** For one-off arrangements where no manager generalises (e.g. `ComboBox` positioning its caret + label, `PickerButton` centring its glyph), the component places its children directly. Those children go in the **content box** — `getContentBounds()`, never `getWidth()` / `getHeight()` — because a child's containing block is already the parent's padding box, so one placed at `(0, 0)` and sized to the outer box starts inside the border and overruns the opposite edge, where `overflow: hidden` clips it. The `local/require-content-bounds` ESLint rule guards this — for any method that places children, not just `doLayout` — by reporting one that names its own outer box without reading its border. It is a guard, not a proof; the rule's header comment lists the shapes it cannot see, and its baseline is what it reports today rather than the whole remainder. Baseline entries come out as sites are fixed and none should go in.
- **Write a specialised layout manager.** When the arrangement is reused across components and doesn't fit existing managers, write a new `LayoutManager` subclass (e.g. `Table`'s body layout). Keep it inside the layout system, not as CSS.

`Component.setPosition` is `protected` — application code cannot reach it. Subclasses MAY call it post-`super()` for two documented carve-outs:

- **`Position.FIXED`** for floating overlays that anchor to the viewport. Used by `AnimatedDropdown` (and every dropdown / picker that extends it), `Popover`, `Notification`, `Dialog`, `DialogBackdrop`. These escape the containing-block hierarchy so they can render above arbitrary scroll containers and stacking contexts.
- **`Position.STATIC`** for an HTML element whose native semantics require in-flow rendering. Currently only `Legend` (the `<legend>` element renders inside its parent `<fieldset>`'s border notch only when statically positioned). Adding a new STATIC carve-out is a design decision — surface it in a plan rather than slipping it into a code change.

No other values are exposed on the `Position` enum. `relative` / `sticky` / `initial` / `inherit` are deliberately absent.

## Drag-and-drop feedback colours

Drag feedback uses two colour channels with fixed meanings; do not blur them. **Green / red** is a whole-target *validity* wash (`DragFeedback`, driven by the target's `accepts` predicate): green when the target accepts the drop, red when it refuses. **Blue** marks *position* in two tiers — a *faint* full-target wash for the "droppable here" affordance (a `DockRegion` body, a `TabBar` strip) plus a *brighter* mark for the precise zone or slot a drop will occupy (a `ReorderIndicator` insertion line, a `DockRegion` edge/centre zone, a `TabBar` strip's insertion bar); the bright mark's **red** variant flags a specific *illegal* spot (a no-op or self-drop) rather than the whole target being invalid. The convention consumers learn: **faint blue = "droppable here", bright blue = "it lands here", green = "valid drop area", red = "not here"**.

A drop target that paints its own positional feedback MUST set `suppressValidityTint` on its `makeDropTarget` options so the manager's whole-target wash does not stack a second, coarser signal over the precise one — keeping "where it lands" the same blue everywhere. Reserve the green / red wash for targets with a single outcome and no sub-region to point at (e.g. `TreeTable` rows, where a reparent has no finer slot to highlight). Consumer-facing version: [`docs/recipes/drag-and-drop.md`](docs/recipes/drag-and-drop.md).

Blue here is the framework's **single accent** — selection (`table.row.selected`, row/list `selectedBackground`) and the focus ring use the same hue — so drag's blue is intentional, not a clash with selection. It stays distinguishable by being transient and modal (drawn on overlays only during an active drag) and by treatment (a faint wash plus a thin bar, not a selection's filled state). Do not introduce a second accent hue for drag to "fix" the overlap.

## Size constraints: who is responsible for what

Every `Component` carries three size hints per axis — minimum, preferred, maximum — bound by the invariant `min ≤ preferred ≤ max`. Three distinct responsibilities keep them honest; conflating them is what historically produced "mysteriously collapsed" or "won't scroll" layouts. The consumer-facing version is [`docs/concepts/sizing.md`](docs/concepts/sizing.md).

- **Reporting — the layout manager's job.** A container's effective min/preferred/max is *derived from its children* by its `LayoutManager`'s `getMinSize` / `getPreferredSize` / `getMaxSize`. `Component` merges the manager's result with the component's own explicit `setMinSize` / `setMaxSize`: `Math.max` for the minimum, `Math.min` for the maximum — the tighter bound on each side. These reports flow *upward* — a parent reads them to size the child and to decide whether to scroll. The aggregation contract a manager must follow: **sum** child extents along its main axis, take the **max** along its cross axis, treat a `null` or sentinel child extent as **unbounded**, and saturate an unbounded axis rather than letting the sentinel overflow.
- **Self-clamping — the `Component`'s job.** `setWidth` / `setHeight` run `clampWidth` / `clampHeight`, the single place a component refuses a size outside its bounds. *Which* bounds bind depends on whether it is a `Panel` (see below).
- **Placement — the layout manager's job.** `doLayout` assigns each child a position and size within the space the parent gave it, honouring the per-component constraints (`fill`, `anchor`, `weight`, …).

### The rules

1. A component must never allow itself to be sized outside of its bounds.
2. A container must provide accurate min/preferred/max sizes derived from how its child components are laid out; when it uses a layout manager, the manager is responsible for calculating these sizes.
3. A layout manager that does not report accurate min/preferred/max sizes is a **bug** — fixed at the manager, never papered over downstream.
4. A layout manager lays out its components according to its own function and the per-component layout constraints.
5. A layout manager must never stretch a component beyond its max size (see rule 1).
6. A layout manager must never compress a component below its min size (see rule 1) — subject to the panel carve-out below.
7. If a component's minimum size is larger than the space its layout manager can assign it, the component's size is set to its preferred size and the component clips so it doesn't spill over; if it has no preferred size, the layout manager sizes it sensibly, to the best of its ability.

### General component vs. `Panel`

Rules 1 and 6 turn on *which* minimum binds a component's committed size — and that is the one place the two kinds diverge:

- A **general `Component`** clamps itself to its **merged, content-derived** `[min, max]`. It never collapses below the size its children need to render — a custom container you build keeps a content-based minimum. If its parent gives it less room, it overflows, and an ancestor scroll host carries the overflow.
- A **`Panel`** clamps only to its **own explicit** `setMinSize` / `setMaxSize`. It fits whatever space its parent allocates and lets the overflow clip — or scroll, when `setAutoScroll` is configured — rather than inflating back to its content size. This is the carve-out that lets a tall form sit inside a short scrolling panel.

The switch is the protected `Component.clampsToContentSize()` — `true` by default, overridden to `false` in `Panel`. In both cases an explicit `setMinSize` / `setMaxSize` remains a hard floor and ceiling; the difference is only whether the *layout-derived* minimum also binds.

One consequence for rules 6 and 7: because a manager may legitimately hand a `Panel` less than its content-minimum (the panel scrolls or clips), a manager must **not** itself floor a child up to that content-minimum. It assigns the available space, capped to the child's maximum, and leaves the minimum to the child's own clamp — which applies it for a general child and skips it for a panel.

## No cosmetic insets or padding

Insets and spacing express *layout structure* — they never exist to nudge something that merely looks visually off. Adding padding "to make it look right" masks the real defect (a wrong preferred size, a missing or mismeasured baseline, a layout manager not reporting accurate extents per the rules above), and the masked defect resurfaces the instant the content, font, or theme changes. When something sits wrong, trace it to the layout cause and fix it there — a [size-report bug](#size-constraints-who-is-responsible-for-what) at the manager, an optical-centring offset, a baseline. Reserve insets for genuine structural breathing room the design calls for, and document the value's "why" like any other [magic number](CODE_CONVENTIONS.md).

## Minimize direct DOM access

Before `element.style.*`, `document.createElement`, or `element.addEventListener`, check for a Component setter or `Event` API. Raw DOM is for things the framework has no API for — and even then it goes through the seam, never the element directly.

All DOM access goes through the **DOM seams** ([core/DOM.ts](src/typescript/lib/core/DOM.ts), see [docs/concepts/dom-seams](docs/concepts/dom-seams.md)), and elements are named by an opaque `Handle`, never by a live reference. Every write — structural mutation, inline style, attribute, scroll offset, focus, value, event listener, animation frame — is a `DOM.sink` call (single-element data writes batch through `DOM.sink.apply(handle, patch)`); every read — geometry, text metric, theme var, scroll/box-model size, computed style, traversal — is a `DOM.source` call that takes and returns `Handle`s. `core/DOM.ts` is the **only** module that touches *or holds a reference to* the real DOM (the production `ProductionDOMSink` / `ProductionDOMSource`, a module-private handle registry, and the relocated text/scrollbar measurement leaf). This is enforced by the type-aware `local/no-raw-dom` ESLint rule with an empty baseline: any raw DOM access — *or* any `Element`/`Node`/`HTMLElement` declaration — outside the seam is a build error. The seam lets tests swap in a recording sink and a modelled, browser-free read source, and leaves no live element crossing the boundary, so a worker transport can be added without touching call sites.

## All attributes and styles go through typed setters

| Category | Use |
|---|---|
| CSS | Component setters (`setBackgroundColor`, `setWidth`, …) — add one if missing |
| ARIA / `role` / `tabindex` | `this.getAria()`; extend `Aria.ts` if missing |
| HTML attribute on every Component | typed setter in `Component.ts` |
| HTML attribute specific to one component | private field + typed setter on that class; calls `setElementAttribute` internally |

Never call `element.setAttribute(...)` or `element.style.*` directly from component code.

### `Component.setAttribute` / `getAttribute` are for data-carrying attributes only

`Component.setAttribute` and `Component.getAttribute` exist for attributes whose **purpose is the data they expose** on the rendered element — framework-internal markers, debugging tags, identity reflection. The canonical example is `Component.setLayoutManager`, which dispatches a typed layout manager *and* mirrors the choice as `setAttribute("layout", layoutManager.getClassName())` so DevTools shows which layout is in effect.

Properties that **change how the component behaves** — input `type` / `inputmode` / `autocomplete`, `disabled`, `readonly`, `placeholder`, ARIA roles, layout primitives, anything the platform interprets — never reach `Component.setAttribute` at the call site. Define a typed setter on the owning class and call that; add the setter (private/protected if subclass-scoped) if it doesn't exist. The typed setter may still route through `Component.setAttribute` internally as the cache + DOM-flush primitive (that's an implementation detail), but the consumer-facing surface is the typed method.

This rule applies to constructors too. `this.setAttribute("type", "text")` in a subclass constructor is a violation; add `setType` and call that instead. The fix for the three bare-`<input>` cell editors (`DateEditor`, `DateTimeEditor`, `TimeEditor`) is the canonical pattern: a shared `TextInputCellEditor` base owns `setType` / `setInputMode` / `setAutoComplete`, and the editors call those from their constructor rather than the string-keyed `setAttribute` API.

## Three non-negotiable rules for every DOM write

These apply to **every** use of the escape hatches — `setElementCSSRule(s)`, `setElementStyle(s)`, `setElementAttribute`, `removeElementAttribute`, and their `clear*` / `remove*` companions:

1. **Always through a typed setter.** No call site outside the typed setter (or its `clearX` / `removeX`) may touch the low-level API. Constructors route through the setter too. Add the setter if it doesn't exist.
2. **Always cache in memory.** Reads return cached state, never re-query the DOM. A *layering property* — one that participates in the layered style-bag (see *Component CSS tiers and state-rule dedup*): `backgroundColor`, `border`, `cursor`, `outline`, `overflowX`/`overflowY`, `shadow`, and the rest of `StyleBag` — is cached in `_instanceStyle`, written unconditionally through `this.writeStyle({ foo: value })` and read through `this.resolveStyleValue("foo")` (or a typed `resolveFontValue` for `Text`'s font sub-bag); the per-key dedup against the class/group tier happens later, at flush time, not in the setter. Every other property still uses the options bag as its cache — for a setter whose input matches its `XOptions` field 1:1, write `this._options.foo = value` and read `this._options.foo ?? null`. Add a private `_foo` backing field only when the setter normalises or derives the stored form (e.g. `number | string` input stored as a `string` with a `"px"` suffix), so reads return the canonical form.
3. **Always expose on the `XOptions` bag** — *for consumer-configurable properties only*. The class's options interface gets a matching optional field; `applyOptions()` forwards it to the setter. Construction-time and post-construction APIs stay in lockstep. Properties that are intrinsic to the component's internal functioning — runtime caches, framework-managed bookkeeping, derived state, anything the consumer should not modify — must stay off the `XOptions` bag and live in a private backing field instead. The options bag is the consumer's configuration surface; reserve it for fields that genuinely belong there.

Default shape — options bag is the cache:

```typescript
export interface FooOptions extends ComponentOptions {
    textAlign?: string | null;
}

setTextAlign(value: string | null): this {
    this._options.textAlign = value;
    this.setElementCSSRule("textAlign", value);
    return this;
}

getTextAlign(): string | null {
    return this._options.textAlign ?? null;
}

protected applyOptions(options: FooOptions): this {
    super.applyOptions(options);

    if (options.textAlign !== undefined) {
        this.setTextAlign(options.textAlign);
    }

    return this;
}
```

When the setter normalises the value before storage, declare a private backing field of the normalised type and read from it instead:

```typescript
export interface FooOptions extends ComponentOptions {
    lineHeight?: number | string;
}

private _lineHeight: string | null = null;

setLineHeight(value: number | string): this {
    this._lineHeight = typeof value === "number" ? value + "px" : value;
    this.setElementCSSRule("lineHeight", this._lineHeight);
    return this;
}

getLineHeight(): string | null {
    return this._lineHeight;
}
```

### Class-level defaults must survive the getter

A field seeded in a `_default<Name>Options` bag is a **pure fallback** — never dispatched into `_options` at construction. The `?? null` getter above therefore **silently drops** it: `new Subclass().getX()` returns `null`, not the class default. For any field this class or a subclass defaults, pick one:

- **Fold it in the getter** — `return this._options.foo ?? this._defaultOptions.foo ?? null;` — when the value is read at render (`applyStyle`) or by a consumer. The common case.
- **Always-dispatch** — when the setter's effect is construction-time with no render re-read, have `applyOptions` call `this.setX(options.foo ?? this.getX())` so the effect fires for the default too. Never gate a defaulted field on `if (options.foo !== undefined)` alone.

A `clearX()` over a *folding* getter must suppress the default, not re-resolve it — distinguish *cleared* from *never-set* by key presence: `return "foo" in this._options ? (this._options.foo ?? null) : (this._defaultOptions.foo ?? null);`, with `clearX()` writing the key (`this._options.foo = undefined`). The chrome group (`border` / `borderRadius` / `shadow` / `backgroundImage`) instead keeps its default on the dispatch path with a non-folding getter, so `clear*()` suppression works without key presence.

This trap is invisible to the offline test harness (the missing default shows only in rendered CSS), so it is guarded mechanically: every class that defaults a field has a row in the default-resolution registry in [`tests/component/default-options-fallback.test.ts`](tests/component/default-options-fallback.test.ts). Add a row with the field.

**Read the folding getter internally too.** Folding the default into `getFoo()` fixes only the consumer's view. Any framework-internal use of the same field — a render path, an animation loop, a layout pass — must call `this.getFoo()` rather than reaching for `this._options.foo` directly, or the default resolves for a caller asking politely and is silently ignored where it actually matters. Callback hooks are the easy ones to miss: `this._options.onDraw?.(…)` in a draw path skips a subclass-defaulted hook entirely, so the class advertises a default that never fires.

### Constructors forward `subclassDefaults`

Every component constructor takes an optional second parameter and layers it over the class's own defaults, so a subclass can seed defaults without editing its parent:

```typescript
constructor(options?: FooOptions, subclassDefaults?: Partial<FooOptions>) {
    super(options, { ..._defaultFooOptions, ...(subclassDefaults ?? {}) });
}
```

Order matters: the class's own `_defaultFooOptions` first, the subclass bag second, so a subclass overrides rather than being overridden. A constructor that swallows the parameter — `super(options, _defaultFooOptions)` — is a dead end: nothing below it in the hierarchy can ever default a field, and the only remaining route is editing the parent's own constant. Forward it even when no subclass exists yet; the cost is one parameter and it cannot be added later without touching every subclass. This is also what the default-resolution registry above needs, since its rows seed defaults through exactly this parameter.

### `setElement*` is the low-level seam

`setElementCSSRule(s)`, `setElementStyle(s)`, and `setElementAttribute` are the buffered writes that the three rules above sit on top of. Restrict the callers to:

- A typed setter — the setter provides the cache.
- A constructor or initialiser writing static constants (e.g. theme-token CSS variable references like `var(--ts-ui-font-family, sans-serif)`).
- A flush whose source values are already cached elsewhere (e.g. `this._styleRule.setMany(this._border.toStyle())` — `_border` is the cache, `toStyle()` is its serialiser).

Never use them to plumb a stateful value that isn't cached anywhere.

## CSS writes go through `StyleRule` / `InlineStyle`

Never assign to `CSSStyleRule.style` or `HTMLElement.style` directly — no `rule.style.cssText = …`, no `rule.style.setProperty(…)`, no `element.style.width = …`, no `Object.assign(style, …)`. The framework owns two deferred-write buffers in [core/StyleTarget.ts](src/typescript/lib/core/StyleTarget.ts):

| Target | Class | Used by |
|---|---|---|
| `CSSStyleRule` (any selector — `#id`, `.class`, `:hover`, …) | `StyleRule` | Component rule, state rules, shared class rules |
| `HTMLElement.style` (inline) | `InlineStyle` | `setElementStyle(s)` |
| `HTMLElement` attributes | `ElementAttributes` | `setElementAttribute` / `removeElementAttribute` / `setDataAttribute` / the `attributes` option |

Both buffer writes into a dirty bag until the target materialises, then flush via camelCase property assignment. Going through the buffer keeps construction-time writes safe (queued before element/rule exists), keeps theme-toggle re-flushes intact, and gives logging/audits a single seam.

For a module-level shared class rule, the canonical pattern is:

```typescript
const rule = new StyleRule({ scope: "class", name: "Foo" });

rule.setMany({ position: "absolute", top: "0", /* … */ });
rule.ensure();
```

`StyleRuleScope` covers three shapes: `"class"` prepends `.`, with an optional `suffix` appended verbatim (e.g. `".pressed"`) for a shared class-tier state rule; `"component"` prepends `#`, with the same optional `suffix`; `"selector"` is verbatim selector text for pseudo-classes / compound selectors / pseudo-elements. The constructor owns the get-or-create handshake against a module-level cache.

If you find yourself reaching for `.style.X` on a `CSSStyleRule` or `HTMLElement`, stop — there is a `StyleRule` / `InlineStyle` (or a Component setter that wraps one) that should own that write.

## Component CSS tiers and state-rule dedup

Every rendered element can be styled from up to four CSS rules, ranked by specificity — written `(id, class, type)`, the standard three-number comparison:

| Tier | Selector shape | Specificity | Who writes it |
|---|---|---|---|
| Framework | `:where(.ts-ui-component)` | `(0,0,0)` | `core/ClassStyleRules.ts`, once per process |
| Class | `.ButtonName`, `.ButtonName.pressed`, `.ButtonName.selected`, … | `(0,1,0)` per class chained | `ClassStyleDefaults` / `ensureClassStyleRule` / `ensureClassStateRule`, once per concrete component class |
| Trait | `.ts-ui-component.ts-ui-trait-<name>` | `(0,2,0)` | `core/ClassStyleRules.ts`'s `ensureTraitStyleRule`, once per trait name per process — ranked above Class and below a guarded declared state |
| Instance | `#c17`, `#c17.pressed`, `#c17:not(.pressed)`, … | `(1,0,0)` regardless of how many classes are chained | Each `Component`'s own setters |

An id always outranks any number of chained classes. That makes a bare `#id` declaration beat a class-tier state rule like `.ButtonName.pressed` even though the latter chains two classes — so an instance that customizes a resting property (a caller-supplied `backgroundColor`, say) while its class also shares a `.pressed` rule for that property silently defeats `.pressed` for that one instance, permanently.

| Selectors compared | Specificity | Winner |
|---|---|---|
| `#c17` vs `.Button.pressed` | `(1,0,0)` vs `(0,2,0)` | `#c17` — the id wins regardless of pressed state |
| `#c17:not(.pressed)` vs `.Button.pressed` | `(1,1,0)` vs `(0,2,0)` | Neither: `:not(.pressed)` never matches while `.pressed` does, so only one selector applies at a time |

The fix is `:not()`: give the resting-tier write its own instance rule that excludes the toggle class, e.g. `#c17:not(.pressed)`. Because the two selectors can never match the same element at the same moment, there's nothing left to arbitrate.

`Component` automates this for every declared toggle state, not a hand-picked property list. A class declares `protected static readonly ownStyleStates: readonly StyleStateSpec[]` — an ordered array of `{ selector, extract }`, highest priority first (the first active entry wins when several are active at once). `resolveStyleStates` (`core/ClassStyleRules.ts`) resolves each entry's `:not(...)`-guarded suffix against every entry earlier in the list and builds its `.ClassName<guardedSuffix>` class-tier rule from `extract`'s returned `StyleBag`; `restingGuardSuffix` joins every entry's own guard into the one suffix the resting tier's own isolation rule uses, and `restingIsolationKeys` (the union of every declared state's own `StyleBag` keys) replaces the old fixed three-property list — a state that declares a fourth property is isolated automatically, not only after someone remembers to widen a hand-kept set. `setStyleState(selector, active)` / `isStyleState(selector)` toggle and query a declared state on an instance, updating the DOM class token (a `.`-prefixed selector) or nothing (a `:`-prefixed pseudo-class, which the browser drives itself). Adding a new toggle-class state is one declaration:

```typescript
protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
    { selector: ".pressed", extract: (): StyleBag => ({ backgroundColor: "…" }) },
];
```

No override, no manual suffix bookkeeping — the guard and the isolation key set both fall out of the declaration. `Button` (`.pressed`, `:hover`), `SpinButton` (`.pressed`, restated with its own `shadow`), `ToggleButton` (`.selected`), `Checkbox`'s `CheckboxBox` delegate (`.selected`, `.indeterminate`), `RadioButton`'s `RadioButtonRing` delegate (`.selected`), `Scrollbar`'s arrow/thumb delegates (`.disabled`, `.hover`), `HeaderCell` (`:active`), `Row` / `Cell` / `TreeRow`'s pooled per-record tints (`.selected`, `.new`, `.dirty`, `.stripe`, `.rangeSelected`, `.readOnly`, `.requiredEmpty`), `Component` itself (`.invisible`), and `Scrollbar` (`.undisplayed`) are the components that declare states today. A declared state that also needs its own per-instance override setters (`Button`'s `setPressedX`/`setHoverX` methods and siblings, `ToggleButton`'s `setSelectedBackgroundColor` and siblings) writes through `this.writeStateStyle(selector, patch)` — the state-tier twin of `writeStyle` — which caches into a per-selector `_instanceStateStyle` layer unconditionally and defers dedup to flush time: `flushStateStyleBag` compares each pending key against `resolveStyleStates(ctor)`'s own resolved bag for that selector and queues an explicit `null` (a removal, not a skip) on a match, so a value that happens to equal the class token still clears any stale pin from an earlier write. The matching getter reads `this.resolveStateStyleValue(selector, key)`, which walks only `[instanceStateLayer(selector), classStateLayer(selector)]` — never the resting tiers — answering "what does this instance's own override for this state declare", not "what is currently painted". A write whose whole purpose is to outrank the class rule even when the two values coincide (`Button.pinPressedToResting`, pinning a chromeless instance's resting values onto `.pressed`) goes through `pinStateStyle` instead, which queues every key verbatim with the class-bag comparison removed.

A state that shares no property with anything else the class declares is a different case: `guardedSuffixFor` guards a state against *every* higher-priority `ownStyleStates` entry unconditionally, not only ones sharing a CSS property, so folding a property-disjoint state into that list would suppress an unrelated one's entire rule whenever both are active at once — a focused *and* read-only `Cell` would lose its whole read-only tint if `.focused` (which only ever carries `outline`) sat in the same guarded list as `.readOnly` (`backgroundColor`/`cursor`). `Cell`'s and `TreeRow`'s own `.focused` keyboard-focus ring is exactly this case, so it stays out of `ownStyleStates` entirely and carries its own **unguarded** shared rule instead, ensured via `this.ensureSharedStateRule(".focused", declarations)` (a one-line forwarder to `ensureClassStateRule`, publishing only the shared `.ClassName.focused` rule and never a per-instance one) — layering correctly on top of any of the class's other declared states rather than being suppressed by them. `Component.setValueStyleState` (`Text`'s numeric line-height dedup) is the third and only other caller of `ensureSharedStateRule`.

A **trait** (`core/ClassStyleRules.ts`'s `StyleTrait`) is a named, hand-authored style bag any number of unrelated component classes or a single instance can opt into, sharing one generated CSS rule per trait no matter how many callers use it. A class opts in with `protected static readonly ownStyleTraits: readonly StyleTrait[]` (inherited down the chain, with no way for a subclass to opt back out); an instance opts in independently of its class with `setStyleTrait`/the `styleTrait` construction option. A trait's `(0,2,0)` rule outranks the class tier by specificity, so a class that needs a different value for a property its trait declares must deliver it as an authored instance value (a real setter call, not a plain class default) so it lands on `#id`, which unconditionally wins — a class-tier override alone can no longer beat a trait it uses. Because a trait's specificity ties with a class's own unguarded top-priority declared state, a class combining `ownStyleTraits` and `ownStyleStates` that would collide on the same CSS property throws at first render instead of resolving the tie by stylesheet order.

### The class tier is hierarchy-aware

A class's `.ClassName` rule declares only its own deviation from its nearest ancestor's rule, not from the framework tier directly — so a subclass that changes nothing shares its ancestor's rule instead of repeating it. A class opts in by declaring `protected static readonly ownClassStyleDefaults: ClassStyleDefaults`, read via an own-property check so a subclass that omits the field never appears to redeclare its parent's; `ensureClassStyleRule` walks `Object.getPrototypeOf` upward, resolving (and, for a class that owns a genuine deviation, inserting) each ancestor's rule before its own, so plain unweighted `.ClassName` selectors are correct with no `:where()` needed between hierarchy levels. The rendered element carries every ancestor's own class name (`getStyleClassChain`) for a *participating* chain — one with `ownClassStyleDefaults` registered somewhere in it — regardless of which individual levels opted in, so the cascade can find those ancestor rules even through a non-contributing middle level (e.g. `DefaultCell`, between `Cell` and `HeaderCell`). A chain with **no** participating level anywhere (`chainParticipates` returns false) does not widen at all — it keeps its pre-hierarchy single-name behaviour; that gate exists for chains like that, not for the Button family. `Button`/`ToggleButton`/`TabButton`/`SpinButton`/`MenuButton`/`PopupButton` all declare or inherit `ownClassStyleDefaults` somewhere in the chain (`Button`, `TabButton` and `SpinButton` each declare their own; `ToggleButton`, `MenuButton` and `PopupButton` inherit the widening with no field of their own), so `chainParticipates` returns true for the whole family and its DOM classes widen like any other participating chain — including `MenuBarButton` and `TabCloseButton`, the family's two other leaves. `Cell`, `Text`, `TextInput`, `AbstractPickerField`, `AbstractSelectableList`, `AbstractWindow`, `AbstractChart`, `AnimatedDropdown`, and `TableBody` are the other middle classes that opt in. A class that customises a hoistable field through `subclassDefaults` must also register its own `ownClassStyleDefaults` mirroring that value, or its deviation is silently lost to a pass-through to its nearest opted-in ancestor — this applies equally to a leaf, not only a middle class: `Link`/`SelectableText` (deviate from `Text` on `cursor`/`userSelect`/`foregroundColor`), `TextField`/`PasswordField`/`UsernameField`/`TextArea`/`PickerInput` (deviate from `TextInput`), `ComboBoxDropdown`/`TimePickerDropdown`/`AutoCompleteDropdown`/`PopupPanel`/`AbstractCalendarDropdown` (deviate from `AnimatedDropdown`), and `MenuBarButton`/`TabCloseButton` (deviate from `Button`) all opt in for exactly this reason.

`ownStyleStates` (*Component CSS tiers and state-rule dedup*, above) resolves through the same own-property, nearest-declaring-ancestor lookup as `ownClassStyleDefaults`, but the two diverge on what that lookup governs. **Order** is a *whole-list* declaration exactly like the old behaviour: a subclass that declares no `ownStyleStates` of its own resolves its ancestor's entire list unchanged (`MenuButton`/`PopupButton` resolve `.pressed` to `Button.ownStyleStates`'s order, not a list of their own), and a subclass that adds a state restates its ancestor's entire list and appends (`ToggleButton.ownStyleStates = [...Button.ownStyleStates, { selector: ".selected", … }]`) — the resolving order always comes from one place, so the generated `:not(...)` guards can never drift. **Content**, by contrast, is a per-level merge: `resolveStateLevels` walks every level from the top of the chain down to the resolving class, and each level that declares its own entry for a selector in that order contributes `extract(ownDefaultsOf(level))` merged over its parent's resolved bag for that selector — only a level whose result actually deviates gets its own `.ClassName<guardedSuffix>` rule, mirroring `resolveClassLevel`'s delta-against-parent shape for the resting tier. A subclass that restates an ancestor's entry unchanged (`ToggleButton` restating `Button`'s `.pressed`/`:hover`) therefore shares the ancestor's rule instead of getting its own, while a subclass that overrides just that entry's content (`TabButton` restating `ToggleButton`'s `.selected` with its own tab-fill `extract`) gets a rule carrying only its own delta from `ToggleButton`'s resolved value — the same "delta, not full restatement" property the resting tier already has.

## Defer DOM work to render time

Construction must stay JS-only. Every framework primitive buffers DOM writes until first render — keep them queued:

- **Component CSS rule**: `setElementCSSRule(s)` queues into `styleRule`; `applyStyle` flushes at render, and inserts the rule only when a real declaration is queued — not for a bag holding only no-op `null` removals. Never call `ensureCSSRule()` from a setter.
- **Per-component state rules** (`:active`, `:hover`, `.selected`, …): a state with per-instance override setters and class-level defaults to dedupe against goes through `this.writeStateStyle(selector, patch)` (or `pinStateStyle` to bypass the comparison) — dedup happens at flush against `resolveStyleStates(ctor)`'s own resolved bag for that selector, not at the call site. A state that only ever publishes a shared class rule and never writes per-instance goes through `this.ensureSharedStateRule(suffix, declarations)` instead. For anything else needing a raw per-instance rule, allocate via `this.createStyleRule(suffix)`; the builder dedupes by suffix and registers for render-time materialisation — don't construct a `StyleRule` directly. When a state also competes with the resting tier for the same property (a shared `.selected` background, say), override `getRestingExclusionSuffixes()` too — see *Component CSS tiers and state-rule dedup* above.
- **Module-level shared class rules** (`.SortPriorityBadge`, `.ResizeHandle`, …): `new StyleRule({ scope: "class", name: "Foo" })` inside a module-singleton `ensureXClassRule()` is the correct path; the `StyleRule` buffer is the public seam over `CSSStyleRule.style`.
- **Inline styles**: `setElementStyle(s)` queues into `inlineStyle`; `init()` attaches and flushes.
- **Measurement**: never read layout (`getBoundingClientRect`, `getComputedStyle`) during construction. Defer to a layout pass or theme-change callback.
- **Children**: build child Components in the constructor; their DOM is realised when the parent renders. Don't `getElement(true)` during construction.

## Components are exported through `callable()`

Every `Component` subclass must be wrapped with `callable()` before export. The raw class stays available behind an underscored alias purely as a typing escape hatch; the callable form is the public name.

```typescript
class StatusBar extends Panel<StatusBarOptions> { /* ... */ }

const StatusBarCallable = callable(StatusBar);
type StatusBarCallable = StatusBar;
export {
    StatusBar         as _StatusBar,
    StatusBarCallable as StatusBar,
};
```

Callable wrapping lets call sites write `StatusBar({ message: "Ready" })` and `new StatusBar({ … })` interchangeably, keeping component construction at parity with the framework's factory-style API.

**Imports always use the callable name.** Write `import { Panel } from "~/core/Panel.js"`, never `_Panel`. This holds even for `extends` clauses — the callable preserves the prototype chain, so `class Foo extends Panel` works correctly. The underscored alias exists only for the rare site that genuinely needs the unwrapped class for typing; reach for it only after confirming the callable form doesn't work.
