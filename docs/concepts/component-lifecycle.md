# Component lifecycle

A [`Component`](/api/classes/Component) goes through a small, predictable sequence of phases from construction to destruction. Understanding it explains when DOM elements appear, when layout runs, and where to hook your own subclass code.

## The phases

```
new Component(tag)        ─→  in-memory object, no DOM
   │
addComponent(child)       ─→  parent registers the child
   │
getElement()              ─→  first call creates the <div>; subsequent
                              calls return the cached element
   │
render() (subclass hook)  ─→  builds bespoke DOM (called from getElement
                              when an element is needed)
   │
init() (subclass hook)    ─→  wires native listeners, sets initial styles
   │
doLayout()                ─→  layout manager positions children, writes
                              x / y / width / height pixel values
   │
        … updates …
   │
removeComponent(child)    ─→  detaches from the parent tree
   │
destructor() (protected)  ─→  subclass cleanup hook
```

## Construction

```typescript
const button = new Button('Save');
```

The component object exists in memory immediately. No `<div>`, no styles, no listeners — just JavaScript state. You can call any setter (`setPosition`, `setForegroundColor`, `setBorder`) at this point; values are stashed and replayed when the DOM element is eventually created.

This is why `setBackgroundColor` works *before* you've added the component to a parent. The framework defers DOM work until it's actually needed.

## Adding to a parent

```typescript
panel.addComponent(button);
```

`addComponent` registers the child with its parent's component list and applies the parent's layout-manager constraints (the optional second argument). It does **not** force a DOM commit — the element is still lazy.

## Element creation: `getElement()`

```typescript
button.getElement(); // first call: creates the <div>
```

The first call to `getElement()` invokes the subclass's `render()` followed by `init()`. From here on, the component has a real DOM node. Anything you set before is replayed onto the element.

You usually don't call `getElement()` directly — it's called for you the first time the component participates in a layout pass.

## Layout: `doLayout()`

Layout is what positions absolutely-positioned children and writes pixel values for `top` / `left` / `width` / `height`. It runs:

1. **At first render** — when the root `Body` lays out top-level children.
2. **On viewport resize** — `Body` listens for `window.resize` and re-runs layout.
3. **Explicitly** — when you call `parent.doLayout()` after changing a child's preferred size.

```typescript
button.setPreferredSize(120, 32);
button.getParentComponent()?.doLayout(); // child's parent re-runs layout
```

::: tip rAF-coalesced scheduling
Internally, setters and event handlers call `scheduleLayout()` rather than `doLayout()` directly. The queue flushes once per animation frame and prunes any component whose ancestor is also dirty (the ancestor's layout will recurse into it). Multiple changes within the same frame coalesce into a single layout pass.
:::

## Pausing layout

For bulk mutations, suspend automatic layout passes:

```typescript
panel.pauseLayout();
for (const item of largeArray) {
    panel.addComponent(buildItem(item));
}
panel.resumeLayout(); // triggers a single doLayout afterwards
```

`pauseLayout()` blocks `scheduleLayout()`; `resumeLayout()` triggers a synchronous layout pass and re-enables scheduling. Without these, every `addComponent` would queue its own layout, and rAF coalescing would still mean one batched pass — but `pauseLayout` makes the intent explicit and disables the scheduling work entirely during the bulk operation.

## Removal

```typescript
panel.removeComponent(button);
```

Detaches the component from the parent's child list. Future layout passes ignore it. The DOM element is removed; future calls to `getElement()` would re-create it from scratch.

## Subclass hooks

If you write your own component subclass, override these in addition to whatever public surface you expose:

| Hook | When | Purpose |
| --- | --- | --- |
| `render()` (protected) | Called by `getElement()` on first access | Build the DOM element. Default returns a `<div>` (or whatever was passed to `super(tag)`). |
| `init()` (protected) | Called once the element exists | Wire native listeners, apply initial styles. The framework calls this after `render()`. |
| `doLayout()` | Called on every layout pass | Override only if you need custom positioning beyond what a `LayoutManager` provides. |
| `destructor()` (protected) | Called on removal / disposal | Clean up listeners, timers, theme subscriptions. |

The framework uses these in built-in components — `Button` adds a label in `init()`, `Window` wires drag handlers, `Text` subscribes to `ThemeManager.onThemeChange`.

## Disposal

[`Text`](/components/Text) (and anything that subclasses it — [`Label`](/components/Label), [`Header`](/components/Header), [`Legend`](/components/Legend)) registers a theme-change listener on construction. **Custom components that create `Text` instances dynamically and remove them must call `text.dispose()`** to detach the listener and avoid memory leaks. The framework does this automatically for built-in components attached and removed through normal `addComponent` / `removeComponent` flows.

## See also

- [Mental model](/guide/mental-model) — the architectural overview
- [Layout system](/concepts/layout-system) — how the layout manager actually positions children
- [Sizing](/concepts/sizing) — preferred / min / max size semantics
- [Performance](/concepts/performance) — `pauseLayout`, virtual scrolling, dispose patterns
