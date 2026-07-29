# Migration

Version-to-version breaking-change notes. Each entry below covers one upgrade
and lists the changes that need code updates. See [Versioning
policy](#versioning-policy) for what counts as a breaking change.

## Upgrading from 0.1.x to 0.2.0

### Size setters take a `Size` object

`Component.setPreferredSize`, `setMinSize`, and `setMaxSize` now take a
single `Size` object instead of two loose numbers:

```typescript
// Before
sidebar.setPreferredSize(240, 0);
sidebar.setMinSize(180, 0);
sidebar.setMaxSize(360, 0);

// After
sidebar.setPreferredSize({ width: 240, height: 0 });
sidebar.setMinSize({ width: 180, height: 0 });
sidebar.setMaxSize({ width: 360, height: 0 });
```

`Size` is a structural interface (`{ width: number; height: number }`), so no
import is needed — an object literal with those two fields satisfies it.
There is no `(width, height)` overload and no deprecation window. Run `npm
run typecheck` after upgrading; every affected call site becomes a compile
error, so the type checker finds them all for you.

### Event listeners consume by return value

A listener registered through `Event.addListener`, `Event.addSubtreeListener`,
or `Event.addViewportListener` now tells the dispatcher what to do with the
event by **returning** a disposition, instead of calling `stopPropagation()`
itself:

```typescript
// Before
Event.addListener(button, 'keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        activate();
    }
});

// After
Event.addListener(button, 'keydown', (e: KeyboardEvent) => {
    if (e.key !== 'Enter') {
        return;
    }

    activate();

    return { stop: true, prevent: true };
});
```

Return nothing (or `false`) to leave the event alone, `true` to stop
propagation, `{ prevent: true }` to call `preventDefault()`, and
`{ stop: true, prevent: true }` for both.

Calling `e.stopPropagation()` directly still halts native DOM propagation — it
is the event's own method — but it no longer tells the dispatcher anything, so
it will not stop a subtree listener's walk up the ancestors. Only a returned
disposition does that. `e.preventDefault()` is unaffected and can still be
called directly.

**An `async` listener no longer typechecks.** An `async` function returns
`Promise<void>`, which is not a valid disposition. Wrap the async work instead
of making the listener itself async:

```typescript
// Before
Event.addListener(save, 'click', async () => { await persist(); });

// After
Event.addListener(save, 'click', () => { void persist(); });
```

The same applies to the semantic `on(...)` shorthands — `Button`, `ToggleButton`,
`Checkbox`, `RadioButton`, `Slider`, `TextInput`, and the selectable lists all
forward `on("action", …)` to `Event.addListener`, so their listeners follow the
same protocol and an `async` one breaks the same way. `Link` is affected too — it
extends `Text`, not `Button`, but types its `"action"` listener with the same
exported `ClickListener`. Any class typing a listener as `ClickListener` is in
the same position.

The **construction-time `listeners` bag** breaks the same way where it is typed
`ClickListener` — `Button`, `ToggleButton`, `Link`, and `SpinButton` — and its
error (`No overload matches this call`) is less obvious than the direct-call
one:

```typescript
// Before
new Button({ text: 'Save', listeners: { action: async () => { await save(); } } });

// After
new Button({ text: 'Save', listeners: { action: () => { void save(); } } });
```

**`Checkbox`, `Slider`, `RadioButton`, `TextInput`, `List`, and `MultiSelectList`
type their bag `action?: () => void`, and get no compiler check at all.** A
`() => void` parameter accepts a function returning *any* value, so neither an
`async` listener nor a value-returning one is rejected there:

```typescript
// Compiles clean — and now stops propagation on every click, because
// Set.delete() returns a boolean and `true` means consume.
new Checkbox({ listeners: { action: () => selected.delete(id) } });

// What you want instead.
new Checkbox({ listeners: { action: () => { selected.delete(id); } } });
```

These bags dispatch to `on("action", …)`, which forwards to
`Event.addListener`, so the disposition is read exactly as it would be from a
directly registered listener — an ancestor subtree listener (row selection, for
instance) simply stops firing. Check these bags by hand; the type checker will
not flag them.

### A concise arrow returning a value no longer compiles

This is the most common break in practice, and the compiler message is not
obvious. A one-line arrow returns whatever its expression evaluates to. If that
value is not a valid disposition — a builder returning `this`, a `Promise`, an
element — the listener no longer typechecks:

```typescript
// Before — goToPage() returns `this` for chaining; the arrow returned it too,
// and nothing looked at the value.
pager.on('action', () => store.goToPage(1));

// After — wrap the call so the arrow returns nothing.
pager.on('action', () => { store.goToPage(1); });
```

`EventDisposition` is a weak type (every field optional), so an unrelated object
has no overlapping property and is rejected. The fix is always the same: give
the arrow a block body, or prefix the expression with `void`.

### A concise arrow returning a boolean now consumes silently

This is the one break the compiler cannot tell you about, so it is worth
checking for by hand. An arrow whose expression happens to evaluate to a
`boolean` is a *valid* disposition, so it still typechecks — and `true` now
means "stop propagation":

```typescript
// Before — the return value was ignored; Set.delete() returning true was
// incidental.
Event.addListener(row, 'click', () => selected.delete(id));

// After — that same listener now consumes every click, and as a subtree
// listener it also stops the event reaching any ancestor.
Event.addListener(row, 'click', () => { selected.delete(id); });
```

Watch for one-line listeners wrapping anything that returns a `boolean`:
`Set`/`Map` `delete` and `has`, `Array.prototype.includes`, and predicate
getters like `isOpen()`. Give any such listener a block body unless you
genuinely want it to consume.

### Overridable drag handlers changed signature

Five public methods on exported classes are part of the same protocol change.
Three dropped the event parameter they only carried in order to reach
`stopPropagation()`, and all five now return a disposition:

| Method | Before | After |
| --- | --- | --- |
| `AbstractWindow.onMouseUp` | `(e?: Event): void` | `(): Event.ListenerResult` |
| `SplitGutter.onDragStop` | `(e?: Event): void` | `(): Event.ListenerResult` |
| `WindowBorder.onDragStop` | `(e?: Event): void` | `(): Event.ListenerResult` |
| `AbstractWindow.onDrag` | `(e: MouseEvent): void` | `(e: MouseEvent): Event.ListenerResult` |
| `SplitGutter.onDrag` | `(evnt: MouseEvent): void` | `(evnt: MouseEvent): Event.ListenerResult` |

**An override written against the old signature still compiles, and silently
stops consuming.** TypeScript accepts a subclass method that declares an extra
optional parameter, and `void` is a member of `ListenerResult`, so
`onMouseUp(e?: Event): void { … }` produces no error — it simply returns
nothing, which the dispatcher reads as "do not consume". The drag then leaks
its `mouseup` to the rest of the page.

The compiler cannot find this one for you. If you override any of the five,
return a disposition explicitly:

```typescript
// Before
onMouseUp(e?: Event): void {
    e?.stopPropagation();
    super.onMouseUp();
}

// After
onMouseUp(): Event.ListenerResult {
    super.onMouseUp();

    return true;
}
```

### Listener-forwarding methods narrowed their parameter type

Six public methods took `listener: Function` and now take
`listener: Event.Listener`:

- `Component.addMouseDownListener` / `removeMouseDownListener`
- `Component.addMouseDownSubtreeListener` / `removeMouseDownSubtreeListener`
- `Button.addPointerDownListener`
- `WindowHeader.addHeaderDoubleClickListener`

Anything you could previously pass as an untyped `Function` is now checked
against the listener contract, so an `async` handler or a value-returning
concise arrow fails here for the same reasons described above.

## Upgrading from 0.2.x to 0.3.0

### Marker lists paint their own bullets and numbers

`BulletedList` and `NumberedList` no longer rely on the browser's `::marker`;
each item renders its marker as a real child component, which the framework can
measure and position like any other content.

Nothing to change to keep compiling — no enum member was removed, and
`getStyle()` still returns exactly what you set. Every numbering and bullet
style renders, and nothing warns. What changes is what you see:

- The bullet characters are the framework's own and differ slightly from each
  browser's.
- `UPPER_GREEK` renders uppercase Greek. No browser ever did, because
  `upper-greek` is not a predefined CSS counter style, so it used to fall back
  to decimal.
- `LOWER_ALPHA` and `LOWER_LATIN` render identically, as do `UPPER_ALPHA` and
  `UPPER_LATIN`. CSS defines each pair as aliases of one counter style.
- Roman numbering covers items 1–3999 and renders decimal above that, matching
  the range CSS gives its predefined roman counter styles.

Every item in one list also shares a marker column as wide as that list's widest
marker, with the marker right-aligned inside it. Markers share a right edge and
labels share a left edge, so a label may sit a few pixels further right than it
did when each item sized its own marker slot.

If you subclass `AbstractMarkerList` directly, implement its new protected
abstract `markerText(index)` — return the marker string for that position, or
`""` for none.

### `Aria.applyToElement` was removed

Every `Aria` mutator (`setRole`, `setSelected`, `setSort`, …) already writes
through the component's attribute channel, so the ARIA state it flushed is
already on the element with no second call. Delete the call site; nothing
replaces it.

```typescript
// Before
component.getAria().setRole("grid");
component.getAria().applyToElement(element);

// After
component.getAria().setRole("grid");
```

### The optional `elkjs` peer moved to `^0.12.0`

Affects only consumers of `@jimka/typescript-ui/component/diagram`. Install the
new elkjs together with the library, or npm rejects the install with an
`ERESOLVE` peer conflict:

```bash
npm install @jimka/typescript-ui@<version> elkjs@^0.12.0
```

No `layoutOptions` key changed — ELK 0.12 only added layout options. Laid-out
coordinates can still differ slightly, so give any diagram whose spacing you
tuned by eye a visual check.

### Rewriting an element's `class` attribute drops its positioning

Every rendered element now carries a `ts-ui-component` class, because the
declarations that are byte-identical across all components — `position:
absolute`, `box-sizing`, and four others — moved out of each instance's
per-id `#uuid` rule onto a single zero-specificity `:where(.ts-ui-component)`
rule. That rule is what positions the element.

So any code that writes the **whole** `class` attribute, rather than adding
or removing one token, must re-state it. A component that loses the class
falls back to `position: static` and collapses into document flow, typically
stacking on top of its siblings:

```typescript
// Before — fine when #uuid carried position: absolute.
row.setElementAttribute('class', selected ? 'row selected' : 'row');

// After — keep the framework class in the written token list.
row.setElementAttribute('class', ['ts-ui-component', 'row', selected && 'selected']
    .filter(Boolean)
    .join(' '));
```

The class name is not exported as a constant, so spell it out; it is stable
and will not change without a migration note of its own. The framework also
adds a class named after the component's own class (`Button`, `Panel`, …) on
the same element — a full-attribute write drops that too, so anything you
style by class name needs re-stating as well.

Prefer an additive write, which has neither problem:

```typescript
DOM.sink.apply(element, {
    removeClass: ['selected'],
    addClass:    selected ? ['selected'] : [],
});
```

The compiler cannot find these. Grep for writes of the `class` attribute.

### `Component._defaultOptions` is frozen and shared per class

`_defaultOptions` used to be a fresh object literal built on every
construction. It is now resolved once per concrete class, cached on the class
constructor, and `Object.freeze`d, so ~1,400 identical bags in a wide table
window become one. Two consequences for a `Component` subclass:

- **Writing into it after `super(...)` now throws** in strict mode (and every
  module here is strict), where it previously mutated only that instance's
  copy. Pass the defaults through the `subclassDefaults` constructor
  parameter instead — the documented mechanism, and the only one that keeps
  the per-class cache correct.

- **`layoutManager` is no longer a member of the bag.** A layout manager
  holds per-instance container state and must never be shared, so it moved to
  a private per-instance slot; `this._defaultOptions.layoutManager` now reads
  `undefined`. Keep supplying it via `subclassDefaults` exactly as before —
  only reading it back off `_defaultOptions` broke.

```typescript
// Before
class Card extends Component<CardOptions> {
    constructor(options?: CardOptions) {
        super(options);
        this._defaultOptions.insets = new Insets(8, 8, 8, 8);  // now throws
    }
}

// After
class Card extends Component<CardOptions> {
    constructor(options?: CardOptions, subclassDefaults?: Partial<CardOptions>) {
        super(options, { insets: new Insets(8, 8, 8, 8), ...(subclassDefaults ?? {}) });
    }
}
```

A class whose defaults genuinely vary per instance (they derive from a
constructor argument, as `Panel`'s do) still works: the resolver detects the
mismatch against the cached bag and hands that instance its own private
frozen bag, without disturbing the cache.

### `DOMSink.setRuleStyle` became `setRuleStyles`

Affects only a consumer that implements its own `DOMSink` — the method is
part of the DOM write seam, not something application code calls. It now
takes a whole declaration bag so a render's dirty keys reach the stylesheet
in one mutation instead of one per key:

```typescript
// Before
setRuleStyle(rule: CSSStyleRule, key: string, value: string | null): void

// After
setRuleStyles(rule: CSSStyleRule, styles: Record<string, string | null>): void
```

`npm run typecheck` flags the missing member on any custom sink.

### `DOMSource` gained `startFontLoad`

Affects only a consumer that implements its own `DOMSource` — like the sink
change above, this is part of the DOM seam, not something application code
calls. An `@font-face` rule downloads nothing until rendered content uses it,
so the framework now asks for the font explicitly as soon as it installs the
rules, and the return value tells it whether an activation callback will
follow:

```typescript
startFontLoad(family: string): boolean
```

Return `true` only if the call really started an asynchronous load. A source
that cannot load fonts asynchronously — no CSS Font Loading API, or one
measuring against baked fonts — returns `false`:

```typescript
startFontLoad(_family: string): boolean {
    return false;
}
```

The distinction matters beyond bookkeeping. The framework holds its first
layout pass until the font reports back (see below), and only `true` arms that
hold. A source that returns `true` without ever settling a load delays the
first layout by the full 50 ms bound.

`npm run typecheck` flags the missing member on any custom source.

### `SplitGutter.destroy()` and `CollapseButton.destroy()` were removed

Both only unhooked listeners and left the component's per-instance stylesheet
rule on the shared sheet — call the inherited `dispose()` instead, which does
the listener cleanup *and* the full teardown:

```typescript
// Before
gutter.destroy();
collapseButton.destroy();

// After
gutter.dispose();
collapseButton.dispose();
```

`npm run typecheck` flags any remaining call site — neither method exists
anymore.

### Behaviour changes worth a check

Neither of these is a compile error, and neither needs a code change in most
apps — but both change when a callback runs.

- **A `"selection"` event no longer fires for an unchanged selection.**
  `Tree`, the table body, and `Table`'s rotated mode now stay silent when the
  resolved selection matches the one already held, so a store reload that
  re-resolves to the same records, or a click on an already-selected row, no
  longer re-fires. A listener using the redundant emit as a general
  "something happened" signal — refreshing a detail pane on every reload, say
  — needs a different trigger, such as the store's own change event.

- **`DOMSource.onFontsReady` may now fire more than once, or not at all.** It
  is driven by the font set's `loadingdone` event rather than a one-shot
  `document.fonts.ready`, so it fires per swap-in batch and never fires on a
  document that loads no web fonts. A callback registered through it must be
  idempotent and must not be relied on as a one-time "startup finished" hook.

- **The first layout pass now waits for the web font to activate.** Text
  measured before the bundled face activates is measured against the browser's
  fallback font, so the first layout used to commit sizes that were wrong the
  moment the real face arrived. The coalesced layout queue now holds its first
  flush until the font settles, bounded at 50 ms, and `Tree` and the table body
  defer their own render passes for the same window. Two timing consequences
  follow: a post-layout callback registered during startup — through either
  `Component.afterNextLayout` or `Component.onFirstLayout` — runs after the
  release rather than on the first frame, so anything measuring geometry from
  one now sees the post-activation sizes; and `flushLayout()` /
  `resumeLayout()` still lay out synchronously and deliberately bypass the
  hold, so a caller using either during startup can still read
  fallback-measured geometry. `Tree` and the table body are the exception to
  that second point: they check the hold inside their own render pass, so
  flushing one during startup lays out its frame but leaves its rows
  unrendered until the hold ends. Read row geometry after the release — from
  `Component.afterNextLayout`, say — rather than from a synchronous flush. A
  programmatic scroll on either view during that window is held and applied on
  release rather than taking effect immediately, so a scroll offset read back
  inside the window can still be the pre-scroll one.

## Versioning policy

The package follows [Semantic Versioning](https://semver.org), with the standard pre-1.0 caveat:

- **`0.x.y` (pre-release)** — anything may change in any release, including breaking the public API. The package is in active development and not yet recommended for use outside the project itself.
- **`1.0.0` and beyond:**
  - **Major** — breaking changes to the public API. Renamed or removed exports, changed function signatures, behaviour changes that require code updates.
  - **Minor** — new features and additive changes. Existing code continues to work.
  - **Patch** — bug fixes and internal improvements with no API impact.

The "public API" means everything re-exported from the per-group barrels at `src/typescript/lib/<group>/index.ts` (the entries listed in the [`package.json` `exports` map](https://github.com/jimka/typescript-ui/blob/master/package.json)). Internal modules — even those exported as side-effect of a class hierarchy — are subject to change without notice.

## Pre-1.0 compatibility

The public API is not stable before `1.0.0`: any `0.x.y` release may break it,
and the version number alone is not a compatibility guarantee. Breaking changes
that require code updates do get an entry on this page — the `0.1.x` to `0.2.0`
note above is one — so read the entry for the version you are moving to rather
than relying on the version bump to tell you whether anything changed.

## Upgrade procedure

When moving to a new version:

1. Read the entry for that version above, plus any entry between it and the version you are on.
2. Update the dependency: `npm install @jimka/typescript-ui@<version>`.
3. Run `npm run typecheck` (or your equivalent) to surface signature mismatches.
4. Address each error using the corresponding migration note above.
5. Run your test suite or manually exercise the app.

## See also

- [Changelog](/reference/changelog) — full release history.
- [GitHub releases](https://github.com/jimka/typescript-ui/releases) — release notes per version.
