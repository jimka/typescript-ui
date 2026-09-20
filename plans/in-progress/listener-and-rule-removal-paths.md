---
touches-shared: [packages/lib/docs/reference/changelog/next.md]
---

# Listeners And Rules With No Removal Path — Implementation Plan

## Overview

Three entries in the render-review correctness register — C7, C15 and C16 —
create something on every call and never take it away. Each one grows a
registry its own class does not own, so nothing in the component system's
teardown reaches what accumulates there.

[`core/Animation.ts:211-212`](packages/lib/src/typescript/lib/core/Animation.ts#L211)
registers a `transitionend` and a `transitionstart` listener on the animated
element and removes neither in `finish()` nor `cancel()`.
[`overlay/ButtonGroup.ts:232`](packages/lib/src/typescript/lib/overlay/ButtonGroup.ts#L232)
registers an `"action"` listener per button with no stored reference, so
`removeButton` cannot remove it and a removed button keeps deselecting its
former siblings; the same file's `setContainer`
([`:276`](packages/lib/src/typescript/lib/overlay/ButtonGroup.ts#L276))
leaves a `keydown` registration on every container it was ever handed.
[`component/editor/theme.ts:68`](packages/lib/src/typescript/lib/component/editor/theme.ts#L68)
builds two fresh `StyleModule`s and 51 CSS rules on every call — once per
editor and once per theme change — into a process-global stylesheet that
`style-mod` gives no way to shrink.

The fixes touch three source files, three test files and two documentation
pages. No exported signature changes.

---

## Scope

**One plan.** The unifying fact is not the remedy — the remedies differ —
but the guarantee each fix installs: *an allocation that today grows without
bound becomes bounded.* All three are proved the same way, by a jsdom test
that drives the leaking call repeatedly and asserts a count stops
climbing.[^one-plan]

The remedy differs because the registries differ, and that difference is the
decision rule the three fixes share:

| # | What grows | Registry it grows into | Removal API? | Remedy |
|---|---|---|---|---|
| C15 | 2 native listeners per `play()` | the element's own listener list | yes — `DOM.sink.removeListener` | remove them at both exits |
| C16 | 1 `Event` registration per button, 1 per container | `Event`'s module-level listener maps | yes — `off()` / `Event.removeSubtreeListener` | hold the reference, remove it at every exit |
| C7 | 2 `StyleModule`s, 51 rules per call | `style-mod`'s per-root `StyleSet` | **no** | never build a second one |

---

## Architecture Decisions

### The remedy is chosen by whether the registry offers removal

A registry that can be shrunk and one that cannot need opposite fixes. Where
the registry can be shrunk, the fix holds the exact reference it registered
and removes it on every exit path. Where the registry cannot be shrunk, the
fix stops creating a second entry. The `## Scope` table sorts the three bugs
by that question.[^why-not-uniform]

### `Animation.play` removes both listeners in `finish()` and in `cancel()`

A single local `stopListening()` runs `DOM.sink.removeListener` for
`transitionend` and `transitionstart`, guarded by a `listening` flag that is
set only once the two registrations are made. Both `finish()`
([`:153`](packages/lib/src/typescript/lib/core/Animation.ts#L153)) and
`cancel()`
([`:133`](packages/lib/src/typescript/lib/core/Animation.ts#L133)) call it.
The precedent is the same file's `afterTransition`, whose `finish` removes
its own `transitionend` at
[`:314`](packages/lib/src/typescript/lib/core/Animation.ts#L314).

### `cancel()` may touch the DOM, and the `listening` flag is what bounds that

`play`'s JSDoc currently promises that cancelling touches no DOM so it stays
safe after the element's handle has been released. That promise is narrowed,
not kept: cancelling now removes two listeners. It may, because
`core/PendingTransitions.ts` — a framework-internal registry of the
transitions still running against each handle — is consulted by
`Component`'s teardown, so every library path that releases a handle has
already cancelled every animation against it, and `cancel()` is
idempotent.[^cancel-safety] The `listening` flag confines the new DOM touch
to the window in which the armed fallback timer would already resolve the
same handle.

### `ButtonGroup` holds one handler per button and removes it at every exit

`addButton` stores its `"action"` closure in a
`Map<RadioButton | ToggleButton, () => void>` keyed by the button;
`removeButton` and `dispose` look the closure up and pass it to
`button.off("action", …)`. The precedent is
[`component/display/Video.ts:108`](packages/lib/src/typescript/lib/component/display/Video.ts#L108)'s
`_mediaHandlers` map — per-key handlers held so the exact reference
registered can be removed on teardown.[^stored-closure]

### C16's behaviour half and its leak half are one fix

The retained `"action"` listener does exactly one thing: call
`updateButtonStates`. Removing it is simultaneously the leak fix and the fix
for a removed button deselecting its former siblings, and one test proves
both.[^one-remedy]

### `addButton` becomes idempotent

Adding a button that is already a member does nothing and returns. Without
that guard a re-add would overwrite the map entry and strand the first
handler, re-opening the leak the map exists to close.[^idempotent-add]

| Call sequence | `getButtons()` today | after | `updateButtonStates` per click today | after |
|---|---|---|---|---|
| `addButton(a)` | `[a]` | `[a]` | 1 | 1 |
| `addButton(a); addButton(a)` | `[a, a]` | `[a]` | 2 | 1 |
| `addButton(a); removeButton(a)` | `[]` | `[]` | — | — |

### `setContainer` unwires the previous container and drops the previous index without sweeping it

`setContainer` first removes the `keydown` registration from the container it
wired last, then wires the new one. The previous `RovingTabIndex` is dropped
by overwriting the field — its members are **not** removed from it one by
one, because `RovingTabIndex.remove` moves DOM focus when the removed item was
the active one.[^no-sweep]

### `codeEditorTheme` is memoised at module scope on the `dark` flag

Two module-level slots hold the built extension for `dark === false` and
`dark === true`; a call with a flag already built returns the same object.
The built theme is a pure function of that flag, so the memo is
sound.[^flag-invariance] The precedent is the sibling module
[`component/editor/editorTheme.ts:31`](packages/lib/src/typescript/lib/component/editor/editorTheme.ts#L31)'s
`_classRulesEnsured` guard, which is the build-once shape
[ARCHITECTURE.md](ARCHITECTURE.md)'s *Module-level shared class rules*
prescribes.

The memo prevents growth; it cannot undo it. `style-mod`'s `StyleSet` keeps
its module list in append order with no removal path, so rules an
already-running session has written stay written. Because the memo lives at
module scope and is consulted from the first call onward, a build that
carries this fix never writes a third module in the first place.

### `ButtonGroup` gains no destructor, so the sibling plan's gates stay green

`ButtonGroup` is not a `Component`; it owns a public `dispose()`, not a
`protected destructor()`. The teardown work goes into that `dispose()`, so
the class still matches none of the three patterns
[`tests/helpers/libraryClassScan.mjs`](packages/lib/tests/helpers/libraryClassScan.mjs)
scans for, and needs neither a registry row nor a baseline entry in any of
`dispose-full-teardown.test.ts`, `dispose-listener-teardown.test.ts` or the
`dispose-drag-teardown.test.ts` that
[`plans/destructor-teardown-coverage.md`](plans/destructor-teardown-coverage.md)
adds. Its standing guard is instead a direct regression test in
`tests/overlay/ButtonGroup.test.ts`.[^gate-blind-spot]

### `ButtonGroup` keeps registering on a component it does not own

[ARCHITECTURE.md](ARCHITECTURE.md)'s *A component must not listen to another
component's events through `Event`* reserves the `Event` API for listening on
self. `ButtonGroup.setContainer` has always registered a subtree `keydown`
listener on the container it is handed, and this plan adds the matching
`Event.removeSubtreeListener` call on that same foreign component. The
deviation is neither created nor widened here; making `ButtonGroup` a
`Component`, or routing the keydown through a typed `on()` surface on the
container, is a separate design change.

---

## Internal Structure

### `Animation.play` — the removal local

```typescript
// core/Animation.ts, inside play(). `listening` joins the existing `let`
// block at :124-127; `stopListening` is declared immediately before `cancel`
// (:133). It closes over `finish` and `rearmFallback`, which are declared
// below it — the same forward reference `cancel` already relies on, and safe
// for the same reason: nothing calls it until both exist.
let listening = false;

const stopListening = (): void => {
    if (!listening) {
        return;
    }

    listening = false;

    DOM.sink.removeListener(el, "transitionend",   finish);
    DOM.sink.removeListener(el, "transitionstart", rearmFallback);
};
```

Call sites, all inside `play`:

| Where | Line today | Insert |
|---|---|---|
| `cancel`, right after `cancelled = true;` | [`:138`](packages/lib/src/typescript/lib/core/Animation.ts#L138) | `stopListening();` |
| `finish`, right after `unregisterTransition(el, cancel);` | [`:159`](packages/lib/src/typescript/lib/core/Animation.ts#L159) | `stopListening();` |
| `applyTransitionAndTo`, right after the two `addListener` calls | [`:212`](packages/lib/src/typescript/lib/core/Animation.ts#L212) | `listening = true;` |

`finish` removes them *before* `buf.set("transition", null)` and before
`config.onComplete?.()`, so a caller that starts a fresh `play()` from its
completion callback installs its listeners onto an element this one has
already let go of.

### `ButtonGroup` — the three new fields

```typescript
// overlay/ButtonGroup.ts, beside the existing private fields at :56-59.

/** Per-button `"action"` handlers, held so the exact reference `addButton` registered can be removed again. */
private readonly _actionHandlers: Map<RadioButton | ToggleButton, () => void> = new Map();

/** The component `setContainer` wired last, held so a re-wire or `dispose` can unregister from it. */
private _container: Component | null = null;

/** The one `keydown` reference registered on `_container`, bound once so `removeSubtreeListener` matches it. */
private readonly _onContainerKeyDown: (e: KeyboardEvent) => Event.ListenerResult;
```

`_onContainerKeyDown` is assigned as the first statement of the constructor —
`this._onContainerKeyDown = this.handleContainerKeyDown.bind(this);` —
mirroring
[`component/container/WindowBorder.ts:131`](packages/lib/src/typescript/lib/component/container/WindowBorder.ts#L131).
`ButtonGroup` calls no `super()`, so its field initialisers have already run
by then and the `declare`-field trap in
[CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) does not apply.

`handleContainerKeyDown` is `setContainer`'s current inline arrow lifted to a
private method, with two changes: it keeps the `SpatialNavigation.claimsKey`
early return first, and it reads `this._rovingTabIndex` into a local and
returns when that local is null, replacing the `!` assertions.

```typescript
private unwireContainer(): void {
    if (this._container === null) {
        return;
    }

    Event.removeSubtreeListener(this._container, "keydown", this._onContainerKeyDown);
    this._container = null;
}
```

### `codeEditorTheme` — the two slots

```typescript
// component/editor/theme.ts, above codeEditorTheme (:68).

/** The built theme for `dark === false`, built on first use and shared by every editor. */
let _lightTheme: Extension | null = null;

/** The built theme for `dark === true`. */
let _darkTheme: Extension | null = null;
```

The function body is unchanged apart from its first and last statements:

```typescript
export function codeEditorTheme(dark: boolean): Extension {
    const cached = dark ? _darkTheme : _lightTheme;

    if (cached) {
        return cached;
    }

    const chrome = EditorView.theme({ /* … unchanged … */ }, { dark });

    const highlight = syntaxHighlighting(HighlightStyle.define([ /* … unchanged … */ ]));

    const built: Extension = [chrome, highlight];

    if (dark) {
        _darkTheme = built;
    } else {
        _lightTheme = built;
    }

    return built;
}
```

---

## Ordered Implementation Steps

Steps 1–3 are C15, 4–9 are C16, 10–11 are C7, 12–13 are documentation. The
three fix groups are independent of each other; within each group the test
step follows its fix.

1. **`packages/lib/src/typescript/lib/core/Animation.ts`** — add
   `let listening = false;` to the `let` block at `:124-127`, add the
   `stopListening` local immediately before `cancel` (`:133`), and make the
   three insertions in the table under *Internal Structure*. Give
   `stopListening` a JSDoc-style line comment saying it removes the two
   registrations `applyTransitionAndTo` made and that the flag makes a second
   call a no-op.
   *Check:* `grep -n 'stopListening' packages/lib/src/typescript/lib/core/Animation.ts` — expect three matches: the declaration, the call in `cancel`, the call in `finish`.

2. **`packages/lib/src/typescript/lib/core/Animation.ts`** — rewrite the
   sentence *"Cancelling touches no DOM, so it stays safe once the element's
   handle has been released"* in `play`'s `@returns`
   ([`:98`](packages/lib/src/typescript/lib/core/Animation.ts#L98)). The
   replacement says: cancelling writes no styles and removes the two
   transition listeners it registered, and it is safe because
   `Component.destructor` and `Component.removeElement` both run the pending-
   transition registry's cancels before releasing the handle. Leave
   `afterTransition`'s own `@returns`
   ([`:287`](packages/lib/src/typescript/lib/core/Animation.ts#L287))
   untouched — its `cancel` genuinely still leaves its listener attached.

3. **`packages/lib/tests/core/Animation.test.ts`** — add the five cases named
   in *Expected Behaviour* to the existing `describe('play')` block
   ([`:116`](packages/lib/tests/core/Animation.test.ts#L116)), plus a
   `listenerOps(op, type)` helper beside `stylesSince`
   ([`:108`](packages/lib/tests/core/Animation.test.ts#L108)) that counts
   `sink.writes` entries whose `op` matches and whose `args[0]` is the event
   type. `beforeEach` installs a fresh recording sink, so the helper needs no
   `from` index. Add them as new `it` cases rather than extending the four
   existing `play` cases that share their drivers, mirroring how
   `describe('afterTransition')` gives each removal case its own `it`.
   *Check:* `npx vitest run tests/core/Animation.test.ts` — the whole file passes, including the four `afterTransition` cases, which this plan does not change.

4. **`packages/lib/src/typescript/lib/overlay/ButtonGroup.ts`** — add the
   three private fields from *Internal Structure* beside the existing ones
   (`:56-59`), and assign `_onContainerKeyDown` as the first statement of the
   constructor body (`:68`), before the `allowDeselect` line.

5. **`packages/lib/src/typescript/lib/overlay/ButtonGroup.ts`** — rework
   `addButton` (`:229`): early-return when `_actionHandlers.has(button)`;
   build the `"action"` closure into a `const handler`, store it in the map,
   and pass that same `handler` to `button.on("action", handler)`. Extend the
   method's JSDoc with one sentence: adding a button already in the group is a
   no-op, and the group holds the handler so `removeButton` can remove it.

6. **`packages/lib/src/typescript/lib/overlay/ButtonGroup.ts`** — in
   `removeButton` (`:252`), after the `splice`, look the handler up, call
   `button.off("action", handler)` and delete the map entry, then leave the
   existing `RovingTabIndex.remove` call as it is. Extend the JSDoc: the
   removed button no longer deselects its former siblings.

7. **`packages/lib/src/typescript/lib/overlay/ButtonGroup.ts`** — lift
   `setContainer`'s inline arrow (`:283-295`) into a private
   `handleContainerKeyDown` method as described in *Internal Structure*; add
   the private `unwireContainer` method; have `setContainer` call
   `unwireContainer()` first, then record `this._container = container` and
   register `this._onContainerKeyDown`. Extend `setContainer`'s JSDoc: calling
   it again unwires the previous container.

8. **`packages/lib/src/typescript/lib/overlay/ButtonGroup.ts`** — rewrite
   `dispose` (`:138`) to `off()` every entry in `_actionHandlers`, clear the
   map, call `unwireContainer()`, null `_rovingTabIndex`, then clear
   `_listeners` as it does today. **Replace its JSDoc**, which currently
   asserts that the buttons and the container each own these registrations
   and release them themselves — that claim is what rationalised the leak and
   is false: the registrations are the group's own.
   *Check:* `npm run typecheck` in `packages/lib`, then `grep -n 'Event.addSubtreeListener\|Event.removeSubtreeListener' packages/lib/src/typescript/lib/overlay/ButtonGroup.ts` — expect one of each.

9. **`packages/lib/tests/overlay/ButtonGroup.test.ts`** — add the cases named
   in *Expected Behaviour*. They need a real event dispatch rather than the
   file's `selectVia` shortcut, so reuse the `freshKeydownWindow()` purge
   helper the file already defines
   ([`:274`](packages/lib/tests/overlay/ButtonGroup.test.ts#L274)) — rename
   it `freshEventWindow()` and move it to module scope so both `describe`
   blocks can call it, keeping its explanatory comment verbatim. Drive a
   member with
   `Event.fireEvent(button, makeEvent(button.getElement(true)!, 'click') as any)`,
   which reaches `ToggleButton.onAction` and its `Event.fireEvent(this, "change")`
   and so runs the group's real `"action"` handler.
   *Check:* `npx vitest run tests/overlay/ButtonGroup.test.ts` — the whole file passes, including the twelve existing selection-model cases.

10. **`packages/lib/src/typescript/lib/component/editor/theme.ts`** — add the
    two module-level slots above `codeEditorTheme` (`:68`) and the four
    statements shown in *Internal Structure*. Do not touch the `EditorView.theme`
    spec or the `HighlightStyle.define` array. Extend the function's JSDoc
    with the reason for the memo: `style-mod` bounds a root's rule count by
    the number of modules mounted into it and offers no unmount, so a module
    per call grows the stylesheet forever; and the build depends on nothing
    but `dark`, because every colour is a module constant or a CSS variable
    the browser resolves at paint time.
    *Check:* `npm run typecheck` in `packages/lib`.

11. **`packages/lib/tests/component/code-editor-theme.test.ts`** — create the
    new test file with the two cases in *Expected Behaviour*. A dedicated file
    is required, not a preference: the memo is module state, vitest isolates
    module state per test file, and the spies must be installed before the
    first `codeEditorTheme` call of the process. Copy that reasoning from
    [`tests/component/editorTheme.multicolumn.test.ts`](packages/lib/tests/component/editorTheme.multicolumn.test.ts)'s
    file header, which exists for the same reason.
    *Check:* `npx vitest run tests/component/code-editor-theme.test.ts`.

12. **`packages/lib/docs/components/ButtonGroup.md`** — in the
    *Common methods* table, add a `removeButton(button)` row ("Remove a button
    from the group; it stops affecting the group's selection") and a
    `dispose()` row ("Release the group's listeners on its buttons and its
    container"), and extend the `addButton(button)` row with "adding a button
    already in the group is a no-op". Leave the `getSelected()` row exactly as
    it is — it documents a method the class does not have, which is a
    pre-existing error this plan does not own.

13. **`packages/lib/docs/reference/changelog/next.md`** — add three entries
    under `## Fixed`: `Animation.play` under `### Core`, `codeEditorTheme`
    under `### Components`, and `ButtonGroup` under `### Overlay`. The
    `ButtonGroup` entry names all three consumer-visible changes — a removed
    button stops deselecting its former siblings, a re-`setContainer` stops
    driving navigation from the old container, and `addButton` of an existing
    member is now a no-op. This file is also edited by
    [`plans/destructor-teardown-coverage.md`](plans/destructor-teardown-coverage.md);
    add entries, never rewrite neighbouring ones.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Animation.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/ButtonGroup.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/theme.ts` |
| Modify | `packages/lib/tests/core/Animation.test.ts` |
| Modify | `packages/lib/tests/overlay/ButtonGroup.test.ts` |
| Create | `packages/lib/tests/component/code-editor-theme.test.ts` |
| Modify | `packages/lib/docs/components/ButtonGroup.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Every case below is unit-testable in jsdom. These "today" columns were
**measured** on `master` at `8140fa7b` with throwaway test files, using
exactly the drivers named: the ten-plays listener counts, the
cancelled-once-armed counts, the removed-member click, the re-`setContainer`
registrations, and both `codeEditorTheme` rows. The remaining rows are
derived from the code and say so.

### `Animation.play` balances its listener registrations

Counted as `sink.writes` entries with `op === 'addListener'` /
`'removeListener'` and `args[0] === 'transitionend'` / `'transitionstart'`,
in `tests/core/Animation.test.ts`'s `describe('play')`.

| Case | Driver | adds today | removes today | removes after | source |
|---|---|---|---|---|---|
| fallback timer wins | one `play()`, then `advanceTimersByTime(PAST_FALLBACK_MS)` | 1 end, 1 start | 0, 0 | 1, 1 | derived |
| `transitionend` wins | one `play()`, then `fireTransitionEnd(listen)` | 1, 1 | 0, 0 | 1, 1 | derived |
| cancelled once armed | one `play()`, then `handle.cancel()` | 1, 1 | 0, 0 | 1, 1 | measured |
| cancelled during the two-frame yield | a `play()` with `from`, `handle.cancel()` before `flushFrame()` | 0, 0 | 0, 0 | 0, 0 | derived |
| ten plays on one retained element | `makeElement()` once, then ten `play()`s each followed by `advanceTimersByTime(300)` | 10, 10 | 0, 0 | 10, 10 | measured |

The last row is the growth assertion: one element, ten animations, and the
add and remove counts must match. The fourth row is what makes the
`listening` flag observable — a cancel that never armed anything must emit no
removal.

`describe('afterTransition')`'s four existing cases
([`:298`](packages/lib/tests/core/Animation.test.ts#L298)) are unchanged,
including `'suppresses onComplete and the listener removal when cancelled
first'`, which pins that `afterTransition.cancel` leaves its listener
attached. That asymmetry is deliberate and stays.

### `ButtonGroup` releases a button when it lets go of it

In `tests/overlay/ButtonGroup.test.ts`, driving a member with a real click
rather than the file's `selectVia` shortcut.

| Case | Driver | today | after | source |
|---|---|---|---|---|
| removed member's click | `a`, `b` in a group; `b.setSelected(true)`; `group.removeButton(a)`; click `a` | `a` selected, **`b` deselected** | `a` selected, `b` still selected | measured |
| disposed group's click | `a`, `b` in a group; `b.setSelected(true)`; `group.dispose()`; click `a` | `a` selected, **`b` deselected** | `a` selected, `b` still selected | derived |
| duplicate add | `addButton(a)` twice | `getButtons()` is `[a, a]` | `getButtons()` is `[a]` | derived |
| re-`setContainer` | `setContainer(c1)`; `setContainer(c2)`; read `Event._registeredComponentIds()` | contains **both** `c1.getId()` and `c2.getId()` | contains `c2.getId()` only | measured |

A bare `new Component()` container holds no other `Event` registration, so
its presence in `_registeredComponentIds()` is an exact signal for the
`keydown` subtree listener and nothing else.

The twelve existing selection-model cases, the two `dispose()` cases and the
two `SpatialNavigation` keydown cases keep passing unchanged; none of them
exercises the `"action"` wiring, which is why none of them caught this.

### `codeEditorTheme` builds one theme per flag, forever

In the new `tests/component/code-editor-theme.test.ts`, with
`vi.spyOn(EditorView, 'theme')` and `vi.spyOn(HighlightStyle, 'define')`
installed before the first call.

| Case | Driver | today | after | source |
|---|---|---|---|---|
| build count | five `codeEditorTheme(false)` then five `codeEditorTheme(true)` | 10 `EditorView.theme`, 10 `HighlightStyle.define` | 2 and 2 | measured |
| call identity | `codeEditorTheme(false) === codeEditorTheme(false)` | `false` | `true` | measured |
| flags stay distinct | `codeEditorTheme(false) === codeEditorTheme(true)` | `false` | `false` | derived |

Identity is the whole proof: `codeEditorTheme` has no input but `dark` and no
side effect but the two builds, so one object per flag means one
`StyleModule` per flag, and a fixed number of modules is a fixed number of
rules on every root they mount into.

The rule count itself is not assertable offline. `DOM.sink.mountView` returns
`null` under the recording sink, so `CodeEditor._view` never leaves `null` in
a test and no `EditorView` ever mounts a module — which is also why
`onThemeChange` cannot be driven offline and why the test calls
`codeEditorTheme` directly.

### Two consequences of the memo that are not leaks

- A `ThemeManager.setTheme` that does not change the dark flag — one light
  theme replacing another — makes `onThemeChange`
  ([`component/editor/CodeEditor.ts:2644`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2644))
  reconfigure the compartment with the identical extension. CodeMirror's
  `mountStyles` runs only when the `styleModule` facet's value changes, so
  the remount and its full re-serialisation are skipped entirely.
- Every editor sharing a `dark` value now carries the same generated theme
  class instead of one per instance. Nothing reads that class; `CodeEditor`
  keys only on the fixed `REVEAL_CLASS` / `REVEAL_FLASH_CLASS` strings.

### Manual verification

Two QA panels show C7 and one shows C15 in a real engine. They are **not**
run by the implementer — every run opens a full-screen window on the user's
desktop and needs the user's explicit go-ahead. Record them as a documented
manual step:

| Panel | Drive | Shows |
|---|---|---|
| `shell-deep` | `theme` | C7. The panel's own description already names slice 23 F23.1, *51 CSS rules per editor per theme switch*, and the harness's `theme` driver ends by counting the page's CSS rules — so the reading is directly comparable before and after. |
| `shell-shallow` | `theme` | C7 again, with a single Dock region instead of a 2×2 grid. |
| `menus` | `toggle` (the default) | C15. Each toggle runs `Menu.show` / `Menu.hide`, which cancel the outgoing fade and start a new one through `OverlayFade` → `Animation.play` — the supersede path this fix changes. |

C16 has no panel. Its only in-library caller,
[`component/container/TabBar.ts:1835`](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1835),
disposes the removed button on the next line, and a disposed `Component`
purges its own `Event` registrations — so `TabBar` never exhibits the bug and
no panel can be made to show it.[^tabbar-innocent]

For all three, the jsdom assertions above are the stronger
evidence.[^jsdom-over-panels]

---

## Verification

Run from `packages/lib`:

1. `npm run typecheck` — expects 0 errors.
2. `npm run typecheck:test` — expects 0 errors.
3. `npx vitest run tests/core/Animation.test.ts tests/overlay/ButtonGroup.test.ts tests/component/code-editor-theme.test.ts`
   — the three files this plan adds cases to.
4. `npx vitest run tests/overlay/Tooltip.test.ts tests/overlay/Dialog.test.ts tests/overlay/Drawer.test.ts tests/overlay/Notification.test.ts tests/overlay/Rail.test.ts`
   — the `Animation.play` callers with test files of their own, in case a test
   counts sink writes in a way the two new `removeListener` ops disturb.
5. `npx vitest run tests/component/code-editor.test.ts tests/component/editorTheme.multicolumn.test.ts tests/component/markdown-editor.test.ts`
   — the editor files.
6. `npx vitest run tests/component/dispose-full-teardown.test.ts tests/component/dispose-listener-teardown.test.ts`
   — unchanged and must stay unchanged; no class here gains a `destructor(`
   or an `Event.add*(this, …)` registration.
7. `npm test` — the full suite, once.
8. `npm run lint`.
9. `npm run docs:api` — must emit no *new* warnings. `master` already emits
   14; the bar is "no more than before", not zero.[^docs-warnings]
10. `grep -n 'button.on("action"\|button.off("action"' packages/lib/src/typescript/lib/overlay/ButtonGroup.ts`
    — expect three matches: one `on` in `addButton`, one `off` in
    `removeButton`, one `off` in `dispose`'s loop. All three pass a stored
    `handler`; none passes an inline arrow.

---

## Documentation Impact

`codeEditorTheme` is exported from `component/editor/theme.ts` but is not
re-exported from `component/editor/index.ts`, so TypeDoc renders no page for
it and its JSDoc change reaches no doc site. `Animation.play`'s `@returns`
does render — it is a public API page — and step 2 is a correction to a
promise that the code will no longer keep.

[`packages/lib/docs/components/ButtonGroup.md`](packages/lib/docs/components/ButtonGroup.md)'s
*Common methods* table gains two rows, `removeButton(button)` and
`dispose()`, each naming what it releases, and the `addButton(button)` row
gains "adding a button already in the group is a no-op".

Per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md), none of the new JSDoc may
`{@link}` a private field or method — `_actionHandlers`, `unwireContainer`,
`handleContainerKeyDown`, `stopListening`, `_lightTheme`, `_darkTheme` —
because the docs build excludes them and a link from a rendered page would
warn. Describe the behaviour in prose instead. `npm run docs:llms:check` is
unaffected: it guards newly-shipped concrete classes and this plan adds none.

---

## Potential Challenges

- **A test somewhere counts total sink writes.** The two new `removeListener`
  ops per `play()` would shift such a count. Mitigation: step 4 of
  *Verification* runs every `Animation.play` caller's test file, and the full
  suite runs after. The one existing assertion that looks exposed —
  `'suppresses onComplete and every DOM write when cancelled before the
  fallback'` at
  [`tests/core/Animation.test.ts:189`](packages/lib/tests/core/Animation.test.ts#L189)
  — filters to `op === 'apply'` style patches and is unaffected; its comment
  still needs narrowing to "writes no styles", since the assertion it
  describes was always about styles only.
- **`Event.fireEvent` needs a freshly-installed base listener.** A `'click'`
  base listener left behind by an earlier test in the file is pinned to that
  test's torn-down window, so a dispatch silently delivers nothing.
  Mitigation: the new cases call the file's existing purge helper, which is
  in the file precisely for this and carries the full explanation.
- **`button.off("action", …)` on the `RadioButton | ToggleButton` union.**
  The two classes declare different `off` parameter types
  ([`ToggleButton.ts:153`](packages/lib/src/typescript/lib/component/button/ToggleButton.ts#L153),
  [`RadioButton.ts:470`](packages/lib/src/typescript/lib/component/input/RadioButton.ts#L470)).
  Mitigation: type the map value `() => void`, which is assignable to both,
  because `Event.ListenerResult` includes `void` and a zero-parameter function
  is assignable to a one-parameter signature.
- **The memo's slots are module state.** A test that asserts a build count
  must be the first thing in its file to call `codeEditorTheme`. Mitigation:
  step 11's dedicated file, for the reason its sibling
  `editorTheme.multicolumn.test.ts` already documents.

---

## Critical Files

| File | Why |
|---|---|
| `packages/lib/src/typescript/lib/core/Animation.ts` | `afterTransition`'s `finish` at `:314` — the in-file precedent for removing a transition listener on completion — and its `cancel` at `:328`, whose deliberate *non*-removal this plan preserves. |
| `packages/lib/src/typescript/lib/core/PendingTransitions.ts` | The registry that guarantees `play`'s `cancel()` runs while the handle is still live; read it before changing anything in `cancel`. |
| `packages/lib/src/typescript/lib/core/Component.ts` | `:1296` and `:1499` — the two places a handle is released, each preceded by `cancelTransitions`. `:1170` is where a disposed component purges its `Event` registrations. |
| `packages/lib/src/typescript/lib/component/display/Video.ts` | `:108`, `:519`, `:505`, `:571` — the stored-per-key-handler map C16 mirrors: built once, registered from the map, removed from the map. |
| `packages/lib/src/typescript/lib/component/container/WindowBorder.ts` | `:131-135` — the bind-once-into-a-field precedent for `_onContainerKeyDown`. |
| `packages/lib/src/typescript/lib/core/RovingTabIndex.ts` | `:98` — `remove` moves focus when the removed item was active, which is why `setContainer` drops the old index rather than sweeping it. |
| `packages/lib/src/typescript/lib/core/Event.ts` | `:655` `removeSubtreeListener`, and `registerEntry`'s per-component listener *array* — which is why a duplicate `addButton` registers a second listener rather than replacing the first. |
| `packages/lib/src/typescript/lib/component/editor/editorTheme.ts` | `:31`, `:49` — the build-once module singleton in the same directory that C7's memo follows. |
| `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` | `:2069` and `:2644` — `codeEditorTheme`'s only two callers, the mount and the theme-change reconfigure. |
| `node_modules/style-mod/src/style-mod.js` | `StyleModule`'s own header comment (treat modules as one-time allocations) and `StyleSet.mount`, whose module list only ever grows and whose `<style>` text is rebuilt from all of it. |
| `packages/lib/tests/core/Animation.test.ts` | `:298-377` — the `afterTransition` describe block whose listener-removal cases the new `play` cases copy. |
| `packages/lib/tests/overlay/ButtonGroup.test.ts` | `:274` — the base-listener purge helper the new dispatch-driven cases need. |
| `packages/lib/tests/component/editorTheme.multicolumn.test.ts` | Its file header explains why a module-singleton assertion needs its own test file. |
| `plans/destructor-teardown-coverage.md` | The sibling plan: it owns the scan-pattern gate and the changelog file this plan also edits. |

---

## Non-Goals

- **`afterTransition`'s `cancel()`.** It leaves its `transitionend` listener
  attached, which is the same shape as C15 and a real leak for a repeatedly
  re-toggled `Accordion` section. It stays out for two reasons: the register
  scopes C15 to `play`, and `afterTransition` has no counterpart to the
  pending-transition registry, so nothing guarantees its component's handle is
  still live when a caller cancels. Fixing it needs that question answered
  first, and a change to
  [`tests/core/Animation.test.ts:344`](packages/lib/tests/core/Animation.test.ts#L344),
  which pins the current behaviour.
- **A fourth scan pattern for `ButtonGroup`'s shape.** The sibling plan
  settled the gate on `DragManager.make{DragSource,DropTarget}(`. `ButtonGroup`
  matches none of the three patterns and this plan does not propose a fourth;
  its guard is the regression test in step 9.
- **Making `ButtonGroup` a `Component`, or giving the container a typed
  `on("keydown")` surface.** Either would resolve the ARCHITECTURE deviation
  named above. Both are design changes well beyond a leak fix.
- **`TabBar` never disposing its `ButtonGroup`.** The group is a private field
  collected with the strip; nothing registers it anywhere global. Not a leak,
  and not C16.
- **The third memo slot C7 could have.** The highlight module does not depend
  on `dark`, so sharing one across both flags would save fifteen rules once.
  Two slots bound the growth, which is the bug; a third buys a one-off
  saving and an extra piece of state.
- **`ButtonGroup.md`'s `getSelected()` row.** The documented method does not
  exist on the class. It is a pre-existing doc error unrelated to these three
  bugs; leave it and report it.
- **Running any QA panel.** Every run opens a full-screen window on the user's
  desktop and needs their explicit go-ahead. The panels are named as a manual
  step, not performed.

---

## Notes

[^one-plan]: Splitting C7 out was seriously considered, and the argument for
    it is real: C15 and C16 share a remedy shape and a precedent family
    (hold the reference, remove it), while C7 shares neither — it is fixed by
    memoisation, in a different subsystem, against a third-party module. What
    kept it here is that the three share the thing a plan actually has to
    decide and prove. They share the decision rule in
    *Architecture Decisions* (which side of the removal-API line each falls
    on, and why the answer differs), and they share their entire verification
    stance: a jsdom driver that runs the leaking call N times and asserts a
    count does not scale with N, with the QA panels named but not run. The
    alternative is a one-fix plan whose whole content is two module-level
    `let`s, and two plans that repeat the same verification argument. The
    proposed grouping in
    `plans/research/render-review-2026-09-15/01-phase2-status-pass.md` also
    puts the three together as one tier-B plan, and nothing found while
    drafting contradicted that.

[^why-not-uniform]: The obvious uniform remedy — give `codeEditorTheme` a
    release path too — does not exist to be written. `style-mod`'s `StyleSet`
    keeps `this.modules` as an append-only array, rebuilds the `<style>`
    element's `textContent` from all of it on every mount, and exposes no
    unmount, no delete and no handle to a mounted module. The library's own
    header comment says so directly: *"to avoid leaking rules, don't create
    these dynamically, but treat them as one-time allocations."* Going the
    other way — memoising instead of removing, for C15 and C16 — is equally
    unavailable: their registrations are per-element and per-button, so there
    is nothing to share.

[^cancel-safety]: `play` calls `registerTransition(el, cancel)` at
    `core/Animation.ts:216`, and both library paths that release a component's
    handle call `cancelTransitions(handle)` immediately before releasing it —
    `Component.destructor` at `core/Component.ts:1296`, just above the release
    loop at `:1300`, and `Component.removeElement` at `:1499`, just above
    `:1503`. `cancel()` early-returns once `done || cancelled`, so by the time
    a handle is released every cancel against it has already run and any later
    caller-held `cancel()` is a no-op that reaches no DOM call. The remaining
    hole is `Component`'s `FinalizationRegistry` (`:468`), which releases
    handles with no cancel — but a component collected by GC has taken its
    element with it, and `stopListening` only reaches the DOM while
    `listening` is true, a window bounded by the armed fallback timer at
    `durationMs + 40` ms. Inside that same window the fallback's own
    `buf.set("transition", null)` would already resolve the handle, so the
    fix shares an exposure rather than opening a new one. The individual
    callers were checked: `Tooltip.destructor` (`overlay/Tooltip.ts:670`) and
    `CodeEditor.destructor` (`component/editor/CodeEditor.ts:1729`) each
    cancel before `super.destructor()`, and `OverlayFade.fadeHideAndDetach`
    only reaches `removeElement()` from inside `finish`, after `done` is
    already set.

[^stored-closure]: `ARCHITECTURE.md`'s *Listeners must reference a named
    function* bans an inline arrow at the registration site because it cannot
    be removed, cannot be named in a stack trace and cannot be grepped. A
    handler whose identity varies per key cannot be a method or a module
    function, so the codebase's answer is to build the closure once and keep
    it: `Video._mediaHandlers` holds one re-emit closure per media event type,
    built in `buildMediaHandlers` (`component/display/Video.ts:519`),
    registered from the map at `:571` and removed from the same map at `:505`.
    `ButtonGroup`'s map is that pattern with the button as the key. The
    alternative — one shared method resolving the initiator from the event —
    does not work here: `Event` hands the listener a raw DOM event, and
    recovering the `Component` from it would mean a reverse lookup the
    framework does not offer.

[^one-remedy]: The two halves looked separable at first — a stale listener is
    a leak, a removed button deselecting its siblings is a behaviour bug — but
    they have one cause and one cure. `updateButtonStates` is the entire body
    of the leaked closure, so as long as the registration survives, the
    behaviour survives with it, and removing the registration removes both.
    Measured on `master`: with `b` selected, `group.removeButton(a)` followed
    by a real click on `a` leaves `a` selected and `b` **deselected**. After
    the fix the same driver leaves `b` selected, because `ToggleButton`'s own
    click handler still toggles `a` and nothing else listens. One assertion
    covers the leak and the behaviour.

[^idempotent-add]: `Event.registerEntry` (`core/Event.ts`) pushes onto a
    per-component listener array and only skips when the *same reference* is
    re-registered. Two `addButton(a)` calls therefore build two distinct
    closures and leave two live `change` registrations on `a`, so one click
    runs `updateButtonStates` twice — and `this.buttons` holds `a` twice while
    `removeButton`'s `indexOf`/`splice` removes only the first copy, leaving a
    member behind whose handler has just been removed. A `Map` keyed by the
    button cannot hold both closures, so without the guard the second
    `addButton` would silently strand the first. Making the call a no-op fixes
    the stranding, the double fire and the half-removal at once, and the
    documented usage — `addButton` / `addButtons` over distinct buttons — is
    unaffected. No test adds a duplicate.

[^no-sweep]: `RovingTabIndex.remove` (`core/RovingTabIndex.ts:98`) deletes the
    member's roving data attribute and, when the removed item was the active
    one, calls `moveTo`, which transfers DOM focus. Sweeping every member out
    of the outgoing index during a re-`setContainer` would therefore move the
    user's focus as a side effect of rewiring. Dropping the reference instead
    is complete: `RovingTabIndex` holds only `_items`, `_activeIndex` and
    `_preventScroll`, registers nothing with `Event` or the DOM seam, and is
    collected with the group's old field value. The stale data attribute and
    `tabindex` on each button are overwritten by the new index's `add` calls
    in the next two lines.

[^flag-invariance]: Verified by reading the whole function. `dark` appears
    exactly twice in `component/editor/theme.ts`: as the parameter at `:68`
    and as `EditorView.theme(..., { dark })` at `:222`. Everything else the
    body reads is a module constant — the seven `SYNTAX_*` colours,
    `REVEAL_CLASS`, `REVEAL_FLASH_CLASS`, `REVEAL_FLASH_KEYFRAME`,
    `REVEAL_FLASH_MS`, `REVEAL_RESTING_TINT`, `REVEAL_PEAK_TINT` — or a
    `var(--ts-ui-…)` reference the browser resolves at paint time, which is
    exactly why the function's own JSDoc already says a `ThemeManager.setTheme`
    toggle recolours the editor with no rebuild. So the build depends on
    nothing outside its own argument, and two slots cover its whole domain.
    A theme that read a resolved CSS variable value, or a `ThemeManager`
    field, or the time, would break the memo; none of that is here.

[^gate-blind-spot]: `01-phase2-status-pass.md` names `ButtonGroup` alongside
    `TreeBody`, `TreeCell` and `AbstractCalendarDropdown` as classes that
    escaped the dispose gates by declaring no destructor. For the other three
    the fix is to declare one, which puts them into
    `classesDeclaringDestructor()` and forces a registry row. `ButtonGroup` is
    different in kind: it is a plain class, not a `Component`, so it has no
    `destructor` to declare and its existing `dispose()` is not the
    `Component.dispose` the registries drive. Its `setContainer` registration
    also targets the container, not `this`, so
    `SELF_LISTENER_REGISTRATION` does not match it either. Nothing in this
    plan changes either fact, so all three registry files — including the
    `dispose-drag-teardown.test.ts` the sibling plan creates — are untouched,
    and no baseline gains or loses an entry.

[^tabbar-innocent]: `TabBar.removeBarEntry` calls
    `this._buttonGroup.removeButton(entry.button)` at
    `component/container/TabBar.ts:1835` and `entry.button.dispose()` sixteen
    lines later, and `Component.destructor` calls
    `Event.purgeComponent(this.getId())` (`core/Component.ts:1170`), which
    drops every registration held under that button's id — the group's
    included. So the library's only `removeButton` caller cleans up the leak
    by accident, which is both why no QA panel can show C16 and why the fix
    carries no in-library regression risk. The bug is live for consumer code
    that removes a button it keeps using, which is what `removeButton` is for.

[^jsdom-over-panels]: The QA app measures frame time and DOM-work counters,
    which a garbage collector can mask: `00-post-campaign-agenda.md` item 6
    already found stylesheet churn shrinking under `FinalizationRegistry`
    reclamation rather than under a fix. For these three the jsdom assertions
    are exact and deterministic — a listener add/remove balance, an
    `Event._registeredComponentIds()` membership, and a spy call count — and
    they fail loudly if the fix is reverted. The panels stay in the plan as
    the real-engine sanity check the user may authorise, not as the evidence
    the fixes rest on. This mirrors `plans/destructor-teardown-coverage.md`,
    which takes the same position for the same reason.

[^docs-warnings]: `00-post-campaign-agenda.md` records that
    `npm run docs:api` emits 14 warnings on `master`, and instructs plans to
    stop writing a zero-warning bar into their verification rather than
    silently inheriting a failing gate. The bar here is therefore "no new
    warnings"; fixing the existing 14 is separate work.
