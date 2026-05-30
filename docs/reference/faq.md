# FAQ

## Why do I need `moduleResolution: "bundler"`?

The framework's source files import each other with `.js` extensions that resolve to `.ts` at build time. Only `bundler`, `node16`, and `nodenext` resolution modes follow that pattern correctly. Older modes look for literal `.js` files and fail.

Add this to your `tsconfig.json`:

```json
{
    "compilerOptions": {
        "moduleResolution": "bundler"
    }
}
```

## Why is my custom CSS being silently ignored?

You probably forgot the `"px"` unit. Browsers ignore unitless dimensional values:

```typescript
component.setElementStyle('padding', '8');    // ignored
component.setElementStyle('padding', '8px');  // works
```

The framework's setters add `"px"` automatically; raw CSS does not.

## Does the framework support Safari?

Tested on Chrome and Firefox. Safari is not verified. The framework relies on standard DOM APIs (no Chrome-only or Firefox-only features), so most things should work, but there is no automated coverage. See [Browser support](/reference/browser-support).

## Why no flexbox or CSS Grid?

The framework was designed for desktop-style apps where layout is **predictable** — every component has a known position and size, computed by JavaScript on each pass. Flex / grid introduce browser-driven reflow that's harder to reason about for the kinds of apps the framework targets (multi-window IDEs, data grids, dashboards).

For content-driven layouts where you'd reach for flex / grid anyway, this framework is the wrong tool. Use plain HTML+CSS or a flow-oriented framework.

See the [Mental model](/guide/mental-model) for the full reasoning.

## How do I switch themes at runtime?

Call [`ThemeManager.setTheme(Theme)`](/concepts/theming). The call writes new CSS custom properties on `:root` and the cascade does the rest — no re-render needed:

```typescript
import { ThemeManager, DefaultTheme, DarkTheme } from '@jimka/typescript-ui/core';
ThemeManager.setTheme(DarkTheme);
```

For a custom theme, see the [custom theme recipe](/recipes/custom-theme).

## Why is my component 0 × 0?

Three common causes:

1. **No layout manager on the parent.** A bare [`Component`](/api/core/classes/Component) defaults to [`Absolute`](/layouts/Absolute), which positions nothing. Set a manager: `panel.setLayoutManager(VBox())`.
2. **No preferred size on a [`Text`](/components/Text)-derived component before its first measurement.** Wait until the parent has had a chance to lay out, or call `setPreferredSize` explicitly.
3. **Custom CSS without `"px"` units.** See above.

See [Troubleshooting](/reference/troubleshooting).

## How big a dataset can `Table` handle?

Hundreds of thousands of rows comfortably. The body uses [virtual scrolling](/concepts/performance#virtual-scrolling) — only ~50 rows are in the DOM at any time. Sort and filter automatically offload to a Web Worker for datasets ≥ 1,000 rows.

For multi-million-row datasets, write a custom [`Proxy`](/data/proxy) that fetches pages on demand.

## How do I bind a non-Bindable component?

Pass an explicit accessor object as the third argument to `binding.bind`:

```typescript
binding.bind('field', myComponent, {
    get:    () => myComponent.getValue(),
    set:    (value) => myComponent.setValue(value),
    listen: (fn) => myComponent.on("change", fn),
});
```

See [Data binding › Explicit accessors](/data/binding#explicit-accessors).

## Why does my hover handler never fire?

You're probably listening on `mouseenter` / `mouseleave` with `addSubtreeListener`. Those events do **not bubble** in Chrome, so subtree (delegated) listeners never receive them.

Use `mouseover` / `mouseout` instead. See [Events › Hover events](/concepts/events#hover-events-use-mouseover-mouseout).

## Where do `Window` components live in the DOM?

[`Window`](/components/Window) attaches its element to `document.documentElement` (i.e. `<html>`), not `document.body`. This is also why the [theme manager](/concepts/theming) sets text colour on both `<html>` and `<body>` — so floating windows inherit the right colour.

## How do I debug a layout issue?

Most layout problems trace back to a single missing call or wrong constraint. Try, in order:

1. **Confirm the parent has a layout manager** — bare components don't lay out children.
2. **Add `console.log(child.getSize())` after `parent.doLayout()`** — `null` means layout hasn't run; `0×0` means it ran but produced no size.
3. **Check `getPreferredSize`** — many auto-measuring components return `null` until they're attached and measured.
4. **Look for missing `"px"` units** — see above.
5. **Wrap the mutation in `pauseLayout` / `resumeLayout`** — sometimes a stray re-layout in the middle of bulk changes produces ordering issues.

The [Component lifecycle](/concepts/component-lifecycle) and [Sizing](/concepts/sizing) pages cover the underlying mechanics.

## Can I use this framework with React / Vue / Svelte?

Not really. The framework owns DOM updates entirely; mixing it with a virtual-DOM framework's reconciliation in the same subtree leads to fights over which side is authoritative. You can have a plain `<div>` hosted inside a React app and mount the framework into it, but you can't mix children.

## Can I drop the `new` keyword when constructing components?

Yes. Every concrete `Component` subclass, every concrete `LayoutManager`, and `ButtonGroup` are callable as plain functions — `Panel({...})` is identical to `new Panel({...})`. Both forms construct the same instance, satisfy `instanceof`, and remain usable as the right-hand side of `extends`.

```typescript
const panel = Panel({
    layoutManager: HBox({ spacing: 10 }),
    components: [Button("OK"), Text("hello")]
});
```

The two forms are interchangeable; pick whichever reads better at the call site. See [Mental model — JSX-shaped, without JSX](/guide/mental-model#jsx-shaped-without-jsx) and [Component options — Calling without `new`](/recipes/component-options#calling-components-and-layouts-without-new).

## How do I unsubscribe from a listener?

Pass the **same function reference** to `removeListener` that you passed to `addListener`. Anonymous arrow functions cannot be unsubscribed because each definition creates a new reference:

```typescript
const onClick = () => save();
Event.addListener(button, 'click', onClick);
Event.removeListener(button, 'click', onClick);  // works

Event.addListener(button, 'click', () => save());
// can't remove this — there's no reference
```
