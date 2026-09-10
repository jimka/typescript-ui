---
depends-on: [focus-reveal-on-navigation]
touches-shared:
  - packages/lib/src/typescript/lib/core/index.ts
  - packages/lib/src/typescript/lib/layout/Split.ts
  - packages/lib/src/typescript/lib/layout/Border.ts
  - packages/lib/src/typescript/lib/layout/Accordion.ts
  - packages/lib/src/typescript/lib/core/LayerManager.ts
  - packages/lib/src/typescript/lib/overlay/Dialog.ts
  - packages/lib/src/typescript/lib/component/container/TabBar.ts
  - packages/lib/src/typescript/lib/component/table/Body.ts
  - packages/lib/src/typescript/lib/component/table/TreeBody.ts
  - packages/lib/src/typescript/lib/component/tree/Tree.ts
  - packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts
  - packages/lib/src/typescript/lib/component/menubar/ToolBar.ts
  - packages/lib/src/typescript/lib/overlay/ButtonGroup.ts
  - packages/lib/src/typescript/lib/component/input/Slider.ts
  - packages/lib/src/typescript/lib/component/input/NumberSpinner.ts
  - packages/lib/src/typescript/main.ts
  - packages/lib/tests/dom/TestDOM.ts
  - packages/lib/docs/concepts/accessibility.md
  - packages/lib/docs/reference/changelog/next.md
---

# Directional Panel Navigation — Implementation Plan

## Overview

