# Mental model

`@jimka/typescript-ui` is **not** like React or any HTML-flow framework. It is closer to Java Swing or Win32: every component has an absolute position and size, computed in JavaScript and applied as pixel values. There is no flexbox, no CSS Grid, no document flow.

If you have only ever built UIs with HTML+CSS, the model below is the most important page in this site. The API will mislead you without it.

## What the framework does

A `Component` is a rectangle on the screen with a known `x`, `y`, `width`, `height`. A `LayoutManager` is attached to a container component and decides where each child rectangle goes. Layout runs in JavaScript and writes pixel values to inline styles. The DOM exists only because the browser needs something to paint.

```
+--------------------------+
|  Window                  |  ← Component (absolute x,y,w,h)
|  +--------+-----------+  |
|  | left   | center    |  |  ← children, positioned by Border layout
|  +--------+-----------+  |
|  |  bottom            |  |
|  +--------------------+  |
+--------------------------+
```

## Why?

- **Predictable layout.** Every component's position is the result of a single `doLayout()` pass. No reflow loops, no implicit sizing, no surprises from a sibling growing.
- **Easy to reason about.** Sizes are explicit — `setPreferredSize`, `setMinSize`, `setMaxSize`. Position is explicit — `setPosition`, `setX`, `setY`.
- **Native-feeling desktop apps.** Windows, dialogs, splits, tabs, virtualized tables — the patterns desktop UIs use, available without per-component custom CSS.

## When **not** to use it

- Content-driven sites where the UI grows with text (blogs, docs, marketing pages).
- Apps that need responsive HTML-flow reflow on mobile.
- Anywhere SEO matters — components render lazily into absolute-positioned divs.

## JSX-shaped, without JSX

You can express a UI tree as a single declarative expression — and the framework does this using only plain TypeScript. Three primitives — callable component classes, options-bag configuration, and a `components: [...]` option — combine to give you the JSX shape with nothing more than standard language features:

```ts
Panel({
    layoutManager: HBox(),
    border: "1px solid black",
    components: [
        Panel({
            layoutManager: VBox(),
            components: [Text("Select Customer"), ComboBox()]
        }),
        Button("Save")
    ]
})
```

### How JSX reaches the browser

JSX is not part of JavaScript. The ECMAScript spec has no `<Foo>` syntax. To run in a browser, JSX takes a path through:

- A parser that understands JSX (TypeScript with `--jsx`, Babel + a JSX plugin, esbuild, swc).
- A transform that rewrites `<Foo bar="x">` into a function call (`React.createElement(Foo, ...)`, `h(Foo, ...)`, etc.).
- Per-project configuration pointing the transform at a factory (`jsxFactory`, `jsxImportSource`, or per-file `/** @jsx ... */` pragmas).
- A runtime helper from a library to interpret what the factory returns.

By the time browser code runs, JSX is already gone — it has been compiled into function calls. The work is purely build-time.

### What this framework uses instead

Object literals, function calls, and arrays — all valid TypeScript expressions. The same TypeScript compiler and bundler that handles the rest of your project handles your UI trees without extra configuration. There is no JSX flag, no factory pragma, no runtime helper.

### What you get

Nested object literals replace angle-bracketed elements — a similar visual hierarchy with slightly different punctuation. In return:

- **A standard TypeScript toolchain.** No JSX-specific tsconfig flags or per-file pragmas; your existing build pipeline already knows how to handle every line of UI code.
- **Direct construction.** Calling a component returns a real, live instance immediately — ready to inspect, mutate, or hand to other code.
- **First-class IDE navigation.** Ctrl+click on a component name jumps straight to its TypeScript class.
- **No virtual DOM, no diffing layer.** What you build is what is on screen, from the moment you build it.

The framework's imperative widget model — build a tree once, then mutate via setters on retained references — gives you direct control over component lifecycles. The declarative shape on top makes that control comfortable to use, without bringing along the build machinery that a JSX-based stack would need.

## The three layers

```
Entry point (your main.ts)
  └─ Your panels / screens
       └─ Component system (lib/)
            ├─ Layout managers (lib/layout/)
            └─ UI components (lib/component/)
```

### Component system

Every UI element extends [`Component`](/api/core/classes/Component), which manages:

- Absolute position and size (with min / max / preferred bounds).
- CSS styling (colors, borders, shadow, opacity).
- Child component tree and the layout manager attached to it.
- Deferred DOM rendering via `getElement()` — the actual `<div>` is not created until needed.

[`BaseObject`](/api/core/classes/BaseObject) sits above `Component` and provides UUID-based identity. [`Body`](/api/core/classes/Body) is a singleton wrapping `document.body` that bootstraps the framework and listens for viewport resize events.

### Layout managers

A [`LayoutManager`](/api/layout/classes/LayoutManager) is attached to a container component and positions its children on each `doLayout()` call. All managers extend `LayoutManager`, which handles fill / anchor constraint resolution.

See [Layouts](/layouts/) for the full list (Border, Card, Column, Fit, Grid, HBox, Row, Split, Tab, VBox, and more).

### UI components

`lib/component/` contains 50+ ready components — buttons, text inputs, lists, tables, trees, menus, dialogs. See [Components](/components/) for the catalog.

## What runs when you call `setSize`

1. You call `myComponent.setPreferredSize({ width: 200, height: 100 })`.
2. The component's preferred size is updated in memory.
3. On the next `doLayout()` pass (triggered by viewport resize, an explicit call, or a parent's layout), the parent's layout manager reads `getPreferredSize()` and decides where to place the child.
4. The layout manager calls `placeComponent(child, x, y, w, h)`, which writes pixel values to the child's inline styles.
5. The browser paints.

There is no auto-reflow when you change a child's preferred size. **You must call `doLayout()` on a container** (or trigger a parent re-layout) for the change to take effect.

## Common gotchas

- **Always include "px" units** when you write your own dimensional CSS values. The framework does this automatically; custom CSS does not.
- **`moduleResolution: "bundler"`** is required in your `tsconfig.json`. The library imports its own modules with `.js` extensions that resolve to `.ts`.
- **Use `mouseover` / `mouseout`**, not `mouseenter` / `mouseleave`, when wiring hover listeners through `addSubtreeListener`. The latter do not bubble and so do not reach delegated listeners.
- **Call `dispose()`** on `Text`-derived components you remove dynamically, so theme-change listeners do not leak.
- **Prefer `addSubtreeListener`** when catching events from child components. `addListener` only matches the exact target ID.

## Next steps

- [Component lifecycle](/concepts/component-lifecycle) — construction → render → layout → destroy.
- [Constructing components](/concepts/construction) — callable shorthand and the callable-vs-`new` rule.
- [Layout system](/concepts/layout-system) — how a layout manager resolves constraints.
- [Sizing](/concepts/sizing) — preferred / min / max / fixed sizes in detail.
- [Theming](/concepts/theming) — runtime-switchable design tokens.
