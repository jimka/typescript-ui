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
same protocol and an `async` one breaks the same way. Any `Button` subclass that
declares its own `"action"` overload is in the same position.

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
