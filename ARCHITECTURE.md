# Architecture Guidelines

Binding architectural rules for the framework. Every implementation plan (built via the `plan` skill) and every code change (executed via the `implement` skill, or written directly) must adhere to these.

## Event handling

The framework has **two event surfaces, split by the origin of the event**:

1. **DOM-routed events** (`click`, `mousedown`, `wheel`, `keydown`, `input`, `resize`, …) go through the `Event` class — `Event.addListener(this, type, handler)`, `Event.addSubtreeListener`, `Event.addViewportListener`, with `Event.fireEvent(this, type, payload?)` to dispatch. The `Event` class owns a single window-level capture handler per DOM event type and routes each event to per-id listener buckets. Raw `element.addEventListener` is reserved for the `Event` module itself and for targets the Event API cannot model today (a `MediaQueryList`, a non-`Component` ancestor element, a one-shot `transitionend` on a raw node). Extend the `Event` API rather than introducing new raw-`addEventListener` sites.

2. **Framework-custom events** (`change`, `binding`, `selection`, `tick`, `scroll`, `dragmove`, `commit`, `tabclose`, `sectiontoggle`, `contextmenu`, the store's `load` / `datachanged` / …) — semantic events the framework defines on top of, or independent of, the DOM — go through a typed `on` / `off` / `emit` pub-sub surface backed by a private `ListenerBag<TEvent>` delegate (`core/ListenerBag.ts`). Each emitting class declares a string-literal `XEvent` union (so `foo.on("typo", fn)` is a compile error), writes one-line `on` / `off` forwarders into the bag, and dispatches through a `protected emit(event, payload)`. Listeners fire in registration order; every `on` has a matching `off`.

**The split is principled: `Event.X` for anything that originates as a real DOM event; `on` / `off` / `emit` for anything that doesn't.** The two never merge — the window-level capture handler and the subtree (DOM-bubbling) semantics only make sense for real DOM events, while custom events need an in-process multi-listener fan-out with no DOM routing.

A class that owns a primary user gesture MAY expose it as a typed **semantic** `on` / `off` **shorthand** whose body wraps `Event.addListener(this, …)` / `Event.removeListener(this, …)`. The canonical case is the **`"action"`** event — the component's main interaction — which every interactive control exposes: `Button.on("action", fn)` (DOM `click`), `Checkbox.on("action", fn)` (DOM `click`), `Slider.on("action", fn)` (DOM `input`), `ComboBox.on("action", fn)` (DOM `change`), `ToggleButton.on("action", fn)` (DOM `change`), `List.on("action", fn)` (DOM `change`). **The public event name is semantic (`"action"`), deliberately decoupled from whichever DOM event the body registers** — consumers wire intent ("the control was actioned"), not the implementation's DOM type. This is sugar over the DOM surface, not the custom-event machinery: there is no `ListenerBag` and no `emit`, because `Event.addListener` already multiplexes listeners per id. Value-bearing inputs additionally expose the inherited custom `"change"` / `"binding"` events (via the `ListenerBag`) for the committed-value and data-binding paths — distinct from the DOM-routed `"action"`. Classes that emit custom (non-DOM) events MUST use the full `on` / `off` / `emit` + `ListenerBag` shape. When an outer component needs to drive an inner component's custom event, the inner component exposes a public domain verb (e.g. `ResizeHandle.dragMove(delta)`) whose body calls its own `emit` — `emit` stays `protected`, never called across class boundaries.

Construction-time listener wiring uses an options `listeners?` bag — a **closed** map of exactly the events the component exposes through `on()`, each typed to that overload's listener, so an inapplicable key (a raw DOM event the component doesn't surface, a foreign component's event, a typo) is a compile error. The bag is dispatched to `on(event, fn)` by the shared protected `Component.applyListeners(options?.listeners)` helper, called from the **constructor body** after `super()` returns — never from `applyOptions`, which runs inside `super()` before the `ListenerBag` field initializes. This is the deferred-dispatch face of the `super()`-cascade field trap (see [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md), *Fields written during the `super()` cascade*): a plain cached field that can hold its value through `super()` uses `declare` instead, but the `ListenerBag` needs a real instance, so its dispatch is deferred to after `super()` rather than the field being left bare. A class that exposes no `on()` surface carries no `listeners` option at all.

**Every class that accepts a `listeners` bag is responsible for its own `applyListeners` call — the base never wires a subclass's bag.** A base that is itself instantiable wires the bag only when it is the *directly-constructed* class: `Button` guards its call (by instance identity, since `callable()` routes construction through a Proxy that defeats `new.target`) so a plain `new Button(...)` wires its bag, while `ToggleButton` / `SpinButton` are skipped and each calls `applyListeners` from its own constructor after `super()`. This is what keeps a subclass event whose `ListenerBag` only exists post-`super()` (e.g. `SpinButton`'s `tick`) from being wired early or twice. The rule to remember when adding a subclass: if it declares a `listeners` bag — or widens an inherited one — it MUST call `this.applyListeners(options?.listeners)` in its own constructor body; a missing call silently drops the bag.

### Listeners must reference a named function

The `handler` (or `listener`) argument must always be a reference to a named function — a method on the component (`this.handleClick`) or a module-level function. Never pass an inline arrow function or function expression. A named reference is removable via `removeListener`, surfaces by name in stack traces, and is grep-able for audits; an inline closure is none of those. The rule applies equally to the raw `addEventListener` escape hatches above.

### A component must not listen to another component's events through `Event`

`Event.addListener(otherComponent, type, handler)` (and every other `Event` API call) is reserved for listening on **self** — `Event.addListener(this, …)` from inside a component, registering a listener on its own element. Calling any `Event` API against *another* `Component` instance is a bypass: it reaches past that component's named-method surface, couples the caller to the target's internal DOM and event routing, and prevents the target from changing how it dispatches events without silently breaking callers.

