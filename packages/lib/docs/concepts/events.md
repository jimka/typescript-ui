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

## addViewportListener

```typescript
Event.addViewportListener(window, 'mousemove', (e: MouseEvent) => {
    track(e.clientX, e.clientY);
});
```

Fires for events anywhere in the document, regardless of their target. Used internally for drag-track gestures (mouse / touch movement during resize / split-gutter / window-drag operations).

Use this only when you genuinely need global event capture — for everything else, `addListener` or `addSubtreeListener` is more focused and easier to reason about.

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

When a custom scroll surface needs to suppress the browser default (e.g. trapping wheel input on a JS-controlled grid), pass `{ passive: false }` as an extra options bag to `addListener` / `addSubtreeListener`:

```typescript
Event.addSubtreeListener(
    grid,
    'wheel',
    (e: WheelEvent) => {
        e.preventDefault();    // ✅ now actually preventDefaults
        customScroll(e.deltaY);
    },
    { passive: false }
);
```

The framework installs one window-level handler per event type, so the first registration for a type locks the passive flag for that type's lifetime. Subsequent registrations must agree or `addListener` / `addSubtreeListener` throws. The in-tree precedent is `VirtualScroller`, which is currently the only `passive: false` consumer.

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
