# Events

The framework's [`Event`](/api/classes/Component) namespace centralises DOM event delegation. Instead of attaching one native listener per component, the framework attaches one listener per event type to a shared root and routes each fired event to the relevant component callback.

This page covers the three listener flavours, when to use each, and the hover-event quirk that bites everyone at least once.

## addListener

```typescript
import { Event } from '@jika/typescript-ui';

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

## Removal

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

## When to use which

| Listener | Use for |
| --- | --- |
| `addListener` | Direct interaction with a leaf component (click, change, input). |
| `addSubtreeListener` | Delegated handlers on a container. Hover detection (`mouseover` / `mouseout`). |
| `addViewportListener` | Drag-track gestures, global keyboard hooks. |

## See also

- [API: Event](/api/classes/Component) (namespace)
- [Mental model](/guide/mental-model) — why event delegation works the way it does
- Recipe: [Right-click menu](/recipes/right-click-menu) — a working `contextmenu` handler