A global keyboard chord that moves focus from the pane or region it is in to the
neighbouring one in the pressed direction. `Ctrl+Shift+→` from the left pane of a
horizontal [`Split`](packages/lib/src/typescript/lib/layout/Split.ts#L107) lands in
the right pane; `Ctrl+Shift+↑` from a
[`Border`](packages/lib/src/typescript/lib/layout/Border.ts#L52) centre lands in its
north region. When the innermost container has no neighbour in that direction, the
search walks outward through the ancestor containers until one does.

The service lives in a new
`packages/lib/src/typescript/lib/core/PanelNavigation.ts`, a module-level namespace
singleton with an opt-in `enable()`, exported from
[`core/index.ts`](packages/lib/src/typescript/lib/core/index.ts#L43) beside
`FocusHistory`. `Split` and `Border` already implement `FocusRevealer` (from
[`plans/focus-reveal-on-navigation.md`](plans/focus-reveal-on-navigation.md), which
this plan depends on); this plan extends that interface into `PanelNavigator` and
reuses `FocusReveal`'s own registry, rather than adding a second one. Each container
also remembers, per pane and per region, which descendant last held focus, and
returns focus there on the way back in.

Two supporting changes come with it. A new
`packages/lib/src/typescript/lib/core/Focusable.ts` becomes the single home of the
focusable-element selector that
[`Dialog`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L186) currently keeps
privately. And ten existing arrow-key handlers gain a one-line guard so they ignore
the chord instead of acting on it at the same time as the service.

---

## Architecture Decisions

### The service is a namespace singleton in `core/`, opt-in through `enable()`

`PanelNavigation` is a `namespace` over module-private state, with
`enable()` / `disable()` / `isEnabled()` / `configure()` and a sentinel `Component`
owning its viewport `keydown` listener. Nothing in the library calls `enable()`; the
demo app does.[^singleton]

Precedent: [`core/FocusHistory.ts`](packages/lib/src/typescript/lib/core/FocusHistory.ts#L65) —
the `_owner` sentinel at line 65, `Event.addViewportListener(_owner, "keydown", …)` at
line 260, opt-in `enable()` at line 248, module-private `let` state, and deference to
`LayerManager` at line 219.

### Containers register once, as `FocusRevealer`s; the service finds them by DOM containment

A `Split` or `Border` registers itself with `FocusReveal.register(this)` from
`attach` — the same call
[`plans/focus-reveal-on-navigation.md`](plans/focus-reveal-on-navigation.md) already
adds there. `PanelNavigation` keeps no registry of its own: given the focused
element, it asks `FocusReveal.containing(target)` for the registered revealers whose
element contains it, and narrows that list to the ones that also implement the two
extra `PanelNavigator` members. There is no global element→`Component` map and this
plan does not add one.[^containment]

Precedent for the broker shape:
[`core/FocusReveal.ts`](packages/lib/src/typescript/lib/core/FocusReveal.ts), which
in turn mirrors
[`core/LayerManager.ts`](packages/lib/src/typescript/lib/core/LayerManager.ts#L220) —
`register` / `unregister` against module-private state, with a containment query
(`containing`) answering "which registered surfaces hold this node".

### `PanelNavigator` extends `FocusRevealer`

The per-container contract adds two members to the `FocusRevealer` interface:

```typescript
export interface PanelNavigator extends FocusRevealer {
    recordFocus(target: Handle): void;
    resolveNeighbour(target: Handle, direction: PanelDirection): Handle[];
}
```

`getRevealElement()` and `revealDescendant()` are inherited, not redeclared — `Split`
and `Border` already implement them for `focus-reveal-on-navigation.md`, and opening
a collapsed pane or region is `revealDescendant`'s job there too, not a second
implementation of the same toggle.[^merge]

`resolveNeighbour` returns the elements to try focusing in the neighbouring pane or
region, best first. An empty array means "I have no neighbour that way" and the
service keeps walking outward. Each container does its own slot→direction mapping
inside `resolveNeighbour`, so the service never learns what a pane or a region is.

### Directions are compass points

`PanelDirection` is `"north" | "south" | "east" | "west"`, matching the vocabulary
[`Placement`](packages/lib/src/typescript/lib/primitive/Placement.ts#L9) already uses
for `Border` regions. The service maps the four arrow `code`s onto it:

| `KeyboardEvent.code` | `PanelDirection` |
|---|---|
| `ArrowUp` | `north` |
| `ArrowDown` | `south` |
| `ArrowLeft` | `west` |
| `ArrowRight` | `east` |

### The default chord is `Ctrl+Shift` + arrow, and the modifiers are configurable

`enable()` defaults to `{ ctrl: true, shift: true }`. The arrow keys themselves are
fixed; only the modifier set is configurable, through
`PanelNavigation.enable({ modifiers })`.[^chord]

The chord is matched on `KeyboardEvent.code`, so it is layout-independent — the same
reason `FocusHistory` matches its accelerator on `code`
([`FocusHistory.ts`](packages/lib/src/typescript/lib/core/FocusHistory.ts#L59)).

### One predicate decides both "the service acts" and "widgets stand down"

`PanelNavigation.claimsKey(e)` is true when the service is enabled, the event matches
the chord, and no transient overlay is on top. The service's own handler consumes the
key exactly when `claimsKey` is true, and every framework arrow-key handler that would
otherwise fight it starts with the same call. Because both sides read one predicate,
they cannot drift apart.

The guard is needed because a viewport listener cannot suppress a component listener:
`Event` installs `baseListener` and `baseViewportListener` as two separate `window`
capture listeners
([`Event.ts`](packages/lib/src/typescript/lib/core/Event.ts#L350)), and
`stopPropagation()` does not stop other listeners on the same node.[^guard]

The ten handlers that need it, each gaining `if (PanelNavigation.claimsKey(e)) { return; }`
as their first statement:

| File | Handler |
|---|---|
| [`component/table/Body.ts:2707`](packages/lib/src/typescript/lib/component/table/Body.ts#L2707) | `onKeyDown` |
| [`component/table/TreeBody.ts:805`](packages/lib/src/typescript/lib/component/table/TreeBody.ts#L805) | `onKeyDown` |
| [`component/tree/Tree.ts:1049`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1049) | `_onKeyDown` |
| [`component/list/AbstractSelectableList.ts:2093`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L2093) | `handleNavigationKey` |
| [`component/menubar/ToolBar.ts:187`](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L187) | the `_onKeyDown` closure |
| [`component/container/TabBar.ts:3297`](packages/lib/src/typescript/lib/component/container/TabBar.ts#L3297) | `onToolbarKeyDown` |
| [`overlay/ButtonGroup.ts:282`](packages/lib/src/typescript/lib/overlay/ButtonGroup.ts#L282) | the inline `keydown` closure |
| [`layout/Accordion.ts:2448`](packages/lib/src/typescript/lib/layout/Accordion.ts#L2448) | `onHeaderKeyDown` |
| [`component/input/Slider.ts:591`](packages/lib/src/typescript/lib/component/input/Slider.ts#L591) | the inline `keydown` closure |
| [`component/input/NumberSpinner.ts:505`](packages/lib/src/typescript/lib/component/input/NumberSpinner.ts#L505) | `onKeyDown` |

Nine of these ten return `Event.ListenerResult` (`boolean | EventDisposition | void`),
so a bare `return;` is a valid guard. `AbstractSelectableList.handleNavigationKey`
returns a plain `boolean`, so its guard is `if (PanelNavigation.claimsKey(e)) { return false; }`
instead — the same predicate, with the return statement adapted to that one method's
own signature. Change nothing else in any of the ten handlers.

`MenuBar` is deliberately absent: its arrow handling is registered only while a menu is
open ([`MenuBar.ts:256`](packages/lib/src/typescript/lib/component/menubar/MenuBar.ts#L256)),
and an open menu is a transient overlay, which `claimsKey` already stands down for.

### The service stands down while a transient overlay is on top

`claimsKey` returns false when
[`LayerManager.hasActiveInputLayer()`](packages/lib/src/typescript/lib/core/LayerManager.ts#L374)
is true — i.e. when some registered layer's dismiss mode is not `"manual"`, anywhere
in the layer stack, not only at its top. Dropdowns and menus are `"click-outside"`,
dialogs and modal drawers are `"modal"`, and windows are `"manual"` — so navigation
keeps working between panes inside a window, and still yields to an open combo-box
list even after a `"manual"` window has registered on top of it.[^layers]

### Focus arrives at the remembered descendant, else the first focusable one

Each container keeps, per pane or region, the `Handle` that last held focus there.
`resolveNeighbour` puts that handle first in the array it returns, provided the handle
is still connected and still inside that pane or region; the focusable elements in DOM
order follow it. The service focuses candidates in order until one actually takes
focus.[^land]

| Neighbour's state | Candidate order | Result |
|---|---|---|
| nothing recorded yet | first focusable, second, … | lands on the first focusable |
| recorded handle still live and inside | recorded handle, then DOM order | lands on the remembered element |
| recorded handle destroyed or moved out | first focusable, second, … | lands on the first focusable |
| recorded handle live but refusing focus | recorded handle, then DOM order | lands on the first focusable that takes it |
| nothing focusable at all | *(empty)* | this container declines; the walk continues outward |

### A candidate is revealed before it is tried, not before it is known to exist

`resolveNeighbour` returns candidates without touching collapse state — opening a pane
or region is `revealDescendant`'s job, not this method's. Before every focus attempt,
`move` calls `FocusReveal.reveal(candidate)`, which runs `revealDescendant` on every
registered revealer containing that candidate, outermost-first: the destination pane
or region, and any further-nested container between it and the candidate, such as an
inactive `Tab` page. Only then does `move` try to focus it.[^candidate-reveal]

### The focusable selector moves to `core/Focusable.ts`

`FOCUSABLE_SELECTOR` moves out of
[`Dialog.ts:186`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L186) into a new
`core/Focusable.ts`, which also holds the two helpers built on it — `findFocusable` and
the `focusCandidates` ordering both managers use — plus the `isLiveHandle` guard.
`Dialog` imports the selector from there and keeps its own `getFocusable` (line 1104)
unchanged. The module is internal: it is not added to `core/index.ts`.[^focusable]

### This feature depends on `plans/focus-reveal-on-navigation.md`

`PanelNavigation` builds directly on the `FocusReveal` broker: `Split` and `Border`
register once as `PanelNavigator`s (a `FocusRevealer` plus two members), and the
service reveals a candidate through `FocusReveal.reveal()` before testing whether it
took focus. `focus-reveal-on-navigation.md` ships first; this plan extends it rather
than duplicating its registry.[^merge]

---

## Public API

New module `packages/lib/src/typescript/lib/core/PanelNavigation.ts`, exported from
[`core/index.ts`](packages/lib/src/typescript/lib/core/index.ts#L43):

```typescript
/** A direction to move focus in, in the compass vocabulary `Placement` already uses. */
export type PanelDirection = "north" | "south" | "east" | "west";

/** The modifier set that arms the arrow keys. */
export interface PanelNavigationModifiers {
    ctrl?:  boolean;
    alt?:   boolean;
    shift?: boolean;
    meta?:  boolean;
}

/** Options for {@link PanelNavigation.enable} / {@link PanelNavigation.configure}. */
export interface PanelNavigationOptions {
    /** Default `{ ctrl: true, shift: true }`. Replaces the whole set, not merged. */
    modifiers?: PanelNavigationModifiers;
}

/**
 * A container whose panes or regions can be navigated between with the chord.
 * Extends `FocusRevealer` (see `plans/focus-reveal-on-navigation.md`) instead of
 * registering with a second broker.
 */
export interface PanelNavigator extends FocusRevealer {
    /** Remember `target` as the last-focused element of whichever pane/region holds it. */
    recordFocus(target: Handle): void;
    /** Elements to try focusing in the neighbour, best first. Empty declines. */
    resolveNeighbour(target: Handle, direction: PanelDirection): Handle[];
}

export namespace PanelNavigation {
    export function enable(options?: PanelNavigationOptions): void;
    export function disable(): void;
    export function isEnabled(): boolean;
    export function configure(options: PanelNavigationOptions): void;

    /** Whether this key event belongs to the service, so a widget must not act on it. */
    export function claimsKey(e: KeyboardEvent): boolean;

    /** Moves focus one pane/region in `direction`. Returns true if focus moved. */
    export function move(direction: PanelDirection): boolean;
}
```

There is no `PanelNavigation.register` / `unregister` — `Split` and `Border` register
with `FocusReveal.register(this)` / `unregister(this)` directly (see *Ordered
Implementation Steps*).

New internal module `packages/lib/src/typescript/lib/core/Focusable.ts` — **not**
exported from `core/index.ts`:

```typescript
/** CSS selector matching every element the framework treats as focusable. */
export const FOCUSABLE_SELECTOR: string;

/** Whether `handle` still resolves to a connected element. */
export function isLiveHandle(handle: Handle): boolean;

/** Enabled focusable elements inside `root`, in DOM order. */
export function findFocusable(root: Handle): Handle[];

/** `findFocusable(root)`, with a still-valid `recorded` handle promoted to the front. */
export function focusCandidates(root: Handle, recorded: Handle | undefined): Handle[];
```

Extended export on `packages/lib/src/typescript/lib/core/LayerManager.ts`, beside
`isTopmostInputLayer`:

```typescript
/** Whether any registered layer's dismiss mode is not `"manual"`, anywhere in the stack. */
export function hasActiveInputLayer(): boolean;
```

`Split` and `Border` each gain `implements PanelNavigator` plus the two new methods
(`recordFocus`, `resolveNeighbour`) and one private map. `getRevealElement` and
`revealDescendant` already exist on both per
[`plans/focus-reveal-on-navigation.md`](plans/focus-reveal-on-navigation.md); this
plan does not redeclare them. No public signature on either class changes, and
neither gains an options field.

New test-harness seeding in
[`tests/dom/TestDOM.ts`](packages/lib/tests/dom/TestDOM.ts#L1636):

```typescript
/** Seeds the handles `querySelectorAll(root, selector)` returns offline. */
export function setQuerySelectorAllResult(root: Handle, selector: string, handles: Handle[]): void;
```

---

## Internal Structure

### `core/Focusable.ts`

```typescript
export const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

// Resolving a released handle throws inside the seam; that counts as dead.
export function isLiveHandle(handle: Handle): boolean {
    try {
        return DOM.source.isConnected(handle);
    } catch {
        return false;
    }
}

export function findFocusable(root: Handle): Handle[] {
    return DOM.source.querySelectorAll(root, FOCUSABLE_SELECTOR)
        .filter(handle => !DOM.source.hasAttribute(handle, "disabled"));
}

export function focusCandidates(root: Handle, recorded: Handle | undefined): Handle[] {
    const focusable = findFocusable(root);

    if (recorded === undefined || !isLiveHandle(recorded) || !DOM.source.contains(root, recorded)) {
        return focusable;
    }

    return [recorded, ...focusable.filter(handle => handle !== recorded)];
}
```

The selector string is copied verbatim from `Dialog.ts` line 186, and the `disabled`
filter from `Dialog.getFocusable` line 1112, so dialog behaviour is unchanged.
`isLiveHandle` is the guard `FocusHistory` keeps privately at
[line 86](packages/lib/src/typescript/lib/core/FocusHistory.ts#L86); it is exported here
because both `focusCandidates` and `FocusReveal`'s own pruning need the same check.

### `core/PanelNavigation.ts` — the walk

```typescript
import { FocusReveal } from "~/core/FocusReveal.js";
import type { FocusRevealer } from "~/core/FocusReveal.js";

const ARROW_DIRECTIONS: Record<string, PanelDirection> = {
    ArrowUp: "north", ArrowDown: "south", ArrowLeft: "west", ArrowRight: "east",
};

/** Narrows a registered `FocusRevealer` to a `PanelNavigator` by its extra member. */
function isPanelNavigator(revealer: FocusRevealer): revealer is PanelNavigator {
    return "resolveNeighbour" in revealer;
}

function move(direction: PanelDirection): boolean {
    const origin = DOM.source.getActiveElement();

    if (origin === null) {
        return false;
    }

    // FocusReveal.containing() is outermost-first (reveal's own invariant); the
    // neighbour walk wants the nearest container to get first refusal, so it
    // reverses that order rather than re-deriving containment itself.
    const navigators = [...FocusReveal.containing(origin)].reverse().filter(isPanelNavigator);

    for (const navigator of navigators) {
        navigator.recordFocus(origin);

        for (const candidate of navigator.resolveNeighbour(origin, direction)) {
            FocusReveal.reveal(candidate);
            DOM.sink.focus(candidate, { preventScroll: true });

            if (DOM.source.getActiveElement() === candidate) {
                return true;
            }
        }
    }

    return false;
}
```

Worked walk, for a horizontal `Split` inside the `CENTER` of a `Border` inside a
vertical `Split`. The border has a north region but no south or east one, and focus sits
in the inner split's right-hand pane:

| Key | Inner Split (horizontal) | Border | Outer Split (vertical) | Outcome |
|---|---|---|---|---|
| `Ctrl+Shift+←` | left pane | *(not asked)* | *(not asked)* | inner split's left pane |
| `Ctrl+Shift+→` | declines — last pane | declines — no `EAST` region | declines — wrong axis | nothing moves |
| `Ctrl+Shift+↑` | declines — wrong axis | `NORTH` region | *(not asked)* | the border's north region |
| `Ctrl+Shift+↓` | declines — wrong axis | declines — no `SOUTH` region | pane below | outer split's lower pane |

### `core/PanelNavigation.ts` — the key handler

```typescript
function claimsKey(e: KeyboardEvent): boolean {
    if (!_enabled || ARROW_DIRECTIONS[e.code] === undefined) {
        return false;
    }

    if (e.ctrlKey !== !!_modifiers.ctrl || e.altKey !== !!_modifiers.alt ||
        e.shiftKey !== !!_modifiers.shift || e.metaKey !== !!_modifiers.meta) {
        return false;
    }

    return !LayerManager.hasActiveInputLayer();
}

function onKeyDown(e: KeyboardEvent): Event.ListenerResult {
    if (!claimsKey(e)) {
        return;
    }

    move(ARROW_DIRECTIONS[e.code]);

    return { stop: true, prevent: true };
}
```

The chord is consumed whenever `claimsKey` is true, whether or not focus moved, so a
widget standing down never leaves the key doing something else instead.

### `Split.resolveNeighbour`

```typescript
// Which way each direction steps along the split's own axis. A direction across
// the axis has no meaning here, so the pane index step is 0 and the split declines.
private directionStep(direction: PanelDirection): number {
    if (this._orientation === "horizontal") {
        return direction === "east" ? 1 : direction === "west" ? -1 : 0;
    }

    return direction === "south" ? 1 : direction === "north" ? -1 : 0;
}

// Index of the pane whose element contains `target`, or -1.
private paneIndexOf(panes: Component[], target: Handle): number {
    return panes.findIndex(pane => {
        const el = pane.getElement();

        return el !== undefined && DOM.source.contains(el, target);
    });
}

resolveNeighbour(target: Handle, direction: PanelDirection): Handle[] {
    const container = this.getContainer();
    const step      = this.directionStep(direction);

    if (!container || step === 0) {
        return [];
    }

    const panes = container.getLaidOutComponents();
    const from  = this.paneIndexOf(panes, target);
    const to    = from + step;

    if (from < 0 || to < 0 || to >= panes.length) {
        return [];
    }

    const el = panes[to].getElement();

    if (el === undefined) {
        return [];
    }

    return focusCandidates(el, this._lastFocus.get(panes[to]));
}
```

Opening the destination pane if it is collapsed is not this method's job — see *A
candidate is revealed before it is tried*. `getRevealElement()`
(`this.getContainer()?.getElement() ?? null`) and `revealDescendant()` (the
collapse-clearing body) are exactly what
[`focus-reveal-on-navigation.md`](plans/focus-reveal-on-navigation.md) step 6 already
adds to `Split`; this plan does not redeclare either.

`getLaidOutComponents()` is the pane list `isPaneCollapsed` / `setPaneCollapsed` already
index into ([`Split.ts:285`](packages/lib/src/typescript/lib/layout/Split.ts#L285)), and
it holds panes only — gutters are appended straight into the container element
([`Split.ts:1464`](packages/lib/src/typescript/lib/layout/Split.ts#L1464)), never added
as children.

`_lastFocus` is `private _lastFocus: Map<Component, Handle> = new Map();`, cleared in
`detach()`. Keying by pane `Component` matches `_sizes`, `_collapsed`, and `_weights`,
which are keyed the same way and cleaned up the same way.[^lastfocus]

### `Border.resolveNeighbour`

The region a direction leads to, by the region focus is in now. A blank cell means the
border declines and the walk widens.

| From \ direction | `north` | `south` | `west` | `east` |
|---|---|---|---|---|
| `CENTER` | `NORTH` | `SOUTH` | `WEST` | `EAST` |
| `NORTH` | — | `CENTER` | — | — |
| `SOUTH` | `CENTER` | — | — | — |
| `WEST` | `NORTH` | `SOUTH` | — | `CENTER` |
| `EAST` | `NORTH` | `SOUTH` | `CENTER` | — |

`WEST` and `EAST` reach `NORTH` and `SOUTH` directly because those regions span the
full width above and below them. The border also declines when the mapped region has no
component, or its component is not displayed.

The table is a module-level constant
`const BORDER_NEIGHBOUR: Record<Placement, Partial<Record<PanelDirection, Placement>>>`,
with a blank cell above meaning the key is simply absent.

```typescript
// The placement whose region element contains `target`, or null.
private regionOf(target: Handle): Placement | null {
    for (const placement of [Placement.CENTER, Placement.NORTH, Placement.SOUTH,
                             Placement.WEST, Placement.EAST]) {
        const el = this.getRegionComponent(placement)?.getElement();

        if (el !== undefined && DOM.source.contains(el, target)) {
            return placement;
        }
    }

    return null;
}

resolveNeighbour(target: Handle, direction: PanelDirection): Handle[] {
    const from = this.regionOf(target);
    const to   = from === null ? undefined : BORDER_NEIGHBOUR[from][direction];
    const next = to === undefined ? null : this.getRegionComponent(to);
    const el   = next?.getElement();

    if (to === undefined || !next || !next.isDisplayed() || el === undefined) {
        return [];
    }

    return focusCandidates(el, this._lastFocus.get(to));
}
```

Same split as above: opening a collapsed destination region is `revealDescendant`'s
job — already added to `Border` by
[`focus-reveal-on-navigation.md`](plans/focus-reveal-on-navigation.md) step 4 — not
this method's.

`_lastFocus` here is `private _lastFocus: Map<Placement, Handle> = new Map();`, cleared
in `detach()`.

`recordFocus(target)` is the mirror image in both managers: find the pane or region
whose element contains `target` — `paneIndexOf` in `Split`, `regionOf` in `Border` —
and store `target` against it.

---

## Ordered Implementation Steps

1. **Create `core/Focusable.ts`.** Move `FOCUSABLE_SELECTOR` verbatim from
   [`Dialog.ts:186`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L186) and add
   `isLiveHandle`, `findFocusable`, and `focusCandidates` as shown in
   *Internal Structure*. Do **not** export any of them from `core/index.ts`.
   Verify: `npm run typecheck`.

2. **Point `Dialog` at the shared selector.** Delete the local const and add
   `import { FOCUSABLE_SELECTOR } from "~/core/Focusable.js";`. Leave `getFocusable`
   and `onKeyDown` otherwise untouched.
   Verify: `grep -rn "FOCUSABLE_SELECTOR *=" packages/lib/src/` — exactly one match, in
   `core/Focusable.ts`. `npm -w packages/lib exec vitest run tests/overlay` — green.

3. **Add root-scoped `querySelectorAll` seeding to the offline DOM, and make
   `hasAttribute` genuinely modelled.** In
   [`tests/dom/TestDOM.ts`](packages/lib/tests/dom/TestDOM.ts#L1244), back
   `querySelectorAll` with a `Map` keyed by root + selector, seeded by a new exported
   `setQuerySelectorAllResult(root, selector, handles)`. Mirror the existing
   `setQuerySelectorResult` / `_bySelector` pair at
   [lines 123](packages/lib/tests/dom/TestDOM.ts#L123) and
   [1636](packages/lib/tests/dom/TestDOM.ts#L1636); an unseeded query still returns
   `[]`.

   Also add an `attributes: Record<string, string>` field (default `{}`) to
   `HandleStub` ([`TestDOM.ts:61`](packages/lib/tests/dom/TestDOM.ts#L61)), and fold
   `patch.removeAttr` then `patch.setAttr` onto it inside `RecordingDOMSink.apply`
   ([`TestDOM.ts:418`](packages/lib/tests/dom/TestDOM.ts#L418)), mirroring the
   existing `foldGeometry` style-fold at
   [`TestDOM.ts:454`](packages/lib/tests/dom/TestDOM.ts#L454). Change
   `ModelledDOMSource.hasAttribute` / `getAttribute` — currently hardcoded stubs at
   [`TestDOM.ts:1342`](packages/lib/tests/dom/TestDOM.ts#L1342) and
   [`1346`](packages/lib/tests/dom/TestDOM.ts#L1346) that ignore both arguments and
   always return `false` / `null` — to read from `stub.attributes` instead. This is
   what makes `core/Focusable.ts`'s `disabled` filter — and
   `framework-focus-traversal.md`'s identical filter, which reuses this same seam —
   genuinely offline-testable rather than vacuously always-true.
   Verify: `npm test` — the whole suite still passes, since no existing test seeds a
   `querySelectorAll` result; a new case asserts `hasAttribute` reflects a `setAttr`
   write and a subsequent `removeAttr` write in the same patch.

4. **Add `LayerManager.hasActiveInputLayer()`.** In
   [`core/LayerManager.ts`](packages/lib/src/typescript/lib/core/LayerManager.ts#L374),
   export a new function beside `isTopmostInputLayer`:
   `export function hasActiveInputLayer(): boolean { return topmostInputLayer() !== null; }`.
   It reuses the existing private `topmostInputLayer` (line 345) — no new algorithm,
   just a public entry point for the whole-stack question `claimsKey` needs.
   Verify: `npm run typecheck`; a test in `tests/overlay/LayerManager.test.ts`
   registering a `"click-outside"` layer, then a `"manual"` layer on top of it (so
   the manual one is topmost), asserting `hasActiveInputLayer()` is `true`
   throughout — and `false` once the `"click-outside"` layer is unregistered,
   leaving only the `"manual"` layer.

5. **Create `core/PanelNavigation.ts` with everything except the listener.** The types,
   `claimsKey` (using `LayerManager.hasActiveInputLayer()`), `move` (using
   `FocusReveal.containing()` and the `isPanelNavigator` guard), `configure`,
   `isEnabled`. `enable` / `disable` only flip `_enabled` for now. Import `FocusReveal`
   and the `FocusRevealer` type from `~/core/FocusReveal.js`. Export `PanelNavigation`,
   `PanelNavigator`, `PanelDirection`, `PanelNavigationOptions`, and
   `PanelNavigationModifiers` from
   [`core/index.ts`](packages/lib/src/typescript/lib/core/index.ts#L43), beside the
   `FocusHistory` lines.
   Verify: `npm run typecheck`; start `tests/unit/core/PanelNavigation.test.ts` with two
   hand-written `PanelNavigator` stubs registered via `FocusReveal.register`, asserting
   the innermost-first order and the pruning rules (Expected Behaviour 6–14), then
   `npm -w packages/lib exec vitest run tests/unit/core`.

6. **Wire the keydown handler.** `enable()` / `disable()` add and remove
   `Event.addViewportListener(_owner, "keydown", onKeyDown)` against a module-level
   `_owner: Component` sentinel, following
   [`FocusHistory.enable`](packages/lib/src/typescript/lib/core/FocusHistory.ts#L248)
   line for line. `onKeyDown` must be a named module-level function, per
   ARCHITECTURE.md's named-listener rule.
   Verify: extend `tests/unit/core/PanelNavigation.test.ts` with synthetic `keydown`
   events dispatched through the window, as
   [`tests/unit/core/FocusHistory.test.ts`](packages/lib/tests/unit/core/FocusHistory.test.ts)
   does, covering Expected Behaviour 1–5 and 15; then
   `npm -w packages/lib exec vitest run tests/unit/core`.

7. **Make `Split` a `PanelNavigator`.** Add `implements PanelNavigator`, the
   `_lastFocus` map, `paneIndexOf`, `directionStep`, and `resolveNeighbour` (per
   *Internal Structure* — no collapse toggle here), importing `focusCandidates` from
   `~/core/Focusable.js`. `getRevealElement`, `revealDescendant`, and the
   `attach` / `detach` registration through `FocusReveal.register` / `unregister`
   already exist once
   [`focus-reveal-on-navigation.md`](plans/focus-reveal-on-navigation.md) step 6 is
   implemented — do **not** add a second registration call. In the existing
   [`detach`](packages/lib/src/typescript/lib/layout/Split.ts#L1278), also clear
   `this._lastFocus`.
   Verify: `npm -w packages/lib exec vitest run tests/component/layout` — a new
   `Split.panelNavigation.test.ts` covers Expected Behaviour 16, 27–34, and the
   existing `Split.test.ts` stays green.

8. **Make `Border` a `PanelNavigator`.** Same shape: `implements PanelNavigator`, the
   `_lastFocus` map keyed by `Placement`, `regionOf`, the module-level
   `BORDER_NEIGHBOUR` table, and `resolveNeighbour`. `getRevealElement`,
   `revealDescendant`, and the `attach` / `detach` registration through
   `FocusReveal.register` / `unregister` already exist once
   [`focus-reveal-on-navigation.md`](plans/focus-reveal-on-navigation.md) step 4 is
   implemented — do **not** add a second registration call. In the existing
   [`detach`](packages/lib/src/typescript/lib/layout/Border.ts#L1146), also clear
   `this._lastFocus`. `getRegionComponent` is private on `Border` and is called from
   inside the class, so its visibility does not change.
   Verify: `npm -w packages/lib exec vitest run tests/component/layout` — a new
   `Border.panelNavigation.test.ts` covers Expected Behaviour 35–39 and the existing
   `Border.test.ts` stays green.

9. **Add the `claimsKey` guard to the ten arrow-key handlers** listed in
   *Architecture Decisions*, each as the handler's first statement:
   `if (PanelNavigation.claimsKey(e)) { return; }` — except
   [`AbstractSelectableList.handleNavigationKey`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L2093),
   which returns `boolean` and needs `if (PanelNavigation.claimsKey(e)) { return false; }`.
   Add `import { PanelNavigation } from "~/core/PanelNavigation.js";` to each file.
   Change nothing else in those handlers — in particular, leave the three inline
   closures inline.
   Verify: `grep -rn "PanelNavigation\.claimsKey" packages/lib/src/` — exactly ten
   matches. Tests covering Expected Behaviour 17–26 in each handler's existing test
   file (`Body.test.ts`, a `TreeBody`-mode case in the same file, `Tree.test.ts`,
   the `List`/`MultiSelectList` keyboard tests, `ToolBar.test.ts`, `TabBar.test.ts`,
   `ButtonGroup.test.ts`, `Accordion.manager.test.ts`, `Slider.test.ts`,
   `NumberSpinner.test.ts`). `npm test` — no existing widget test regresses, since
   `claimsKey` is false while the service is disabled.

10. **Enable it in the demo app.** Add `PanelNavigation.enable();` to
    [`packages/lib/src/typescript/main.ts`](packages/lib/src/typescript/main.ts#L45),
    beside the existing `FocusHistory.enable()`.
    Verify: the manual smoke tests in *Verification*.

11. **Document.** Add a "Directional panel navigation" section to
    [`docs/concepts/accessibility.md`](packages/lib/docs/concepts/accessibility.md#L51)
    after "Keyboard navigation: RovingTabIndex", and a `### Core` entry under `## Added`
    in [`docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md#L8),
    placed after `### Layouts` to match
    [`0.9.0.md`](packages/lib/docs/reference/changelog/0.9.0.md#L359).
    Verify: `npm run docs:api` — zero warnings; `npm run build:docs` — clean.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/core/PanelNavigation.ts` |
| Create | `packages/lib/src/typescript/lib/core/Focusable.ts` |
| Create | `packages/lib/tests/unit/core/PanelNavigation.test.ts` |
| Create | `packages/lib/tests/component/layout/Split.panelNavigation.test.ts` |
| Create | `packages/lib/tests/component/layout/Border.panelNavigation.test.ts` |
| Modify | `packages/lib/src/typescript/lib/core/index.ts` — export `PanelNavigation` + its types |
| Modify | `packages/lib/src/typescript/lib/core/LayerManager.ts` — export `hasActiveInputLayer()` |
| Modify | `packages/lib/src/typescript/lib/layout/Split.ts` — `PanelNavigator` members, `_lastFocus` clear in `detach` |
| Modify | `packages/lib/src/typescript/lib/layout/Border.ts` — `PanelNavigator` members, `_lastFocus` clear in `detach` |
| Modify | `packages/lib/src/typescript/lib/overlay/Dialog.ts` — import the shared selector |
| Modify | `packages/lib/src/typescript/lib/component/table/Body.ts` — `claimsKey` guard |
| Modify | `packages/lib/src/typescript/lib/component/table/TreeBody.ts` — `claimsKey` guard |
| Modify | `packages/lib/src/typescript/lib/component/tree/Tree.ts` — `claimsKey` guard |
| Modify | `packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts` — `claimsKey` guard |
| Modify | `packages/lib/src/typescript/lib/component/menubar/ToolBar.ts` — `claimsKey` guard |
| Modify | `packages/lib/src/typescript/lib/component/container/TabBar.ts` — `claimsKey` guard |
| Modify | `packages/lib/src/typescript/lib/overlay/ButtonGroup.ts` — `claimsKey` guard |
| Modify | `packages/lib/src/typescript/lib/layout/Accordion.ts` — `claimsKey` guard |
| Modify | `packages/lib/src/typescript/lib/component/input/Slider.ts` — `claimsKey` guard |
| Modify | `packages/lib/src/typescript/lib/component/input/NumberSpinner.ts` — `claimsKey` guard |
| Modify | `packages/lib/src/typescript/main.ts` — `PanelNavigation.enable()` |
| Modify | `packages/lib/tests/dom/TestDOM.ts` — `setQuerySelectorAllResult` + genuinely modelled `hasAttribute`/`getAttribute` |
| Modify | `packages/lib/docs/concepts/accessibility.md` — new section |
| Modify | `packages/lib/docs/reference/changelog/next.md` — `### Core` entry |

---

## Expected Behaviour

Unit-testable offline. `TestDOM` models `contains`, `focus`, `getActiveElement`,
`isConnected`, and window-level `keydown` dispatch, and step 3 adds seeded
`querySelectorAll` results.

**The service**

1. `claimsKey` returns false for every key while `isEnabled()` is false.
2. `claimsKey` returns true for `Ctrl+Shift+ArrowRight` and false for a bare
   `ArrowRight`, `Shift+ArrowRight`, and `Ctrl+ArrowRight` once enabled with defaults.
3. After `configure({ modifiers: { alt: true } })`, `Alt+ArrowRight` claims the key and
   `Ctrl+Shift+ArrowRight` does not.
4. A claimed `keydown` calls both `preventDefault()` and `stopPropagation()`, even when
   no navigator moved focus. An unclaimed one calls neither.
5. `claimsKey` returns false while any registered layer's dismiss mode is not
   `"manual"` — including one that is not the topmost-registered layer, e.g. a
   `"click-outside"` dropdown left open underneath a `"manual"` window registered
   afterward — and returns true while every currently registered layer (if any) is
   `"manual"`.
6. `move` visits containing navigators innermost first — `FocusReveal.containing()`'s
   outermost-first result, reversed — and stops at the first one returning a
   non-empty candidate array.
7. `move` calls `recordFocus(origin)` on every `PanelNavigator` it visits, including
   ones that then decline. A registered `FocusRevealer` that does not also implement
   `PanelNavigator` (e.g. a `Tab` or `Panel` under `focus-reveal-on-navigation.md`
   alone) is skipped entirely — never asked to resolve or record.
8. A registered navigator whose element is connected but does not contain the focused
   element is never asked to resolve.
9. A registered navigator whose element is rendered and then disconnected is dropped
   from `FocusReveal`'s registry during a `move` and never consulted again.
10. A registered navigator whose `getRevealElement()` returns `null` is skipped and
    **stays** registered, so a manager attached before its container renders still works
    later.
11. `move` returns false and leaves focus alone when nothing contains the active
    element, and when every containing navigator declines.
12. `move` returns false when there is no active element.
13. When the first candidate refuses focus (`getActiveElement()` unchanged after the
    `focus` call), `move` calls `FocusReveal.reveal()` on the next candidate, tries it,
    and returns true once one takes it.
14. Every service-driven focus call passes `{ preventScroll: true }`.
15. `disable()` leaves a subsequent chord entirely unhandled and preserves
    `FocusReveal`'s registry.
16. A candidate that sits inside both a collapsed pane and, beneath that, an inactive
    `Tab` page is revealed all the way down — the tab selected and the pane expanded —
    by the single `FocusReveal.reveal(candidate)` call `move` makes before testing it,
    and focus lands on it in that same `move` call.

**The ten guarded handlers**

Offline-testable through each handler's own existing test harness.

17. With `claimsKey()` true, [`Body.onKeyDown`](packages/lib/src/typescript/lib/component/table/Body.ts#L2707)'s
    own row/column/edit navigation does not fire (no `renderWindow()` call, no
    selection change); with `claimsKey()` false, it behaves exactly as before.
    Verifiable in `tests/component/table/Body.test.ts`.
18. Same pair for [`TreeBody.onKeyDown`](packages/lib/src/typescript/lib/component/table/TreeBody.ts#L805) —
    no branch expand/collapse when claimed. Verifiable alongside `Body.test.ts`'s
    tree-mode cases.
19. Same pair for [`Tree._onKeyDown`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1049) —
    no selection move when claimed. Verifiable in `tests/component/tree/Tree.test.ts`.
20. Same pair for
    [`AbstractSelectableList.handleNavigationKey`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L2093) —
    returns `false` (not `true`) and does not call `moveFocus` when claimed; existing
    `List` / `MultiSelectList` keyboard tests stay green when unclaimed.
21. Same pair for the `ToolBar` `_onKeyDown` closure
    ([`ToolBar.ts:187`](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L187)) —
    no `RovingTabIndex.moveNext` / `movePrev` call when claimed. Verifiable in
    `tests/component/menubar/ToolBar.test.ts`.
22. Same pair for [`TabBar.onToolbarKeyDown`](packages/lib/src/typescript/lib/component/container/TabBar.ts#L3297) —
    no active-tab change when claimed. Verifiable in
    `tests/component/container/TabBar.test.ts`.
23. Same pair for the `ButtonGroup` inline `keydown` closure
    ([`ButtonGroup.ts:282`](packages/lib/src/typescript/lib/overlay/ButtonGroup.ts#L282)) —
    no roving-focus move when claimed.
24. Same pair for [`Accordion.onHeaderKeyDown`](packages/lib/src/typescript/lib/layout/Accordion.ts#L2448) —
    no header focus move when claimed. Verifiable in
    `tests/component/layout/Accordion.manager.test.ts`.
25. Same pair for the `Slider` inline `keydown` closure
    ([`Slider.ts:591`](packages/lib/src/typescript/lib/component/input/Slider.ts#L591)) —
    no value change when claimed.
26. Same pair for [`NumberSpinner.onKeyDown`](packages/lib/src/typescript/lib/component/input/NumberSpinner.ts#L505) —
    no `applyValue` call when claimed. Verifiable in
    `tests/component/input/NumberSpinner.test.ts`.

**`Split`**

27. Horizontal split, focus in pane 1 of 3: `east` yields pane 2's candidates, `west`
    yields pane 0's, `north` and `south` yield an empty array.
28. Vertical split: `south` / `north` step the pane index; `east` / `west` yield empty.
29. `east` from the last pane and `west` from the first both yield an empty array.
30. With nothing recorded, the candidate array is the destination pane's focusable
    elements in DOM order.
31. After focus has been recorded in the destination pane and moved away, the recorded
    handle is first in the array and the remaining focusables follow it without a
    duplicate.
32. A recorded handle that is no longer connected, or is no longer inside that pane, is
    dropped from the array.
33. `resolveNeighbour` returns a non-empty array for a still-collapsed destination pane
    **without** changing `isPaneCollapsed(to)` — expanding it is exercised by case 16
    above, not by this method.
34. `detach()` clears the recorded-focus map. Unregistering from `FocusReveal` is
    exercised by `focus-reveal-on-navigation.md`'s own `Split` tests, not duplicated
    here.

**`Border`**

35. Every row of the region table in *Internal Structure* — including the blanks, which
    yield an empty array.
36. A mapped region with no component, or whose component reports `isDisplayed()` false,
    yields an empty array.
37. `resolveNeighbour` returns a non-empty array for a still-collapsed destination
    region **without** changing `isRegionCollapsed(to)` — same split as `Split`'s case
    33.
38. Recording and recall behave as in cases 30–32, keyed by `Placement`.
39. `detach()` clears the recorded-focus map. Unregistering from `FocusReveal` is
    exercised by `focus-reveal-on-navigation.md`'s own `Border` tests, not duplicated
    here.

**Manual verification only** — real focus, real geometry, and the live browser are
outside the offline harness:

- `Ctrl+Shift+→` from the left pane of the demo app's split panel lands on a real
  control in the right pane, and `Ctrl+Shift+←` returns to the exact control that was
  focused there before, not the first one.
- Navigating into a collapsed pane and a collapsed border region expands it and lands
  focus inside, with the collapse animation catching up behind the focus move.
- `Ctrl+Shift+↑` / `↓` inside a `Table`, `Tree`, and `List` in a pane moves between
  panes and does **not** also move the row selection or extend a range.
- `Ctrl+Shift+←` / `→` inside a `TextArea` and a `CodeEditor` in a pane moves between
  panes and does not extend a word selection.
- The chord inside a `ToolBar`, a `TabBar`, a `ButtonGroup`, an `Accordion` header, a
  `Slider`, and a `NumberSpinner` moves between panes and leaves each widget's own
  state alone — no roving-focus move, no slider or spinner value change. Their bare
  arrow keys still work exactly as before.
- With a combo-box dropdown open, `Ctrl+Shift+↓` still moves the dropdown's highlight
  and does not move between panes.
- Panes navigate normally inside an `AbstractWindow`, and the chord is inert inside a
  modal `Dialog`.
- Navigating into a pane whose first focusable element sits inside an inactive `Tab`
  page still lands focus on a visible control.
- A `Dialog` still traps `Tab` at both ends after step 2.

---

## Verification

- `npm run typecheck` and `npm run lint` — the `local/no-raw-dom` rule stays clean
  only if every focus, `activeElement`, and containment read in the two new modules
  goes through `DOM.sink` / `DOM.source`.
- `npm test` — the three new test files plus the whole existing suite.
- `grep -rn "FOCUSABLE_SELECTOR *=" packages/lib/src/` — exactly one definition, in
  `core/Focusable.ts`.
- `grep -rn "PanelNavigation\.claimsKey" packages/lib/src/` — exactly ten call sites,
  one per guarded handler.
- `grep -rn "addEventListener\|\.focus(\|activeElement" packages/lib/src/typescript/lib/core/PanelNavigation.ts packages/lib/src/typescript/lib/core/Focusable.ts` —
  every hit is a `DOM.sink` / `DOM.source` call.
- `npm run docs:api` — zero warnings. The local `docs/api` directory is gitignored and
  goes stale, so run it rather than trusting an old build.
- `npm run docs:llms:check` — still green; a `namespace` is not a concrete class, so the
  coverage manifest needs no entry.
- `npm run build:docs` — clean.
- Manual smoke test: `npm run dev`, http://localhost:8015 — the split/border demo panel,
  the table and tree demo panels, the editor panel, a dialog, and a combo box, against
  the manual list in *Expected Behaviour*.

---

## Documentation Impact

- `PanelNavigation`, `PanelNavigator`, `PanelDirection`, `PanelNavigationOptions`, and
  `PanelNavigationModifiers` are exported from
  [`core/index.ts`](packages/lib/src/typescript/lib/core/index.ts#L43), so TypeDoc
  renders them. Give the namespace and each exported function a `@category Core` JSDoc
  block, as `FocusHistory` does.
- `LayerManager.hasActiveInputLayer()` is a new export on an already-public class; give
  it a `@category Core` JSDoc block matching `isTopmostInputLayer`'s existing style. No
  new doc page or sidebar entry — it is a small utility addition, not a
  consumer-facing feature.
- `core/Focusable.ts` is not exported from the barrel and so is not documented. Per
  [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md), public JSDoc must not `{@link}` it —
  describe the first-focusable fallback in prose instead of naming `findFocusable`.
- [`docs/concepts/accessibility.md`](packages/lib/docs/concepts/accessibility.md#L51)
  gains a "Directional panel navigation" section after "Keyboard navigation:
  RovingTabIndex", covering `enable()`, the default chord, the stand-down rules, and the
  obligation on any new arrow-key handler to call `claimsKey`. Its **Testing** section's
  keyboard-only bullet references the new service.
- No sidebar change: `/concepts/accessibility` is already listed in
  [`packages/docs/src/content/pages.ts:155`](packages/docs/src/content/pages.ts#L155).
- No `llms.txt` change: that file is generated from `scripts/llms/manifest.data.mjs`,
  whose coverage check only tracks concrete classes.
- No migration note: the service is opt-in and every guard is inert while it is
  disabled, so no existing app's behaviour changes.

---

## Potential Challenges

- **A future arrow-key handler forgets the guard.** Note the obligation in
  `PanelNavigation`'s namespace JSDoc and in the accessibility page, and keep the
  ten-call-site grep in `## Verification` as the check.
- **The chord is a text-selection gesture on Windows and Linux.** `Ctrl+Shift+←` / `→`
  extends a word selection in an `<input>`, `<textarea>`, or an embedded editor. The
  service's `preventDefault` plus `stopPropagation` suppresses it. Apps that value the
  editing gesture more pass different `modifiers` to `enable()`.
- **A collapse animation is still running when focus lands.** `setPaneCollapsed` and
  `setRegionCollapsed` animate through `runCollapse` rather than snapping. A clipped
  element is still focusable, so focus lands immediately and the reveal catches up
  visually. Listed as manual-verify.
- **The first focusable element may be inside an inactive `Tab` page**, which is hidden
  with `visibility: hidden` and cannot take focus. Resolved: `move` calls
  `FocusReveal.reveal(candidate)` before every attempt, which selects the tab (and any
  other nesting between the candidate and its pane or region) before the focus call —
  see *A candidate is revealed before it is tried* and Expected Behaviour 16. The
  try-the-next-candidate loop still runs for the rarer case a revealed candidate
  refuses focus for some other reason.
- **`FocusReveal.register` can run before the container renders.** `attach` may
  precede first render, so `getRevealElement()` returns `null` for a while. `FocusReveal`
  skips such a revealer without dropping it — see Expected Behaviour 10.
- **A pane removed from a `Split` leaves a recorded handle behind.** The entry is keyed
  by the pane `Component` and is only cleared on `detach()`, exactly as `_sizes`,
  `_collapsed`, and `_weights` already are.

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/FocusHistory.ts`](packages/lib/src/typescript/lib/core/FocusHistory.ts) —
  **the precedent for the service.** Namespace singleton, `_owner` sentinel (line 65),
  viewport `keydown` listener (line 260), opt-in `enable` (line 248), `configure`
  (line 296), the `isLive` stale-handle guard (line 86), and the `LayerManager` check
  (line 219). Copy this shape.
- [`packages/lib/src/typescript/lib/core/FocusReveal.ts`](packages/lib/src/typescript/lib/core/FocusReveal.ts) —
  **the registry this plan extends, not duplicates.** `FocusRevealer`, `register` /
  `unregister`, and `containing` (the containment + outermost-first ordering
  `PanelNavigation.move` reverses).
- [`packages/lib/src/typescript/lib/core/LayerManager.ts`](packages/lib/src/typescript/lib/core/LayerManager.ts) —
  `register` / `unregister` (lines 220, 266), the private `topmostInputLayer` walk
  (line 345) and its public `isTopmostInputLayer` (line 374) — this plan adds
  `hasActiveInputLayer` beside it. `LayerDismissMode` (line 23).
- [`packages/lib/src/typescript/lib/core/Event.ts`](packages/lib/src/typescript/lib/core/Event.ts) —
  `addViewportListener` (line 790), `applyDisposition` (line 197), and the two separate
  window capture listeners (lines 248 and 350) that make the widget guard necessary.
- [`packages/lib/src/typescript/lib/core/DOM.ts`](packages/lib/src/typescript/lib/core/DOM.ts) —
  the seam: `focus(handle, { preventScroll })` (line 608), `contains` (line 1264),
  `querySelectorAll` (line 1282), `hasAttribute` (line 1472), `isConnected` (line 1153),
  `getActiveElement` (line 1179).
- [`packages/lib/src/typescript/lib/layout/Split.ts`](packages/lib/src/typescript/lib/layout/Split.ts) —
  `isPaneCollapsed` (line 279), `setPaneCollapsed` (line 399), `getOrientation`
  (line 444), the `Map<Component, …>` pane state (lines 111–127), `detach` (line 1278),
  and the raw gutter append (line 1464).
- [`packages/lib/src/typescript/lib/layout/Border.ts`](packages/lib/src/typescript/lib/layout/Border.ts) —
  `getRegionComponent` (line 225), `isRegionCollapsed` (line 241), `setRegionCollapsed`
  (line 260), `detach` (line 1146).
- [`packages/lib/src/typescript/lib/overlay/Dialog.ts`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L186) —
  the selector being moved, `getFocusable` (line 1104) as the model for
  `findFocusable`, and `isTopmostInputLayer(this)` at `onKeyDown` (line 1134) — the
  only other call site of that function in the library.
- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) —
  `getElement` (line 1254, returns `Handle | undefined`), `getLaidOutComponents`
  (line 6794), `isDisplayed`.
- [`packages/lib/tests/unit/core/FocusHistory.test.ts`](packages/lib/tests/unit/core/FocusHistory.test.ts) —
  the offline harness style: `installTestDOM`, `makeEvent`, `setConnected`, window
  `keydown` dispatch, `DismissableLayer` stubs, and the `afterEach` teardown a module
  singleton needs.
- [`packages/lib/tests/dom/TestDOM.ts`](packages/lib/tests/dom/TestDOM.ts) —
  `contains` (line 1223), `querySelectorAll` (line 1244), `setQuerySelectorResult`
  (line 1636) as the seeding pattern to mirror.
- [`plans/focus-reveal-on-navigation.md`](plans/focus-reveal-on-navigation.md) — **the
  plan this one depends on and extends.** Read `FocusRevealer`, `FocusReveal.register` /
  `unregister` / `containing` / `reveal`, and `Split` / `Border`'s `revealDescendant`
  before starting steps 7–8.
- [`plans/framework-focus-traversal.md`](plans/framework-focus-traversal.md) — the
  deferred Tab-traversal plan this one must not collide with (different key, different
  arbitration shape — see its own `## Architecture Decisions`).
- [ARCHITECTURE.md](ARCHITECTURE.md) — DOM seam rule, named-listener rule, the
  disposition protocol.

---

## Non-Goals

- **`Accordion` and `Tab` as navigable containers.** The `PanelNavigator` interface is
  container-agnostic, so either can adopt it later by implementing the two extra
  members and registering. Neither does so here — the request was `Split` and
  `Border`, and each extra container type brings its own direction table to design and
  test. `Accordion` is still edited in step 9, but only for the `claimsKey` guard on
  its header keys.
- **`Tab` / `Shift+Tab` traversal.** Owned by
  [`plans/framework-focus-traversal.md`](plans/framework-focus-traversal.md), which is
  deferred. The two features share no key.
- **A global element→`Component` map.** Containment against `FocusReveal`'s registered
  revealers replaces it, as
  [`plans/focus-reveal-on-navigation.md`](plans/focus-reveal-on-navigation.md) also
  requires.
- **Any new `ComponentOptions` field.** Nothing here is configured per component, so no
  row is added to
  [`tests/component/default-options-fallback.test.ts`](packages/lib/tests/component/default-options-fallback.test.ts).
- **Making a pane focusable when it holds nothing focusable.** Such a pane is skipped
  and the walk widens.
- **Navigating inside a modal `Dialog` or `Drawer`.** The service stands down for them,
  matching `FocusHistory`.
- **Enabling the service by default.** Only the demo app calls `enable()`.

---

## Notes

[^singleton]: Three shapes were weighed. A per-`Component` opt-in cannot work because
    the destination of a move is decided by a container the focused component knows
    nothing about. Putting the whole feature on `LayoutManager` was rejected because
    the walk is a document-wide concern that no single manager can run — a manager
    would still need a registry to find its ancestors. The namespace singleton matches
    the two facilities that already solve document-wide keyboard concerns,
    `FocusHistory` and `LayerManager`, and it is the only one of the three where
    `enable()` makes the entire feature inert by default.

[^containment]: `plans/focus-reveal-on-navigation.md` records that no element→`Component`
    map exists and that adding one is out of bounds. This plan reuses that plan's
    `FocusReveal` registry rather than repeating the constraint in a second one — see
    *the merge* footnote below. The registry is a `Set`, and every revealer in it that
    also contains the focused element is on that element's DOM ancestor chain, so the
    set of matches is always totally ordered by containment — the same invariant
    `FocusReveal.containing` already establishes for `reveal`.

[^chord]: `Ctrl+Shift` + arrow is the user's own suggestion and it is free of OS and
    browser bindings on all three major platforms: Windows reserves `Win`+arrow for
    snapping, GNOME reserves `Super`+arrow for tiling and `Ctrl+Alt`+arrow for
    workspaces, macOS reserves `Ctrl`+arrow for spaces, and no browser binds
    `Ctrl+Shift`+arrow. `Alt`+arrow was rejected because `Alt+←` / `Alt+→` is browser
    history. `Ctrl+Alt`+arrow was rejected for the GNOME workspace collision, which
    would hit this project's own Linux development environment. The one real cost is
    in-page: `Ctrl+Shift+←` / `→` extends a word selection in text inputs on Windows and
    Linux. Declining inside text-editing surfaces was rejected as the fix, because
    moving focus out of an editor pane is the feature's primary use case — an editor
    app is exactly where pane navigation earns its keep. Making the modifier set
    configurable, rather than the whole per-direction combo, keeps the option surface
    to the one field that actually varies; `FocusHistory` needs two independent combos
    because its two directions are not a natural key pair, while four arrows are.

[^guard]: Two alternatives were rejected. Calling `stopImmediatePropagation()` from the
    viewport handler would suppress the framework's own dispatcher, but only when the
    viewport window listener happens to have been installed before the component one —
    `Event` installs each lazily on first registration, so the order depends on app
    startup sequence — and the disposition protocol has no way to express it.
    Restructuring `Event` so one window listener runs the viewport phase before the
    targeted phase, with a shared stop, would fix the ordering properly, but it changes
    dispatch semantics for every existing viewport listener in the library and belongs
    in its own plan. The explicit predicate is grep-able, inert while the service is
    disabled, and puts the arbitration where a reader of the widget can see it — the
    same shape as the `LayerManager.isTopmostInputLayer(this)` guard already written
    into [`Dialog.onKeyDown`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L1134),
    the only other call site of that function in the library.

[^layers]: `FocusHistory` suppresses its accelerator only for `"modal"`
    (`FocusHistory.ts` line 221), checking only the very top of the stack — safe there
    because `FocusHistory`'s accelerator has no widget-guard equivalent to fight over.
    This service needs a wider net for two reasons: the widgets it must not fight — a
    combo-box list, an autocomplete dropdown, a calendar, an open menu — are all
    `"click-outside"` layers, and their arrow handling is precisely what a user
    pressing arrows inside them expects; and checking only the topmost *registered*
    layer is wrong once a `"manual"` layer (a non-modal `Drawer`, a `Popover` with
    `dismissOn: "manual"`, an `AbstractWindow`) can register on top of one of those —
    e.g. a window raised while a dropdown is still open elsewhere in the app.
    `LayerManager.hasActiveInputLayer()` answers the whole-stack question correctly by
    reusing the module's own `topmostInputLayer` walk, which already treats a
    `"manual"` layer as decorative and keeps looking beneath it rather than stopping
    there. Excluding every `"manual"` layer this way is what keeps the feature alive
    where it matters most: `AbstractWindow` reports `"manual"` (`AbstractWindow.ts`
    line 840), so a desktop-style app full of windowed splits navigates normally.

[^land]: Whether focus actually landed is the operational success signal, borrowed from
    `plans/focus-reveal-on-navigation.md`'s skip-if-unrevealable loop. It removes the
    need to classify candidates: a `visibility: hidden` element inside an inactive `Tab`
    page silently refuses focus, and the loop moves to the next candidate rather than
    the service having to know what `Tab` is. Checking `getActiveElement()` after the
    `focus` call costs one seam read per attempt, and there is normally exactly one
    attempt.

[^focusable]: A third home was needed because both consumers are wrong owners. Leaving
    the selector in `overlay/Dialog.ts` would make a `core/` service import from
    `overlay/`; putting it in `core/PanelNavigation.ts` would make a panel-navigation
    module the authority on what "focusable" means framework-wide. `core/Focusable.ts`
    is also the neutral home the deferred `plans/framework-focus-traversal.md` needs:
    its Architecture Decisions now say that plan reuses `core/Focusable.ts`'s selector
    as its own base rather than re-introducing a competing public export (see that
    plan's own notes). Keeping the module out of `core/index.ts` keeps it internal, so
    it adds nothing to the public API surface or to TypeDoc.

[^merge]: An earlier draft of this plan argued the `FocusReveal` broker "buys this
    feature nothing" and shipped a second, parallel `PanelNavigator` registry —
    `_navigators`, `register` / `unregister`, and its own containment walk — alongside
    `FocusReveal`'s. That reasoning did not survive scrutiny: both brokers solve the
    same problem, "which registered container holds this element, and what should it
    do about it" — both keep a module-private `Set` pruned by `isConnected` at query
    time, both resolve "which of my panes/regions holds this target" by walking
    `getLaidOutComponents()` or a region getter, and both end by flipping a collapse
    flag. Shipping both as originally designed would give `Split` and `Border` two
    parallel `attach` / `detach` registrations doing overlapping work. `PanelNavigator
    extends FocusRevealer` instead: `getRevealElement()` is the one shared
    identity/containment hook, `revealDescendant()` stays reveal-only (a pane/region
    collapse toggle and nothing directional-specific), and `recordFocus` /
    `resolveNeighbour` are the two members this plan actually adds. The two walks keep
    opposite orders for a real reason — `move` wants the nearest neighbour to get first
    refusal (innermost-first), while `reveal` needs an outer container to open before
    an inner one can be measured (outermost-first) — so `PanelNavigation.move` gets its
    order by reversing `FocusReveal.containing()`'s result, rather than that ordering
    logic being written twice.

[^candidate-reveal]: Revealing per candidate, immediately before the focus attempt,
    mirrors `FocusHistory.navigate`'s `revealAndFocus`: a candidate that turns out to
    be unfocusable may still leave a container open behind it — the same tradeoff
    `focus-reveal-on-navigation.md` already accepts for a skipped trail entry — but the
    walk never opens an *outer* container only to find the *inner* one it actually
    needed was still closed. An earlier version of this plan expanded the destination
    pane or region as soon as `resolveNeighbour` had a non-empty candidate array,
    before any candidate was tested. That array is computed from the focusable-element
    selector alone, with no visibility check, so a pane whose only candidates sit
    behind a further-nested inactive `Tab` page opened for nothing when every candidate
    then refused focus, and the walk continued outward to open an *outer* container
    too. Calling `FocusReveal.reveal(candidate)` per attempt fixes this because `reveal`
    already walks every registered revealer containing the candidate, outermost-first
    — the pane or region *and* the inactive tab beneath it — in one call, before the
    candidate is tested.

[^lastfocus]: A `focusin` listener recording continuously was rejected. It would cost a
    containment test against every registered navigator on every focus change — dozens
    of them in a window-heavy app, since `Border` is used internally by headers, dialogs,
    and table panels — to maintain state that is only ever read at navigation time.
    Recording on the way out costs nothing extra: the service has already computed the
    containing navigators and the departing element by the time it asks the first one to
    resolve. The behaviour is the same for every case that matters, including a
    destination the user last reached by clicking rather than by keyboard.
</content>
