---
touches-shared:
  - packages/lib/src/typescript/lib/overlay/Dialog.ts
  - packages/lib/src/typescript/lib/core/FocusTraversal.ts
  - packages/lib/src/typescript/lib/core/Focusable.ts
  - packages/lib/src/typescript/lib/core/LayerManager.ts
  - packages/lib/docs/components/CodeEditor.md
  - packages/lib/docs/components/Dialog.md
  - packages/lib/docs/concepts/accessibility.md
  - packages/lib/docs/concepts/layering.md
  - packages/lib/docs/reference/changelog/next.md
  - packages/lib/docs/reference/migration/next.md
---

# Dialog Escape Releases a Tab-Key Owner — Implementation Plan

## Overview

A modal [`Dialog`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L650) whose
only focusable content is a [`CodeEditor`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L676)
traps a keyboard user. Since 0.10.0 the dialog counts a `contenteditable`
element as focusable, so it opens with focus in the editor. From there no key
reaches the dialog's buttons:

- `Tab` / `Shift+Tab` indent and dedent. `CodeEditor` binds CodeMirror's
  `indentWithTab`, and marks itself a *Tab-key owner* — a component whose
  subtree keeps `Tab` for itself, flagged by the
  `data-ts-ui-tab-key-owner` attribute ([`Component.setTabKeyOwner`](packages/lib/src/typescript/lib/core/Component.ts#L2321)).
  The dialog's Tab trap stands down while focus is inside such an owner
  ([`Dialog.onKeyDown`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L1175)).
- `Escape` closes the whole dialog. [`LayerManager`'s keydown handler](packages/lib/src/typescript/lib/core/LayerManager.ts#L833)
  calls [`Dialog.requestClose`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L1450)
  and stops the event at the window, so CodeMirror never sees the Escape
  either — which also means an open completion list or search panel cannot be
  closed with Escape inside a dialog.

This fails WCAG 2.1.2 (No Keyboard Trap). SQLAdmin's SQL review dialog is the
reported case (`LIBRARY_NOTES.md`, "A review dialog with no other focusable
content traps Tab/Shift+Tab in the SQL editor (0.10.0)").

The fix gives `Dialog` the same *Escape release* that
[`FocusTraversal`](packages/lib/src/typescript/lib/core/FocusTraversal.ts#L180)
already implements. Pressing `Escape` while focus is inside a Tab-key owner
in the dialog does not close the dialog. It arms a one-shot release instead,
and lets the keystroke reach the editor. The next `Tab` / `Shift+Tab` steps
focus past the owner, wrapping inside the dialog. A second `Escape` closes the
dialog as before. The change touches `Dialog.ts`, `LayerManager.ts` (so a
layer can decline an Escape), `Focusable.ts` (shared helpers moved out of
`FocusTraversal.ts`), and `FocusTraversal.ts` (it must stand down while a
dialog runs its own release).

---

## Architecture Decisions

### Escape inside a Tab-key owner arms a release; a second Escape dismisses

Inside a dialog, the first `Escape` pressed while focus is in a descendant
Tab-key owner arms a one-shot release for that owner and does not close the
dialog. While the release is armed, `Tab` moves to the first dialog stop after
the owner and `Shift+Tab` to the last stop before it, wrapping inside the
dialog. `Escape` pressed again while armed closes the dialog.[^why-escape]

| Focus | Release armed for this owner? | Key | Result |
|---|---|---|---|
| in the editor | no | `Tab` | editor indents (unchanged) |
| in the editor | no | `Escape` | release armed; dialog stays open; the editor also receives the Escape |
| in the editor | yes | `Tab` | focus moves to the next stop after the editor (SQLAdmin: Cancel) |
| in the editor | yes | `Shift+Tab` | focus moves to the last stop before the editor (the title-bar ✕) |
| in the editor | yes | `Escape` | dialog closes with `'close'` |
| in the editor | yes | `ArrowDown` (any non-modifier key but Tab/Escape) | release expires; the editor handles the key |
| on a plain button | — | `Escape` | dialog closes (unchanged) |

The release expires on any other non-modifier key, and when focus moves
outside the owner that armed it. These are the same two expiry rules
`FocusTraversal` uses.[^expiry]

### The dialog owns the release, mirroring `FocusTraversal`

The one-shot state is a per-dialog field `_releaseOwner: Handle | null`, not
shared module state. This mirrors [`FocusTraversal`'s `_releaseOwner`](packages/lib/src/typescript/lib/core/FocusTraversal.ts#L42),
its `onFocusIn` expiry, and its `stopAfterOwner` / `stopBeforeOwner` landing
rule. The dialog's Tab trap already mirrors `FocusTraversal`'s stand-down
(`tab-and-dialog-key-routing`); this completes the mirror with the
release.[^per-dialog]

### Shared helpers move to `core/Focusable.ts`

`stopAfterOwner`, `stopBeforeOwner` and the `MODIFIER_KEYS` set move from
`FocusTraversal.ts` to `Focusable.ts`, unchanged except that the two landing
functions take the ordered stop list instead of a root. A new
`ownsTabKey(handle)` reads the marker attribute; `findTabKeyOwner` uses it.
This follows the precedent set when `findTabKeyOwner` itself moved there so
`Dialog` could share it ([`Focusable.ts:109`](packages/lib/src/typescript/lib/core/Focusable.ts#L109)).[^stops-param]

### A layer may decline an Escape by returning `false` from `requestClose`

`DismissableLayer.requestClose()` widens from `void` to `boolean | void`.
`false` means "not closing — let the key that triggered this keep
propagating"; anything else, including no return, means handled, exactly as
today. `LayerManager.onKeyDown` returns no disposition when the layer returns
`false`, so the Escape reaches CodeMirror. `Dialog.requestClose()` returns
`boolean`.[^decline-contract]

| `requestClose()` returns | Layer closed? | Escape keeps propagating? |
|---|---|---|
| nothing (`AnimatedDropdown`, `Popover`, `Menu`, windows, custom layers) | per the layer | no (unchanged) |
| `true` (`Dialog`: closed, or a mandatory modal swallowing it) | per the layer | no |
| `false` (`Dialog`: release armed) | no | yes |

A mandatory modal (`dismissable: false`) arms the release too. Its second
Escape stays swallowed, as today.

### `FocusTraversal` stands down while the topmost layer owns the Tab key

`FocusTraversal`'s keydown handler returns immediately when the current focus
root — the topmost layer's element — carries the Tab-key-owner marker. Only
an open `Dialog` sets that marker on a layer element. Without this, an app
that enables `FocusTraversal` gets two releases armed by one Escape, and both
move focus on the next Tab.[^double-move]

### Rejected: a Ctrl/Cmd+Enter "run primary" shortcut and a primary-button initial focus

Neither is added. `Dialog` has no such shortcut today (only plain Enter, which
is inert inside a `contenteditable`), and `initialFocus` stays as it is.[^rejected]

### Semver: minor

The next release carrying this is a minor release (0.11.0 under the pre-1.0
scheme). It changes the documented Escape contract of `Dialog` and widens a
public interface. A `Dialog` subclass that overrides `requestClose(): void`
stops compiling.[^semver] No version is bumped by this plan.

---

## Public API

```typescript
// core/LayerManager.ts — DismissableLayer (exported from core/index.ts)
/**
 * Advisory request to close; the surface runs its own teardown + unregister.
 *
 * @returns `false` when the surface declines and the keystroke that triggered
 *   the request should keep propagating to the focused content; anything
 *   else — including no return value — counts as handled.
 */
requestClose(): boolean | void;
```

```typescript
// overlay/Dialog.ts — class Dialog implements DismissableLayer
requestClose(): boolean;
```

Internal (not re-exported from any barrel; `core/Focusable.ts` is internal):

```typescript
// core/Focusable.ts
export const MODIFIER_KEYS: ReadonlySet<string>;
export function ownsTabKey(handle: Handle): boolean;
export function stopAfterOwner(stops: Handle[], owner: Handle): Handle | null;
export function stopBeforeOwner(stops: Handle[], owner: Handle): Handle | null;
```

New private state on `Dialog` (not an option, not consumer-configurable):

```typescript
// The descendant Tab-key owner the last Escape released, or null.
private _releaseOwner: Handle | null = null;
private _boundFocusInHandler: () => void;
```

---

## Implementation

### `Focusable.ts` — the moved helpers

`stopAfterOwner` / `stopBeforeOwner` keep their bodies from
[`FocusTraversal.ts:95-135`](packages/lib/src/typescript/lib/core/FocusTraversal.ts#L95),
with the first line `const stops = visibleFocusable(root);` deleted and
`stops` taken as the first parameter. Keep their doc comments, rewording
"`root`'s DOM order" to "`stops`' order". Move `MODIFIER_KEYS` with its
comment from [`FocusTraversal.ts:20-24`](packages/lib/src/typescript/lib/core/FocusTraversal.ts#L20),
and add one sentence saying it is shared by every Escape release.

```typescript
/** Whether `handle` itself carries the Tab-key-owner marker. */
export function ownsTabKey(handle: Handle): boolean {
    return DOM.source.hasAttribute(handle, TAB_KEY_OWNER_ATTR);
}
```

`findTabKeyOwner`'s loop calls `ownsTabKey(h)` instead of its inline
`hasAttribute`.

### `Dialog.ts` — the release

```typescript
// Replaces tabOwnedByDescendant(). Same walk, returns the owner.
private descendantTabKeyOwner(): Handle | null {
    const el     = this.getElement();
    const active = DOM.source.getActiveElement();

    if (!el || active === null || !DOM.source.contains(el, active)) {
        return null;
    }

    return findTabKeyOwner(active, el);
}

requestClose(): boolean {
    const released = this.armEscapeRelease();

    if (released) {
        return false;
    }

    if (this._config.dismissable === false) {
        return true;
    }

    this.hide('close');

    return true;
}

// Arms the release for the focused descendant owner, unless focus is in no
// owner or this owner is already released (the second Escape).
private armEscapeRelease(): boolean {
    const owner = this.descendantTabKeyOwner();

    if (owner === null || owner === this._releaseOwner) {
        return false;
    }

    this._releaseOwner = owner;

    return true;
}

// Consumes the release: focus the stop past `owner`, wrapping inside the dialog.
private stepPastOwner(owner: Handle, backward: boolean): Event.ListenerResult {
    this._releaseOwner = null;

    const stops  = this.getFocusable();
    const target = backward
        ? (stopBeforeOwner(stops, owner) ?? lastStopOutside(stops, owner))
        : (stopAfterOwner(stops, owner) ?? firstStopOutside(stops, owner));

    if (target !== null) {
        DOM.sink.focus(target);
    }

    return { stop: true, prevent: true };
}

// Mirrors FocusTraversal's onFocusIn: expire only when focus leaves the owner.
private onFocusIn(): void {
    if (this._releaseOwner === null) {
        return;
    }

    const active = DOM.source.getActiveElement();

    if (active !== null && DOM.source.contains(this._releaseOwner, active)) {
        return;
    }

    this._releaseOwner = null;
}
```

`firstStopOutside` / `lastStopOutside` are module-private functions in
`Dialog.ts` (below the private constants): the first / last entry of `stops`
that `owner` does not contain, or `null`. Write each as a plain `for` loop,
matching the style of the moved helpers.

`onKeyDown`, after the existing topmost-layer check, becomes this order:

```typescript
if (e.key === 'Tab') {
    return this.onTab(e);
}

// Any key but Tab, Escape or a bare modifier expires a pending release.
if (e.key !== 'Escape' && !MODIFIER_KEYS.has(e.key)) {
    this._releaseOwner = null;
}

if (e.key === 'Enter') {
    return this.onEnter(e);
}

return;
```

`onTab(e)` is the current Tab block moved into its own private method, with
its first statement replaced:

```typescript
const owner = this.descendantTabKeyOwner();

if (owner !== null) {
    if (owner !== this._releaseOwner) {
        return; // the owner keeps Tab.
    }

    return this.stepPastOwner(owner, e.shiftKey);
}
// …the existing wrap-at-either-end code, unchanged…
```

`Escape` itself is not handled in `onKeyDown`; `LayerManager` delivers it
through `requestClose()`.

---

## Ordered Implementation Steps

Work in a library worktree on a `feature/dialog-escape-releases-tab-owner`
branch based on local `master`. Tests first per step; run
`npx vitest run <file>` from `packages/lib` after each test step to see it
fail, then after the code step to see it pass.

**Commit 1 — shared helpers (no behaviour change).**

1. `packages/lib/src/typescript/lib/core/Focusable.ts`: add `MODIFIER_KEYS`,
   `ownsTabKey`, `stopAfterOwner(stops, owner)`, `stopBeforeOwner(stops, owner)`
   as in *Implementation*. Make `findTabKeyOwner` call `ownsTabKey`.
2. `packages/lib/src/typescript/lib/core/FocusTraversal.ts`: delete the local
   `MODIFIER_KEYS`, `stopAfterOwner`, `stopBeforeOwner`; import them from
   `~/core/Focusable.js`. Change the call at line 214 to
   `stopBeforeOwner(visibleFocusable(root), owner)` /
   `stopAfterOwner(visibleFocusable(root), owner)`.
   Check: `npx vitest run tests/core/FocusTraversal.test.ts tests/core/FocusTraversalCompositeWidgets.test.ts`
   — green, unchanged. `grep -n "function stopAfterOwner\|const MODIFIER_KEYS" src/typescript/lib/core/FocusTraversal.ts`
   — zero matches.

**Commit 2 — `LayerManager` honours a declined Escape.**

3. `packages/lib/tests/overlay/LayerManager.test.ts`: widen `FakeLayer.requestClose`
   to `Mock<() => boolean | void>` and the `vi.fn` in `fakeLayer` to match. In
   `describe('Escape (viewport keydown)')` add
   `it('does not consume Escape when the topmost layer declines it')`:
   register a `'click-outside'` fake layer, `layer.requestClose.mockReturnValue(false)`,
   dispatch Escape as the sibling tests do; expect `requestClose` called once
   and `stopPropagation` not called.
4. `packages/lib/src/typescript/lib/core/LayerManager.ts`: change the interface
   member at line 49 to the *Public API* signature and JSDoc. In `onKeyDown`
   (line 833) assign `const handled = target.requestClose();`, return with no
   disposition when `handled === false`, else `return true`. Update the
   handler's `@returns` to "`true` when a layer handled Escape; nothing when no
   dismissible layer is open or the layer declined it".

**Commit 3 — the dialog's release.**

5. `packages/lib/tests/overlay/Dialog.test.ts`:
   - Move `markTabKeyOwner` and `ownerDialog` out of
     `describe('Dialog — the Tab trap stands down inside a Tab-key owner')` to
     file scope so a second describe can use them. Add `owner` to
     `ownerDialog`'s returned object (row 13 appends a second child to it);
     nothing else changes.
   - Add `public focusIn(): void { (this as any).onFocusIn(); }` to `TestDialog`.
   - Add `describe('Dialog — Escape releases a Tab-key owner')` with the cases in
     *Expected Behaviour → Dialog release*. Arm with `dialog.requestClose()`
     (the path `LayerManager` drives) and spy `hide` as the `dismissable`
     tests do (`vi.spyOn(dialog, 'hide').mockReturnValue(dialog)`).
   - Update the two existing `dismissable` tests that call `requestClose()` to
     also assert its return: `true` in both.
6. `packages/lib/src/typescript/lib/overlay/Dialog.ts`:
   - Import `MODIFIER_KEYS`, `stopAfterOwner`, `stopBeforeOwner` from
     `~/core/Focusable.js` beside the existing import at line 28.
   - Add `firstStopOutside` / `lastStopOutside` module-private functions.
   - Add the two fields after `_boundResizeHandler` (line 661), each with a
     one-line comment. Assign `_boundFocusInHandler = () => this.onFocusIn();`
     next to `_boundKeyHandler` (line 761).
   - `open()`: register `Event.addViewportListener(this, 'focusin', this._boundFocusInHandler);`
     right after the `keydown` registration (line 965).
   - `hide()`: remove it right after the `keydown` removal (line 1272).
   - Replace `tabOwnedByDescendant()` (line 1121) with `descendantTabKeyOwner()`.
   - Split the Tab block out of `onKeyDown` into `onTab(e)` and reorder
     `onKeyDown` as in *Implementation*. Update `onKeyDown`'s JSDoc summary to
     "Handles document-level keydown events: the Tab focus trap and its Escape
     release, and Enter-to-confirm."
   - Add `armEscapeRelease`, `stepPastOwner`, `onFocusIn`, each with a JSDoc.
   - Rewrite `requestClose()` (line 1450) and its JSDoc: keep the existing
     `@remarks`, and add that when focus is inside a descendant Tab-key owner
     not yet released, the call arms the release and returns `false` so the
     Escape reaches the owner; `@returns` `false` when it armed the release,
     `true` otherwise (closed, or swallowed by a mandatory modal).
   Check: `grep -n "tabOwnedByDescendant" src/typescript/lib/overlay/Dialog.ts` — zero matches.

**Commit 4 — `FocusTraversal` stands down under a Tab-owning layer.**

7. `packages/lib/tests/core/FocusTraversal.test.ts`: in
   `describe('FocusTraversal keydown arbitration')` add
   `it('stands down entirely while the topmost layer\'s element owns the Tab key')`
   — see *Expected Behaviour → FocusTraversal*. Unregister the layer at the end,
   as the sibling layer tests do.
8. `packages/lib/src/typescript/lib/core/FocusTraversal.ts`: at the top of
   `onKeyDown` (line 180), after the `_enabled` check, add
   `const root = focusScopeRoot();` and return when `ownsTabKey(root)`, with a
   comment: a layer that claims Tab for its whole subtree (an open `Dialog`)
   runs its own trap and Escape release. Reuse that `root` for the existing
   `const root = focusScopeRoot();` at line 208 (delete the second
   declaration). Add one sentence to the namespace JSDoc (line 226) saying the
   service also stands down entirely while the topmost layer claims Tab.

**Commit 5 — documentation.**

9. `packages/lib/docs/components/Dialog.md`, `### Keyboard` (lines 145-162):
   keep the first paragraph. Rewrite the second so it says: an editing surface
   or `Table` in the dialog keeps `Tab` while focus is inside it; pressing
   `Escape` there does not close the dialog but releases the surface, so the
   next `Tab` or `Shift+Tab` moves to the dialog's next or previous control
   (wrapping inside the dialog); a second `Escape` closes the dialog; any other
   key cancels the release. Delete the "no `Tab` route past it" and
   "Put a plain control at one end of a mandatory modal" advice — both describe
   the trap this plan removes. Say that a mandatory modal releases the same way
   but still ignores the second `Escape`.
10. `packages/lib/docs/concepts/accessibility.md`: extend the `Dialog`
    paragraph at line 141 with two sentences: `Escape` inside such a descendant
    releases it for one `Tab` instead of closing the dialog, and a second
    `Escape` closes it; `FocusTraversal` stands down entirely while a dialog is
    open, since the dialog runs this itself. In the *Keyboard-only* checklist
    item (line 267) add: inside a `Dialog`, check that `Escape` then `Tab`
    leaves an embedded editor whether or not Tab traversal is enabled.
11. `packages/lib/docs/components/CodeEditor.md`, the paragraph at line 210:
    add, before the `Ctrl-m` sentence, that pressing `Escape` and then `Tab`
    moves focus out once. Outside a dialog this is CodeMirror's own tab-focus
    window: the `Tab` must follow within two seconds, and an `Escape` that
    closes the completion list, the search panel or a multi-cursor selection
    does not open it. Inside a [`Dialog`](/components/Dialog) it is the
    dialog's release, with no time limit. Leave the keymap table unchanged.
12. `packages/lib/docs/concepts/layering.md`, the *advisory* paragraph at
    line 112: add that `requestClose()` may return `false` to decline, in which
    case the manager leaves the Escape unhandled so it reaches the focused
    content — `Dialog` does this to release an embedded editor.
13. `packages/lib/docs/reference/changelog/next.md`: append these sections
    (create each heading only if absent; order: Breaking changes, Added, Fixed):
    - `## Breaking changes` → `### Overlay`: **A `Dialog`'s first `Escape`
      inside an editing surface or `Table` releases it instead of closing the
      dialog.** State the trap it fixes (a dialog whose only focusable content
      is a `CodeEditor` opened with focus there and no key reached its buttons),
      the new two-step, and that `Dialog.requestClose()` now returns `boolean`.
      End with "See [Migration](/reference/migration/next) for the full note."
    - `## Added` → `### Core`: `DismissableLayer.requestClose()` may return
      `false` to decline, leaving the Escape that triggered it unhandled.
    - `## Fixed` → `### Core`: `FocusTraversal` stands down entirely while an
      open `Dialog` is the topmost layer, instead of arming its own release
      for an editor inside it and moving focus a second time on the next `Tab`.
14. `packages/lib/docs/reference/migration/next.md`: append
    `## A \`Dialog\`'s first Escape inside an editor releases it` covering:
    what changed (table from *Architecture Decisions*, the three Dialog rows
    only); who is affected — automated UI tests or scripts that close a dialog
    with a single `Escape` while focus is in a `CodeEditor`, `MarkdownEditor`
    or `Table` (send two, or move focus to a button first), and a `Dialog`
    subclass that overrides `requestClose(): void` (return `boolean`; call
    `super.requestClose()` and return its result to keep the release); and
    that other `DismissableLayer` implementations need no change.
    Check: `npm run docs:api` — zero warnings; `npm run docs:llms:check` — clean.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Focusable.ts` |
| Modify | `packages/lib/src/typescript/lib/core/FocusTraversal.ts` |
| Modify | `packages/lib/src/typescript/lib/core/LayerManager.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Dialog.ts` |
| Modify | `packages/lib/tests/overlay/LayerManager.test.ts` |
| Modify | `packages/lib/tests/overlay/Dialog.test.ts` |
| Modify | `packages/lib/tests/core/FocusTraversal.test.ts` |
| Modify | `packages/lib/docs/components/Dialog.md` |
| Modify | `packages/lib/docs/components/CodeEditor.md` |
| Modify | `packages/lib/docs/concepts/accessibility.md` |
| Modify | `packages/lib/docs/concepts/layering.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/docs/reference/migration/next.md` |

---

## Expected Behaviour

### Dialog release

Unit-testable offline in `Dialog.test.ts`, using `ownerDialog()` (owner `O`
containing `inner`, plus plain `plainA`, `plainB`). "Seed" is the stop order
handed to `seed(...)`. Every row starts with focus on `inner` unless stated.

| # | Seed | Steps | Expected |
|---|---|---|---|
| 1 | `[inner, plainA, plainB]` | `requestClose()` | returns `false`; `hide` not called; focus still `inner` |
| 2 | `[inner, plainA, plainB]` | `requestClose()` ×2 | second returns `true`; `hide('close')` called once |
| 3 | `[inner, plainA, plainB]` | focus `plainA`; `requestClose()` | returns `true`; `hide('close')` called |
| 4 | `[inner, plainA, plainB]`, `dismissable: false` | `requestClose()` ×2 | first `false`, second `true`; `hide` never called |
| 5 | `[inner, plainA, plainB]` | `requestClose()`; `keyDown(Tab)` | focus `plainA`; prevented and stopped |
| 6 | `[plainA, inner, plainB]` | `requestClose()`; `keyDown(Tab, shift)` | focus `plainA` |
| 7 | `[plainA, plainB, inner]` | `requestClose()`; `keyDown(Tab)` | wraps: focus `plainA` |
| 8 | `[inner, plainA, plainB]` | `requestClose()`; `keyDown(Tab, shift)` | wraps: focus `plainB` |
| 9 | `[inner, plainA, plainB]` | `requestClose()`; `keyDown('ArrowDown')`; `keyDown(Tab)` | focus `inner`; Tab not prevented (release expired) |
| 10 | `[inner, plainA, plainB]` | `requestClose()`; `keyDown('Shift')`; `keyDown(Tab, shift)` | focus `plainB` (a bare modifier keeps the release) |
| 11 | `[inner, plainA, plainB]` | `requestClose()`; `keyDown('Escape')`; `keyDown(Tab)` | focus `plainA` (Escape keydown keeps the release) |
| 12 | `[inner, plainA, plainB]` | `requestClose()`; focus `plainA`; `focusIn()`; focus `inner`; `keyDown(Tab)` | focus `inner`; not prevented (release expired) |
| 13 | `[inner, inner2, plainA]`, `inner2` a second child of `O` | `requestClose()`; focus `inner2`; `focusIn()`; `keyDown(Tab)` | focus `plainA` (moving inside the owner keeps the release) |
| 14 | `[inner, plainA, plainB]` | `requestClose()`; `keyDown(Tab)`; focus `inner`; `keyDown(Tab)` | second Tab: focus stays `inner`, not prevented (one-shot) |
| 15 | `[inner]` | `requestClose()`; `keyDown(Tab)` | focus `inner`; prevented and stopped (nothing outside to reach) |

The existing rows in `describe('Dialog — the Tab trap stands down inside a
Tab-key owner')` and `describe('Dialog — Tab focus trap')` stay green
unchanged: with no release armed, the trap behaves exactly as before.

### LayerManager

Offline in `LayerManager.test.ts`: a topmost layer whose `requestClose`
returns `false` → Escape not stopped; one returning nothing → stopped (the
existing test, unchanged).

### FocusTraversal

Offline in `FocusTraversal.test.ts`: register a `'modal'` layer whose element
`L` is marked a Tab-key owner; inside `L`, a marked owner `O` containing
`inside`, plus a plain `after`; seed `L`'s stops `[inside, after]`; enable the
service; focus `inside`. Dispatch Escape, then Tab. Expect focus still
`inside` and the Tab's `preventDefault` not called. Every existing test stays
green (their layers carry no marker).

### Needs manual verification

The live check is SQLAdmin's review dialog, run by
`/home/jika/typescript/sqladmin/plans/review-dialog-keyboard-exit.md` against
a symlinked build of this branch. It covers reaching and activating Execute by
keyboard only, Escape closing an open completion list without closing the
dialog, and a second Escape closing the dialog.

One library-only case is not covered there: a `Table` inside a `Dialog`.
Place one temporarily in any docs demo that opens a `Dialog`, focus a cell,
press `Escape` then `Tab`, and confirm focus ends outside the table. If it
ends back inside the table, record that under an `## Implementation Notes`
heading in this plan; it is the listener-order gap in *Non-Goals*, not a
defect of this change. Revert the demo edit. **Do not run a QA panel without
the user's explicit go-ahead.**

---

## Verification

- From `packages/lib`: `npm run typecheck` and `npm run typecheck:test`.
- From the repo root: `npm test` (full suite) and `npm run lint`.
- `grep -rn "tabOwnedByDescendant" packages/lib/src` — zero matches.
- `grep -rln "function stopAfterOwner" packages/lib/src` — exactly
  `core/Focusable.ts`.
- `npm run docs:api` — zero warnings. `npm run docs:llms:check` — clean.
- The manual checks under *Needs manual verification*.

---

## Documentation Impact

`DismissableLayer` is exported from `core/index.ts` (line 48), so its
`requestClose` JSDoc renders in the generated API pages; `Dialog.requestClose`
likewise. `core/Focusable.ts` is internal and renders nowhere. The public
JSDoc changes must not `{@link}` `Focusable.ts` symbols (CODE_CONVENTIONS.md,
*Don't `{@link}` internal symbols from public JSDoc*). Consumer-facing pages:
steps 9-14. No new page, no sidebar or `llms.txt` entry.

---

## Potential Challenges

- **Stacked keydown listeners.** `baseViewportListener` runs every viewport
  listener regardless of an earlier one's disposition, so `LayerManager`,
  `Dialog` and (when enabled) `FocusTraversal` all see each key. The design
  never lets two of them move focus for one key: `FocusTraversal` stands down
  under a dialog (step 8), and `Dialog` only arms through `requestClose`.
- **The Escape now reaches CodeMirror.** A declined Escape also closes an open
  completion list or search panel, and arms CodeMirror's own two-second
  tab-focus mode. That is harmless: the dialog handles the following `Tab` at
  the window and stops it before CodeMirror sees it.
- **An Escape that only closed a completion list still arms the release.** The
  dialog cannot tell, at the window, whether the editor will use the key. The
  user's next ordinary keystroke expires it, so the cost is one extra Escape
  to close the dialog.
- **`Dialog.test.ts` drives private methods.** The new `focusIn()` seam
  follows the file's existing `keyDown()` / `enter()` white-box pattern.

---

## Critical Files

- `packages/lib/src/typescript/lib/core/FocusTraversal.ts` — the precedent:
  `_releaseOwner`, `onFocusIn`, the arbitration in `onKeyDown`.
- `packages/lib/src/typescript/lib/core/Focusable.ts` — where shared focus
  helpers live; `findTabKeyOwner`.
- `packages/lib/src/typescript/lib/overlay/Dialog.ts` — `open`, `onKeyDown`,
  `requestClose`, `hide`, `getFocusable`.
- `packages/lib/src/typescript/lib/core/LayerManager.ts` — `DismissableLayer`,
  `onKeyDown`.
- `packages/lib/src/typescript/lib/core/Event.ts` — `baseViewportListener`
  (lines 368-386): every viewport listener runs.
- `plans/implemented/framework-focus-traversal.md` — the release's
  arbitration table and its audit findings.
- `plans/implemented/tab-and-dialog-key-routing.md` — the dialog trap's
  stand-down, and the accepted "no Tab route past an editor" trade this plan
  retires.

---

## Non-Goals

- **`Table` in a `Dialog` with a deterministic outcome.** `Table`'s own Tab
  handler runs from the window-level target dispatcher, a separate window
  listener from the viewport one; which of the two runs first depends on
  registration order. Making that order deterministic is a `core/Event.ts`
  change of its own.[^table-order]
- **A release for non-modal layers.** `Popover` and dropdowns still close on
  the first Escape; they restore focus to their opener, so they trap nothing.
  A `Window` never handles Escape, so CodeMirror's own Escape-then-Tab already
  works inside one.
- **`MarkdownEditor` or `CodeEditor` changes.** Both already mark themselves
  Tab-key owners; the release works through that marker. `CodeEditor.md` is
  edited, `CodeEditor.ts` is not.
- **A Ctrl/Cmd+Enter shortcut or a new `initialFocus` default.** See
  *Rejected* above.
- **A version bump or release.** Release steps stay manual.

---

## Notes

[^why-escape]: Escape is the exit gesture already chosen twice in this
    codebase: `FocusTraversal`'s release ("Escape-to-exit is the WAI-ARIA
    Authoring Practices convention for composite widgets that capture Tab",
    `framework-focus-traversal.md`), and CodeMirror's own recommendation — its
    `indentWithTab` documentation sends readers to the Tab-handling example
    before binding it, which gives Escape-then-Tab as the way out, and
    `@codemirror/view` 6.43 arms a two-second tab-focus mode on Escape
    (`dist/index.js`, `handlers.keydown`). Inside a dialog that route
    was dead, because `LayerManager` consumed the Escape at the window first.
    The earlier plan chose "Escape still closes the dialog" on purpose
    (`framework-focus-traversal.md`, *Potential Challenges*), and
    `tab-and-dialog-key-routing.md` accepted "no Tab route past an editor at a
    dialog's end" with Escape-to-close as the only way out. With the dialog now
    opening *inside* the editor, that way out abandons the task, which is not
    an exit a keyboard user can use to reach Execute. Two Escapes to close from
    inside an editor matches editors where Escape first dismisses the editor's
    own state.

[^expiry]: Both rules exist for the reasons `framework-focus-traversal.md`'s
    audit found: a bare modifier keydown precedes `Shift+Tab` and must not
    expire the release, and a focus move that stays inside the owner (a
    `Table` cell-editor cancel re-focusing the body; closing `CodeEditor`'s
    search panel re-focusing the document) must not either.

[^per-dialog]: Per-dialog state keeps stacked dialogs independent — a release
    armed in a background dialog cannot be consumed by the one on top, since
    each dialog's `onKeyDown` already returns early unless it is the topmost
    input layer. A shared module-level release (one state for both
    `FocusTraversal` and `Dialog`) was considered. It would couple the opt-in
    service to every dialog, and the two can never both be active for the same
    key once `FocusTraversal` stands down under a dialog.

[^stops-param]: The dialog's trap computes its stops with its own
    `getFocusable()` (every `FOCUSABLE_SELECTOR` match that is not disabled),
    while `FocusTraversal` uses `visibleFocusable(root)`. Passing the list in
    lets each keep its own eligibility rule, so the release lands on the same
    set of stops the dialog's wrap already uses.

[^decline-contract]: `requestClose` is already advisory — a mandatory modal
    ignores it, and `AbstractWindow` lets a `"beforeclose"` listener veto it —
    so declining is not new. What is new is telling the manager the key should
    keep going. Two alternatives were rejected. Handling Escape in the dialog's
    own keydown listener cannot work: `LayerManager` registers first and closes
    the dialog before the dialog's listener runs. A separate optional
    `claimsEscape?()` hook on `DismissableLayer` would be a query with a side
    effect (arming), or a second call the manager must sequence against
    `requestClose`. Letting the Escape propagate matters beyond the release:
    today an Escape meant for CodeMirror's completion list or search panel
    closes the whole dialog instead.

[^double-move]: `Dialog` became a Tab-key owner in `framework-focus-traversal.md`
    precisely so `FocusTraversal` would "stand down completely" under a dialog.
    That holds only while focus is on a plain control: `findTabKeyOwner`
    returns the *nearest* owner, so with focus in a `CodeEditor` inside the
    dialog the service sees the editor, not the dialog. Its Escape arms its
    own release for the editor, and on `Tab` it moves focus, after which the
    dialog's trap reads the new active element and may wrap it a second time.
    That path was unreachable while Escape always closed the dialog; this plan
    makes it reachable, so the stand-down becomes explicit. Checking the root
    rather than walking for an outer owner keeps the check to one attribute
    read, and only `Dialog` marks a layer element.

[^rejected]: A Ctrl/Cmd+Enter "confirm from anywhere" shortcut does not
    satisfy WCAG 2.1.2 — it runs one action but still leaves focus trapped, so
    Cancel and the title-bar ✕ stay unreachable. It also collides with
    CodeMirror's default `Mod-Enter` (`insertBlankLine`) and with SQLAdmin's
    own `Ctrl/Cmd+Enter` run-query chord, and is not discoverable. Defaulting
    initial focus to the primary button when the only content stop is a
    Tab-key owner would undo the deliberate 0.10.0 change that opens a dialog
    in its editor, would put a destructive primary action (SQLAdmin's
    Execute) one Enter away, and would still leave the trap in place the
    moment the user clicks into the editor. `initialFocus` already lets a
    caller choose the button when it wants that.

[^semver]: Under the documented policy (`docs/reference/migration/index.md`)
    this is a minor change once past 1.0: the Escape behaviour of a public
    component changes, and a public interface gains a return value. Pre-1.0,
    the project records such changes on a migration page and ships them in a
    minor. A patch would have let SQLAdmin's `^0.10.0` range pick the fix up
    with no manifest edit, but it would mislabel a documented behaviour change
    and a compile break for `requestClose(): void` overrides. SQLAdmin moves
    its range at release time as usual.

[^table-order]: `Event.ts` installs one window capture listener for the
    per-component maps (`baseListener`, line 220) and another for viewport
    listeners (`baseViewportListener`, line 812), each on the first
    registration of its kind for a given event type. Stopping propagation in
    one does not stop the other, since both sit on `window`. When
    `baseListener` runs first — the usual order in an app, whose components
    register `keydown` long before any layer opens — `Table`'s `Body` moves to
    the next cell and the dialog's release then moves focus out: the user ends
    up outside the table. In the other order the table may pull focus back.
    `FocusTraversal`'s release has the same exposure today.

---

## Implementation Notes

### Small deviations

- **`ownerDialog(config)`** in `Dialog.test.ts` takes an optional
  `Partial<DialogConfig>` that is spread into the dialog's config. Row 4
  (`dismissable: false`) needs it. The plan said nothing else about the
  helper would change.
- **`CodeEditor.md`**: the Escape-then-Tab sentences go before the `Ctrl-m`
  sentence as planned. That sentence's lead-in changed from "To move focus
  out" to "To switch Tab to moving focus for longer", because Escape-then-Tab
  now covers the one-off exit.
- **Changelog placement**: `### Overlay` goes at the end of `## Breaking
  changes`. `### Core` goes at the end of `## Added` and at the end of
  `## Fixed`. The page already had headings from earlier branches, and these
  follow them.
- **Docs step 9 (and 10, 13, 14) scoped for `Table`.** The live check
  below found that `Escape` then `Tab` does not reliably leave a `Table`.
  So the docs promise the release only for editing surfaces. For a `Table`
  they say the first `Escape` does not close the dialog but `Tab` may not
  leave it. `Dialog.md` keeps the "plain control at each end" advice for a
  dialog hosting a `Table`, though step 9 said to delete it. The first audit
  round raised this.
- **`npm run docs:api`** does not finish with zero warnings. It prints 15
  warnings, all from symbols this branch does not touch (`SpatialNavigation`,
  `MarkdownViewer`, `MarkdownEditor`, `FieldDecorator`). None come from this
  branch's JSDoc.

### What was checked live vs by unit tests only

The live checks used the lib demo (`packages/lib`, `vite`), in Chrome driven
by chrome-devtools, with real key presses. Temporary buttons in
`MiscPanel.ts` opened the test dialogs, and that edit was reverted. The first
dialog held only a `CodeEditor`, with Execute (primary) and Cancel buttons.
It opened with focus in the editor. These all behaved as the plan expects:

- `Tab` indented, as before.
- `Escape` left the dialog open. After a 2.6 s wait, which is past
  CodeMirror's own two-second window, `Tab` moved to Execute and did not
  indent.
- `Shift+Tab` back into the editor, then `Escape`, `Shift+Tab` moved to the
  title-bar close button and did not dedent.
- `Escape`, `ArrowDown`, `Tab` indented, so the release expired.
- `Ctrl+Space` opened the completion list, and `Escape` closed the list
  while the dialog stayed open. A second `Escape` closed the dialog with
  `'close'`, and focus went back to the button that opened it.
- With `FocusTraversal.enable()`, the dialog was opened from the keyboard.
  `Escape`, `Tab` moved focus to Execute, one step only (not Cancel). `Enter`
  on Execute then resolved `'confirm'`.
- Mandatory modal (`dismissable: false`): two `Escape`s left it open. `Tab`
  then moved to Execute, `Tab` again to Cancel, and `Space` resolved
  `'cancel'`.

These were covered by unit tests only, not checked live: the one-shot
second `Tab` (row 14), the focus-inside-owner keep (row 13), the empty-stops
case (row 15), the `LayerManager` decline row, and the `FocusTraversal`
stand-down row as an isolated case. SQLAdmin's review dialog is the plan's
downstream live check and was not run here.

### `Table` inside a `Dialog`: focus ends back inside the table

This is the manual case from *Needs manual verification*. Focus ended inside
the table in both of the setups below.

1. **Cell focused, no editor open.** `Escape` armed the release. On `Tab`,
   the dialog moved focus to OK first. Then `Table`'s own `Tab` handler
   opened the next cell's editor and pulled focus back into the table. In
   the lib demo, the viewport listener runs before the target dispatcher.
   This is the listener-order gap in *Non-Goals*, not a defect of this
   change.
2. **Cell editor open.** The release is cleared before `Tab` arrives. The
   string, number and combo cell editors re-fire each keydown as
   `Event.fireEvent(this, "keydown", { detail: … })`, a bubbling
   `CustomEvent` with no `key`, and it reaches every viewport `keydown`
   listener. `Dialog.onKeyDown` reads `e.key === undefined` as "any other
   key" and expires the release. `FocusTraversal`'s expiry rule has the
   same exposure. This expiry path was not in the plan. It is left
   unfixed: the Table case fails on listener order anyway, and fixing
   either one needs a change to `Event` or the cell editors, outside this
   plan's scope. It is a candidate for the same follow-up as the
   listener-order gap.
