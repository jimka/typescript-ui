# Events

The framework has **two listener surfaces**, with a hard rule for picking
between them:

- **DOM events** (`click`, `mousedown`, `keydown`, `resize`, …) route
  through the [`Event`](/api/core/classes/Component) namespace's
  `Event.addListener` / `Event.addSubtreeListener` /
  `Event.addViewportListener` triple. One window-level handler per type;
  per-id dispatch in O(1).
- **Framework custom events** (`change`, `selection`, `scroll`, `tick`,
  `drag`, `commit`, `tabclose`, `sectiontoggle`, …) route through the
  emitting class's `on(event, listener)` / `off(event, listener)` pair.
  Each emitter owns a private [`ListenerBag`](/api/core/classes/ListenerBag)
  delegate; `protected emit(...)` fan-outs to its registered listeners.

The split is principled: **`Event.X` is the surface for anything that
originates as a real DOM event** (the window-level handler and subtree
bubbling depend on the event existing in the DOM). **`on`/`off` is the
surface for in-process custom events** that the framework defines on
top of, or independently of, the DOM.

Interactive controls expose a typed **semantic** `on("action", fn)`
shorthand over `Event.addListener` for their primary gesture — e.g.
[`Button.on("action", fn)`](/api/component/button/classes/Button#on)
wraps the DOM `click`, `Slider.on("action", fn)` wraps `input`,
`ComboBox.on("action", fn)` wraps `change`. The dispatcher and the
multi-listener bucket stay inside the `Event` class; the shorthand is a
per-class typed convenience whose public name (`"action"`) is decoupled
from the underlying DOM event.

This page covers the three DOM listener flavours, the `on`/`off`/`emit`
surface, when to use each, and the hover-event quirk that bites everyone
at least once.

## addListener

```typescript
import { Event } from '@jimka/typescript-ui/core';
Event.addListener(button, 'click', () => save());
```

Subscribes a callback that fires only when the event's target is **exactly** this component's element. Events on descendant elements do not fire this listener.

Use `addListener` for leaf components or any case where the event's logical target is the component itself — clicking a button, typing in a text field, changing a checkbox.

## addSubtreeListener

```typescript
Event.addSubtreeListener(panel, 'click', (e: MouseEvent) => {
    console.log('clicked somewhere inside the panel');
});
```

Fires for events that originate **anywhere in the subtree** rooted at this component. Use this for delegated handlers — "any click inside this panel", "any keydown in this form".

`addSubtreeListener` is the right choice for:

- Container-level click delegation (e.g. an item in a list of dynamically-built children).
- Catching events from children that don't have their own handlers.
- Keyboard shortcut scopes.

A subtree listener that consumes the event (see [Consuming an event](#consuming-an-event) below) stops it from reaching any ancestor's subtree listeners — every listener registered on the same component still runs first, but the walk climbs no further.

## addViewportListener

```typescript
Event.addViewportListener(window, 'mousemove', (e: MouseEvent) => {
    track(e.clientX, e.clientY);
});
```

Fires for events anywhere in the document, regardless of their target. Used internally for drag-track gestures (mouse / touch movement during resize / split-gutter / window-drag operations).

Use this only when you genuinely need global event capture — for everything else, `addListener` or `addSubtreeListener` is more focused and easier to reason about.

A viewport listener does not swallow the event: every registered component receives it, and it keeps propagating to the page — through to any `document`-level listener, such as your own global keyboard accelerator — unless a handler's returned disposition asks for a stop (see [Consuming an event](#consuming-an-event) below). Consume from your handler only when the component genuinely consumes the event (it acted on it and owns the interaction), not merely because it observed it. Unlike `addListener` / `addSubtreeListener` (below), a viewport listener is **not** button-filtered — it fires for every button on every registration.

## Which mouse button fires a listener

`addListener` and `addSubtreeListener` default to firing only for a **primary** (left) button press — a right- or middle-click mousedown/pointerdown on a leaf component's own listeners is silently ignored unless you opt in. Pass a registration object instead of a bare listener to change that:

```typescript
Event.addListener(component, 'pointerdown', {
    button: 'aux',           // or 'any'
    handler: (e: PointerEvent) => { /* … */ },
});
```

| `button`      | Fires for                                                                 |
| ------------- | -------------------------------------------------------------------------- |
| `'primary'` (default) | Only a primary press, or an event with no `button` property at all (touch, hand-built fixtures). |
| `'aux'`       | Only a non-primary press (right/middle/back/forward) — named after the DOM's `auxclick` event, which fires under this same condition. Never fires for touch. |
| `'any'`       | Every button, regardless of state.                                        |

Only a short list of press-initiating types defaults to `'primary'` at all: `mousedown`, `mouseup`, `click`, `dblclick`, `pointerdown`, `pointerup`. Every other type defaults to `'any'`, because it doesn't represent an initiating press — `contextmenu` (it's already the button-agnostic "open a menu" signal — right-click, a keyboard context-menu key, or a touch long-press), the pointer move/cancel/capture-loss family (`pointermove`, `pointerenter`, `pointerleave`, `pointerover`, `pointerout`, `pointercancel`, `lostpointercapture`, `gotpointercapture`), whose `button` the Pointer Events spec reports as `-1` ("no button change") rather than whichever button is actually held, the mouse-flavoured half of that same family (`mousemove`, `mouseover`, `mouseout`, `mouseenter`, `mouseleave`), and `auxclick`, which by definition never carries `button: 0` — a `'primary'` default would mean a bare registration on it could never fire. Set `button` explicitly on a registration to override the default either way. `click` is a special case beyond just defaulting to `'primary'`: the dispatcher gates it to the primary button unconditionally, regardless of this option, since it is the framework-wide activation event.

## Consuming an event

`addListener`, `addSubtreeListener`, and `addViewportListener` listeners tell the dispatcher what to do with the event by **return value**, instead of calling `stopPropagation()` themselves:

| Return                          | Effect                            |
| -------------------------------- | ---------------------------------- |
| nothing / `false`                | event untouched                    |
| `true`                            | `stopPropagation()`                |
| `{ prevent: true }`               | `preventDefault()`                 |
| `{ stop: true, prevent: true }`   | both                                |

```typescript
Event.addListener(button, 'keydown', (e: KeyboardEvent) => {
    if (e.key !== 'Enter') {
        return;
    }

    confirm();

    return { stop: true, prevent: true };
});
```

`preventDefault()` is unaffected in every respect — call it directly, exactly as before; it never needed dispatcher help. A direct `stopPropagation()` call still halts native DOM propagation (it is the event's own method), but it no longer influences the dispatcher's ancestor walk — only a returned disposition does. Return a disposition instead of calling `stopPropagation()` whenever you want the walk itself to stop.

### An unconditional floor: `stop` / `prevent` in the registration

When a listener's disposition is the *same on every code path* — it always wants to `preventDefault()`, say — returning it from every branch is repetitive and easy to miss on a newly-added early return. Set `stop` and/or `prevent` directly on the registration instead; the dispatcher applies them unconditionally, OR'd together with whatever the listener itself returns:

```typescript
Event.addListener(dropZone, 'dragover', {
    prevent: true,
    handler: (e: DragEvent) => { highlight(); },
});
```

This is a **floor, not an override** — it cannot be un-set by a listener returning `false`/nothing, so use it only when every path genuinely wants the same outcome. A listener whose disposition depends on runtime state (an early guard-clause return, a conditional check) must leave `stop`/`prevent` unset on the registration and keep returning its disposition instead — the two mechanisms compose (both fire when both trigger), but only the return value can vary per invocation.

## on / off / emit — framework custom events

For events the framework defines (not the DOM), use the emitter's `on`
method directly:

```typescript
import { Tree } from '@jimka/typescript-ui/component/tree';

const tree = new Tree();

tree.on("selection", (nodes) => {
    console.log(`selected ${nodes.length} node(s)`);
});

// Construction-time wiring via the options bag:
const tree2 = new Tree({
    listeners: {
        selection: (nodes) => console.log(nodes),
    },
});
```

Symmetric removal:

```typescript
const onSelect = (nodes) => console.log(nodes);
tree.on("selection",  onSelect);
tree.off("selection", onSelect);
```

Every emitter declares a string-literal union of its supported event
names — `tree.on("typo", fn)` is a compile error. Listeners fire in
registration order. The same shape applies to
[`AbstractStore`](/api/data/classes/AbstractStore),
[`Binding`](/api/core/classes/Binding),
[`AbstractInput`](/api/component/input/classes/AbstractInput),
[`Scrollbar`](/api/component/container/classes/Scrollbar),
[`SpinButton`](/api/component/input/classes/SpinButton),
[`SplitGutter`](/api/component/container/classes/SplitGutter),
[`WindowBorder`](/api/component/container/classes/WindowBorder),
[`ButtonGroup`](/api/overlay/classes/ButtonGroup),
[`ResizeHandle`](/api/component/table/classes/ResizeHandle),
[`Cell`](/api/component/table/classes/Cell),
[`HeaderCell`](/api/component/table/classes/HeaderCell), the table
[`TableHeader`](/api/component/table/classes/TableHeader), the
[`Accordion`](/api/layout/classes/Accordion) layout, and the
[`Tab`](/api/layout/classes/Tab) layout.

## DOM event removal

Each `addX` has a matching `removeX` that takes the same `(component, type, listener)` triple. Pass the **same function reference** that you passed to the `add` call:

```typescript
const onClick = () => save();
Event.addListener(button, 'click', onClick);
// later:
Event.removeListener(button, 'click', onClick);
```

Anonymous arrow functions cannot be removed because each call creates a new reference. Save the function to a variable if you need to unsubscribe.

Disposing a component drops every registration it holds through the `Event`
API automatically, so teardown needs no explicit `removeX` call. `removeX` is
for unhooking while the component keeps living — a finished drag, a consumer
unsubscribing — not for teardown.

## Re-registering a listener

Registering the same function reference twice for the same `(component,
type)` is not a second listener — it re-configures the one already
registered:

```typescript
Event.addListener(button, 'mousedown', onPress);
// Same reference, same options: a no-op.
Event.addListener(button, 'mousedown', onPress);
// Same reference, new options: replaces onPress's registered options.
Event.addListener(button, 'mousedown', { button: 'any', handler: onPress });
```

`addViewportListener` follows the same reference-matching rule, but a repeat
registration is simply ignored rather than re-configured — it takes no
options to update.

A **fresh inline closure has no identity to match**, so each call registers
a distinct listener that fires independently and, per the note above, can
never be removed:

```typescript
Event.addListener(button, 'mousedown', () => save());
Event.addListener(button, 'mousedown', () => save()); // A second, unremovable listener — save() now runs twice.
```

A registration site that can run more than once — most commonly `init()` or
`render()`, which a component's `release()`/rematerialize cycle can replay —
must pass a stable reference (a method on the component, or a `readonly`
arrow field) for this reason.

## Hover events: use `mouseover` / `mouseout`

::: warning Don't use mouseenter / mouseleave with subtree listeners
`mouseenter` and `mouseleave` **do not bubble** in Chrome. Subtree (delegated) listeners rely on bubbling; they will not receive these events.

Use `mouseover` and `mouseout` for hover detection.
:::

```typescript
// Works — these events bubble:
Event.addSubtreeListener(panel, 'mouseover', onHover);
Event.addSubtreeListener(panel, 'mouseout',  onUnhover);

// Silently broken — these don't bubble in Chrome:
Event.addSubtreeListener(panel, 'mouseenter', onHover); // ❌
Event.addSubtreeListener(panel, 'mouseleave', onUnhover); // ❌
```

The DOM specification allows `mouseenter`/`mouseleave` to bubble, but Chrome implements them as non-bubbling for compatibility with older code. Firefox and Safari behave the same way. The framework's documented hover patterns all use `mouseover` / `mouseout`.

## Scroll, wheel, and touch listeners are passive

Listeners registered through `Event.addListener`, `Event.addSubtreeListener`, or `Event.addViewportListener` for `scroll`, `wheel`, `touchstart`, and `touchmove` are installed as **passive** by default. The browser does not wait for the handler to return before scrolling, which keeps scroll inertia on the compositor thread.

The trade-off: calling `event.preventDefault()` from a passive handler is silently ignored and logs `[Intervention] Unable to preventDefault inside passive event listener` in the console.

```typescript
// Fires; preventDefault is silently dropped:
Event.addListener(grid, 'wheel', (e: WheelEvent) => {
    e.preventDefault();        // ❌ no effect
    customScroll(e.deltaY);
});
```

When a custom scroll surface needs to suppress the browser default (e.g. trapping wheel input on a JS-controlled grid), pass a registration object — `{ ...options, handler }` — instead of a bare listener, with `passive: false`:

```typescript
Event.addSubtreeListener(grid, 'wheel', {
    passive: false,
    handler: (e: WheelEvent): Event.ListenerResult => {
        customScroll(e.deltaY);

        return { prevent: true };  // ✅ now actually preventDefaults
    },
});
```

The framework installs one window-level handler per event type, so the first registration for a type locks the passive flag for that type's lifetime. Subsequent registrations must agree or `addListener` / `addSubtreeListener` throws. In-tree precedents include `VirtualScroller` and `DiagramView` (both `wheel`) and `Scrollbar` (`touchstart`) — grep the codebase for `passive: false` for the current full list.

## When to use which

| Listener                                    | Use for                                                                                 |
| ------------------------------------------- | --------------------------------------------------------------------------------------- |
| `Event.addListener`                         | Direct interaction with a leaf component (click, change, input).                        |
| `Event.addSubtreeListener`                  | Delegated handlers on a container. Hover detection (`mouseover` / `mouseout`).          |
| `Event.addViewportListener`                 | Drag-track gestures, global keyboard hooks.                                             |
| `emitter.on(event, listener)`               | Framework custom events: store/binding/selection/scroll/tick/drag/commit, tab/section.  |
| `button.on("action", listener)` (and `off`) | Typed semantic shorthand over `Event.addListener` exposed by interactive controls (the public `"action"` name is decoupled from the DOM event). |

## See also

- [API: Event](/api/core/classes/Component) (namespace)
- [Mental model](/guide/mental-model) — why event delegation works the way it does
- Recipe: [Right-click menu](/recipes/right-click-menu) — a working `contextmenu` handler
