---
touches-shared: [packages/lib/src/typescript/lib/overlay/Tooltip.ts, packages/lib/docs/reference/changelog/next.md]
---

# Tooltip Ownership, Picker Strictness And Split Transients — Implementation Plan

## Overview

Three entries in the render-review correctness register — C21, C23 and C29 —
each apply a rule to the wrong set of things. One dismisses a tooltip that
belongs to somebody else, one accepts text the user never finished typing,
and one captures a child it was told never to capture.

[`overlay/Tooltip.ts:476`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L476)
ends `detach` with an unconditional `Tooltip.hide()`. Any component's
`attach` or `detach` therefore fades out the tooltip currently showing for a
*different* component, and cancels a pending show that a different component
armed.

[`component/input/DateField.ts:128`](packages/lib/src/typescript/lib/component/input/DateField.ts#L128)
parses through `new Date(raw + "T00:00:00")`, which accepts the partial
prefixes `"2026"` and `"2026-09"` and silently rolls `"2025-02-30"` forward
to 2 March. Typing a ten-character date therefore commits two values the user
never typed on the way to the one they did.
[`component/input/DateTimeField.ts:147`](packages/lib/src/typescript/lib/component/input/DateTimeField.ts#L147)
has the same hole in its date half.

[`layout/LayoutSerialization.ts:216`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L216)
captures every child of a `Split`, while the `Tab` branch at
[`:232`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L232)
filters out children marked `transient` through the `serializableChildren`
helper. A saved `Split` layout therefore carries a placeholder node that
`materializeNode` warns about and skips on every restore.

The fixes touch seven source files, eight test files and four documentation
pages. No public signature changes.

---

## Scope

**One plan, three independent commits.** The three bugs share no code, no
file and no ordering constraint — dropping any one of them changes nothing
about the other two. They are planned together because each is a single small
edit behind a single decision, and because the campaign's own status pass
already groups them as one tier-C batch.[^one-plan] The commit structure
keeps them separable: one code commit per bug, so a bisect still isolates
each.

What the three do share is the shape of the defect, and it is worth naming
because it decides each fix:

| # | Rule being applied | Applied to | Should be applied to |
|---|---|---|---|
| C21 | "dismiss the tooltip" | every component that detaches | the component that owns what is on screen |
| C23 | "this text is a date" | anything `new Date` will swallow | text `formatValue` could have produced |
| C29 | "skip transient children" | children of a `Tab` | children of a `Tab` **and** of a `Split` |

---

## Architecture Decisions

### C21 — `detach` acts only on what the detaching component owns

`Tooltip.detach` stops calling `hide()` unconditionally. It dismisses the
visible tooltip only when the detaching component is its anchor, and cancels
the pending show only when the detaching component armed it. The in-file
precedent is `detachElement`
([`overlay/Tooltip.ts:618-620`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L618)),
which cancels its own attachment's timer and touches the shared
`activeElement` pointer only behind an ownership guard.

This is also what `detach`'s own JSDoc has always promised — *"cancelling any
pending show and hiding the tooltip if it is currently visible for this
component"* — so the change makes the code match its documented
contract.[^jsdoc-already-right]

### C21 — the pending show gets its own ownership pointer, keyed by component id

A tooltip has two phases, and today only the second one has an owner.
`Tooltip.activeElement` records the anchor of a tooltip that is **on screen**;
nothing records which component armed the shared `Tooltip.showTimer`. A new
`private static pendingId: string | null` records that, and a new private
static `_cancelPendingShow()` clears the timer and the pointer together.

The pending pointer is a component **id**; the visible pointer stays an
element **handle**. Each is the key its own store already uses:
`Tooltip.attachments` is keyed by id, and `activeElement` is shared with the
raw-element attachment path, which has no component to name.[^two-keys]

Both phases must be fixed together, because leaving the pending phase alone
leaves the same symptom reachable through the other door: a list rebind or a
label change during the 500 ms hover delay would still mean the tooltip never
appears at all.[^both-phases]

### C23 — a picker field parses exactly what it formats

`parseRaw` accepts an absolute string only when `formatValue` could have
produced it. For a date that means a complete, zero-padded `YYYY-MM-DD` and a
day that really exists in that month. Anything else returns `null`, which
leaves the field invalid and fires no change.

Out-of-range input is **rejected, not normalised**. `new Date` rolls an
impossible day forward, so `"2025-02-30"` becomes 2 March — a value the text
never named, which is the same defect as accepting `"2026"`. The engine
already rejects a month outside `01`–`12` and a day outside `01`–`31`; the
day-within-month overflow is the only case left for the fix to
catch.[^engine-checks]

| Typed | Today | After |
|---|---|---|
| `2026-09-16` | 16 Sep 2026 | 16 Sep 2026 |
| `2026` | 1 Jan 2026 | `null` |
| `2026-09` | 1 Sep 2026 | `null` |
| `2025-02-30` | 2 Mar 2025 | `null` |
| `2024-02-29` | 29 Feb 2024 | 29 Feb 2024 |
| `2026-9-1` | `null` | `null` |

### C23 — one shared helper per half, in `dateMath.ts`

Two free functions join
[`component/input/dateMath.ts`](packages/lib/src/typescript/lib/component/input/dateMath.ts):
`parseIsoDate` for the `YYYY-MM-DD` half and `parseClockTime` for the
`H:MM[:SS]` half. `DateField` calls the first, `TimeField` calls the second,
and `DateTimeField` calls both.

`parseClockTime` is `TimeField.parseRaw`'s existing check moved out
unchanged, so `TimeField`'s own behaviour does not change. `DateTimeField`
stops assembling a string for `new Date` and composes the two helpers
instead, which is what its own comment already claims it
does.[^one-helper-per-half]

`dateMath.ts` is the module all three fields already import for turning typed
text into a `Date`, and it is `@internal` and absent from every barrel, so
widening it costs nothing publicly.[^why-datemath]

### C29 — the `Split` branch filters through the same helper, mapping indices

`serializableChildren` gains a sibling, `serializableChildIndices`, which
returns the positions of the non-transient children instead of the children
themselves. `serializableChildren` is then defined in terms of it, so
"transient" is still decided in exactly one place. The `Split` branch maps
those indices over the live child list for its nodes, over
`manager.getPaneRatios()` for its ratios, and over
`manager.isPaneCollapsed(index)` for its flags — so all three arrays are read
at the child's **live** position and written at its **kept** position.

Live panes A (0.5), B (0.3, collapsed) and a transient placeholder P (0.2):

| | Live index | Kept index | `children` | `ratios` | `collapsed` |
|---|---|---|---|---|---|
| A | 0 | 0 | `node(A)` | `0.5` → `0.625` | `isPaneCollapsed(0)` = `false` |
| B | 1 | 1 | `node(B)` | `0.3` → `0.375` | `isPaneCollapsed(1)` = `true` |
| P | 2 | — | dropped | dropped | dropped |

With the placeholder mounted first — P, A, B — the kept indices are `[1, 2]`
and every read shifts with them; the captured arrays are identical to the
table above.

The kept ratios are renormalised to sum 1.0 so `SplitNode.ratios` keeps the
guarantee its own declaration makes
([`layout/LayoutSerialization.ts:86`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L86)).[^renormalise]

### C29 — the restore path is not touched, and states already in the wild restore identically

`populateContainer` already drops a child whose factory yields nothing and
re-aligns the surviving ratios through its `placed` list
([`layout/LayoutSerialization.ts:510-521`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L510)).
A state captured before this fix therefore restores to exactly the same tree
after it — the placeholder node is skipped either way, and the surviving
ratios are the same numbers. The only observable differences are the
`console.warn` that stops firing and the smaller captured JSON, so no
migration and no schema version bump is needed.[^wild-states]

---

## Public API

No exported class or component signature changes. Two functions and one
interface are added to the `@internal`, un-barrelled `dateMath` module:

```typescript
// packages/lib/src/typescript/lib/component/input/dateMath.ts

/** A wall-clock time parsed from "H:MM" or "H:MM:SS" text. */
export interface ClockTime {
    hours:   number;
    minutes: number;
    seconds: number;
}

export function parseIsoDate(raw: string): Date | null;

export function parseClockTime(raw: string): ClockTime | null;
```

One private static field and one private static method are added to
`Tooltip`:

```typescript
// packages/lib/src/typescript/lib/overlay/Tooltip.ts

private static pendingId: string | null = null;

private static _cancelPendingShow(): void;
```

One module-private function is added to `LayoutSerialization`:

```typescript
// packages/lib/src/typescript/lib/layout/LayoutSerialization.ts

function serializableChildIndices(component: Component): number[];
```

---

## Internal Structure

### `Tooltip` — the two ownership checks

`_cancelPendingShow` replaces the timer-clearing block in both `show`
([`:210-213`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L210)) and
`hide` ([`:338-341`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L338)),
so the timer and its owner can never disagree:

```typescript
private static _cancelPendingShow(): void {
    if (Tooltip.showTimer !== null) {
        clearTimeout(Tooltip.showTimer);
        Tooltip.showTimer = null;
    }

    Tooltip.pendingId = null;
}
```

`attach`'s `mouseoverFn` records the owner as it arms the timer
([`:407-413`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L407)):

```typescript
Tooltip.showTimer = setTimeout(() => { /* unchanged body */ }, 500);
Tooltip.pendingId = component.getId();
```

`detach`'s tail
([`:475-476`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L475))
becomes the two guarded actions:

```typescript
Tooltip.attachments.delete(id);

// Only this component's own pending show is cancelled: an unrelated
// detach must not swallow the hover another component is waiting out.
if (Tooltip.pendingId === id) {
    Tooltip._cancelPendingShow();
}

// `getElement()` is still resolvable here on the teardown path — destroy
// hooks run before `Component.destructor` releases its handles — so a
// disposed anchor still dismisses its own tooltip. The `undefined` check
// matters: a never-rendered component must not match a null anchor.
const element = component.getElement();

if (element !== undefined && Tooltip.activeElement === element) {
    Tooltip.hide();
}
```

The two branches can never both run for one call: `show()` clears
`pendingId`, so a component that owns the visible tooltip has no pending show
left.

### `dateMath` — the two parsers

```typescript
// A complete, zero-padded ISO calendar date — the only absolute form the
// date fields format, and therefore the only one they read back.
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseIsoDate(raw: string): Date | null {
    const match = ISO_DATE.exec(raw);

    if (match === null) {
        return null;
    }

    // Local midnight, appended so the day is not shifted by the UTC parse
    // `new Date("YYYY-MM-DD")` would otherwise perform.
    const date = new Date(`${raw}T00:00:00`);

    if (isNaN(date.getTime())) {
        return null;
    }

    // The engine range-checks the month and the bare day but rolls an
    // impossible calendar day forward — 30 February becomes 2 March — which
    // would commit a date the text never named. A rolled date is the one
    // case the shape check above cannot see.
    return date.getDate() === Number(match[3]) ? date : null;
}
```

```typescript
export function parseClockTime(raw: string): ClockTime | null {
    const [hStr, mStr, sStr] = raw.split(":");
    const hours   = Number(hStr);
    const minutes = Number(mStr);
    const seconds = sStr === undefined ? 0 : Number(sStr);

    const hasMinutes = mStr !== undefined && mStr !== "";
    const validHour  = !isNaN(hours)   && hours   >= 0 && hours   < 24;
    const validMin   = !isNaN(minutes) && minutes >= 0 && minutes < 60;
    const validSec   = !isNaN(seconds) && seconds >= 0 && seconds < 60;

    if (!hasMinutes || !validHour || !validMin || !validSec) {
        return null;
    }

    return { hours, minutes, seconds };
}
```

### `TimeField.parseRaw` — the composed branch

```typescript
const time = parseClockTime(raw);

if (time === null) {
    return null;
}

const d = new Date();
d.setHours(time.hours, time.minutes, time.seconds, 0);

return d;
```

### `DateTimeField.parseRaw` — the absolute branch

```typescript
// The strict inverse of formatValue: exactly two whitespace-separated
// parts, each parsed by the helper its own sibling field uses.
const parts = raw.trim().split(/\s+/);

if (parts.length !== 2) {
    return null;
}

const date = parseIsoDate(parts[0]);
const time = parseClockTime(parts[1]);

if (date === null || time === null) {
    return null;
}

date.setHours(time.hours, time.minutes, time.seconds, 0);

return date;
```

### `LayoutSerialization` — the index-preserving filter

```typescript
function serializableChildIndices(component: Component): number[] {
    const indices: number[] = [];

    component.getComponents().forEach((child, index) => {
        if (component.getLayoutConstraints(child)?.transient !== true) {
            indices.push(index);
        }
    });

    return indices;
}

function serializableChildren(component: Component): Component[] {
    const children = component.getComponents();

    return serializableChildIndices(component).map(index => children[index]);
}
```

```typescript
if (kind === "Split") {
    const manager = component.getLayoutManager() as Split;
    const live    = component.getComponents();
    const kept    = serializableChildIndices(component);
    const ratios  = manager.getPaneRatios();

    return {
        kind:        "split",
        orientation: manager.getOrientation() === "vertical" ? "vertical" : "horizontal",
        children:    kept.map(index => nodeFor(live[index])),
        ratios:      normalizeRatios(kept.map(index => ratios[index] ?? 0), kept.length),
        collapsed:   kept.map(index => manager.isPaneCollapsed(index)),
    };
}
```

---

## Ordered Implementation Steps

### Commit 1 — C21, tooltip ownership

1. **`packages/lib/tests/overlay/Tooltip.test.ts`** — add a
   `describe('Tooltip.detach — ownership')` block covering every row of
   *`Tooltip.detach` acts only on what it owns* in `## Expected Behaviour`.
   Drive the pending-show arm by calling the stored handler —
   `(Tooltip as any).attachments.get(a.getId()).mouseoverFn({ clientX: 10, clientY: 10 })`
   — rather than firing a DOM event, which is how the file already reaches
   `Tooltip`'s privates. Add `(Tooltip as any).pendingId = null;` beside the
   existing `activeElement` reset in both `afterEach` blocks
   ([`:76`](packages/lib/tests/overlay/Tooltip.test.ts#L76) and
   [`:269`](packages/lib/tests/overlay/Tooltip.test.ts#L269)), and give the new
   block its own. These tests fail before step 2.
2. **`packages/lib/src/typescript/lib/overlay/Tooltip.ts`** — declare
   `private static pendingId: string | null = null;` beside `activeElement`
   at [`:82`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L82), with a
   comment saying it names the component whose hover delay is running.
3. **Same file** — add the private static `_cancelPendingShow()` next to
   `_applyColors` ([`:485`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L485)),
   as shown in `## Internal Structure`.
4. **Same file** — replace the timer-clearing block at the top of `show`
   ([`:210-213`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L210)) and
   the one at the top of `hide`
   ([`:338-341`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L338))
   with `Tooltip._cancelPendingShow();`.
5. **Same file** — set `Tooltip.pendingId = component.getId();` immediately
   after `mouseoverFn` arms the timer
   ([`:407`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L407)).
6. **Same file** — replace `detach`'s trailing `Tooltip.hide();`
   ([`:476`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L476)) with
   the two guarded blocks from `## Internal Structure`, and tighten its JSDoc
   ([`:456-461`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L456)) to
   say it cancels **its own** pending show and hides the tooltip only when
   this component is its anchor.
7. **`packages/lib/src/typescript/lib/component/button/Button.ts`** — in
   `setTooltipSuppressed`'s JSDoc, change *"any visible/pending one
   dismissed"* to name the button's own, since a suppressed button no longer
   dismisses another component's tooltip.
8. **Test-helper hygiene** — add `(Tooltip as any).pendingId = null;` beside
   the existing `activeElement` reset in each tooltip reset helper:
   [`tests/component/container/LabeledGrid.tooltip.test.ts:39`](packages/lib/tests/component/container/LabeledGrid.tooltip.test.ts#L39),
   [`tests/component/container/LabeledFieldSet.test.ts:127`](packages/lib/tests/component/container/LabeledFieldSet.test.ts#L127),
   and both sites in
   [`tests/component/container/SplitGutter.tooltip.test.ts`](packages/lib/tests/component/container/SplitGutter.tooltip.test.ts)
   (`:39` and `:101`).
9. `npx vitest run tests/overlay/Tooltip.test.ts tests/component/container/LabeledGrid.tooltip.test.ts tests/component/container/LabeledFieldSet.test.ts tests/component/container/SplitGutter.tooltip.test.ts tests/component/button/Button.test.ts tests/component/menubar/MenuBarButton.test.ts tests/component/table/HeaderCell.disposal.test.ts tests/diagnostics/StyleAuditView.test.ts`
   — all green.
10. `grep -c 'Tooltip.hide();' packages/lib/src/typescript/lib/overlay/Tooltip.ts`
    — expect 6: `_onAnchorWatch`, `attach`'s `mouseoutFn` and `mousedownFn`,
    `detach`'s new guarded call, and `attachToElement`'s two handlers. The
    `detach` one must sit inside the `if`.

### Commit 2 — C23, picker strictness

11. **`packages/lib/tests/component/input/dateMath.test.ts`** — add a
    `describe('parseIsoDate')` and a `describe('parseClockTime')` block
    covering the rows in `## Expected Behaviour`. These fail before step 13.
12. **`packages/lib/tests/component/input/DateField.test.ts`** — rewrite the
    test at [`:86`](packages/lib/tests/component/input/DateField.test.ts#L86)
    (*"rolls an impossible day (2025-02-30) forward to a non-null Date"*) to
    assert `null`, replacing its DOCUMENTED ROLLOVER comment with one saying
    a rolled date is rejected because it names a day the text did not. Add
    the partial-prefix cases and the keystroke-by-keystroke `onInput` case
    from `## Expected Behaviour`; the `onInput` case follows the shape of
    test 27 at
    [`:273`](packages/lib/tests/component/input/DateField.test.ts#L273)
    (`field._input.setText(...)` then `field.onInput()`).
13. **`packages/lib/src/typescript/lib/component/input/dateMath.ts`** — add
    the `ISO_DATE` constant, the `ClockTime` interface, `parseIsoDate` and
    `parseClockTime`, exactly as in `## Internal Structure`. Give each the
    `@internal — not re-exported from the package barrel.` JSDoc tag the
    module's existing exports carry.
14. **`packages/lib/src/typescript/lib/component/input/DateField.ts`** —
    replace the two lines at
    [`:128-130`](packages/lib/src/typescript/lib/component/input/DateField.ts#L128)
    with `return parseIsoDate(raw);`, add `parseIsoDate` to the existing
    `dateMath` import at
    [`:9`](packages/lib/src/typescript/lib/component/input/DateField.ts#L9),
    and update `parseRaw`'s JSDoc to say the absolute form must be a complete
    `YYYY-MM-DD` naming a real calendar day.
15. **`packages/lib/src/typescript/lib/component/input/TimeField.ts`** —
    replace everything from
    [`:133`](packages/lib/src/typescript/lib/component/input/TimeField.ts#L133)
    to the closing `return d;` with the composed branch from
    `## Internal Structure`, importing `parseClockTime` from `dateMath`.
    Behaviour must not change.
16. **`packages/lib/src/typescript/lib/component/input/DateTimeField.ts`** —
    replace the absolute branch at
    [`:144-155`](packages/lib/src/typescript/lib/component/input/DateTimeField.ts#L144)
    with the body from `## Internal Structure`, importing both helpers. The
    existing comment's claim about mirroring `DateField`/`TimeField` is now
    literally true; keep it and say the two helpers are shared.
17. **`packages/lib/tests/component/input/DateTimeField.test.ts`** — add the
    `DateTimeField` rows from `## Expected Behaviour`.
    `packages/lib/tests/component/input/TimeField.test.ts` is **not** edited:
    its five existing strictness cases must pass unchanged, and that is what
    proves step 15's extraction behaviour-preserving.
18. `npx vitest run tests/component/input/` — all green.
19. `grep -rn 'T00:00:00' packages/lib/src/typescript/lib/component/input/`
    — expect exactly one match, in `dateMath.ts`. And
    `grep -n 'datePart' packages/lib/src/typescript/lib/component/input/DateTimeField.ts`
    — expect zero.

### Commit 3 — C29, Split transients

20. **`packages/lib/tests/component/layout/LayoutSerialization.test.ts`** —
    add a `Split`-rooted counterpart to the two `Tab`-rooted transient tests
    at [`:305`](packages/lib/tests/component/layout/LayoutSerialization.test.ts#L305)
    and [`:333`](packages/lib/tests/component/layout/LayoutSerialization.test.ts#L333),
    covering the rows in `## Expected Behaviour`. These fail before step 21.
21. **`packages/lib/src/typescript/lib/layout/LayoutSerialization.ts`** — add
    `serializableChildIndices` with its own JSDoc immediately after
    `panelIdOf` ([`:187`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L187)),
    ahead of the two existing doc blocks, and redefine `serializableChildren`
    ([`:206`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L206))
    in terms of it, as in `## Internal Structure`. Leave
    `serializableChildren`'s own JSDoc in place, adding one sentence saying it
    drops the positions the new function returns.
22. **Same file** — rewrite the `Split` branch
    ([`:214-225`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L214))
    as in `## Internal Structure`, and add `normalizeRatios` to the imports
    from `~/layout/LayoutSizes.js`.
23. **Same file** — `nodeFor`'s JSDoc block sits above `serializableChildren`
    rather than above `nodeFor`
    ([`:189-196`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L189)).
    Leave it where it is: the misplacement is pre-existing and unrelated, and
    step 21 inserts above it rather than through it.
24. `npx vitest run tests/component/layout/ tests/overlay/Dock.beforeClose.test.ts tests/overlay/Dock.lifecycle.test.ts tests/overlay/Dock.panelPresentation.test.ts tests/overlay/Dock.closeDisposal.test.ts`
    — all green. Those four `Dock` files are the only in-library callers of
    `serializeLayout` / `restoreLayout`.
25. `grep -n 'getComponents().map(nodeFor)' packages/lib/src/typescript/lib/layout/LayoutSerialization.ts`
    — expect zero matches.

### Commit 4 — documentation

26. **`packages/lib/docs/reference/changelog/next.md`** — three entries under
    `## Fixed`, in `### Overlay`, `### Components` and `### Layouts`. The
    `Components` entry must name the behaviour change a consumer can see: a
    partial or impossible date no longer commits, and a `DateTimeField` no
    longer accepts a UTC/offset-suffixed time.
27. **`packages/lib/docs/components/DateField.md`** and
    **`DateTimeField.md`** — one Notes bullet each: the absolute form must be
    complete and name a real calendar day, and anything else leaves the field
    invalid until blur clears it.
28. **`packages/lib/docs/components/Tooltip.md`** — one Notes bullet:
    detaching one component's tooltip never dismisses another component's.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/overlay/Tooltip.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/Button.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/dateMath.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/DateField.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/TimeField.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/DateTimeField.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/LayoutSerialization.ts` |
| Modify | `packages/lib/tests/overlay/Tooltip.test.ts` |
| Modify | `packages/lib/tests/component/container/LabeledGrid.tooltip.test.ts` |
| Modify | `packages/lib/tests/component/container/LabeledFieldSet.test.ts` |
| Modify | `packages/lib/tests/component/container/SplitGutter.tooltip.test.ts` |
| Modify | `packages/lib/tests/component/input/dateMath.test.ts` |
| Modify | `packages/lib/tests/component/input/DateField.test.ts` |
| Modify | `packages/lib/tests/component/input/DateTimeField.test.ts` |
| Modify | `packages/lib/tests/component/layout/LayoutSerialization.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/docs/components/DateField.md` |
| Modify | `packages/lib/docs/components/DateTimeField.md` |
| Modify | `packages/lib/docs/components/Tooltip.md` |

---

## Expected Behaviour

Every row is unit-testable unless marked otherwise.

### `Tooltip.detach` acts only on what it owns

`A` and `B` are two attached components.

| # | Setup | Action | Expected |
|---|---|---|---|
| 1 | tooltip visible, `activeElement` = A's element | `detach(B)` | `dismissing` stays `false`; `activeElement` is still A's element |
| 2 | tooltip visible, `activeElement` = A's element | `detach(A)` | `dismissing` becomes `true`; `activeElement` becomes `null` |
| 3 | A's `mouseoverFn` has armed the timer | `detach(B)` | `showTimer` is still non-null; `pendingId` is still A's id |
| 4 | A's `mouseoverFn` has armed the timer | `detach(A)` | `showTimer` is `null`; `pendingId` is `null` |
| 5 | nothing visible, nothing pending, A attached | `detach(A)` | the singleton is never built — `(Tooltip as any).instance` stays `null` |
| 6 | A attached, tooltip visible for A | `A.dispose()` | the destroy hook's `detach(A)` still dismisses: `activeElement` becomes `null` |
| 7 | A never attached | `detach(A)` | no-op, as today — the `!att` early return runs first |
| 8 | A attached, tooltip visible for A | `attach(A, "new text")` | still dismissed, as today: `attach` detaches its own component first |

### `parseIsoDate`

| Input | Result |
|---|---|
| `"2026-09-16"` | 16 Sep 2026, local midnight |
| `"2024-02-29"` | 29 Feb 2024 |
| `"0001-01-01"` | 1 Jan 0001 |
| `"2026"` | `null` |
| `"2026-09"` | `null` |
| `"2026-9-1"` | `null` |
| `"2025-02-30"` | `null` |
| `"2026-02-29"` | `null` |
| `"2025-13-45"` | `null` |
| `"garbage"` | `null` |
| `""` | `null` |
| `"2026-09-16 "` | `null` |

### `parseClockTime`

Every row is `TimeField`'s existing behaviour, asserted on the extracted
helper so the move is proved behaviour-preserving.

| Input | Result |
|---|---|
| `"09:30"` | `{ hours: 9, minutes: 30, seconds: 0 }` |
| `"9:5"` | `{ hours: 9, minutes: 5, seconds: 0 }` |
| `"09:30:45"` | `{ hours: 9, minutes: 30, seconds: 45 }` |
| `"09"` | `null` |
| `"24:00"` | `null` |
| `"09:60"` | `null` |
| `"09:30:61"` | `null` |

`TimeField.parseRaw` composes it as shown in `## Internal Structure`, and
every existing `TimeField` test must pass unchanged.

### `DateTimeField.parseRaw`

| Input | Today | After |
|---|---|---|
| `"2025-06-15 14:30"` | 15 Jun 2025 14:30 | unchanged |
| `"2025-06-15 14:30:05"` | with seconds | unchanged |
| `"2026 10:00"` | 1 Jan 2026 10:00 | `null` |
| `"2026-09 10:00"` | 1 Sep 2026 10:00 | `null` |
| `"2025-02-30 10:00"` | 2 Mar 2025 10:00 | `null` |
| `"2025-06-15"` | `null` | unchanged |
| `"total garbage"` | `null` | unchanged |
| `"2025-06-15 25:00"` | `null` | unchanged |
| `"2025-06-15 9:5"` | `null` | 15 Jun 2025 09:05 |
| `"2025-06-15 14:30Z"` | 14:30 UTC | `null` |
| `"2025-06-15 14:30 extra"` | 15 Jun 2025 14:30 | `null` |
| `"1y 6mo"` | shorthand | unchanged |

The `9:5`, `14:30Z` and `14:30 extra` rows are the time half's deliberate
changes. `9:5` starts being accepted because `TimeField` accepts it; the
other two stop being accepted because `formatValue` never produces them and
no doc page names them.

### Typing a date one character at a time

`DateField`, driven through `_input.setText(prefix)` then `onInput()` for
each prefix of `"2026-09-16"`:

| Observable | Today | After |
|---|---|---|
| `on("change")` fires | 3 — at `"2026"`, `"2026-09"`, `"2026-09-16"` | 1 — at `"2026-09-16"` |
| `_invalid` transitions | 6 | 2 — `true` at `"2"`, `false` at `"2026-09-16"` |
| value after `"2026"` | 1 Jan 2026 | unchanged from before typing |

Blurring on an incomplete entry follows `onBlur`'s existing contract: the
text and the value are cleared, because the field is invalid.

### `serializeLayout` of a `Split` holding a transient child

Panes A (ratio 0.5), B (ratio 0.3, collapsed) and transient placeholder
P (ratio 0.2).

| # | Case | Expected |
|---|---|---|
| 1 | P mounted last | `children` has 2 nodes, A then B |
| 2 | P mounted last | `ratios` is `[0.625, 0.375]` and sums to 1.0 |
| 3 | P mounted last | `collapsed` is `[false, true]` |
| 4 | P mounted **first** | identical `children`, `ratios` and `collapsed` to rows 1–3 |
| 5 | every child transient | `children`, `ratios` and `collapsed` are all `[]` |
| 6 | restore of the row-1 state | no `console.warn`; the rebuilt split holds exactly A and B |
| 7 | P is detached, not disposed, by the restore | same as the `Tab` case at [`:305`](packages/lib/tests/component/layout/LayoutSerialization.test.ts#L305) |
| 8 | a `Tab` container | unchanged — both existing transient tests stay green |

### Manual verification

Two checks need a real engine. They are **not** run by the implementer —
every QA-panel run opens a full-screen window on the user's desktop and needs
the user's explicit go-ahead. Record them as documented manual steps.

| Panel | How | Shows |
|---|---|---|
| `form-flat`, `type=date` | a harness run of the shipped drive, which types `2026-09-19` one character at a time into the first `DateField` | C23. `setRuleStyles` over the ten keystrokes falls from 6 to 2, and the border stops flashing red three times. The panel's own description already names C23, so the readout is directly comparable before and after. |
| `form-flat`, any drive, window left open | by hand: type past the 20-character limit in two decorated text fields so both show their red error outline, rest the pointer on the first until its error tooltip appears, then keep the pointer still and type in the second | C21. The second field's `FieldDecorator` calls `showError`/`clearError`, which `attach`/`detach` on a different component. Today the visible tooltip fades out; after the fix it stays. |

`menus` is a **regression check only**, not a reproduction: its toolbar
buttons carry tooltips, so resting the pointer on one and moving away must
still show and dismiss normally. No shipped panel can reproduce C21 under a
harness drive, because reproducing it needs a pointer held still on one
component while a second component re-attaches, and each run drives a single
target.[^no-c21-panel]

C29 has no panel. Its only in-library transient child is the `Dock`'s
empty-state placeholder, which sits under a `Tab` and is already filtered, so
nothing in the library can exhibit it — the jsdom assertions are the whole
proof.

---

## Verification

Run from `packages/lib`:

1. `npm run typecheck` — expects 0 errors.
2. `npm run typecheck:test` — expects 0 errors.
3. `npx vitest run tests/overlay/Tooltip.test.ts tests/component/input/ tests/component/layout/LayoutSerialization.test.ts`
   — the files this plan adds cases to.
4. `npx vitest run tests/component/container/LabeledGrid.tooltip.test.ts tests/component/container/LabeledFieldSet.test.ts tests/component/container/SplitGutter.tooltip.test.ts tests/component/button/Button.test.ts tests/component/menubar/MenuBarButton.test.ts tests/component/table/HeaderCell.disposal.test.ts tests/diagnostics/StyleAuditView.test.ts`
   — every test file that reaches into `Tooltip`'s private statics.
5. `npx vitest run tests/overlay/Dock.beforeClose.test.ts tests/overlay/Dock.lifecycle.test.ts tests/overlay/Dock.panelPresentation.test.ts tests/overlay/Dock.closeDisposal.test.ts`
   — the only in-library callers of `serializeLayout` / `restoreLayout`. The
   three date/time *cell editors* are not affected: they are bare `<input>`
   elements and share no code with the picker fields.
6. `npm test` — the full suite, once.
7. `npm run lint`.
8. `npm run docs:api` — must emit no *new* warnings. Neither `parseIsoDate`
   nor `parseClockTime` may be `{@link}`ed from a rendered page's JSDoc; the
   module is excluded from the docs build, so a link would warn.
9. `npm run docs:llms:check` — unaffected; no new concrete class ships.
10. `grep -rn 'Tooltip.hide()' packages/lib/src/typescript/lib/ --include=*.ts`
    — outside `Tooltip.ts` the only matches are `AbstractChart`'s three
    deliberate manual dismissals, unchanged by this plan.
11. `grep -c 'getLayoutConstraints(child)?.transient' packages/lib/src/typescript/lib/layout/LayoutSerialization.ts`
    — expect 2: `serializableChildIndices`'s filter and `collectLeaves`'s
    detach. The `Split` branch must not open-code a third.

---

## Documentation Impact

`Tooltip.detach`, `Button.setTooltipSuppressed` and the three `parseRaw`
overrides all carry JSDoc that this plan edits. Only the first two render:
`parseRaw` is `protected`, and TypeDoc excludes protected members, so those
edits reach no page. `dateMath` is not re-exported from any barrel, so
`parseIsoDate` and `parseClockTime` get no page either.

Per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md), none of the new JSDoc on a
rendered symbol may `{@link}` `pendingId`, `_cancelPendingShow`,
`parseIsoDate`, `parseClockTime` or `serializableChildIndices` — every one of
them is private or excluded. Describe the behaviour in prose.

Three component doc pages change:

- [`docs/components/Tooltip.md`](packages/lib/docs/components/Tooltip.md) —
  a Notes bullet stating that detaching one component's tooltip never
  dismisses another's. The page documents no dismissal rule today, so this is
  an addition, not a correction.
- [`docs/components/DateField.md`](packages/lib/docs/components/DateField.md)
  and
  [`docs/components/DateTimeField.md`](packages/lib/docs/components/DateTimeField.md)
  — a Notes bullet each on the absolute format's strictness. Both pages
  already describe the accepted absolute form as `YYYY-MM-DD` /
  `YYYY-MM-DD HH:MM[:SS]`, so the code is moving to match the docs.
- [`docs/components/TimeField.md`](packages/lib/docs/components/TimeField.md)
  is unchanged — `TimeField`'s rule does not move.

[`docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md)
gains three `## Fixed` entries, one per `### Overlay` / `### Components` /
`### Layouts` subsection, following the bold-lead-sentence style the page
already uses.

---

## Potential Challenges

- **A tooltip test leaves `pendingId` set and the next file sees it.** Step 8
  adds the reset beside the `activeElement` reset in every helper that
  already clears `Tooltip`'s statics. A stale `pendingId` with a `null`
  `showTimer` is inert, but the two must not be allowed to disagree.
- **A disposed component's element could already be released when its
  destroy hook reaches `detach`.** It is not:
  `Component.destructor` runs every destroy hook before the handle-release
  block ([`core/Component.ts:1268-1273`](packages/lib/src/typescript/lib/core/Component.ts#L1268)),
  and `_element` is cleared last. Row 6 of `## Expected Behaviour` pins that
  ordering. Were it ever inverted, the anchor watch would still dismiss the
  orphaned tooltip on the next pointer move.
- **A `Split` test asserts a captured ratio array length.** Renormalising
  changes the numbers only when a transient child was filtered, and the
  existing shape test at
  [`tests/component/layout/LayoutSerialization.test.ts:54`](packages/lib/tests/component/layout/LayoutSerialization.test.ts#L54)
  asserts the sum, not the members, so it stays green. Step 24 runs the file.
- **A detached `Split` now captures equal ratios instead of an empty array.**
  `getPaneRatios()` returns `[]` when the container is detached, and
  `normalizeRatios([], n)` fills in equal shares. The restore is identical
  either way, because `applyPaneRatios` renormalises a short array to the
  same result. No test asserts the empty case.
- **`DateTimeField` loses a form a consumer might use.** The offset-suffixed
  and fractional-second times it accepted are undocumented and not something
  `formatValue` emits, but the changelog entry must name them so the change
  is visible rather than silent.

---

## Critical Files

| File | Why |
|---|---|
| [`packages/lib/src/typescript/lib/overlay/Tooltip.ts`](packages/lib/src/typescript/lib/overlay/Tooltip.ts) | `detachElement:618-620` is the ownership-guard precedent C21 copies; `show`/`hide`/`attach` are the other three writers of the pending-show state. |
| [`packages/lib/src/typescript/lib/component/input/TimeField.ts`](packages/lib/src/typescript/lib/component/input/TimeField.ts) | `parseRaw:123-151` is the in-family strictness precedent, and the body `parseClockTime` is extracted from. |
| [`packages/lib/src/typescript/lib/component/input/dateMath.ts`](packages/lib/src/typescript/lib/component/input/dateMath.ts) | The shared parse-helper module the two new functions join, and the source of their `@internal` JSDoc shape. |
| [`packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts`](packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts) | `onInput:427` is what turns a `parseRaw` result into the invalid border and the `change` fan-out, and `onBlur:453` is what clears an incomplete entry. Neither changes; both decide what the keystroke test observes. |
| [`packages/lib/src/typescript/lib/layout/LayoutSerialization.ts`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts) | `serializableChildren:206` is the helper the `Split` branch never adopted; `populateContainer:505-526` is the restore side that must keep working unchanged. |
| [`packages/lib/src/typescript/lib/layout/Split.ts`](packages/lib/src/typescript/lib/layout/Split.ts) | `getPaneRatios:986` indexes `getComponents()`, `isPaneCollapsed:333` indexes `getLaidOutComponents()`, and `applyPaneRatios:1104` documents that a short, non-unit array is acceptable input. |
| [`packages/lib/src/typescript/lib/layout/LayoutSizes.ts`](packages/lib/src/typescript/lib/layout/LayoutSizes.ts) | `normalizeRatios:139` — the function the `Split` branch imports, including its equal-share fallback. |
| [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) | `destructor:1268-1316` — destroy-hook ordering, which is what makes C21's element comparison safe on the teardown path. |
| [`plans/research/render-review-2026-09-15/01-phase2-status-pass.md`](plans/research/render-review-2026-09-15/01-phase2-status-pass.md) | The verified current state of all three entries, and correction 4, which added C23's `DateTimeField` half. |

---

## Non-Goals

- **The rest of F11.2.** `Tooltip.attach`'s missing unchanged-text early
  return, its four per-call closures, and the always-on `mousemove`
  registration are performance work, assigned to the campaign's G19
  `tooltip-hover-path` group. Only the ownership defect is fixed here.
- **The rest of F17.7.** Carrying the invalid state as a `.invalid` style
  state instead of a border write, and evaluating it on blur rather than on
  every keystroke, belong to the same performance batch. The border still
  turns red on the first keystroke of a date; it just stops turning back and
  forth.
- **Relaxing `TimeField`'s own rule.** `parseClockTime` is extracted
  verbatim, so `"9:5"` and `":30"` keep parsing exactly as they do today. Its
  quirks are pre-existing and out of C23's statement.
- **Making `attach` re-show a visible tooltip with new text.**
  `attachToElement` does this mid-hover; `attach` does not. Aligning them is
  a feature, not a correctness fix.
- **A `LayoutState` schema version bump or a migration.** States captured
  before this fix restore identically after it, so neither is needed.
- **Any QA-panel change.** The shipped `form-flat` drive already witnesses
  C23, and a panel target built to witness C21 under a harness drive would
  add nothing the jsdom tests do not already pin.

---

## Notes

[^one-plan]: Three separate plans would each carry a near-identical scaffold
    — overview, verification list, changelog entry — around a single edit of
    five to twenty-five lines. The campaign's own
    `plans/research/render-review-2026-09-15/01-phase2-status-pass.md`
    already lists them as one tier-C batch ("tooltip ownership, picker
    strictness, Split transients"). The cost of grouping is that a reader
    must hold three unrelated subjects at once, which the `## Scope` table
    and the per-commit step sections are there to contain. The benefit of
    *not* grouping — independent revert — is preserved by the one-code-commit-
    per-bug rule, so grouping costs nothing a bisect would notice.

[^jsdoc-already-right]: The JSDoc at
    [`overlay/Tooltip.ts:456-461`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L456)
    reads "Removes the tooltip attachment from a component, cancelling any
    pending show and hiding the tooltip if it is currently visible for this
    component." The hiding clause is already conditional on ownership and the
    code never honoured it. The wording of the pending clause is loose enough
    to read either way, so step 6 tightens it to "its own pending show"
    rather than leaving a sentence that could be read as licensing the old
    behaviour.

[^two-keys]: A single pointer would be simpler but wrong in two ways. Making
    `activeElement` mean "showing or about to show" changes what
    `attachToElement` reads at
    [`:517`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L517): its
    `wasActive` check would fire for a merely-pending anchor and repaint the
    tooltip immediately at `(0, 0)`, turning a wrong-render fix into a
    wrong-render bug. Keying the pending pointer by element handle instead of
    id has its own trap: `getElement()` returns `undefined` for a
    never-rendered component, and a `?? null` normalisation would make
    `null === null` match a component that owns nothing. The id is what
    `Tooltip.attachments` is already keyed by, is stable across dispose, and
    has no null case.

[^both-phases]: The pending phase is reached as often as the visible one.
    `AbstractSelectableList.applyTooltip`
    ([`component/list/AbstractSelectableList.ts:428`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L428))
    calls `attach` on every pooled-row rebind with no unchanged-text guard,
    and `attach` opens with `detach`. So scrolling a list while the pointer
    rests on a toolbar button cancels that button's hover delay, and — because
    no fresh `mouseover` fires under a stationary pointer — the tooltip never
    appears at all until the pointer leaves and returns. Fixing only the
    visible phase would leave that symptom in place and make the guard look
    like it works.

[^engine-checks]: Verified in Node 25 against the local timezone and against
    `TZ=America/Santiago` (a zone whose DST transition lands at midnight):
    `2026-13-01`, `2026-00-01`, `2026-09-00` and `2026-09-32` all parse to an
    Invalid Date, so the engine range-checks the month and the bare day
    itself. `2025-02-30` parses to 2 March and `2026-02-29` to 1 March, so
    day-within-month overflow is the only survivor. Under the Santiago
    transition, local midnight shifts to 01:00 on the same date, so
    `getDate()` is unaffected and the rollover check is timezone-stable.

[^one-helper-per-half]: Three options were weighed. Leaving each field with
    its own check is what produced the bug — the same rule written three
    times, tightened in two places and forgotten in the third. Gating
    `DateTimeField`'s existing `new Date(\`${datePart}T${timePart}\`)` behind
    a call to `parseIsoDate` is the smallest possible diff, but it parses the
    date twice and leaves the time half on a different rule from
    `TimeField`'s — the exact drift the plan exists to end. Composing two
    shared helpers parses each half once, deletes the string assembly, and
    makes `DateTimeField`'s own comment true. It costs a verbatim extraction
    from `TimeField`, whose five existing strictness tests pin the move.

[^why-datemath]: The module's name says "math" and its existing exports are
    the relative-shorthand grammar, so an absolute-date parser widens what it
    covers. The alternative — a second `dateParse.ts` beside it — would split
    "how a picker field turns typed text into a `Date`" across two modules
    that the same three fields both import, for two small functions. The
    module is `@internal` and absent from every barrel, so the widening has
    no public consequence; what it buys is one place to look.

[^renormalise]: Not renormalising also restores correctly —
    `applyPaneRatios` treats its input as relative weights and says so at
    [`layout/Split.ts:1089-1093`](packages/lib/src/typescript/lib/layout/Split.ts#L1089).
    Renormalising is chosen because `SplitNode.ratios` declares "sums to
    ~1.0" as part of the captured schema, and the existing shape test asserts
    that sum. Keeping the declaration true makes a state captured from a
    container that held a transient child indistinguishable from one that
    never had it, which is what `transient` means.

[^wild-states]: Traced through `populateContainer`
    ([`layout/LayoutSerialization.ts:505-526`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L505)):
    a placeholder node's `panelId` is the placeholder component's own id,
    which no consumer factory supplies, so `materializeNode` returns `null`,
    the pane is left out of `placed`, and the surviving ratios are read at
    their original indices — the same numbers this fix now captures directly.
    `applyPaneRatios` then renormalises both. The one theoretical divergence
    is a stale state whose placeholder id happens to collide with a
    factory-known id, which would restore an extra pane today and not after;
    the `Dock`'s placeholder is never factory-known, so nothing in the
    library can produce that collision.

[^no-c21-panel]: The `menus` panel has both halves of C21 in the room — a
    toolbar of tooltip-bearing buttons, and `MenuBarButton.setActive`
    ([`component/menubar/MenuBarButton.ts:198`](packages/lib/src/typescript/lib/component/menubar/MenuBarButton.ts#L198)),
    which calls `setTooltipSuppressed` and so `detach` on a different
    component. It cannot stage them together: the only way to activate a
    menu-bar button is to click it, which moves the pointer off whatever was
    hovered and dismisses that tooltip legitimately, and `MenuBar` installs
    its keydown listener only while a menu is already open, so there is no
    keyboard route in. `form-flat`'s two decorated text fields avoid the
    problem because the second field is driven from the keyboard while the
    pointer stays where it is. Building a panel target that calls `setText`
    on an unhovered button would witness it under a harness drive, but the
    jsdom assertions already pin the same transition exactly — the slice-11
    probe's own Q3 reading is `Tooltip.dismissing` before and after — so the
    panel would add no evidence.
