# Browser support

## Verified browsers

| Browser | Status | Notes |
| --- | --- | --- |
| **Chrome** | ✅ Tested | The primary development target. |
| **Firefox** | ✅ Tested | Routinely verified during development. |
| **Safari** | ⚠️ Unverified | The framework relies on standard DOM APIs, so most things should work — but there is no automated coverage. Reports welcome via the [issue tracker](https://github.com/jimka/typescript-ui/issues). |

The framework targets desktop-class browsers from the last few years. It deliberately does not implement workarounds for legacy IE / Edge Legacy.

## Required browser features

The framework uses these APIs with no polyfills:

- ES2017+ (async/await, classes, modules)
- `ResizeObserver` (used by `Body` for some layout cases)
- `Intl.NumberFormat` (used by date / number cells)
- `Web Workers` (used by `AbstractStore` for sort/filter offload on datasets ≥ 1,000 rows)
- CSS custom properties (used by the theme system)

All of these have been available in evergreen Chrome and Firefox since 2018.

## Mobile browsers

Not a primary target. The framework's absolute-positioning model is not particularly mobile-friendly out of the box — there are no built-in responsive breakpoints, no touch-optimised gestures beyond the basic drag handlers, and the typography sizes target desktop reading distance.

The DOM APIs work — touch events fire, resize listeners run — but app-level behaviour (window dragging, multi-column tables) needs deliberate adaptation for narrow viewports.

## Known browser-specific behaviours

### Hover events: `mouseover` not `mouseenter`

Chrome (and Firefox / Safari) implement `mouseenter` and `mouseleave` as **non-bubbling** events. The framework's [`addSubtreeListener`](/concepts/events#addsubtreelistener) relies on bubbling, so subtree (delegated) listeners never receive these events.

Use `mouseover` and `mouseout` for hover detection through subtree listeners.

### One-frame scroll flicker in tables

The browser's GPU compositor scrolls rows visually before the JS scroll event reaches the main thread, producing a one-frame flicker during fast scrolling. The framework's virtual-scroll pool catches up on the next frame. Eliminating the flicker entirely would require a transform-based positioning strategy (a known architectural trade-off rather than a bug).

### Native form-control styling

The framework uses real `<input>`, `<select>`, `<textarea>` elements where possible. Their visual appearance is browser-driven; minor pixel differences across browsers are normal. The theme system covers borders, backgrounds, and font, but not all native scrollbar / picker / dropdown details.

## Reporting compatibility issues

If you find a browser-specific bug, the issue tracker accepts:

- Browser name + version
- Operating system
- A minimal reproducer

Bug reports about Internet Explorer or Edge Legacy will be closed — those browsers are out of support scope.

## See also

- [README — Browser support](https://github.com/jimka/typescript-ui#readme)
- [Troubleshooting](/reference/troubleshooting)
