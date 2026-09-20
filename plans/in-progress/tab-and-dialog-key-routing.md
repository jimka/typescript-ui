---
touches-shared:
  - packages/lib/docs/reference/changelog/next.md
  - packages/lib/docs/concepts/accessibility.md
---

# Tab Strip and Dialog Key Routing — Implementation Plan

## Overview

Two keyboard-routing defects, both settled by the *Decisions taken 2026-09-20*
section of
[`plans/research/render-review-2026-09-15/01-phase2-status-pass.md`](plans/research/render-review-2026-09-15/01-phase2-status-pass.md#L385).
Neither design question is re-opened here.

**2a — a closeable tab strip is one Tab stop per close button too wide.**
[`TabBar.createBarEntry`](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1802)
adds only the tab button to the strip's roving group, and
[`Button`'s constructor](packages/lib/src/typescript/lib/component/button/Button.ts#L778)
writes an explicit `tabIndex(0)` on every button, so each ✕ stays a full tab
stop. A three-tab closeable strip exposes four stops where it should expose
one. The close buttons join the roving group, and
[`onToolbarKeyDown`](packages/lib/src/typescript/lib/component/container/TabBar.ts#L3307)
gains `Delete` beside ArrowLeft/ArrowRight.

**2b — a modal `Dialog` takes Tab from an editing surface placed first or
last.** [`Dialog.open()`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L940)
claims the Tab key for its whole subtree, and its
[Tab branch](packages/lib/src/typescript/lib/overlay/Dialog.ts#L1143) wraps
focus at either end with no check on who is focused — so a `CodeEditor`,
`MarkdownEditor` or `Table` sitting at an end has its own Tab handling
overridden. That end-of-list wrap is the dialog's focus trap. It becomes
owner-aware: it stands down whenever focus sits inside a *descendant*
carrying the Tab-key-owner marker, and wraps as before otherwise.

The work touches
[`TabBar.ts`](packages/lib/src/typescript/lib/component/container/TabBar.ts),
[`Focusable.ts`](packages/lib/src/typescript/lib/core/Focusable.ts),
[`FocusTraversal.ts`](packages/lib/src/typescript/lib/core/FocusTraversal.ts)
and [`Dialog.ts`](packages/lib/src/typescript/lib/overlay/Dialog.ts). No
public signature changes.

---

## Architecture Decisions

### 2a and 2b ship as one plan, in separate commits

Both fixes land here, each as its own code commit, with one shared
documentation commit.[^one-plan]

### The close buttons join the strip's roving group

`createBarEntry` adds the ✕ to `_rovingTabIndex` right after its tab button,
and `removeBarEntry` removes it. A bare `setTabIndex(-1)` on the ✕ would
remove the stray stop too, and is rejected: roving-group membership is also
what keeps the ✕ reachable at all.[^why-group]

`ToolBar`'s membership check — the reason `Button` writes `tabIndex(0)` in
the first place — is unaffected. It reads a component's `tabindex` at the
moment that component is added to a bar, and a ✕ is never added to one: it is
raw-appended onto its own tab button's element.[^toolbar-check]

### Delete closes the focused tab, and does nothing when it cannot

`onToolbarKeyDown` gains a `Delete` branch that emits `"tabclose"` for the
focused cell. It works from the tab button and from the ✕ alike, because the ✕
is now a place keyboard focus can land.[^delete-from-x] When the focused cell
is not closeable — or nothing in the strip is focused — the handler returns no
disposition, leaving the key to propagate.[^no-action]

The rule, with the cases it decides:

| Focused element | Cell closeable? | Result |
|---|---|---|
| tab button of cell `b` | yes | `"tabclose"` emitted with `"b"`; `preventDefault()` |
| ✕ of cell `b` | yes | `"tabclose"` emitted with `"b"`; `preventDefault()` |
| tab button of cell `a` | no | nothing emitted, no disposition |
| a strip tool button | — | nothing emitted, no disposition |
| nothing in the strip | — | nothing emitted, no disposition |

### The roving group is addressed by identity, not by entry index

`onTabPressed` currently passes a cell's `_entries` index straight to
`RovingTabIndex.moveTo`. Interleaving the ✕ buttons breaks that equality, so
the call site looks the button up with
`this._rovingTabIndex.getItems().indexOf(button)` and skips the move on
`-1`.[^identity-lookup]

### The dialog's trap finds its owner by walking up from the focused element

`Dialog`'s Tab branch stands down when an ancestor walk from the active
element reaches an element carrying the Tab-key-owner marker
(`TAB_KEY_OWNER_ATTR`, rendered as `data-ts-ui-tab-key-owner`) before it
reaches the dialog's own element. No registry, no list of element
kinds.[^walk-not-registry]

The walk is bounded twice over, which is what makes the dialog's own claim
harmless: focus must be inside the dialog (`DOM.source.contains`), and the
walk stops at the dialog's element without testing it.

| Focus sits in | Walk finds | Trap |
|---|---|---|
| a `CodeEditor` inside the dialog | the editor's element | stands down |
| a plain `Button` inside the dialog | the dialog element (bound; not tested) | wraps as before |
| a `CodeEditor` on the page behind the dialog | — (`contains` is false) | wraps as before |

### The owner walk lives in `core/Focusable.ts`, shared with `FocusTraversal`

[`FocusTraversal`'s private `findTabKeyOwner`](packages/lib/src/typescript/lib/core/FocusTraversal.ts#L64)
moves into `core/Focusable.ts` as an exported function with an optional
`bound` parameter, and `FocusTraversal` imports it back. `Focusable.ts` is
already the shared home of every focus helper `FocusTraversal`,
`SpatialNavigation`, `FocusHistory` and `Dialog` use.[^shared-home]

---

## Internal Structure

### `core/Focusable.ts` — the shared walk

Added below `ancestorsBefore`; `Focusable.ts` gains
`import { TAB_KEY_OWNER_ATTR } from "~/core/Component.js";`.

```typescript
/**
 * Walks from `handle` up to (and including) `<html>` — see {@link
 * ancestorsToDocument} for why the walk is bounded there — looking for the
 * first ancestor marked as owning the Tab key for its own subtree.
 *
 * @param handle - The element to start the walk from (typically the focused element).
 * @param bound - Optional ancestor to stop at. The walk ends there and reports
 *   nothing, without testing `bound` itself, so a component that claims the Tab
 *   key for its whole subtree can still ask whether a descendant claims it too.
 *
 * @returns The nearest owning ancestor's handle, or `null` when none claims it.
 */
export function findTabKeyOwner(handle: Handle, bound?: Handle): Handle | null {
    for (const h of ancestorsToDocument(handle)) {
        if (h === bound) {
            return null;
        }

        if (DOM.source.hasAttribute(h, TAB_KEY_OWNER_ATTR)) {
            return h;
        }
    }

    return null;
}
```

### `overlay/Dialog.ts` — the stand-down

A private helper beside
[`getFocusable`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L1105):

```typescript
    /**
     * Whether keyboard focus currently sits inside a descendant of this dialog
     * that has claimed the Tab key for itself — a `CodeEditor`, a
     * `MarkdownEditor`, a `Table`. The walk is bounded at this dialog's own
     * element, which carries the same marker for the whole subtree, so the
     * dialog's own claim never answers for one of its children.
     *
     * @returns `true` when a descendant owns Tab, so the focus trap must stand down.
     */
    private tabOwnedByDescendant(): boolean {
        const el     = this.getElement();
        const active = DOM.source.getActiveElement();

        if (!el || active === null || !DOM.source.contains(el, active)) {
            return false;
        }

        return findTabKeyOwner(active, el) !== null;
    }
```

and, as the first statement of the existing `if (e.key === 'Tab')` block:

```typescript
            // A descendant that owns the Tab key handles it itself — the same
            // stand-down FocusTraversal performs, reading the same marker.
            if (this.tabOwnedByDescendant()) {
                return;
            }
```

### `component/container/TabBar.ts` — the rewritten key handler

`onToolbarKeyDown` in full, replacing the body at `:3302-3347`:

```typescript
    /**
     * Handles ArrowLeft / ArrowRight to move tab focus and activate the
     * adjacent tab, and Delete to close the focused tab.
     *
     * @param e - The keyboard event fired on the strip element.
     */
    private onToolbarKeyDown(e: KeyboardEvent): Event.ListenerResult {
        if (SpatialNavigation.claimsKey(e)) { return; }

        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Delete') {
            return;
        }

        const tabCount = this._entries.length;

        if (tabCount === 0) {
            return;
        }

        // A cell can hold DOM focus without being `_activeId` — SpatialNavigation
        // moves focus onto a TabButton (or, now that it is a roving member, onto
        // a TabCloseButton) with a direct .focus() call that never runs through
        // onTabPressed, so `_activeId` can lag behind wherever focus actually
        // is. Step from whichever cell currently holds focus, falling back to
        // the active tab only when focus is outside this strip.
        const focusedIdx = this.entryIndexForElement(DOM.source.getActiveElement());

        if (e.key === 'Delete') {
            return this.closeFocusedEntry(focusedIdx);
        }

        const activeIdx = focusedIdx >= 0
            ? focusedIdx
            : this._entries.findIndex(entry => entry.id === this._activeId);
        const base = activeIdx >= 0 ? activeIdx : 0;

        const newIdx = e.key === 'ArrowRight'
            ? (base + 1) % tabCount
            : (base - 1 + tabCount) % tabCount;

        const newTab = this._entries[newIdx].button;

        this._entries.forEach(entry => entry.button.setSelected(false));
        newTab.setSelected(true);

        this.onTabPressed(newTab);

        return { prevent: true };
    }
```

Its two new collaborators:

```typescript
    /**
     * The `_entries` index of the cell whose tab button or close ✕ renders as
     * `element`, or -1 when `element` is neither — focus outside the strip, or
     * on a strip tool. The ✕ half matters because the ✕ is a member of this
     * strip's roving group, so keyboard focus can land on it.
     *
     * @param element - The element to resolve, typically the active element.
     *
     * @returns The matching cell index, or -1.
     */
    private entryIndexForElement(element: Handle | null): number {
        if (element === null) {
            return -1;
        }

        return this._entries.findIndex(entry =>
            entry.button.getElement() === element ||
            entry.closeButton?.getElement() === element);
    }

    /**
     * Emits `"tabclose"` for the cell at `index` when that cell is focused and
     * closeable — the Delete half of {@link onToolbarKeyDown}. Reports no
     * disposition for an unfocused strip or a non-closeable cell, so a Delete
     * the strip has no action for keeps propagating.
     *
     * @param index - The cell index the focused element resolved to, or -1.
     *
     * @returns A prevent disposition when a close was emitted; nothing otherwise.
     */
    private closeFocusedEntry(index: number): Event.ListenerResult {
        if (index < 0) {
            return;
        }

        const entry = this._entries[index];

        if (!this.isEntryCloseable(entry.id)) {
            return;
        }

        this.emit("tabclose", entry.id);

        return { prevent: true };
    }
```

---

## Ordered Implementation Steps

**Commit 1 — the tab strip (2a).**

1. `packages/lib/tests/component/container/TabBar.test.ts`: add
   `describe('TabBar — close buttons are roving members')`. Import
   `ROVING_MEMBER_ATTR` from `~/core/RovingTabIndex`. Build a three-cell
   closeable bar with the file's existing `closeable()` helper (`:21`) and
   `bar.getElement(true)`, then assert:
   - every `barEntries(bar)[i].button.getCloseButton()!.getAria().getTabIndex()`
     is `-1`;
   - cell 0's tab button is `0` and cells 1–2 are `-1`;
   - `DOM.source.hasAttribute(closeEl, ROVING_MEMBER_ATTR)` is `true` for each
     ✕, where `closeEl` is `getCloseButton()!.getElement(true)!`;
   - after `bar.setActiveEntry('c')`, cell `c`'s tab button is `0` and every ✕
     is still `-1` (this is the step-9 identity lookup);
   - after `bar.removeBarEntry('b')`,
     `(bar as any)._rovingTabIndex.getItems()` has length 4 and contains
     neither of cell `b`'s two buttons.

   Every assertion fails today except the last two counts.
2. Same file: add
   `describe('TabBar onToolbarKeyDown — Delete closes the focused tab')`,
   mirroring the existing keydown blocks (`:98`, `:132`). Register a spy with
   `bar.on('tabclose', spy)`, put focus with `entry.button.focus()` /
   `entry.closeButton!.focus()`, and call
   `(bar as any).onToolbarKeyDown({ key: 'Delete' } as KeyboardEvent)`,
   asserting both the spy and the returned disposition. Cover all five rows of
   the Delete table in `## Architecture Decisions`, plus one case on an empty
   `new TabBar()` and one with
   `vi.spyOn(SpatialNavigation, 'claimsKey').mockReturnValue(true)` — both
   expecting no emit and no disposition.
3. `packages/lib/tests/core/FocusTraversalCompositeWidgets.test.ts`: add two
   tests beside the existing `'A Tab layout\'s TabBar exposes exactly one stop'`
   (`:95`), identical to it except for the per-child constraints. Import
   `LayoutConstraints` from `~/layout/LayoutConstraints` and build each
   constraint as `Object.assign(new LayoutConstraints(), { closeable: true })`.
   - all three children closeable: `stopCount(barEl)` must be `1`; it is `4`
     today.
   - only the middle child closeable: `stopCount(barEl)` must be `1`; it is `2`
     today.

   Leave the two surviving `it.todo`s (`:124`, `:125`) untouched — they are
   `MenuBar` and `ToolBar`, different widgets.
4. Create `packages/lib/tests/layout/Tab.keyboardClose.test.ts`, copying the
   `hostTab()` / `barEntries()` harness from
   `packages/lib/tests/layout/Tab.closeDisposal.test.ts` (`:44-62`). Two
   tests, both on a three-child `Tab` whose children are added with
   `closeable: true`, sized and `flushLayout()`-ed:
   - Delete on the focused active tab removes that cell —
     `bar.getEntryIds()` drops it;
   - after that Delete, `DOM.source.getActiveElement()` is a surviving cell's
     tab button element, never a ✕.

   Reach the strip's handler through
   `(bar as any).onToolbarKeyDown({ key: 'Delete' } as KeyboardEvent)`, where
   `bar` is `(tab as any)._bar`. Both fail today: nothing handles Delete, so
   the cell survives and focus never moves.
5. `packages/lib/src/typescript/lib/component/container/TabBar.ts`, in
   `createBarEntry`: immediately after
   `this._rovingTabIndex.add(tabButton);` (`:1802`), insert

   ```typescript
   if (closeButton) {
       this._rovingTabIndex.add(closeButton);
   }
   ```

   The ✕ must be added *after* its own tab button, so the group's order matches
   the strip's DOM order.
6. Same file, in `removeBarEntry`: replace
   `this._rovingTabIndex.remove(entry.button);` (`:1836`) with

   ```typescript
   if (entry.closeButton) {
       this._rovingTabIndex.remove(entry.closeButton);
   }

   this._rovingTabIndex.remove(entry.button);
   ```

   Both removals are required: `removeBarEntry` disposes the tab button (and
   with it the ✕), so a ✕ left in the group would be a disposed component the
   group holds forever.
7. Same file: add the private `entryIndexForElement` helper from
   `## Internal Structure`, next to `entryById` (`:1707`). `Handle` is already
   imported at `:7`.
8. Same file: add the private `closeFocusedEntry` helper from
   `## Internal Structure`, next to `entryIndexForElement`.
9. Same file, in `onTabPressed` (`:2049`): replace
   `this._rovingTabIndex.moveTo(idx);` (`:2054`) with

   ```typescript
            // The roving group interleaves each closeable cell's ✕ after its
            // own tab button, so a cell's entry index is not its member index.
            const rovingIdx = this._rovingTabIndex.getItems().indexOf(button);

            if (rovingIdx >= 0) {
                this._rovingTabIndex.moveTo(rovingIdx);
            }
   ```
10. Same file: replace `onToolbarKeyDown` (`:3302-3347`, doc comment included)
    with the version in `## Internal Structure`.
11. Run `npx vitest run tests/component/container/TabBar.test.ts tests/core/FocusTraversalCompositeWidgets.test.ts tests/layout/Tab.keyboardClose.test.ts`
    from `packages/lib` — steps 1–4 go green.
12. Run `npm test` from the repo root. Checkpoint:
    `grep -n 'moveTo(idx)' packages/lib/src/typescript/lib/component/container/TabBar.ts`
    — expect zero matches.

**Commit 2 — the dialog trap (2b).**

13. `packages/lib/tests/overlay/Dialog.test.ts`: add
    `describe('Dialog — the Tab trap stands down inside a Tab-key owner')`.
    Copy `markTabKeyOwner` from
    `packages/lib/tests/core/FocusTraversal.test.ts` (`:40`) and import
    `FOCUSABLE_SELECTOR` from `~/core/Focusable` and
    `setQuerySelectorAllResult` from `../dom/TestDOM`. Each test:
    `installTestDOM(CONFIG)`, build a `TestDialog`, take
    `const dialogEl = (dialog as any).getElement(true)`, mint `owner` and
    `inner` with `DOM.sink.createElement('div')`, wire
    `DOM.sink.appendChild(dialogEl, owner)` and
    `DOM.sink.appendChild(owner, inner)`, seed the trap's ends with
    `setQuerySelectorAllResult(dialogEl, FOCUSABLE_SELECTOR, [...])`,
    `DOM.sink.focus(...)`, `LayerManager.register(dialog)`, then
    `dialog.keyDown(event)` and assert on the `stopped()` / `prevented()` spies
    the file already provides. One test per row of `## Expected Behaviour`'s
    dialog table, in that order. `LayerManager.unregister(dialog)` at the end
    of each, as the neighbouring blocks do.
14. `packages/lib/src/typescript/lib/core/Focusable.ts`: add
    `import { TAB_KEY_OWNER_ATTR } from "~/core/Component.js";` and the
    exported `findTabKeyOwner` from `## Internal Structure`, placed after
    `ancestorsBefore` (`:86-92`).
15. `packages/lib/src/typescript/lib/core/FocusTraversal.ts`: delete the
    private `findTabKeyOwner` and its doc comment (`:56-72`); add
    `findTabKeyOwner` to the existing `~/core/Focusable.js` import (`:8`); drop
    `TAB_KEY_OWNER_ATTR` from the `~/core/Component.js` import (`:3`, keeping
    `Component` itself, which the `_owner` sentinel needs) and drop
    `ancestorsToDocument` from the `Focusable` import, since the deleted
    function was its only user. Checkpoint:
    `grep -n 'TAB_KEY_OWNER_ATTR\|ancestorsToDocument' packages/lib/src/typescript/lib/core/FocusTraversal.ts`
    — expect zero matches.
16. `packages/lib/src/typescript/lib/overlay/Dialog.ts`: add `findTabKeyOwner`
    to the existing `~/core/Focusable.js` import (`:28`); add the private
    `tabOwnedByDescendant` helper above `getFocusable` (`:1105`); insert the
    stand-down as the first statement of the `if (e.key === 'Tab')` block
    (`:1143`). Leave `onEnter` (`:1190`) exactly as it is.
17. Run `npx vitest run tests/overlay tests/core/FocusTraversal.test.ts tests/core/FocusTraversalCompositeWidgets.test.ts`
    from `packages/lib`, then `npm test` and `npm run lint` from the repo root.

**Commit 3 — documentation.**

18. `packages/lib/docs/concepts/accessibility.md`, *Keyboard navigation:
    RovingTabIndex* (ends at `:71`): add a short paragraph giving the tab
    strip's keyboard contract — ArrowLeft/ArrowRight move and activate,
    `Delete` closes the focused tab when it is closeable, the whole strip is
    one Tab stop, and a closeable tab's ✕ is reached by spatial navigation
    rather than by Tab.
19. Same file, *Tab traversal* (ends at `:125`): add one paragraph stating that
    a modal `Dialog`'s own focus trap follows the same Tab-key-owner rule —
    it wraps at the dialog's first and last stop, except while focus is inside
    a descendant that claims Tab, where the descendant keeps the key.
20. `packages/lib/docs/components/TabBar.md` (`:42`): widen the `"tabclose"`
    row's meaning from "A cell's ✕ was clicked" to name all three routes — the
    ✕, `Delete` on the focused tab, and the right-click menu's close items.
21. `packages/lib/docs/layouts/Tab.md`: add two sentences to the end of
    *Right-click context menu* (`:261`) giving the keyboard route to the same
    close, and noting that `Delete` is inert on a non-closeable tab.
22. `packages/lib/docs/components/Dialog.md`: add a short *Keyboard* subsection
    after *Initial focus* (ends at `:144`) stating the Tab contract: Tab wraps
    inside the dialog, and an editing surface or `Table` in the dialog keeps
    Tab for itself.
23. `packages/lib/docs/reference/changelog/next.md`: three bullets —
    - `## Fixed` → `### Components` (`:596`): a closeable tab strip no longer
      contributes one extra Tab stop per ✕;
    - `## Added` → `### Components` (`:137`): `Delete` closes the focused tab;
    - `## Fixed` → `### Overlay` (`:955`): a modal `Dialog`'s Tab trap no
      longer takes Tab from an editing surface or `Table` at either end.
24. `npm run docs:api` — must finish with zero warnings.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/container/TabBar.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Focusable.ts` |
| Modify | `packages/lib/src/typescript/lib/core/FocusTraversal.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Dialog.ts` |
| Modify | `packages/lib/tests/component/container/TabBar.test.ts` |
| Modify | `packages/lib/tests/core/FocusTraversalCompositeWidgets.test.ts` |
| Modify | `packages/lib/tests/overlay/Dialog.test.ts` |
| Create | `packages/lib/tests/layout/Tab.keyboardClose.test.ts` |
| Modify | `packages/lib/docs/concepts/accessibility.md` |
| Modify | `packages/lib/docs/components/TabBar.md` |
| Modify | `packages/lib/docs/components/Dialog.md` |
| Modify | `packages/lib/docs/layouts/Tab.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

### Tab stops a strip exposes

Unit-testable, in `FocusTraversalCompositeWidgets.test.ts` against the real
jsdom selector engine.

| Strip | Today | After |
|---|---|---|
| three non-closeable tabs | 1 | 1 |
| three closeable tabs | 4 | 1 |
| three tabs, one closeable | 2 | 1 |

### The roving group's contents and tabindex

Unit-testable, offline, in `TabBar.test.ts`.

- A closeable cell contributes two members, its tab button then its ✕, in that
  order.
- After any completed strip operation — create, activate, remove — exactly one
  member of the whole group carries `tabindex="0"`, and it is a tab button,
  never a ✕. `onTabPressed` is the only caller that moves the group, and it
  always moves to a tab button.[^transient-focus]
- Every member, ✕ included, carries `data-ts-ui-roving-member`.
- `removeBarEntry(id)` removes both of that cell's members.
- `setActiveEntry(id)` puts `tabindex="0"` on that cell's tab button whatever
  mix of closeable and non-closeable cells precedes it.

### Delete

Unit-testable, offline, in `TabBar.test.ts` — the five rows of the Delete
table in `## Architecture Decisions`, plus:

- `SpatialNavigation.claimsKey(e)` true ⇒ nothing emitted, no disposition
  (the existing first-statement guard runs before the key filter).
- An empty strip ⇒ nothing emitted, no disposition.

Unit-testable, offline, in `Tab.keyboardClose.test.ts`:

- `Delete` on the focused active tab of a three-cell closeable strip closes it
  and leaves DOM focus on a surviving cell's **tab button**, never on a ✕.

### Arrow keys

Unit-testable, offline, in `TabBar.test.ts`. Unchanged except for the last row.

| Focus | Key | Result |
|---|---|---|
| cell `b`'s tab button | ArrowRight | cell `c` activated and focused |
| outside the strip | ArrowRight | steps from the active cell |
| empty strip | ArrowRight | nothing |
| cell `b`'s ✕ | ArrowRight | cell `c` activated and focused (today: steps from the *active* cell instead) |

### The dialog's Tab trap

Unit-testable, offline, in `Dialog.test.ts`. Every row assumes the dialog is
the topmost input layer; a backgrounded dialog still returns early, unchanged.

| Focus | Key | Trap | Disposition |
|---|---|---|---|
| a Tab-key owner's inner element, seeded first | Shift+Tab | stands down | none |
| a Tab-key owner's inner element, seeded last | Tab | stands down | none |
| a Tab-key owner's inner element, seeded in the middle | Tab | stands down | none |
| a plain element seeded last | Tab | wraps to the first | `{ stop, prevent }` |
| a plain element seeded first | Shift+Tab | wraps to the last | `{ stop, prevent }` |
| a plain element seeded in the middle | Tab | leaves it to the browser | none |
| a marked owner's element that is **not** a descendant of the dialog, seeded as the last stop | Tab | wraps to the first | `{ stop, prevent }` |
| dialog with no focusable elements | Tab | consumes the key | `{ stop, prevent }` |

### Needs manual verification

Neither the docs demo surface nor the QA panels ship the two shapes these
fixes are about, so both checks need a temporary local edit and are secondary
to the offline tests above.[^manual-gap] **Do not run a QA panel without the
user's explicit go-ahead** — each run opens a full-screen window on their
desktop.

- A closeable tab strip: Tab into the strip and out again visits one tab button
  and no ✕; ArrowLeft/ArrowRight walk the tabs; `Delete` closes the focused tab
  and focus lands on its neighbour; `Ctrl+Alt`+arrow still reaches the ✕.
- A `CodeEditor` placed first or last inside a `Dialog`: Tab indents inside the
  editor instead of jumping to the other end of the dialog; Tab from the
  dialog's last plain control still wraps to the first.

---

## Verification

- `npm run typecheck` and `npm run typecheck:test`, from `packages/lib`.
- `npm test` from the repo root — the full suite, including the four test
  files this plan touches or creates.
- `npm run lint` from the repo root.
- `grep -n 'moveTo(idx)' packages/lib/src/typescript/lib/component/container/TabBar.ts`
  — zero matches.
- `grep -n 'TAB_KEY_OWNER_ATTR\|ancestorsToDocument' packages/lib/src/typescript/lib/core/FocusTraversal.ts`
  — zero matches.
- `grep -rln 'findTabKeyOwner' packages/lib/src` — exactly three files:
  `core/Focusable.ts` (the definition), `core/FocusTraversal.ts`,
  `overlay/Dialog.ts`.
- `npm run docs:api` — zero warnings.
- The two manual sweeps under *Needs manual verification*, if and only if the
  user asks for them.

---

## Documentation Impact

`core/Focusable.ts` is not re-exported from `core/index.ts` or any package
entry point, so `findTabKeyOwner` appears in no generated API page and no
reference page changes. No public signature changes anywhere, so
`packages/lib/llms.txt` needs no new entry and `npm run docs:llms:check` has
nothing new to cover.

The consumer-facing surface is the keyboard contract, covered by steps 18–23:
`docs/concepts/accessibility.md` (both sections), `docs/components/TabBar.md`,
`docs/layouts/Tab.md`, `docs/components/Dialog.md`, and three changelog
bullets.

---

## Potential Challenges

- **A keyboard user cannot Tab out of an editing surface that sits at an end
  of a dialog.** That is the decided contract — the owner keeps Tab — and it
  matches what `FocusTraversal` already does everywhere else. The dialog stays
  dismissable with Escape, which restores focus to wherever it was before the
  dialog opened. Consumers who want a Tab route past the editor should not place
  it first or last in the dialog.
- **CodeMirror's tab-focus mode (`Ctrl-m`) can now move focus out of a modal
  dialog.** In that mode CodeMirror declines Tab and the dialog has already
  stood down, so the browser's own traversal runs and can leave the dialog.
  Narrow and user-initiated; the alternative is re-trapping a key the user just
  asked to be given back.[^tab-focus-mode] `Table` is unaffected — its body
  consumes Tab unconditionally at every cell, edges
  included ([`Body.ts:2856`](packages/lib/src/typescript/lib/component/table/Body.ts#L2856)).
- **Closing the roving-active cell briefly focuses the previous cell's ✕.**
  `RovingTabIndex.remove` focuses the member before the one it removed, which is
  now a ✕. The move is corrected in the same call stack, before any paint, by
  `Tab.closeEntry`'s own re-selection; step 4's second test pins where focus
  actually ends up.[^transient-focus]
- **`Focusable.ts` gains a direct import of `Component.ts`.** No new cycle:
  `Focusable.ts` already imports `LayerManager.ts`, which imports `Component.ts`,
  and `Component.ts` imports nothing that reaches `Focusable.ts`.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/container/TabBar.ts`](packages/lib/src/typescript/lib/component/container/TabBar.ts) —
  `createBarEntry` (`:1734`), `removeBarEntry` (`:1826`), `onTabPressed`
  (`:2049`), `onToolbarKeyDown` (`:3307`), `isEntryCloseable` (`:1475`), and the
  subtree `keydown` registration (`:777`) that delivers a ✕'s key to the strip.
- [`packages/lib/src/typescript/lib/core/RovingTabIndex.ts`](packages/lib/src/typescript/lib/core/RovingTabIndex.ts) —
  `add` (`:82`), `remove` (`:98`), `moveTo` (`:131`), and the
  `ROVING_MEMBER_ATTR` comment (`:6-19`) explaining why membership, not a bare
  `tabindex`, is what spatial navigation reads.
- [`packages/lib/src/typescript/lib/component/menubar/ToolBar.ts:554-570`](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L554) —
  the membership check `Button`'s `tabIndex(0)` exists for; its own comment is
  the reasoning the roving-group decision above answers.
- [`packages/lib/src/typescript/lib/component/button/TabButton.ts:338-378`](packages/lib/src/typescript/lib/component/button/TabButton.ts#L338) —
  `buildCloseButton`, which raw-appends the ✕ onto the tab button's own element.
- [`packages/lib/src/typescript/lib/core/Focusable.ts`](packages/lib/src/typescript/lib/core/Focusable.ts) —
  `FOCUSABLE_SELECTOR` (`:35`) and `ancestorsToDocument` (`:64`), the walk
  `findTabKeyOwner` reuses.
- [`packages/lib/src/typescript/lib/core/FocusTraversal.ts:198-242`](packages/lib/src/typescript/lib/core/FocusTraversal.ts#L198) —
  the precedent stand-down: `onKeyDown` returns nothing while an owner holds
  Tab.
- [`packages/lib/src/typescript/lib/core/SpatialNavigation.ts:317-361`](packages/lib/src/typescript/lib/core/SpatialNavigation.ts#L317) —
  `isIndependentLeaf` and `rovingGroupMembers`, which are what keep a roved-off
  ✕ reachable.
- [`packages/lib/src/typescript/lib/overlay/Dialog.ts:1100-1210`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L1100) —
  `getFocusable`, `onKeyDown`, and `onEnter`'s existing carve-out.
- [`packages/lib/tests/core/FocusTraversal.test.ts:26-90`](packages/lib/tests/core/FocusTraversal.test.ts#L26) —
  the offline owner-marking and stop-seeding helpers step 13 copies.
- [`packages/lib/tests/layout/Tab.closeDisposal.test.ts:44-62`](packages/lib/tests/layout/Tab.closeDisposal.test.ts#L44) —
  the `Tab` harness step 4 copies.

---

## Non-Goals

- **The overflow / context menu's close items.** They already emit
  `"tabclose"` and are correct; the decision says they stay as they are.
- **`Backspace` as a second close key.** WAI-ARIA's pattern names `Delete`;
  a second binding is unrequested surface.
- **`onEnter`'s tag-based carve-out.** It answers a different question — which
  element self-activates on Enter — and works. Converting it to the owner flag
  is a separate change with its own risk.
- **`MenuBar` and `ToolBar`'s own extra tab stops.** The two surviving
  `it.todo`s in `FocusTraversalCompositeWidgets.test.ts` (`:124`, `:125`) are
  different widgets with different causes, each needing its own plan.
- **An accessible name for the ✕.** `TabCloseButton` renders a glyph with no
  `aria-label`. Real, pre-existing, and out of scope under the surgical-changes
  rule.
- **A Tab escape hatch out of a dialog-hosted editor.** See
  `## Potential Challenges`; adding one would re-open the decision this plan
  implements.

---

## Notes

[^one-plan]: The two fixes touch disjoint files — 2a is `TabBar.ts` alone, 2b is
    `Focusable.ts` / `FocusTraversal.ts` / `Dialog.ts` — so they could ship
    separately. They are planned together because they are one contract change
    for the consumer and one documentation edit: both are Tab-key routing, both
    were settled in the same decision entry, and both land in the same
    `accessibility.md` sections and the same changelog page. Splitting them
    would mean two plans racing on `accessibility.md` and
    `changelog/next.md`, which the frontmatter's `touches-shared` exists to
    flag. Separate code commits keep the diffs reviewable one at a time.

[^why-group]: `FOCUSABLE_SELECTOR` carries `:not([tabindex="-1"])` on every
    branch, so any element roved to `-1` disappears from `findFocusable` —
    which is exactly the stray stop this fixes, but would also make the ✕
    unreachable by keyboard altogether if that were the whole change.
    `SpatialNavigation` recovers roved-off members through
    `rovingGroupMembers` (`SpatialNavigation.ts:360`), which queries
    `[data-ts-ui-roving-member]` — a marker only `RovingTabIndex.add` writes.
    So group membership is what keeps `Ctrl+Alt`+arrow able to land on the ✕; a
    bare `setTabIndex(-1)` would not. `leafFocusables`' own doc comment already
    names the `TabCloseButton` case and keeps both the tab button and its ✕ as
    candidates, so nothing else in that tier needs to change.

[^delete-from-x]: The ✕ becomes a place `Ctrl+Alt`+arrow can land, so a user can
    be focused on it with no obvious way to act other than Enter/Space. Making
    `Delete` work there costs one extra comparison in
    `entryIndexForElement` and removes a dead end. The same helper is what lets
    ArrowLeft/ArrowRight step from the ✕'s own cell rather than from a possibly
    stale active cell — an inconsistency the ✕ becoming reachable would
    otherwise introduce.

[^no-action]: Returning no disposition matches what the same handler already
    does for an arrow key `SpatialNavigation` claimed, and what
    `ToolBar._onKeyDown` does for a childless bar: a widget must not swallow a
    key it has no action for, or an ancestor that does have one never sees it.
    Emitting `"tabclose"` for a non-closeable cell was rejected outright —
    `Tab._onBarTabClose` closes whatever id it is handed, so the guard has to
    be here, and `isEntryCloseable` (`TabBar.ts:1475`) is the check the
    right-click menu already uses for the same decision.

[^identity-lookup]: `moveTo` clamps its argument into range, so an `indexOf`
    miss (`-1`) would silently activate member 0 rather than doing nothing —
    hence the explicit `>= 0` guard. A `RovingTabIndex.moveToComponent` method
    was considered and rejected: `getItems()` is already public for exactly
    this, `TabBar` is the only index-addressed caller in the library
    (`ButtonGroup` and `ToolBar` use `moveNext` / `movePrev` only), and a new
    public method on a core class for one call site fails the
    simplicity rule in `CLAUDE.md`.

[^toolbar-check]: `Button`'s constructor writes `tabIndex(0)` so
    `ToolBar.addComponent` (`ToolBar.ts:568`) can tell a real control from a
    decorative child such as a `Text` caption, which never sets one. Roving a
    ✕ rewrites that value to `-1`, so the question is whether the check can
    ever see a roved ✕. It cannot: the check reads the value at
    `addComponent` time, on components a consumer hands the bar, and a
    `TabCloseButton` is raw-appended onto its own `TabButton`'s element by
    `TabButton.buildCloseButton` — it is never a `ToolBar` child, and `TabBar`
    is a `Container`, not a `ToolBar`. `getTabIndex()` has exactly two readers
    library-wide (`ToolBar.ts:568` and `RovingTabIndex.ts:144`), so there is no
    third path. The second reader keeps working too: `moveTo`'s
    already-active-and-tabbable early return simply never matches a member
    roved to `-1`, so a move onto one still writes.

[^walk-not-registry]: A registry would have to map the focused *element* back
    to a `Component`, and the framework deliberately does not keep that map —
    `Component.setTabKeyOwner` mirrors the claim onto the DOM precisely so
    "a consumer with no `Component` reference for the focused element … can
    still discover the claim from the DOM alone" (its own doc comment,
    `Component.ts:2263-2276`). A hard-coded list of element kinds, the shape
    `onEnter` uses, was ruled out by the decision: it would have to be widened
    every time a component claims Tab, and would not see a consumer's own
    claim at all. Cost per Tab press: one `getActiveElement`, one `contains`,
    then one `hasAttribute` per ancestor up to the dialog's element — a
    handful of seam reads, bounded by the focused element's depth inside the
    dialog. It runs *before* `getFocusable()`, whose `querySelectorAll` over
    the whole dialog subtree plus `disabled` filter is the more expensive of
    the two, so a Tab inside an editor gets cheaper than it is today.

[^shared-home]: `Focusable.ts` already exports `FOCUSABLE_SELECTOR`,
    `ancestorsToDocument`, `ancestorsBefore`, `focusScopeRoot`,
    `findFocusable`, `visibleFocusable` and `focusCandidates`, consumed by
    `FocusTraversal`, `SpatialNavigation`, `FocusHistory` and `Dialog` — and
    `Dialog` already imports from it. `ancestorsToDocument`'s own doc comment
    names itself "shared by every marker-attribute ancestor search", which is
    what this walk is. Leaving the function in `FocusTraversal.ts` and
    exporting it from there would make `Dialog` import a service namespace
    module for one pure helper.

[^manual-gap]: `packages/qa/src/builders/shell.ts:142` builds every dock tab
    with `closeable: false`, and the `windows` panel's dialog holds a six-field
    form with no editing surface; no demo in `packages/docs/src/demos` sets
    `closeable` at all (`grep -rn 'closeable' packages/docs/src` is empty).
    So proving either fix by eye needs a one-line local change to a panel or a
    demo. That is why the offline tests carry the proof and the sweeps are
    listed as secondary.

[^tab-focus-mode]: `CodeEditor` binds `indentWithTab` deliberately and
    documents the trade at `CodeEditor.ts:2024-2030`: Tab indents, and
    CodeMirror's own `Ctrl-m` (Alt-Shift-m on macOS) toggles tab-focus mode
    when a user wants Tab to move focus again. Before this change, a dialog
    hosting the editor at an end would wrap focus back into the dialog on that
    Tab; after it, the browser moves focus natively and can leave the dialog.
    Trapping it again would mean the dialog second-guessing a claim the
    component makes for its whole subtree, which is the thing this change
    exists to stop.

[^transient-focus]: `RovingTabIndex.remove` calls `moveTo(idx - 1)` when the
    removed member was the active one, and `moveTo` focuses. With the ✕
    interleaved, `idx - 1` is the previous cell's ✕ rather than its tab button.
    This already happens today in the same shape (focus lands on the previous
    *tab button*), and on both paths `Tab.closeEntry` immediately calls
    `selectNextContent`, which routes through `setActiveEntry` →
    `onTabPressed` → `moveTo` and lands focus on a real tab button — all
    synchronously, in the same call stack, so nothing is painted in between.
    The group's active index always tracks `_activeId`, because `onTabPressed`
    is the only caller that moves it, so this correction fires exactly whenever
    `remove`'s own focus move does.
