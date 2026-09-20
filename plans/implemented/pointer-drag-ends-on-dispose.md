---
depends-on: [destructor-teardown-coverage]
touches-shared:
  - packages/lib/src/typescript/lib/core/Component.ts
  - packages/lib/tests/helpers/libraryClassScan.mjs
  - packages/lib/tests/helpers/libraryClassScan.d.mts
  - packages/lib/docs/reference/changelog/next.md
---

# A Pointer Drag Ends When Its Owner Is Disposed — Implementation Plan

## Overview

A pointer drag whose owning component is destroyed part-way through the
gesture locks the whole page, permanently. This is entry **C39** of the
render-review register
([`plans/research/render-review-2026-09-15/01-phase2-status-pass.md:248`](plans/research/render-review-2026-09-15/01-phase2-status-pass.md#L248)).
[`beginPointerDrag`](packages/lib/src/typescript/lib/core/PointerDrag.ts#L59)
stamps the class `ts-ui-dragging` and an inline drag cursor onto `<html>`,
which arms the shared rule `html.ts-ui-dragging > * { pointer-events: none }`
([`core/PointerDrag.ts:47`](packages/lib/src/typescript/lib/core/PointerDrag.ts#L47)).
That rule takes `<body>` — and every overlay mounted directly on the document
element — out of hit testing. Only
[`endPointerDrag`](packages/lib/src/typescript/lib/core/PointerDrag.ts#L73)
takes it back off, and every site reaches it from a drag-stop viewport
listener registered against its own component. When that component is
destroyed mid-gesture,
[`Component.destructor`](packages/lib/src/typescript/lib/core/Component.ts#L1148)
calls `Event.purgeComponent`
([`core/Component.ts:1170`](packages/lib/src/typescript/lib/core/Component.ts#L1170)),
the listener goes, the release is heard by nobody, and `<html>` keeps the
class and the cursor for the life of the page. Nothing on the page can be
clicked, including anything that might undo it.

Four sites share the defect:
[`WindowBorder.onDragStop`](packages/lib/src/typescript/lib/component/container/WindowBorder.ts#L278),
[`SplitGutter.onDragStop`](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L619),
[`Scrollbar._onDragEnd`](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L1125)
and
[`HeaderCell.onResizeDragStop`](packages/lib/src/typescript/lib/component/table/cell/Header.ts#L657).
All four were reproduced offline while drafting this plan.[^probe]

The fix is one framework-internal registry, `core/PendingPointerDrags.ts`,
that records an armed drag against the id of the component that began it, and
one call from `Component.destructor` that ends whatever is recorded against
the component being destroyed. It covers all four sites at once and needs no
per-site teardown code. A new registry test asserts the end-to-end property —
dispose with a drag armed leaves `<html>` free of `ts-ui-dragging` and of an
inline cursor — for each of the four, and a new source scan makes a fifth
drag site fail the build until it has a row there too.

---

## Architecture Decisions

### The registry mirrors `PendingTransitions`

`core/PendingPointerDrags.ts` is a new framework-internal module holding a
`Map` from an owner's id to the function that ends its drag, with
`registerPointerDrag` / `unregisterPointerDrag` / `endPointerDragFor`. It
mirrors
[`core/PendingTransitions.ts`](packages/lib/src/typescript/lib/core/PendingTransitions.ts#L3),
which solves the same hazard for animations: a registry that exists purely so
two modules can share teardown bookkeeping without importing each
other.[^mirror] It is not exported from `core/index.ts`, exactly as
`PendingTransitions` is not, so it stays off the public API surface.[^internal]

### The key is the owner's id, not the owner itself

`PendingTransitions` keys by element `Handle`; this registry keys by the
string `getId()` of the owning component. A `Map` holding component instances
would keep a dropped-but-never-disposed component alive and disarm the
garbage-collection finalizer, which is the reason `Event`'s own component
registry is keyed by id too.[^id-key]

### `beginPointerDrag` takes the owning component

`beginPointerDrag(owner: Component, cursor: string)` and
`endPointerDrag(owner: Component)` gain an owner parameter;
`beginViewportDrag` / `endViewportDrag` keep their current signatures and pass
their existing `component` argument down. Registration happens inside
`beginPointerDrag`, so no call site can arm a drag without recording
it.[^required-owner]

A drag begun by something that is not a `Component` is not reachable:
`core/PointerDrag.ts` is internal to the library, and the parameter makes any
other caller a compile error.

### Ending a stranded drag clears `<html>` and nothing else

`endPointerDragFor` clears the class and the inline cursor. It does **not**
run the site's own drag-stop callback. Each of the four callbacks either
writes style through handles the destructor is about to release, or tells a
consumer that a gesture committed when in fact the component was destroyed —
`SplitGutter.onDragStop` emits `"dragend"`, which `Split` turns into a
`"paneresize"` for the application
([`layout/Split.ts:1449`](packages/lib/src/typescript/lib/layout/Split.ts#L1449)).[^no-callback]

The component's own drag state (`SplitGutter._dragging`,
`Scrollbar._thumbDragging`, `HeaderCell._isDragging`) is left as it stands.
It belongs to an object that is being destroyed, and nothing reads it again.

### The end runs beside the line that strands the drag

The call goes into `Component.destructor` immediately after
`Event.purgeComponent(this.getId())`
([`core/Component.ts:1170`](packages/lib/src/typescript/lib/core/Component.ts#L1170)),
not in the handle-release block lower down. Both are module-level registries
keyed by this component's id, and the purge is the step that strands the
drag, so the repair reads best next to it.[^placement]

`destructor()` is the hook, not `dispose()`, so a drag owner destroyed by an
ancestor's recursion — a `SplitGutter` inside a disposed `Split`, a
`WindowBorder` inside a closing `Window` — is reached the same way.

### A source scan keeps the new registry honest

`tests/helpers/libraryClassScan.mjs` gains a fourth pattern,
`classesBeginningPointerDrags()`, matching a line that calls
`beginPointerDrag(` or `beginViewportDrag(`. The new registry test derives the
classes it must cover from that scan, the way its three siblings already do,
so a fifth drag site fails the build until it is covered.[^scan]

---

## Public API

None of these symbols is exported from a package entry point; every one is
framework-internal. Signatures are listed because the implementer must match
them exactly.

```typescript
// packages/lib/src/typescript/lib/core/PendingPointerDrags.ts  (new)

/** Records the function that ends `ownerId`'s armed pointer drag. */
export function registerPointerDrag(ownerId: string, end: () => void): void;

/** Forgets `ownerId`'s record, called when the drag ends normally. */
export function unregisterPointerDrag(ownerId: string): void;

/** Invokes and forgets whatever is recorded for `ownerId`. No-op when nothing is. */
export function endPointerDragFor(ownerId: string): void;
```

```typescript
// packages/lib/src/typescript/lib/core/PointerDrag.ts  (changed signatures)

export function beginPointerDrag(owner: Component, cursor: string): void;
export function endPointerDrag(owner: Component): void;

// unchanged:
export function beginViewportDrag(component: Component, moveListener: Event.Listener, stopListener: Event.Listener, cursor: string): void;
export function endViewportDrag(component: Component, moveListener: Event.Listener, stopListener: Event.Listener): void;
```

```javascript
// packages/lib/tests/helpers/libraryClassScan.mjs  (+ the .d.mts sibling)

/** Class names calling `beginPointerDrag(` / `beginViewportDrag(` — the pointer-drag registry's source of truth. */
export function classesBeginningPointerDrags(): string[];
```

---

## Internal Structure

### The registry

One entry per owner — a component can only ever have one pointer drag armed,
so the value is a single function rather than
`PendingTransitions`'s `Set`.[^single-entry]

```typescript
/** The function that ends each armed drag, keyed by its owner's component id. */
const armed: Map<string, () => void> = new Map();
```

### `PointerDrag.ts` after the change

The document-element write moves into a module-private helper so the registry
can hold it without going back through `endPointerDrag`:

```typescript
/** Clears the dragging class and the pinned cursor from the document element. */
function clearDragChrome(): void {
    DOM.sink.apply(DOM.source.getDocumentElement(), {
        removeClass: [DRAGGING_CLASS],
        style:       { cursor: "" },
    });
}

export function beginPointerDrag(owner: Component, cursor: string): void {
    ensureSuppressRule();
    registerPointerDrag(owner.getId(), clearDragChrome);

    DOM.sink.apply(DOM.source.getDocumentElement(), {
        addClass: [DRAGGING_CLASS],
        style:    { cursor },
    });
}

export function endPointerDrag(owner: Component): void {
    unregisterPointerDrag(owner.getId());
    clearDragChrome();
}
```

### The new scan pattern

```javascript
/** The pointer-drag registry's source of truth. The lookahead skips JSDoc
 *  continuation lines, mirroring `DRAG_REGISTRATION` above. */
const POINTER_DRAG_REGISTRATION = /^(?!\s*\*).*\bbegin(Pointer|Viewport)Drag\(/;
```

| Source line | Match? |
|---|---|
| `        beginPointerDrag("grabbing");` | yes |
| `        beginViewportDrag(this, this.onDrag, this.onDragStop, this.dragCursor());` | yes |
| `import { beginViewportDrag, endViewportDrag } from "~/core/PointerDrag.js";` | no — no `(` after the name |
| `        // \`beginViewportDrag\` suppresses pointer events below.` | no — no `(` after the name |
| ` * \`beginPointerDrag(cursor)\`. Pair with \`endViewportDrag\` …` | no — JSDoc continuation |
| `export function beginPointerDrag(owner: Component, cursor: string): void {` | matched, but attributed to no class |

The last row is the declaration inside `core/PointerDrag.ts`, which sits at
the module's top level. `classesMatching` attributes a match to the most
recent column-0 class declaration and drops matches with none, so the three
hits inside `PointerDrag.ts` contribute nothing. Run against `master` the
pattern yields exactly the four drag sites:

| Class | Site |
|---|---|
| `Scrollbar` | [`Scrollbar.ts:1079`](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L1079) |
| `SplitGutter` | [`SplitGutter.ts:609`](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L609) |
| `WindowBorder` | [`WindowBorder.ts:270`](packages/lib/src/typescript/lib/component/container/WindowBorder.ts#L270) |
| `HeaderCell` | [`Header.ts:644`](packages/lib/src/typescript/lib/component/table/cell/Header.ts#L644) |

All four get a row, so `UNCLAIMED_POINTER_DRAG_CLASSES` is empty on arrival.

---

## Ordered Implementation Steps

Steps 1–4 are the fix; 5–8 are the proof; 9 is documentation. Step 3 depends
on step 1; steps 4 and 5 depend on step 2; step 8 depends on steps 1–7.

1. **Create
   `packages/lib/src/typescript/lib/core/PendingPointerDrags.ts`** with the
   three exported functions from `## Public API` over the `armed` map in
   `## Internal Structure`. Copy the header-comment shape of
   [`core/PendingTransitions.ts:3-11`](packages/lib/src/typescript/lib/core/PendingTransitions.ts#L3):
   a short paragraph saying what the map holds, that
   `Component.destructor()` consults it, and that the module is not exported
   from `core/index.ts` because it exists only to let `PointerDrag.ts` and
   `Component.ts` share this bookkeeping without importing each other. Give
   each function a JSDoc block with `@param` lines, matching its
   `PendingTransitions` counterpart. `endPointerDragFor` deletes the entry
   **before** invoking it, as
   [`cancelTransitions`](packages/lib/src/typescript/lib/core/PendingTransitions.ts#L62)
   does, so a re-entrant call cannot loop.
   *Check:* `npm run typecheck` in `packages/lib`.

2. **`packages/lib/src/typescript/lib/core/PointerDrag.ts`** — add the
   `clearDragChrome` helper, give `beginPointerDrag` and `endPointerDrag`
   their `owner` parameter, and wire the register / unregister calls exactly
   as in `## Internal Structure`. `beginViewportDrag` (`:99`) now calls
   `beginPointerDrag(component, cursor)`; `endViewportDrag` (`:118`) now calls
   `endPointerDrag(component)`. Extend each function's JSDoc with an
   `@param owner` line, and add one sentence to `beginPointerDrag`'s saying
   that destroying the owner ends the drag. The module's existing
   `import type { Component }` already covers the new parameter — do not turn
   it into a value import.

3. **`packages/lib/src/typescript/lib/core/Component.ts`** — add
   `import { endPointerDragFor } from "~/core/PendingPointerDrags.js";`
   beside the existing `PendingTransitions` import (`:27`), and call
   `endPointerDragFor(this.getId());` in `destructor()` immediately after
   `Event.purgeComponent(this.getId())` (`:1170`). Precede it with a comment
   in the style of its neighbours: the purge just removed the viewport
   listener that would have ended an armed pointer drag, so without this the
   document element keeps `ts-ui-dragging` and its pinned cursor for the life
   of the page. Extend the `destructor()` JSDoc's list of what teardown does
   with "ends any pointer drag it had armed".
   *Check:* `grep -n 'endPointerDragFor' packages/lib/src/typescript/lib/core/Component.ts` — expect two matches (import, call).

4. **Update the two direct call sites.** In
   `packages/lib/src/typescript/lib/component/container/Scrollbar.ts`,
   `beginPointerDrag("grabbing")` (`:1079`) becomes
   `beginPointerDrag(this, "grabbing")` and `endPointerDrag()` (`:1125`)
   becomes `endPointerDrag(this)`. In
   `packages/lib/src/typescript/lib/component/table/cell/Header.ts`,
   `beginPointerDrag(RESIZE_HANDLE_CURSOR)` (`:644`) becomes
   `beginPointerDrag(this, RESIZE_HANDLE_CURSOR)` and `endPointerDrag()`
   (`:657`) becomes `endPointerDrag(this)`. `WindowBorder` and `SplitGutter`
   need no edit — they already pass `this` to `beginViewportDrag`.
   *Check:* `grep -rn 'endPointerDrag()' packages/lib/src/` — expect zero matches.

5. **`packages/lib/tests/core/PointerDrag.test.ts`** — update every existing
   call for the new signatures. The five direct-call cases (three under
   `describe('beginPointerDrag')`, two under `describe('endPointerDrag')`)
   each need a `Component` to own the drag; construct one per case the way the
   `beginViewportDrag` cases already do. Then add the three mechanism cases
   listed under *The registry, on its own* in `## Expected Behaviour`.

6. **`packages/lib/tests/helpers/libraryClassScan.mjs`** — add the
   `POINTER_DRAG_REGISTRATION` constant (exact regex in
   `## Internal Structure`) beside the three existing pattern constants, and
   export `classesBeginningPointerDrags()` delegating to `classesMatching`.
   Match the one-line JSDoc style of its three siblings.

7. **`packages/lib/tests/helpers/libraryClassScan.d.mts`** — declare
   `classesBeginningPointerDrags(): string[]` alongside the three existing
   declarations, with the same JSDoc line.
   *Check:* `npm run typecheck:test` in `packages/lib`.

8. **Create
   `packages/lib/tests/component/dispose-pointer-drag-teardown.test.ts`** —
   the four-row registry, the three extra cases, and the two coverage
   assertions; shapes and drivers in `## Expected Behaviour`. Copy the
   header-comment and `REGISTRY` shape of
   [`tests/component/dispose-drag-teardown.test.ts`](packages/lib/tests/component/dispose-drag-teardown.test.ts),
   opening with one sentence saying how this file differs from that one: this
   registry watches the document element's drag chrome, that one watches
   `DragManager`'s source / target maps. Include the
   `UNCLAIMED_POINTER_DRAG_CLASSES` baseline constant — empty, with a comment
   saying it is empty because every scanned class has a row, and that an entry
   only ever goes in as a deliberate, commented deferral. Name the two
   coverage assertions *every covers entry still begins a pointer drag* and
   *every class beginning a pointer drag is claimed by a row or listed as
   unclaimed*, mirroring the sibling file's pair.
   *Check:* `npx vitest run tests/component/dispose-pointer-drag-teardown.test.ts`
   — every case passes. Reverting step 3 alone must fail all four site rows.

9. **`packages/lib/docs/reference/changelog/next.md`** — one entry under
   `## Fixed` → `### Core`, naming the four components whose drags this
   affects and saying no consumer action is needed.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/core/PendingPointerDrags.ts` |
| Modify | `packages/lib/src/typescript/lib/core/PointerDrag.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/Scrollbar.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/Header.ts` |
| Modify | `packages/lib/tests/core/PointerDrag.test.ts` |
| Modify | `packages/lib/tests/helpers/libraryClassScan.mjs` |
| Modify | `packages/lib/tests/helpers/libraryClassScan.d.mts` |
| Create | `packages/lib/tests/component/dispose-pointer-drag-teardown.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Every case below is unit-testable offline, apart from the manual check at the
end.

### Reading the document element in a test

The modelled DOM source returns `''` from `getInlineStyle`, so the assertions
read the recorded write log, not the element. Both test files therefore need
the harness installed per case — `sink = installTestDOM(CONFIG)` in
`beforeEach` and `DOM.reset()` in `afterEach`, with the `CONFIG` constant
copied from
[`PointerDrag.test.ts:21`](packages/lib/tests/core/PointerDrag.test.ts#L21).
Reuse
[`PointerDrag.test.ts:46`](packages/lib/tests/core/PointerDrag.test.ts#L46)'s
`patchFor('HTML')` helper — the last `apply` patch written to the document
element — copying it into the new file rather than exporting it, the way the
sibling registries copy their own small helpers. Clearing `sink.writes` after
arming the drag (the idiom at
[`PointerDrag.test.ts:80`](packages/lib/tests/core/PointerDrag.test.ts#L80))
makes the post-dispose read unambiguous: if dispose wrote nothing to `<html>`,
`patchFor('HTML')` is `undefined` and the assertion fails.

### The registry, on its own

Three cases in `tests/core/PointerDrag.test.ts`, each with two plain
`Component`s, `owner` and `other`:

| Case | Sequence | `<html>` after the last step |
|---|---|---|
| the owner's dispose ends the drag | `beginPointerDrag(owner, 'ew-resize')`, clear log, `owner.dispose()` | `removeClass: ['ts-ui-dragging']`, `style: { cursor: '' }` |
| another component's dispose does not | `beginPointerDrag(owner, 'ew-resize')`, clear log, `other.dispose()` | no `apply` patch at all |
| a drag already ended is forgotten | `beginPointerDrag(owner, 'ew-resize')`, `endPointerDrag(owner)`, clear log, `owner.dispose()` | no `apply` patch at all |

The second case is what keeps the fix from degenerating into "clear the drag
chrome on every dispose", which would end a live drag whenever any unrelated
component was destroyed.

### Each of the four sites

Four `REGISTRY` rows in
`tests/component/dispose-pointer-drag-teardown.test.ts`, each claiming its own
class through `covers` (`covers: ['SplitGutter']` and so on) so the four
together leave the coverage baseline empty. Each row builds its component,
calls `getElement(true)`, arms the drag through the site's own entry point,
asserts the drag really armed, clears the write log, disposes, and asserts
`<html>` came clean.

| Row | `make` | Arm with | Cursor while armed |
|---|---|---|---|
| `SplitGutter` | `new SplitGutter('horizontal')` | `onDragStart(press)` | `ew-resize` |
| `WindowBorder` | `new WindowBorder(Direction.SOUTH)` | `onDragStart(press)` | `ns-resize` |
| `Scrollbar` | `new Scrollbar({ vertical: true })` | `_onDragStart(press)` (private arrow field, reached by cast) | `grabbing` |
| `HeaderCell` | `new HeaderCell('Name', 'name')` | `onResizeDragStart(press)` (private method, reached by cast) | `var(--ts-ui-table-resize-handle-cursor, ew-resize)` |

`press` is `{ button: 0, clientX: 40, clientY: 40 } as MouseEvent`, plus a
no-op `stopPropagation` for the `HeaderCell` row, whose handler calls it.
`Direction` is exported from
`~/component/container/WindowBorder`. Reaching a private driver through a cast
is the registries' established idiom.

Each row asserts, in order:

```typescript
expect(patchFor('HTML')?.addClass).toEqual(['ts-ui-dragging']);   // it really armed
sink.writes.length = 0;
c.dispose();
const patch = patchFor('HTML');
expect(patch?.removeClass).toEqual(['ts-ui-dragging']);
expect(patch?.style).toEqual({ cursor: '' });
```

The first assertion is the positive direction — without it a row whose `make`
silently failed to arm anything would pass for the wrong reason.

### Three more cases in the same file

Three standalone `it(...)` cases, outside `REGISTRY` — they prove properties of
the mechanism rather than of a class, so they carry no `covers` and take part
in no coverage assertion.

| Case | Setup | Assertion |
|---|---|---|
| an ancestor's dispose reaches it | `Panel` with a `SplitGutter` added via the public `addComponent`; arm the gutter's drag; dispose the **panel** | `<html>` comes clean — the hook is `destructor()`, reached by recursion, not `dispose()` |
| the site's drag-stop callback does not run | arm a `SplitGutter` that has a `"dragend"` listener attached via `on`; dispose it | the listener never fires |
| a second dispose writes nothing further | arm, dispose, clear the log, dispose again | no `apply` patch at all |

### The gate refuses a fifth unclaimed drag site

Adding a `beginPointerDrag(` call to any library class with no row and no
baseline entry fails *every class beginning a pointer drag is claimed by a row
or listed as unclaimed*. Check by hand once during implementation, then revert
the probe edit.

### Manual verification — not run by the implementer

The QA app's `windows` panel
([`packages/qa/src/panels/windows.ts`](packages/qa/src/panels/windows.ts))
mounts floating `Window`s and is the witness for the original report: close
several windows quickly, press a resize border strip while one is fading out,
and release after it has gone. Before the fix the page is unclickable behind a
frozen resize cursor; after it, the cursor returns and the page stays live.

**Do not run it.** Every QA run opens a full-screen window on the user's
desktop and needs their explicit go-ahead. Record it as a documented manual
step and leave it to the user. The offline assertions above are the stronger
evidence anyway: they pin the exact document-element state for all four sites,
where the manual check only exercises one.

---

## Verification

Run from `packages/lib`:

1. `npm run typecheck` — expects 0 errors. Catches any missed call site of the
   two changed signatures.
2. `npm run typecheck:test` — expects 0 errors. Catches a missing `.d.mts`
   declaration for the new scan export.
3. `grep -rn 'endPointerDrag()' src/` — expect zero matches.
4. `npx vitest run tests/component/dispose-pointer-drag-teardown.test.ts tests/core/PointerDrag.test.ts`
   — the new gate and the reworked mechanism tests.
5. `npx vitest run tests/component/dispose-full-teardown.test.ts tests/component/dispose-listener-teardown.test.ts tests/component/dispose-drag-teardown.test.ts tests/component/dispose-store-subscription-teardown.test.ts`
   — the four existing dispose gates. None should need an edit: this plan adds
   no `protected destructor(`, no `Event.add*(this, …)` call and no
   `DragManager.make*(` call, so none of their scan-derived class lists
   moves.[^no-baseline-churn]
6. `npx vitest run tests/component/container/SplitGutter.hover.test.ts tests/component/container/SplitGutter.movable.test.ts tests/component/container/Scrollbar.test.ts tests/component/layout/Split.test.ts tests/overlay/AbstractWindow.snapMouseMoveCoalescing.test.ts`
   — the files driving the four sites' own drag entry points.
7. `npm test` — the full suite, once.
8. `npm run lint`.

---

## Documentation Impact

No public API changes: every symbol this plan adds or re-signs is
framework-internal. `grep -rn 'PointerDrag' packages/lib/docs/ packages/lib/llms.txt`
finds nothing today, so no doc page and no catalog entry covers any of it. The
only documentation change is the changelog entry in step 9.

---

## Potential Challenges

- **Two drags armed at once.** Two fingers on two different handles arm two
  drags; ending either clears `<html>` for both. This is exactly what happens
  today — `endPointerDrag` has always been a global, last-writer-wins
  operation — so the registry introduces no new degradation.[^concurrent]
- **A stale record if a drag owner is dropped without being disposed.** The
  map then keeps one id string and one function reference, not the component,
  so nothing is pinned and the next `beginPointerDrag` by that owner replaces
  the entry. Keying by id (see `## Architecture Decisions`) is what buys this.
- **`destructor()` runs its body again on a second call.** `endPointerDragFor`
  is a map lookup that misses the second time, so the repeat is a no-op — the
  same property `cancelTransitions` relies on. Pinned by the third case in
  *Three more cases in the same file*.

---

## Critical Files

| File | Why |
|---|---|
| [`packages/lib/src/typescript/lib/core/PendingTransitions.ts`](packages/lib/src/typescript/lib/core/PendingTransitions.ts) | The precedent the new registry mirrors — module shape, header comment, JSDoc, delete-before-invoke. |
| [`packages/lib/src/typescript/lib/core/PointerDrag.ts`](packages/lib/src/typescript/lib/core/PointerDrag.ts) | The module being changed; its module comment explains why the two halves of the drag chrome move together. |
| [`packages/lib/src/typescript/lib/core/Component.ts:1148`](packages/lib/src/typescript/lib/core/Component.ts#L1148) | `destructor()` — the ordering and comment style of its teardown steps. |
| [`packages/lib/tests/component/dispose-drag-teardown.test.ts`](packages/lib/tests/component/dispose-drag-teardown.test.ts) | The registry-test shape the new file copies: `REGISTRY` rows, `covers`, the shrink-only baseline, the two coverage assertions. |
| [`packages/lib/tests/core/PointerDrag.test.ts`](packages/lib/tests/core/PointerDrag.test.ts) | The `patchFor('HTML')` helper and the write-log assertion idiom. |
| [`packages/lib/tests/helpers/libraryClassScan.mjs`](packages/lib/tests/helpers/libraryClassScan.mjs) | The three existing scan patterns the fourth joins. |
| [`plans/implemented/destructor-teardown-coverage.md`](plans/implemented/destructor-teardown-coverage.md) | Established the scan-plus-registry apparatus this plan extends; its decisions are settled and not reopened here. |

---

## Non-Goals

- **Making a closing `Window` non-interactive while it fades.**
  `AbstractWindow.onExitAction` fades the window for 150 ms with it still in
  the DOM and still hit-testable
  ([`overlay/AbstractWindow.ts:1091`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1091)),
  which is the trigger the user found. Suppressing pointer events for the fade
  would narrow that one trigger and change behaviour — a window being closed
  would stop responding to a press immediately — while leaving the general
  defect in place for every other way a drag owner can be destroyed. It also
  needs its own decision about clicks, not just drags. Deferred.[^fade]
- **Reference-counting concurrent drags.** See `## Potential Challenges`;
  the current global behaviour is preserved rather than changed.
- **Re-litigating the `DragManager` teardown registry.**
  `plans/implemented/destructor-teardown-coverage.md` is settled; this plan
  adds a fourth scan pattern beside its third and changes nothing it decided.

---

## Notes

[^probe]: Confirmed offline in the modelled DOM harness while drafting, one
    throwaway probe per site: construct the component, render it, arm the drag
    through the site's own entry point, dispose, then replay the recorded
    `apply` writes to the document element. All four left `ts-ui-dragging`
    set and the drag cursor pinned — `ew-resize` for `SplitGutter`,
    `ns-resize` for `WindowBorder`, `grabbing` for `Scrollbar`, and the
    resize-handle cursor token for `HeaderCell`. The probe also established
    that each site's drag-start entry point is reachable from a test with the
    drivers given in `## Expected Behaviour`; it was deleted afterwards. The
    register entry records the bug as pre-existing, verified by identical
    results on `master` (`c83c5896`) and on the phase-2 stack tip
    (`d982101e`).

[^mirror]: `PendingTransitions`'s header states its purpose plainly: it
    "exists purely to let `Animation.ts` and `Component.ts` share this
    bookkeeping without importing each other". The same holds here for
    `PointerDrag.ts` and `Component.ts`. A registry holding *functions* rather
    than membership flags is what makes that possible — `Component.destructor`
    invokes whatever was recorded without knowing anything about drags, so it
    never imports `PointerDrag.ts`. The alternative, a membership set plus a
    direct `endPointerDrag` call from `Component.destructor`, was rejected: it
    needs two imports instead of one and puts drag vocabulary into the base
    class for no gain.

[^id-key]: `Component.destructor`'s own comment above the `Event.purgeComponent`
    call spells this out for `Event`'s registry: "An entry left behind pins the
    whole instance (disarming the GC finalizer)". The framework supports a
    component being dropped without `dispose()` and collected later — that is
    what `_componentFinalizer` is for — so a registry holding instances would
    quietly defeat it. `PendingTransitions` avoids the problem differently, by
    keying on an opaque element `Handle`; neither registry holds a component.

[^required-owner]: The alternative was to leave `beginPointerDrag(cursor)`
    alone and have each of the four sites register itself separately.
    Rejected: it is four more things to remember, and forgetting one
    reproduces C39 exactly. Folding registration into `beginPointerDrag` means
    the only way to arm the drag chrome is also the way it gets recorded.

[^no-callback]: Running the site's own drag-stop callback from teardown was
    considered and rejected on evidence from all four: `SplitGutter.onDragStop`
    calls `applyHoverState()` (two style writes) and emits `"dragend"`, which
    `Split.onDragEnd` turns into `flushDrag()` plus a `"paneresize"` event to
    the application — a resize commit fired *because* the gutter was
    destroyed. `WindowBorder.onDragStop` calls `setSnapTarget(false)`, another
    style write. `Scrollbar._onDragEnd` calls `updateThumbFill()` on a thumb
    the same destructor is about to destroy. `HeaderCell.onResizeDragStop`
    calls `this._resizeHandle.dragEnd()` — on a handle `HeaderCell.destructor`
    disposes — and schedules a `setTimeout` that writes a field on the
    destroyed cell. The viewport listeners those callbacks would remove are
    already gone: `Event.purgeComponent` runs first.

[^placement]: The register entry suggested placing the call beside
    `cancelTransitions` in the handle-release block
    ([`core/Component.ts:1296`](packages/lib/src/typescript/lib/core/Component.ts#L1296)).
    Either position is correct — `clearDragChrome` resolves the document
    element freshly and never touches a handle this component owns, so it is
    insensitive to where in teardown it runs. The purge site wins on
    legibility: the two calls share a key (`this.getId()`), and the reader
    meets the hazard and its repair on adjacent lines.

[^single-entry]: `PendingTransitions` maps each handle to a `Set` because one
    element can be running several transitions at once. A component cannot
    have two pointer drags armed: each of the four sites owns exactly one
    handle, strip, thumb or gutter. A second `beginPointerDrag` from the same
    owner overwrites the entry with the identical `clearDragChrome` reference,
    which is a no-op in effect. This is the one deliberate divergence from the
    precedent.

[^scan]: Whether to add a scan at all was a real question, since the fix here
    is central rather than per-class — a fifth site calling
    `beginPointerDrag(this, …)` is correct for free, so a row proving its
    teardown proves nothing new. The deciding argument is the counterfactual:
    had this scan and registry existed, C39 *would* have been caught, because
    all four sites would have been required to carry a row asserting the
    end-to-end property, and all four rows would have failed. The property
    worth gating is not "this class stores its teardown" but "arming this
    class's drag and destroying it leaves the document element clean", and
    that stays worth asserting per site because each site arms the chrome
    through a different path. The scan is also what keeps the registry's
    membership derived rather than hand-written, which is the stated reason
    `libraryClassScan.mjs` exists at all.

[^internal]: Pre-1.0 policy deletes unused public API and makes
    exported-but-internal-only symbols private. `core/PendingPointerDrags.ts`
    has no re-export from `core/index.ts` and no `package.json` `exports`
    subpath reaches it, so nothing outside the library can import it —
    the same containment `core/PendingTransitions.ts`,
    `core/ClassStyleRules.ts` and `core/ComponentDefaults.ts` already have.
    The module's header comment states it, so a future re-export is a visible
    decision rather than an accident.

[^no-baseline-churn]: The three scan-derived gates key off
    `protected destructor(`, `Event.add*(this, …)` and
    `DragManager.make*(` respectively. This plan adds none of the three, so
    `UNCLAIMED_DESTRUCTOR_CLASSES`, `UNCLAIMED_LISTENER_CLASSES` and
    `UNCLAIMED_DRAG_TEARDOWN_CLASSES` all stay exactly as they are. A change
    to any of them during implementation means something went in that this
    plan did not intend.

[^concurrent]: Two simultaneous pointer drags need multi-touch on two
    different handles. Today the second `beginPointerDrag` overwrites the
    first's cursor and the first release clears the chrome for both; the
    registry changes neither. A per-drag reference count would fix it, and is
    not taken: the case has not been reproduced, and the machinery would have
    to handle a stranded owner's share coming out of the count as well as a
    normal release, which is more mechanism than an unreproduced case earns.

[^fade]: Both fixes were weighed. Ending the drag on dispose is general: it
    covers all four sites and every route to destroying a drag owner, of which
    the window close fade is one. Making a closing window non-interactive
    narrows that single route and buys no correctness once the general fix is
    in. It also costs something concrete — the close fade is the only
    reliable hand-reproducer for C39, and suppressing pointer events during it
    would make the manual check in `## Expected Behaviour` impossible to
    perform, so a regression of the general fix would become harder to notice,
    not easier.

---

## Implementation Notes

Five deviations, all small and none touching the plan's design:

- **`Scrollbar`'s registry row constructs it as `new Scrollbar('vertical')`,
  not `new Scrollbar({ vertical: true })`** as *Each of the four sites* has
  it. `Scrollbar`'s first positional parameter is
  `orientation: AxisOrientation` (`"vertical" | "horizontal"`), with the
  options bag second, so the plan's call would not have compiled. The row
  builds the same vertical scrollbar the plan intended.
- **Each `REGISTRY` row also asserts the cursor pinned while the drag is
  armed**, not only `addClass`. The plan's per-row assertion block checks the
  class alone, while its table gives a cursor per row; asserting it is what
  proves the write came from *that* site's drag rather than from anything else
  that might have armed the chrome.
- **`beginViewportDrag` / `endViewportDrag` had their JSDoc updated** to name
  `beginPointerDrag(component, cursor)` / `endPointerDrag(component)`. Their
  signatures are unchanged as the plan requires; only the prose naming the old
  call shapes, which this change made wrong, moved.
- **`libraryClassScan.mjs`'s header comment now says "four registry tests"**
  and lists the new test file beside its three siblings, for the same reason.
- **Two documentation sites outside `## Documentation Impact` were updated.**
  That section concluded "the only documentation change is the changelog
  entry", derived from a `grep` for `PointerDrag` across `docs/` — which
  cannot find a page that enumerates what teardown does without naming the
  module. Two such enumerations exist and both were left inaccurate by the
  fix: `Component.dispose()`'s own JSDoc, which restates `destructor()`'s
  list and is public where `destructor()`'s is not, and the `dispose()` bullet
  under *Disposal* in `docs/concepts/component-lifecycle.md`. Both now carry
  the same "ends any pointer drag it had armed" clause step 3 added to
  `destructor()`; nothing else in either was touched.

Three of the new cases assert a negative — *another component's dispose does
not*, *a drag already ended is forgotten*, *a second dispose writes nothing
further* — and a fourth, *the site's drag-stop callback does not run*, asserts
a callback count of zero. All four pass on the unfixed code, so each was
earned instead by a deliberate mutation: making `endPointerDragFor` ignore its
id fails the first two, dropping its delete-before-invoke fails the third, and
driving a real `onDragStop()` in place of the dispose raises the callback count
to one, proving the listener live. The four site rows and *an ancestor's
dispose reaches it* were seen failing on the unfixed code first, and *the
owner's dispose ends the drag* was seen failing with the registry in place but
the destructor hook not yet added.

The manual check in *Expected Behaviour* — the QA app's `windows` panel — was
**not run** by the implementer: every QA run opens a full-screen window on the
user's desktop and needs their go-ahead. The offline assertions cover all four
sites' document-element state, but none of them exercises a real browser's hit
testing.

**Confirmed in a real engine by the user, 2026-09-20.** The reproduction that
found C39 — several `Window`s opened in the library's demo app under
`npm run dev`, then closed in rapid succession with the cursor crossing the
border strips — no longer locks the page on this branch. That is the evidence
the offline suite cannot produce, and it is what closes the bug; the new
four-row registry in `tests/component/dispose-pointer-drag-teardown.test.ts`
is what keeps it closed.
