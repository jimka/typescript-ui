# Troubleshooting

Diagnostics for common runtime issues. For pre-flight questions, see the [FAQ](/reference/faq).

## "My component is 0 × 0"

The single most common issue. Run through this list:

1. **Does the parent have a layout manager?** A bare [`Component`](/api/classes/Component) defaults to [`Absolute`](/layouts/Absolute), which positions nothing.

   ```typescript
   panel.setLayoutManager(VBox());  // ← required
   ```

2. **Are you reading size before layout has run?**

   ```typescript
   panel.addComponent(child);
   panel.doLayout();              // ← runs the layout pass
   console.log(child.getSize()); // now non-null
   ```

3. **Is your custom CSS missing "px"?**

   ```typescript
   component.setElementStyle('padding', '8');    // ❌ ignored
   component.setElementStyle('padding', '8px');  // ✅
   ```

## "My layout never runs"

Three causes worth checking:

- **Component not attached to the tree.** Layout only runs on components that are reachable from [`Body.getInstance()`](/components/Body). Confirm with `panel.getParentComponent()`.
- **`pauseLayout()` not paired with `resumeLayout()`.** A stray `pauseLayout` blocks the rAF queue indefinitely.
- **Hidden component.** `setVisible(false)` skips layout for the component and its subtree. Subsequent setters are stashed but don't trigger passes.

## "Theme tokens aren't applying"

The theme manager writes CSS custom properties on `:root` (the `<html>` element). If your component's CSS rule uses a token but you don't see the value:

1. **Did you call `setTheme` before mounting?** Components apply CSS rules on construction. Calling `setTheme` later still works (cascade re-flows), but it must run at *some* point.

   ```typescript
   ThemeManager.setTheme(DefaultTheme);  // before any component construction
   ```

2. **Are you using a fallback in your CSS rule?** Tokens with no fallback show as empty when unset.

   ```typescript
   component.setBackgroundColor('var(--ts-ui-button-bg, gray)');  // gray fallback
   ```

3. **Is the token name correct?** Cross-check against the table in [Theming › Theme keys](/concepts/theming#theme-keys).

## "My listener doesn't fire"

- **Wrong event type for delegation.** `mouseenter` / `mouseleave` don't bubble in Chrome — use `mouseover` / `mouseout` with `addSubtreeListener`.
- **`addListener` instead of `addSubtreeListener`.** `addListener` only matches the exact target element, not descendants.
- **Anonymous handler removed accidentally.** `removeListener` requires the **same function reference** passed to `addListener`. Arrow-function shorthands create a new reference each time.

```typescript
// ❌ removeListener can't match
Event.addListener(button, 'click', () => save());
Event.removeListener(button, 'click', () => save());

// ✅ keep a reference
const onClick = () => save();
Event.addListener(button, 'click', onClick);
Event.removeListener(button, 'click', onClick);
```

## "I'm seeing growing memory usage over time"

Most often a [`Text`](/components/Text)-derived listener leak. Custom components that create `Text`, [`Label`](/components/Label), [`Header`](/components/Header), or [`Legend`](/components/Legend) instances dynamically and remove them must call `text.dispose()` to detach the theme-change listener:

```typescript
class StatusBar extends Component {
    private message: Text = Text('');

    protected destructor(): void {
        this.message.dispose();
        super.destructor();
    }
}
```

Built-in components attached and removed through normal `addComponent` / `removeComponent` flow have this handled automatically.

## "My filter or sort is throwing in a Worker"

The store offloads sort and filter to a Web Worker for datasets ≥ 1,000 rows. The worker uses **structured clone** to receive the data and predicate.

- **Custom filter functions are not transferable.** Functions captured in `filterBy` callbacks fail to clone. Use [`FilterDescriptor`](/api/type-aliases/FilterDescriptor) — a serialisable filter algebra — for filters that need to cross the worker boundary.
- **Records with non-cloneable fields** (functions, DOM nodes, class instances with private state) trigger a clone error in the worker. Keep store data as plain objects.

## "Drag interactions feel laggy"

[`Window`](/components/Window) and [`Split`](/layouts/Split) drag operations throttle layout to 30 fps by default. For heavier UIs, lower the frame rate further:

```typescript
window.setResizeFps(15);
```

Conversely, for snappier interaction in a light UI:

```typescript
window.setResizeFps(0);  // every frame, no throttle
```

## "My table flickers during fast scrolling"

A known one-frame flicker comes from the browser's GPU compositor scrolling the rows visually before the JS scroll event reaches the main thread. The framework's virtual-scroll pool catches up on the next frame.

Mitigations:

- Reduce the per-row height — fewer rows in the buffer means less work per frame.
- Remove non-essential cell renderers (custom renderers are slower than the built-in [`StringRenderer`](/api/classes/StringRenderer) / [`NumberRenderer`](/api/classes/NumberRenderer)).
- For a fully glitch-free implementation, the framework would need to switch to a transform-based positioning strategy. This is a known trade-off, not a fixable bug at the current architectural layer.

## "I see TypeScript errors I didn't write"

The most common cause: missing `"moduleResolution": "bundler"`. Add it to your `tsconfig.json`. See [FAQ](/reference/faq#why-do-i-need-moduleresolution-bundler).

## When to file an issue

If this page didn't help and you've narrowed the problem to a small reproducer, the [GitHub issue tracker](https://github.com/jimka/typescript-ui/issues) is the right place. Include:

- Browser + version
- TypeScript version
- A minimal reproducer (a few dozen lines, ideally runnable in the demo app)
- Expected vs actual behaviour