Every `Component` owns the event surface its consumers can subscribe to and exposes it through the typed `on(event, fn)` / `off(event, fn)` pair on the class itself — `Button.on("action", fn)`, `Tab.on("tabclose", fn)`, `Tree.on("selection", fn)`, `Scrollbar.on("scroll", fn)`, and so on. The consumer routes through `on`; the class owns the internal `Event.addListener(this, …)` (for the DOM shorthand) or `emit(…)` (for a custom event) call. When a consumer needs an event a component doesn't yet expose, widen that component's `XEvent` union and add the `on` overload — never reach for the raw `Event` API from outside.

The rule holds even when the bypass looks local (e.g. a parent component writing `Event.addListener(this._button, "click", …)` against a child it just constructed). The named-method surface is the contract; the raw call is not.

### Hover detection uses `mouseover` / `mouseout`

Because every DOM-routed event reaches the framework through a single window-level capture handler, hover wiring must use the **bubbling** `mouseover` / `mouseout` pair, never the non-bubbling `mouseenter` / `mouseleave`. Non-bubbling events do not propagate to the window capture handler in Chrome, so `Event.addListener(this, "mouseenter", …)` silently never fires. When you need true enter/leave semantics (ignoring moves between descendants), filter on `event.target` / `event.relatedTarget` inside the `mouseover` / `mouseout` handler rather than reaching for the non-bubbling events.

## One DOM element per class

A class owns exactly one DOM element. If a sub-element needs independent behaviour (event routing, its own CSS rule, layout), extract it into a `Component` subclass. Trivial non-interactive helpers (e.g. a resize-handle div) can stay as raw children.

## Keep presentation state out of data Models

A data `Model` holds domain state only — the fields that represent the record. Presentation and UI state — selection, hover, expanded/collapsed, scroll position, sort order, in-flight edit buffers — never live on the Model; they belong to the component rendering it. The Model is the binding source of truth shared across views, so folding view state into it breaks that contract: multiple views of the same record would contend over one field, and the transient flags would leak into anything that persists the Model.

## Positioning is always absolute

Every framework `Component` is positioned with `position: absolute`. Coordinates come from the parent's `LayoutManager` via `setX` / `setY` / `setWidth` / `setHeight`. No `position: relative`, no `position: sticky`, no `display: flex` / `display: grid` on a `Component` to lay out its children. The framework's containing-block math, scroll arithmetic, baseline alignment, and `overflow: auto` propagation all assume absolute children.

If a layout manager can't express what a component needs:

- **Add the feature to an existing manager.** Most missing behaviours fit cleanly into `HBox` / `VBox` / `Grid` / `Border` / `Tab` / `Accordion` / `Fit` / `Card` / `Absolute`. Add a constraint, an option, or an axis flag rather than a new layout primitive.
- **Override `doLayout` on the owning component.** For one-off arrangements where no manager generalises (e.g. `ComboBox` positioning its caret + label, `PickerButton` centring its glyph), the component places its children directly.
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

Before `element.style.*`, `document.createElement`, or `element.addEventListener`, check for a Component setter or `Event` API. Raw DOM is for things the framework has no API for.

When raw access is unavoidable, it still goes through the **DOM seams** ([core/DOM.ts](src/typescript/lib/core/DOM.ts), see [docs/concepts/dom-seams](docs/concepts/dom-seams.md)). Every structural write and inline-style flush is a `DOM.sink` call; every geometry / text-metric / theme-var read is a `DOM.source` call. Raw `getBoundingClientRect` / `getComputedStyle` / `createElement` / `appendChild` / `classList` mutation outside the production seam implementations (and the documented `core/Util.ts` measurement delegate) is a grep-checkable violation. The seam lets tests swap in a recording sink and a modelled, browser-free read source.

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
2. **Always cache in memory.** Reads return cached state, never re-query the DOM. The options bag is the default cache — for any setter whose input matches its `XOptions` field 1:1, write `this._options.foo = value` and read `this._options.foo ?? null`. Add a private `_foo` backing field only when the setter normalises or derives the stored form (e.g. `number | string` input stored as a `string` with a `"px"` suffix), so reads return the canonical form.
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

Both buffer writes into a dirty bag until the target materialises, then flush via camelCase property assignment. Going through the buffer keeps construction-time writes safe (queued before element/rule exists), keeps theme-toggle re-flushes intact, and gives logging/audits a single seam.

For a module-level shared class rule, the canonical pattern is:

```typescript
const rule = new StyleRule({ scope: "class", name: "Foo" });

rule.setMany({ position: "absolute", top: "0", /* … */ });
rule.ensure();
```

`StyleRuleScope` covers three shapes: `"class"` prepends `.`; `"component"` prepends `#`; `"selector"` is verbatim selector text for pseudo-classes / compound selectors / pseudo-elements. The constructor owns the get-or-create handshake against a module-level cache.

If you find yourself reaching for `.style.X` on a `CSSStyleRule` or `HTMLElement`, stop — there is a `StyleRule` / `InlineStyle` (or a Component setter that wraps one) that should own that write.

## Defer DOM work to render time

Construction must stay JS-only. Every framework primitive buffers DOM writes until first render — keep them queued:

- **Component CSS rule**: `setElementCSSRule(s)` queues into `styleRule`; `applyStyle` flushes at render. Never call `ensureCSSRule()` from a setter.
- **Per-component state rules** (`:active`, `:hover`, `.selected`, …): allocate via `this.createStyleRule(suffix)`. The builder dedupes by suffix and registers for render-time materialisation. Don't construct a `StyleRule` directly for these — go through `createStyleRule` so the dedupe + register path runs.
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
