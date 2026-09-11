---
touches-shared:
  - packages/lib/src/typescript/lib/core/index.ts
  - packages/lib/src/typescript/lib/core/Component.ts
  - packages/lib/src/typescript/lib/core/Focusable.ts
  - packages/lib/src/typescript/lib/core/FocusTraversal.ts
  - packages/lib/src/typescript/lib/layout/Split.ts
  - packages/lib/src/typescript/lib/layout/Border.ts
  - packages/lib/src/typescript/lib/layout/Accordion.ts
  - packages/lib/src/typescript/lib/component/container/TabBar.ts
  - packages/lib/src/typescript/lib/component/table/Body.ts
  - packages/lib/src/typescript/lib/component/table/TreeBody.ts
  - packages/lib/src/typescript/lib/component/tree/Tree.ts
  - packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts
  - packages/lib/src/typescript/lib/component/menubar/ToolBar.ts
  - packages/lib/src/typescript/lib/component/input/Slider.ts
  - packages/lib/src/typescript/lib/component/input/NumberSpinner.ts
  - packages/lib/src/typescript/lib/overlay/ButtonGroup.ts
  - packages/lib/src/typescript/main.ts
  - packages/lib/src/typescript/SplitPanel.ts
  - packages/lib/tests/component/default-options-fallback.test.ts
  - packages/lib/tests/core/FocusTraversal.test.ts
  - packages/lib/tests/dom/TestDOM.ts
  - packages/lib/tests/component/container/TabBar.test.ts
  - packages/lib/tests/component/table/Body.test.ts
  - packages/lib/tests/component/table/TreeBody.test.ts
  - packages/lib/tests/component/tree/Tree.test.ts
  - packages/lib/tests/component/list/List.test.ts
  - packages/lib/tests/component/menubar/ToolBar.test.ts
  - packages/lib/tests/component/input/Slider.test.ts
  - packages/lib/tests/component/input/NumberSpinner.test.ts
  - packages/lib/tests/component/layout/Accordion.manager.test.ts
  - packages/lib/tests/overlay/ButtonGroup.test.ts
  - packages/lib/docs/concepts/accessibility.md
  - packages/lib/docs/reference/changelog/next.md
---

# Spatial Focus Navigation — Implementation Plan

## Overview

Two keyboard chords move focus by *direction* rather than by document order. `Ctrl+Alt`+arrow moves to the nearest individual focusable element in the pressed direction. `Ctrl+Shift`+arrow moves to the nearest container the app has marked as a navigation target, and hands focus to that container's remembered — or first — focusable descendant.

Both chords run the same geometric search over element rectangles read through [`DOM.source.getElementRect`](packages/lib/src/typescript/lib/core/DOM.ts#L1027). They differ only in which elements are candidates and in what happens on arrival.

This plan replaces the neighbour-resolution algorithm currently sitting unmerged on `feature/directional-panel-navigation`. That branch's [`core/PanelNavigation.ts`](packages/lib/src/typescript/lib/core/PanelNavigation.ts) asks each ancestor container "what is my neighbour that way", with `Split` and `Border` each answering from their own child list through a `PanelNavigator` interface. The interface, both implementations, and the outward ancestor walk all go away; the service's scaffolding — opt-in `enable()`/`disable()`/`configure()`, the `claimsKey` arbitration guard, the stand-down while an overlay layer is open, and the "remember the last-focused descendant per container" idea — carries over. The module is renamed `core/SpatialNavigation.ts`, because it no longer navigates only panels.[^rename]

---

## Architecture Decisions

### One geometric primitive, two candidate sets

A single pure function ranks candidates by direction:

```typescript
rankInDirection(origin: Rect, candidates: readonly SpatialCandidate[], direction: SpatialDirection): Handle[]
```

`rankInDirection` reads no DOM and knows nothing about focus. The two tiers differ only in what they feed it and what they do with the ranked list.[^one-primitive]

| Tier | Chord | Candidates | On arrival |
|---|---|---|---|
| `"component"` | `Ctrl+Alt`+arrow | every rendered focusable element in scope, minus the focused one | focus it |
| `"target"` | `Ctrl+Shift`+arrow | every element carrying `data-ts-ui-navigation-target` in scope | focus its remembered descendant, else its first focusable descendant |

### The ranking rule

For a direction, one axis is the **primary axis** (the one the arrow points along) and the other is the **perpendicular axis**. The *primary gap* is the clearance between the origin's forward edge and the candidate's near edge; the *perpendicular gap* is how far the two rectangles' perpendicular spans fail to overlap, and is `0` whenever they overlap at all.

| Direction | Primary gap | Perpendicular span |
|---|---|---|
| `north` | `origin.top − candidate.bottom` | `[left, right]` |
| `south` | `candidate.top − origin.bottom` | `[left, right]` |
| `west` | `origin.left − candidate.right` | `[top, bottom]` |
| `east` | `candidate.left − origin.right` | `[top, bottom]` |

A candidate is **eligible** when its primary gap is `>= 0` and its rect is not the seam's zero rect (`width === 0 && height === 0`). A negative primary gap means the candidate is behind, beside, or straddling the origin's forward edge — all excluded. Only a rect with no extent on *either* axis is dropped, so a `Split` pane collapsed to zero width keeps its height and stays reachable.

Eligible candidates are ranked by three keys, in order:

1. `score = primaryGap + 2 × perpendicularGap`, ascending.[^weight]
2. `|perpendicularCentre(candidate) − perpendicularCentre(origin)|`, ascending.
3. The order the caller supplied them in — DOM order in both tiers.[^stable-sort]

`rankInDirection` returns **every** eligible candidate, best first, not just the winner; the caller walks the list until one actually takes focus.

Worked cases. Origin `O` spans `left 0, top 200, right 100, bottom 220`; the arrow is `north`, so the perpendicular span is `[0, 100]` and its centre is `50`:

| Candidate (`left, top, right, bottom`) | Primary | Perp. gap | Score | Outcome |
|---|---|---|---|---|
| A `(0, 80, 100, 100)` — directly above | 100 | 0 | **100** | beats B |
| B `(180, 120, 280, 140)` — above-right | 60 | 80 | 220 | loses to A although its straight-line distance is also 100 |
| C `(0, 160, 100, 180)` — directly above, nearer | 20 | 0 | **20** | beats A |
| D `(0, 210, 100, 230)` — straddles `O.top` | −30 | — | — | excluded |

Ties break on perpendicular-centre distance. Origin `O2` spans `left 0, top 0, right 100, bottom 100` (perpendicular centre `50`); the arrow is `east`:

| Candidate | Primary | Perp. gap | Score | Centre delta | Outcome |
|---|---|---|---|---|---|
| E `(200, 0, 250, 20)` | 100 | 0 | 100 | 40 | loses the tie |
| F `(200, 60, 250, 80)` | 100 | 0 | 100 | **20** | **wins** |
| G `(120, 300, 220, 320)` | 20 | 200 | 420 | — | loses to both, though nearest ahead |

### The navigation-target marker mirrors `setTabKeyOwner`

`Component` gains a boolean opt-in shaped exactly like the existing Tab-key claim at [`core/Component.ts:2101`](packages/lib/src/typescript/lib/core/Component.ts#L2101): a `navigationTarget` field on `ComponentOptions`, a `setNavigationTarget(value)` / `isNavigationTarget()` pair, and a `data-ts-ui-navigation-target="true"` attribute mirrored through `setDataAttribute` while the flag is on.

The service enumerates targets by that attribute — `DOM.source.querySelectorAll(root, '[data-ts-ui-navigation-target]')` — never through a registry.[^marker]

Nothing is marked by default. `Split` and `Border` stop being navigable on their own; an app marks whichever containers it wants reachable.

### The search scope is the topmost layer, shared with `FocusTraversal`

Both tiers search inside the topmost registered layer's element, or `<body>` when no layer is open — so an open modal's candidates are the only ones considered, and nothing behind it is reachable. Candidates are further filtered to elements [`DOM.source.isRenderedVisible`](packages/lib/src/typescript/lib/core/DOM.ts#L1371) reports as actually rendered.

That scope-plus-visibility computation is exactly what [`FocusTraversal`](packages/lib/src/typescript/lib/core/FocusTraversal.ts#L52)'s private `resolveRoot` and `collectTabStops` already do. Both move to [`core/Focusable.ts`](packages/lib/src/typescript/lib/core/Focusable.ts) as `focusScopeRoot()` and `visibleFocusable(root)`, and `FocusTraversal` delegates to them.[^scope]

### Revealing stays with `FocusReveal`, and the marker plays no part in it

Before each focus attempt the service calls [`FocusReveal.reveal(candidate)`](packages/lib/src/typescript/lib/core/FocusReveal.ts#L103), which runs `revealDescendant` on every registered revealer whose element contains that candidate, outermost-first. `Split`, `Border`, `Tab`, `Accordion`, and the scrolling `Panel` are all already registered, so a candidate inside a collapsed pane or region is expanded, and one below the fold is scrolled into view, before focus is tried.

Reveal is keyed on DOM containment, not on the marker, so the generalized navigation target needs no relationship to `FocusRevealer` at all. The branch's `PanelNavigator extends FocusRevealer` coupling is deleted rather than replaced.[^reveal]

### Per-target focus memory moves into the service

The branch keeps a `Map` of last-focused descendants inside each `Split` and `Border` ([`Split.ts:137`](packages/lib/src/typescript/lib/layout/Split.ts#L137), [`Border.ts:95`](packages/lib/src/typescript/lib/layout/Border.ts#L95)). With the marker generalized, one module-private `Map<Handle, Handle>` in the service replaces both, keyed by the target element.

Before every move, the service walks from the focused element up to `<body>` and records it against **every** marked ancestor it passes. Stale keys are pruned at the start of each move, and `disable()` empties the map.[^memory]

Reading the map is unchanged: `focusCandidates(targetElement, remembered)` ([`core/Focusable.ts:57`](packages/lib/src/typescript/lib/core/Focusable.ts#L57)) already promotes a live, still-contained handle to the front and silently drops a dead or relocated one.

### Chords: `Ctrl+Alt` for components, `Ctrl+Shift` for targets

`Ctrl+Shift`+arrow keeps the branch's chord for the coarse tier. `Ctrl+Alt`+arrow is the new fine tier. Both are matched on `KeyboardEvent.code`, so they are keyboard-layout independent. Each tier's modifier set is replaceable through `configure`; the arrow keys themselves are fixed. If both tiers are configured to the same modifier set, the component tier acts.[^chords]

`claimsKey(e)` stays the single predicate that both the service and the ten guarded widget handlers read: true when the service is enabled, the event matches *either* chord, and `LayerManager.hasActiveInputLayer()` is false. Its contract and its ten call sites are unchanged apart from the module rename.

### Geometry is read fresh on every keypress

No cache. Each move performs one `querySelectorAll` and one `getElementRect` per candidate, then discards them — the same lazy, per-keystroke recomputation `FocusTraversal.collectTabStops` ([`FocusTraversal.ts:102`](packages/lib/src/typescript/lib/core/FocusTraversal.ts#L102)) already does for tab stops.[^no-cache]

### This supersedes the `directional-panel-navigation` plan

The `directional-panel-navigation` design is per-layout-manager: `Split` maps a direction onto a pane-index step, `Border` maps it through a hand-written region table, and the service walks ancestor containers outward until one of them claims a neighbour. That design is replaced because the answer it gives depends on the container hierarchy rather than on where things are drawn — two panes that sit side by side on screen are not neighbours unless one specific container type says so, and every new navigable container type needs its own direction table.

The geometric search has no ancestor walk, no per-type table, and no notion of a pane. It is a new pattern in this codebase: no existing module ranks elements by direction, so there is no precedent to follow.[^new-pattern] The shape is adapted from the CSS Spatial Navigation specification — discard everything not beyond the origin's forward edge, then score what remains on primary-axis distance plus a weighted perpendicular penalty, then break ties in document order — simplified as described under *The ranking rule*.

---

## Public API

New module `packages/lib/src/typescript/lib/core/SpatialNavigation.ts`, replacing `core/PanelNavigation.ts` and exported from [`core/index.ts`](packages/lib/src/typescript/lib/core/index.ts#L43):

```typescript
export type SpatialDirection = "north" | "south" | "east" | "west";

export type SpatialTier = "component" | "target";

export interface SpatialNavigationModifiers {
    ctrl?:  boolean;
    alt?:   boolean;
    shift?: boolean;
    meta?:  boolean;
}

export interface SpatialNavigationOptions {
    /** Fine tier. Default `{ ctrl: true, alt: true }`. Replaces the whole set, not merged. */
    componentModifiers?: SpatialNavigationModifiers;
    /** Coarse tier. Default `{ ctrl: true, shift: true }`. Replaces the whole set, not merged. */
    targetModifiers?:    SpatialNavigationModifiers;
}

/** One element paired with the rectangle it occupies, as fed to {@link rankInDirection}. */
export interface SpatialCandidate {
    handle: Handle;
    rect:   Rect;
}

/** Eligible candidates in `direction` from `origin`, best first. Pure; reads no DOM. */
export function rankInDirection(
    origin:     Rect,
    candidates: readonly SpatialCandidate[],
    direction:  SpatialDirection,
): Handle[];

export namespace SpatialNavigation {
    export function enable(options?: SpatialNavigationOptions): void;
    export function disable(): void;
    export function isEnabled(): boolean;
    export function configure(options: SpatialNavigationOptions): void;
    export function claimsKey(e: KeyboardEvent): boolean;
    export function move(direction: SpatialDirection, tier: SpatialTier): boolean;
}
```

Added to [`core/Focusable.ts`](packages/lib/src/typescript/lib/core/Focusable.ts) (internal — not barrel-exported):

```typescript
/** The topmost registered layer's element, or `<body>` when no layer is open. */
export function focusScopeRoot(): Handle;

/** `findFocusable(root)` filtered to elements that are actually rendered. */
export function visibleFocusable(root: Handle): Handle[];
```

Added to [`core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts#L2101), mirroring `setTabKeyOwner` / `isTabKeyOwner`:

```typescript
export interface ComponentOptions {
    /** Marks this component as a coarse-tier spatial-navigation target — see `setNavigationTarget`. */
    navigationTarget?: boolean;
}

/** Backing store: `this._options.navigationTarget`. Mirrors `data-ts-ui-navigation-target="true"` while on. */
setNavigationTarget(value: boolean): this;

/** Reads `this._options.navigationTarget ?? this._defaultOptions.navigationTarget ?? false`. */
isNavigationTarget(): boolean;
```

Deleted: `PanelNavigation`, `PanelNavigator`, `PanelDirection`, `PanelNavigationOptions`, `PanelNavigationModifiers`.

---

## Internal Structure

### `rankInDirection`

```typescript
// A candidate whose perpendicular span misses the origin's is penalised at
// twice the rate of raw forward distance — the CSS Spatial Navigation spec's
// own vertical `orthogonalWeight`. See the plan's `[^weight]` note.
const PERPENDICULAR_WEIGHT: number = 2;

interface Span { start: number; end: number; }

/** The primary gap and perpendicular spans for `direction`, per the table in the plan. */
function project(origin: Rect, candidate: Rect, direction: SpatialDirection):
    { primary: number; originSpan: Span; candidateSpan: Span } { /* … */ }

function gapBetween(a: Span, b: Span): number {
    return Math.max(0, Math.max(a.start, b.start) - Math.min(a.end, b.end));
}
```

Each eligible candidate is scored once into a local array of `{ handle, score, centreDelta }`, sorted on the three keys, then mapped back to handles.

### `SpatialNavigation` — module state

```typescript
// The DOM attribute a navigation target's element carries — mirrored by
// `Component.setNavigationTarget`.
const NAVIGATION_TARGET_ATTR = "data-ts-ui-navigation-target";
const NAVIGATION_TARGET_SELECTOR = "[data-ts-ui-navigation-target]";

const ARROW_DIRECTIONS: Record<string, SpatialDirection> = {
    ArrowUp: "north", ArrowDown: "south", ArrowLeft: "west", ArrowRight: "east",
};

const DEFAULT_COMPONENT_MODIFIERS: SpatialNavigationModifiers = { ctrl: true, alt: true };
const DEFAULT_TARGET_MODIFIERS:    SpatialNavigationModifiers = { ctrl: true, shift: true };

const _owner: Component = new Component();

// Last-focused descendant per navigation target, keyed by the target's element.
const _lastFocus: Map<Handle, Handle> = new Map<Handle, Handle>();

let _enabled: boolean = false;
let _componentModifiers: SpatialNavigationModifiers = DEFAULT_COMPONENT_MODIFIERS;
let _targetModifiers:    SpatialNavigationModifiers = DEFAULT_TARGET_MODIFIERS;
```

### `SpatialNavigation` — the move

```typescript
function moveFocus(direction: SpatialDirection, tier: SpatialTier): boolean {
    const origin = DOM.source.getActiveElement();

    if (origin === null) { return false; }

    const originRect = DOM.source.getElementRect(origin);

    if (originRect.width === 0 && originRect.height === 0) { return false; }

    pruneStaleMemory();
    recordOrigin(origin);

    const root = focusScopeRoot();
    const ranked = rankInDirection(originRect, collectCandidates(root, origin, tier), direction);

    for (const candidate of ranked) {
        const landings = tier === "component"
            ? [candidate]
            : focusCandidates(candidate, _lastFocus.get(candidate));

        for (const landing of landings) {
            FocusReveal.reveal(landing);
            DOM.sink.focus(landing, { preventScroll: true });

            if (DOM.source.getActiveElement() === landing) { return true; }
        }
    }

    return false;
}
```

`collectCandidates` builds the `SpatialCandidate[]`:

- `"component"`: `visibleFocusable(root)`, dropping `origin` itself.
- `"target"`: `DOM.source.querySelectorAll(root, NAVIGATION_TARGET_SELECTOR)` filtered by `DOM.source.isRenderedVisible`.

Both then pair each handle with `DOM.source.getElementRect(handle)`.

`recordOrigin` walks from `origin` up to `<body>` — the same bounded walk as [`FocusTraversal.findTabKeyOwner`](packages/lib/src/typescript/lib/core/FocusTraversal.ts#L81) — and calls `_lastFocus.set(ancestor, origin)` for every ancestor carrying `NAVIGATION_TARGET_ATTR`, rather than stopping at the first.

Keying `_lastFocus` by `Handle` is safe because the seam's handle registry is canonical: `intern` returns the same handle for the same node forever, so the handle `getParentNode` yields during the record walk is the identical value `querySelectorAll` yields when the target is later ranked ([`core/DOM.ts:212`](packages/lib/src/typescript/lib/core/DOM.ts#L212)).

### `SpatialNavigation` — the key handler

`claimedTier(e)` returns the matching tier or `null`:

```typescript
function claimedTier(e: KeyboardEvent): SpatialTier | null {
    if (!_enabled || ARROW_DIRECTIONS[e.code] === undefined) { return null; }
    if (LayerManager.hasActiveInputLayer()) { return null; }
    if (matchesModifiers(e, _componentModifiers)) { return "component"; }
    if (matchesModifiers(e, _targetModifiers))    { return "target"; }

    return null;
}
```

The public `claimsKey` — the single predicate both the service and the ten guarded widgets read — is a one-line wrapper: `claimsKey(e: KeyboardEvent): boolean { return claimedTier(e) !== null; }`.

`onKeyDown` computes `const tier = claimedTier(e);`. When `tier` is non-null it calls `moveFocus(ARROW_DIRECTIONS[e.code], tier)` and returns `{ stop: true, prevent: true }` regardless of `moveFocus`'s result, so a widget that stood down never leaves the key doing something else instead; when `tier` is `null` it returns `undefined` (no disposition), unchanged from the branch.

---

## Ordered Implementation Steps

1. **Merge in the branch being reworked.** `/implement` creates this plan's worktree as a fresh `feature/spatial-focus-navigation` branch off master's own tip — per `~/.claude/skills/_shared/worktree.md` and `implement/worker.md`, it does not start from, or know about, `feature/directional-panel-navigation`. The steps below need *both* master's `core/FocusTraversal.ts` / `core/Focusable.ts` *and* the branch's `core/PanelNavigation.ts`, so this branch's first action is `git merge feature/directional-panel-navigation` (a real merge, not a rebase — a rebase of that branch onto master hits a *different* conflict set, since its patch-id cherry-detection silently skips one of the branch's five commits as already-applied; the conflicts below are what the merge itself produces, verified by running it). Expect conflicts in exactly four files: `packages/lib/src/typescript/lib/core/index.ts` (master's `export { FocusTraversal }` / `export type { FocusTraversalOptions }` and the branch's `export { PanelNavigation }` / `export type { PanelNavigator, … }` both insert immediately after the same `export type { FocusRevealer } …` line — keep both blocks; the `PanelNavigation` one is replaced anyway in step 11), `packages/lib/tests/dom/TestDOM.ts` (master independently added a `renderedVisible: boolean` field to `HandleStub`, plus its `renderedVisible: true,` initializer in `mint()`, both immediately after `attributes` — the branch has no change at that point at all, since it predates `renderedVisible` — keep `HEAD`'s side entirely, discarding the empty branch side), `packages/lib/docs/concepts/accessibility.md` (two separate hunks: master adds a "Tab traversal" section and the branch adds "Directional panel navigation" — keep both sections; separately, the `## Testing` section's single "Keyboard-only" bullet was independently rewritten by each side — keep master's version for now, since step 13 rewrites it again to name both chords, and deleting the branch's duplicate here avoids carrying a stale bullet through steps 2–12), and `packages/lib/docs/reference/changelog/next.md` (master added many entries the branch predates — keep every master entry and re-add the branch's `PanelNavigation` bullet under `## Added → ### Core`).
   *Verify:* `packages/lib/src/typescript/lib/core/FocusTraversal.ts` and `.../PanelNavigation.ts` both exist; `npm run typecheck && npm test` green.

2. **Move the scope helpers into `core/Focusable.ts`.** Add `focusScopeRoot()` (body of `FocusTraversal`'s `resolveRoot`, lines 52–56) and `visibleFocusable(root)` (body of `collectTabStops`, lines 102–104), importing `LayerManager`; add `focusScopeRoot, visibleFocusable` to `FocusTraversal.ts`'s existing `import { findFocusable } from "~/core/Focusable.js";`. In `core/FocusTraversal.ts`, delete both private functions and route their ten call sites — lines 146, 166, 258, 266, 352 (this line calls both `resolveRoot` and `collectTabStops`), 361, 363, 372, 374 — to the new exports; keep `isModalRoot` and `shouldWrap` exactly as they are. In [`packages/lib/tests/core/FocusTraversal.test.ts`](packages/lib/tests/core/FocusTraversal.test.ts#L1), reword the three header-comment references naming the module being replaced, so the module rename in step 11 doesn't leave a stale reference behind: lines 1 and 6 ("mirrors FocusHistory/PanelNavigation" and "PanelNavigation.test.ts, the precedents this mirrors") to name `SpatialNavigation`; and line 9 ("Border.panelNavigation.test.ts, which seeds the same way for `findFocusable`") to instead name `SpatialNavigation.test.ts` — the actual successor, created in steps 5/7, since `Border.panelNavigation.test.ts` itself is deleted outright by step 10 with no per-container-type replacement. Note line 9's reference is lowercase-`p` `panelNavigation` (naming the doomed file's own filename), so a case-sensitive grep for `PanelNavigation` won't catch it on its own; reword it anyway.
   *Verify:* `grep -n "function resolveRoot\|function collectTabStops" packages/lib/src/typescript/lib/core/FocusTraversal.ts` — zero matches. `npm test` green, with `tests/core/FocusTraversal.test.ts` and `tests/core/FocusTraversalCompositeWidgets.test.ts` passing unedited.

3. **Add the marker tests.** In [`packages/lib/tests/component/default-options-fallback.test.ts`](packages/lib/tests/component/default-options-fallback.test.ts#L766), add a `describe('isNavigationTarget folds a subclass navigationTarget default', …)` block copying the five cases of the `isTabKeyOwner` block above it, substituting `navigationTarget` / `setNavigationTarget` / `isNavigationTarget` / `ts-ui-navigation-target`.
   *Verify:* the new block fails (the methods do not exist yet).

4. **Add the marker.** In `core/Component.ts`: `navigationTarget?: boolean` on `ComponentOptions` beside `tabKeyOwner` (line 168); `setNavigationTarget` / `isNavigationTarget` beside `setTabKeyOwner` (line 2101); and, immediately after line 825, the always-dispatch line `this.setNavigationTarget(options.navigationTarget ?? this.isNavigationTarget());` with a comment pointing at the neighbouring one.
   *Verify:* step 3's block passes; `npm run typecheck` green.

5. **Write the geometry tests.** New `packages/lib/tests/unit/core/SpatialNavigation.test.ts`, starting with a `describe('rankInDirection', …)` covering Expected Behaviour 1–11. These need no DOM: build `Rect` literals directly.
   *Verify:* the file fails to import (the module does not exist yet).

6. **Create `core/SpatialNavigation.ts` with `rankInDirection` only** — the constants, `project`, `gapBetween`, and the exported function, per `## Internal Structure`.
   *Verify:* the `rankInDirection` describe block passes.

7. **Write the service tests.** Extend `packages/lib/tests/unit/core/SpatialNavigation.test.ts` with Expected Behaviour 12–28, copying the harness helpers named in `## Expected Behaviour` from `tests/core/FocusTraversal.test.ts` and the module-singleton `afterEach` from `tests/unit/core/PanelNavigation.test.ts`.
   *Verify:* the new blocks fail (the service does not exist yet); the `rankInDirection` blocks still pass.

8. **Port the service into the same module.** Copy `core/PanelNavigation.ts`'s `_owner` sentinel, `enable` / `isEnabled` / `configure`, and the `onKeyDown` disposition verbatim, renaming the types and splitting the single `_modifiers` into the two tier fields. Replace `claimsKey`'s body and add `claimedTier` per `## Internal Structure`, above. Copy `disable` verbatim *plus one added line*, `_lastFocus.clear();` — `configure` stays untouched by `disable`, exactly as on the branch, but the focus memory must not outlive a disable/enable cycle (see Expected Behaviour 27). Add `_lastFocus`, `pruneStaleMemory`, `recordOrigin`, `collectCandidates`, and `moveFocus` per `## Internal Structure`. `PanelNavigation.ts` stays in place for now.
   *Verify:* step 7's blocks pass; `npm run typecheck` green.

9. **Repoint the ten guards.** In each file below, change the import and the `claimsKey` call from `PanelNavigation` to `SpatialNavigation`; change nothing else in any handler. Then, in each of the ten guard test files listed in `## Files to Create / Modify / Delete`, do the same for the import and the `vi.spyOn`/mock call, and additionally reword every remaining prose mention of `PanelNavigation` — comments and `describe` block titles alike — to `SpatialNavigation`. Every one of the ten test files has at least one such comment and one such title outside the import/mock; leaving any of them is what the `## Verification` grep exists to catch.

   | File | Line |
   |---|---|
   | [`component/table/Body.ts`](packages/lib/src/typescript/lib/component/table/Body.ts#L2709) | 2709 |
   | [`component/table/TreeBody.ts`](packages/lib/src/typescript/lib/component/table/TreeBody.ts#L807) | 807 |
   | [`component/tree/Tree.ts`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1051) | 1051 |
   | [`component/list/AbstractSelectableList.ts`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L2095) | 2095 (`return false`) |
   | [`component/menubar/ToolBar.ts`](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L189) | 189 |
   | [`component/container/TabBar.ts`](packages/lib/src/typescript/lib/component/container/TabBar.ts#L3307) | 3307 (post-merge; master's own `TabBar.ts` edit shifts this from the branch's 3299) |
   | [`overlay/ButtonGroup.ts`](packages/lib/src/typescript/lib/overlay/ButtonGroup.ts#L284) | 284 |
   | [`layout/Accordion.ts`](packages/lib/src/typescript/lib/layout/Accordion.ts#L2503) | 2503 |
   | [`component/input/Slider.ts`](packages/lib/src/typescript/lib/component/input/Slider.ts#L593) | 593 |
   | [`component/input/NumberSpinner.ts`](packages/lib/src/typescript/lib/component/input/NumberSpinner.ts#L507) | 507 |

   *Verify:* `grep -rn "SpatialNavigation.claimsKey" packages/lib/src/` — exactly ten matches. `npm run typecheck` green.

10. **Strip the navigator implementations.** In `layout/Split.ts`: delete the `~/core/PanelNavigation.js` and `focusCandidates` imports, the `PanelNavigator` clause on line 112, the `_lastFocus` field (line 137), `paneIndexOf`, `directionStep`, `recordFocus`, `resolveNeighbour`, and the `this._lastFocus.clear()` line in `detach`. In `layout/Border.ts`: the same, plus the `BORDER_NEIGHBOUR` constant (line 40) and `regionOf`. Both keep `FocusRevealer`, `getRevealElement`, `revealDescendant`, and their `FocusReveal.register` / `unregister` calls untouched. Delete `packages/lib/tests/component/layout/Split.panelNavigation.test.ts` and `.../Border.panelNavigation.test.ts`.
    *Verify:* `grep -rn "resolveNeighbour\|recordFocus\|PanelNavigator" packages/lib/src/typescript/lib/layout/` — zero matches. `npm run typecheck && npm run lint` green (lint catches any import left orphaned).

11. **Delete the old module and swap the barrel.** Remove `core/PanelNavigation.ts` and `packages/lib/tests/unit/core/PanelNavigation.test.ts`. In `core/index.ts`, replace the two `PanelNavigation` export lines with:

    ```typescript
    export { SpatialNavigation, rankInDirection } from '~/core/SpatialNavigation.js';
    export type { SpatialDirection, SpatialTier, SpatialNavigationOptions, SpatialNavigationModifiers, SpatialCandidate } from '~/core/SpatialNavigation.js';
    ```

    In `packages/lib/src/typescript/main.ts`, change the import and the `PanelNavigation.enable()` call to `SpatialNavigation.enable()`.

    *Verify:* `grep -rn "PanelNavigation\|PanelNavigator\|PanelDirection" packages/lib/src/ packages/lib/tests/` — zero matches. `npm run typecheck && npm test` green. (The full-tree grep including `packages/lib/docs/` is the final `## Verification` gate, after step 13 rewrites the docs and changelog — `docs/concepts/accessibility.md` and `docs/reference/changelog/next.md` still carry the branch's original `PanelNavigation` prose at this point, by step 1's own "keep both" rebase resolution, so a full-tree grep here would fail.)

12. **Mark the demo panes.** In [`packages/lib/src/typescript/SplitPanel.ts`](packages/lib/src/typescript/SplitPanel.ts#L20), construct the two panes of `mainSplit` as `new Component({ navigationTarget: true })` (lines 20 and 30), so the coarse tier has something to navigate between.
    *Verify:* `npm run dev`, http://localhost:8015, Split tab — the manual checks in Expected Behaviour 29–34.

13. **Documentation.** Per `## Documentation Impact`.
    *Verify:* `npm run docs:api` finishes with zero warnings; `npm run docs:llms:check` and `npm run build:docs` clean.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/core/SpatialNavigation.ts` |
| Create | `packages/lib/tests/unit/core/SpatialNavigation.test.ts` |
| Delete | `packages/lib/src/typescript/lib/core/PanelNavigation.ts` |
| Delete | `packages/lib/tests/unit/core/PanelNavigation.test.ts` |
| Delete | `packages/lib/tests/component/layout/Split.panelNavigation.test.ts` |
| Delete | `packages/lib/tests/component/layout/Border.panelNavigation.test.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Focusable.ts` |
| Modify | `packages/lib/src/typescript/lib/core/FocusTraversal.ts` |
| Modify | `packages/lib/tests/core/FocusTraversal.test.ts` |
| Modify | `packages/lib/tests/dom/TestDOM.ts` (step-1 merge-conflict resolution only) |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/core/index.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Split.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Border.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Accordion.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/TabBar.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Body.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/TreeBody.ts` |
| Modify | `packages/lib/src/typescript/lib/component/tree/Tree.ts` |
| Modify | `packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts` |
| Modify | `packages/lib/src/typescript/lib/component/menubar/ToolBar.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/Slider.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/NumberSpinner.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/ButtonGroup.ts` |
| Modify | `packages/lib/src/typescript/main.ts` |
| Modify | `packages/lib/src/typescript/SplitPanel.ts` |
| Modify | `packages/lib/tests/component/default-options-fallback.test.ts` |
| Modify | `packages/lib/tests/component/container/TabBar.test.ts` |
| Modify | `packages/lib/tests/component/input/NumberSpinner.test.ts` |
| Modify | `packages/lib/tests/component/input/Slider.test.ts` |
| Modify | `packages/lib/tests/component/layout/Accordion.manager.test.ts` |
| Modify | `packages/lib/tests/component/list/List.test.ts` |
| Modify | `packages/lib/tests/component/menubar/ToolBar.test.ts` |
| Modify | `packages/lib/tests/component/table/Body.test.ts` |
| Modify | `packages/lib/tests/component/table/TreeBody.test.ts` |
| Modify | `packages/lib/tests/component/tree/Tree.test.ts` |
| Modify | `packages/lib/tests/overlay/ButtonGroup.test.ts` |
| Modify | `packages/lib/docs/concepts/accessibility.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

`rankInDirection` takes plain `Rect` literals and reads no DOM, so cases 1–11 are **unit-testable with no harness at all**. Cases 12–28 are **offline-testable** through `installTestDOM`, following [`packages/lib/tests/core/FocusTraversal.test.ts`](packages/lib/tests/core/FocusTraversal.test.ts)'s harness: `seedStops`-style `setQuerySelectorAllResult` seeding, `setRenderedVisible`, `setConnected`, `DOM.sink.edit(h).attr(…)` for the marker, `DOM.sink.apply(h, { style: { left, top, width, height } })` for geometry, `stableBody()` to pin the scope root, and `DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(…))` to drive the real keydown path.[^offline-caveats] Cases 29–34 need **manual verification**.

### `rankInDirection`

1. An empty candidate list returns `[]`.
2. A candidate whose primary gap is negative is excluded — behind the origin, beside it, or straddling its forward edge (case D in *The ranking rule*).
3. A candidate whose rect is `width === 0 && height === 0` is excluded even when its position would qualify.
4. A candidate whose primary gap is exactly `0` (edge-to-edge adjacency) is eligible and scores `0`.
5. Two candidates sharing the origin's perpendicular band: the smaller primary gap wins (C beats A).
6. A perfectly aligned but distant candidate beats a near but off-band one (E beats G).
7. Directly ahead beats diagonal at equal straight-line distance (A beats B).
8. Equal score breaks on the smaller perpendicular-centre distance (F beats E).
9. Equal score *and* equal centre distance breaks on the caller's input order.
10. The return value lists every eligible candidate ranked, not only the winner.
11. The same fixture mirrored through all four directions produces mirrored rankings.

### The service

12. `claimsKey` is `false` for every key while `isEnabled()` is `false`.
13. Once enabled with defaults, `claimsKey` is `true` for `Ctrl+Alt+Arrow*` and `Ctrl+Shift+Arrow*`, and `false` for a bare arrow, `Ctrl`-only, `Shift`-only, `Alt`-only, and any non-arrow `code`.
14. `configure({ componentModifiers })` makes the new set claim and the old one stop claiming; the target tier is untouched, and vice versa.
15. With both tiers configured to the same modifier set, a matching keydown moves the component tier.
16. `claimsKey` is `false` while any non-`"manual"` layer is registered anywhere in the stack — including beneath a `"manual"` layer stacked on top — and `true` once only `"manual"` layers remain.
17. A claimed keydown dispatched at the window calls both `preventDefault()` and `stopPropagation()`, whether or not focus moved.
18. An unclaimed keydown calls neither.
19. `move(dir, "component")` focuses the best-ranked rendered focusable in the scope, and never a candidate `isRenderedVisible` reports as `false`.
20. `move` returns `false` and focuses nothing when nothing is focused, or when the focused element's rect is the zero rect.
21. `move(dir, "component")` never re-focuses the origin element.
22. `move(dir, "target")` considers only elements matching `[data-ts-ui-navigation-target]` inside the scope root — an unmarked container in the same direction is ignored.
23. `move(dir, "target")` lands on the target's remembered descendant when that handle is live and still inside it, and on the first focusable descendant when nothing is recorded.
24. When a remembered descendant refuses focus, the next focusable descendant of the same target is tried; when a target has no focusable descendant at all, the next-ranked target is tried.
25. `FocusReveal.reveal` is called for each landing candidate before its focus attempt.
26. Moving away from an element nested inside two marked containers records it against **both**.
27. `move(dir, "target")` after a `disable()` / `enable()` cycle lands on the first focusable descendant — `disable()` empties the memory.
28. A memory entry whose target element is no longer connected is dropped rather than consulted.

### Manual verification

29. `Ctrl+Alt+→` from the Split demo's "Hello World button!" moves to the nearest focusable to its right; `Ctrl+Alt+↓` moves down into the lower pane's list.
30. `Ctrl+Shift+↓` then `Ctrl+Shift+↑` between the demo's two marked panes returns to the control that was focused in the first pane, not to its first control.
31. Navigating into a collapsed `Split` pane expands it and lands focus inside; the collapse animation is still running when focus arrives, and nothing flickers back.
32. With focus in a `Slider`, `Tree`, `Table`, `ToolBar`, or `TabBar`, a bare arrow key still drives that widget's own behaviour, and both chords still move focus out of it.
33. With a `ComboBox` dropdown open, neither chord acts; inside a non-modal `Window`, both still do.
34. On GNOME, `Ctrl+Alt`+arrow switches workspace before the page sees it — confirm the collision, and that `SpatialNavigation.configure({ componentModifiers: … })` is a working escape.

---

## Verification

- `npm run typecheck` and `npm run lint` — the `local/no-raw-dom` rule stays clean only if every geometry, focus, containment, and attribute read in the new module goes through `DOM.source` / `DOM.sink`.
- `npm test` — the new test file plus the whole existing suite.
- `grep -rn "PanelNavigation\|PanelNavigator\|PanelDirection" packages/lib/` — zero matches (the superseded plan under `plans/` is outside this path and keeps its text).
- `grep -rn "SpatialNavigation.claimsKey" packages/lib/src/` — exactly ten matches, one per guarded handler.
- `grep -rn "function resolveRoot\|function collectTabStops" packages/lib/src/typescript/lib/core/FocusTraversal.ts` — zero matches.
- `grep -rn "addEventListener\|\.focus(\|activeElement\|getBoundingClientRect" packages/lib/src/typescript/lib/core/SpatialNavigation.ts` — every hit is a `DOM.sink` / `DOM.source` call.
- `npm run docs:api` — zero warnings. `docs/api` is gitignored and goes stale locally, so run it rather than trusting an old build.
- `npm run docs:llms:check` and `npm run build:docs` — clean.
- Manual smoke test: `npm run dev`, http://localhost:8015, against Expected Behaviour 29–34 on the Split, Misc., Tree, and Table tabs.

---

## Documentation Impact

- `SpatialNavigation`, `rankInDirection`, `SpatialDirection`, `SpatialTier`, `SpatialNavigationOptions`, `SpatialNavigationModifiers`, and `SpatialCandidate` are exported from `core/index.ts`, so TypeDoc renders them. Give the namespace, each exported function, and each interface a `@category Core` JSDoc block, matching `FocusHistory`'s style.
- `Component.setNavigationTarget` / `isNavigationTarget` are new public members on an already-documented class; copy `setTabKeyOwner`'s JSDoc shape, including the "why the attribute is mirrored" remark.
- `core/Focusable.ts` stays out of the barrel and out of the docs. Per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md), public JSDoc must not `{@link}` `focusScopeRoot`, `visibleFocusable`, `findFocusable`, or `focusCandidates` — describe the behaviour in prose instead.
- [`docs/concepts/accessibility.md`](packages/lib/docs/concepts/accessibility.md): the branch's "Directional panel navigation" section becomes "Spatial focus navigation", placed after "Tab traversal". It must now cover both chords, `setNavigationTarget` as the way to make a container reachable, the fact that nothing is marked by default, the stand-down rules, and the obligation on any new arrow-key handler to call `claimsKey`. Its **Testing** section's keyboard-only bullet updates to name both chords.
- No sidebar change: `/concepts/accessibility` is already listed in `packages/docs/src/content/pages.ts`.
- No `llms.txt` change: the coverage manifest tracks concrete component classes only, and this adds none.
- [`docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md): under `## Added → ### Core`, replace the branch's `PanelNavigation` bullet with one for `SpatialNavigation` describing both tiers, carrying over its mention of the new `LayerManager.hasActiveInputLayer()`, and add a bullet for `Component.setNavigationTarget` / `navigationTarget`. No migration note — the service is opt-in, `PanelNavigation` was never released, and every guard is inert while the service is disabled.

---

## Potential Challenges

- **`Ctrl+Alt`+arrow switches workspace on GNOME**, this project's own development environment, so the fine tier may never reach the page there. Mitigation: `configure({ componentModifiers })` replaces the set; Expected Behaviour 34 makes the collision an explicit manual check rather than a surprise.
- **`Ctrl+Shift+←`/`→` extends a word selection in text inputs on Windows and Linux.** The service's `preventDefault` plus `stopPropagation` suppresses it; an app that values the editing gesture more passes different `targetModifiers`.
- **One `getElementRect` per candidate per keypress forces a layout flush.** All the reads are contiguous with no interleaved writes, so the browser flushes once; the chord also only fires on a deliberate modifier press, never during typing. If a screen with hundreds of focusables ever feels slow, that is the place to look — do not pre-emptively add a cache.
- **Offline, `DOM.source.matches` always returns `false`**, so `findFocusable(root)` never includes `root` itself in tests. Seed the candidate set through `setQuerySelectorAllResult` and treat the self-match branch as manual-verify only.
- **`DOM.source.getBody()` mints a fresh handle per call offline.** Any test that seeds against the body root must pin it with the `stableBody()` helper from `FocusTraversal.test.ts`.
- **`core/Focusable.ts` gains a `LayerManager` import.** Nothing in `LayerManager`'s import graph reaches `Focusable`, so there is no cycle; the import is also only used inside a function body, so even a future cycle would not trip a temporal-dead-zone error at module init.
- **A marked container nested inside another marked container** produces two eligible candidates from the same region. That is accepted, not resolved — see `## Non-Goals`.

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/PanelNavigation.ts`](packages/lib/src/typescript/lib/core/PanelNavigation.ts) — **the module being replaced.** Read it whole before starting: `_owner`, `enable` / `disable` / `isEnabled` / `configure`, `isClaimedKey`, and `onKeyDown`'s disposition all carry over; `PanelNavigator`, `isPanelNavigator`, and `moveFocus`'s outward walk do not.
- [`packages/lib/src/typescript/lib/core/FocusTraversal.ts`](packages/lib/src/typescript/lib/core/FocusTraversal.ts) — **the precedent for scoping and for lazy per-keypress computation.** `resolveRoot` (line 52), `collectTabStops` (line 102), `findTabKeyOwner`'s bounded ancestor walk (line 81), and `TAB_KEY_OWNER_ATTR` (line 22).
- [`packages/lib/src/typescript/lib/core/Focusable.ts`](packages/lib/src/typescript/lib/core/Focusable.ts) — `FOCUSABLE_SELECTOR` (line 11), `isLiveHandle` (line 19), `findFocusable` (line 38), and `focusCandidates` (line 57), which the target tier's landing reuses unchanged.
- [`packages/lib/src/typescript/lib/core/Component.ts:2101`](packages/lib/src/typescript/lib/core/Component.ts#L2101) — **the precedent for the marker.** `setTabKeyOwner` / `isTabKeyOwner`, the `tabKeyOwner` option field (line 168), and the always-dispatch line in `applyOptions` (line 825) with its comment explaining why the field is not gated on `!== undefined`.
- [`packages/lib/src/typescript/lib/core/FocusReveal.ts`](packages/lib/src/typescript/lib/core/FocusReveal.ts) — `containing` (line 66) and `reveal` (line 103). The service calls only `reveal`.
- [`packages/lib/src/typescript/lib/core/FocusHistory.ts`](packages/lib/src/typescript/lib/core/FocusHistory.ts) — the namespace-singleton shape the service follows, and `pruneStale` (line 101) as the model for pruning the focus memory.
- [`packages/lib/src/typescript/lib/core/DOM.ts`](packages/lib/src/typescript/lib/core/DOM.ts) — the seam: `Rect` (line 38), `getElementRect` (line 1027), `isRenderedVisible` (line 1371), `querySelectorAll` (line 1282), `contains` (line 1264), `getBody` (line 1395), `getActiveElement` (line 1179), `isConnected` (line 1153).
- [`packages/lib/src/typescript/lib/core/LayerManager.ts`](packages/lib/src/typescript/lib/core/LayerManager.ts) — `hasActiveInputLayer` (added by the branch) and `getTopLayer`, the two the scope and the stand-down rest on.
- [`packages/lib/tests/core/FocusTraversal.test.ts`](packages/lib/tests/core/FocusTraversal.test.ts) — **the offline harness to copy**: `liveHandle`, `markDisabled`, `markTabKeyOwner`, `seedStops`, `stableBody`, `dispatchKeyDown`, and the module-singleton `afterEach`.
- [`packages/lib/tests/dom/TestDOM.ts`](packages/lib/tests/dom/TestDOM.ts) — `getElementRect`'s composition from inline-style writes, `setQuerySelectorAllResult`, `setRenderedVisible`, `setConnected`.
- [`packages/lib/tests/component/default-options-fallback.test.ts:766`](packages/lib/tests/component/default-options-fallback.test.ts#L766) — the `isTabKeyOwner` block the new `navigationTarget` block mirrors.
- [`plans/implemented/directional-panel-navigation.md`](plans/implemented/directional-panel-navigation.md) — **the superseded plan**, at that path on the feature branch and at `plans/directional-panel-navigation.md` on master. Its `## Architecture Decisions` explains the chord choice and the ten-guard arbitration, both of which survive.
- [ARCHITECTURE.md](ARCHITECTURE.md) — the DOM-seam rule, the typed-setter rule, the named-listener rule, and the disposition protocol.

---

## Non-Goals

- **Resolving nested navigation targets.** A marked container inside another marked container yields two candidates and no filtering happens between them; whichever ranks better wins. This is a deliberate simplification — the app author decides where to put the markers.
- **Marking anything by default.** `Split` panes and `Border` regions are no longer navigable on their own; only the demo's two `SplitPanel` panes are marked, as a manual-verification fixture.
- **Wrapping at the edges of the scope.** A direction with no eligible candidate moves nothing, and the chord is still consumed.
- **Reaching a candidate that is not currently rendered.** An inactive `Tab` page is hidden with `visibility: hidden`, so its contents still occupy a rectangle sitting exactly over the visible page's; the `isRenderedVisible` filter drops them, which is what keeps the search from ranking two overlapping stacks of candidates against each other. `FocusReveal` is still called on the way in, for the collapsed regions and off-screen scroll positions that *are* rendered.
- **Per-direction overrides.** There is no equivalent of CSS `nav-right` — geometry alone decides, and the marker is the only opt-in.
- **A cache of candidate rectangles.** See *Geometry is read fresh on every keypress*.
- **`Tab` / `Shift+Tab` traversal.** Owned by `FocusTraversal`, which shares only the scope helpers with this service.
- **Navigating inside a modal `Dialog` from outside it, or out of one.** The scope root is the topmost layer, so the search never crosses that boundary.
- **Enabling the service by default.** Only the demo app calls `enable()`.

---

## Notes

[^rename]: The branch calls the module `PanelNavigation`, and keeping that name would have saved renaming ten guard call sites and their ten test files. It was rejected because the fine tier navigates between individual controls, not panels — a `Slider` standing down for something called `PanelNavigation.claimsKey` reads as a mistake — and because "spatial navigation" is the established name for exactly this algorithm, so a reader recognises what the module does before opening it. The rename is safe now and only now: the feature has never been released, so no consumer holds the old name. The renames are mechanical and every one is covered by the zero-match grep in `## Verification`.

[^one-primitive]: The alternative was two search functions, one per tier. Rejected: the two would have had to agree on eligibility, weighting, and tie-breaking forever, and nothing would have enforced that. Making the shared part a pure function of rectangles also means the whole ranking rule is testable with plain numbers — no DOM harness, no seeded selectors — which is why Expected Behaviour 1–11 need no fixture at all.

[^weight]: The CSS Spatial Navigation specification's distance function is `euclidean + displacement − alignment − sqrt(overlap)`, with an `orthogonalWeight` of 30 for horizontal navigation and 2 for vertical, an `orthogonalBias`, and an `alignWeight` of 5. That machinery exists because the spec measures orthogonal deviation between *points*, so a candidate that overlaps the origin's band still accrues a penalty and needs a large counterweight to stay competitive. Measuring the *gap between spans* instead makes the penalty exactly zero for every candidate that shares any of the origin's band, so overlap already wins outright and no large weight is needed. The weight then only ever ranks candidates that all miss the band, where 2 — the spec's own vertical weight — means a sideways pixel costs twice a forward pixel. Reproducing the full four-term formula was rejected as unjustifiable complexity for a result that would differ only in contrived layouts.

[^stable-sort]: `Array.prototype.sort` has been required to be stable since ES2019, so a comparator that returns `0` for two candidates leaves them in the order the caller supplied — which is `querySelectorAll` order, i.e. DOM order. That matches the specification's own "first item in document order" tie-break without a third comparator arm.

[^marker]: A module-level registry (`SpatialNavigation.register(component)`) was rejected: it needs lifecycle management on destroy, it cannot be scoped to a layer root without a second containment pass, and it duplicates state the DOM would carry anyway. The attribute route is the shape `setTabKeyOwner` already established, and its JSDoc gives the reason in as many words — a consumer with no `Component` reference for an element can still discover the claim from the DOM alone. It also makes the target set a single seeded `querySelectorAll` offline, exactly like the focusable set.

[^scope]: Two alternatives were considered. Duplicating the six lines of `resolveRoot` and `collectTabStops` inside the new module keeps `FocusTraversal` untouched but lets the two services drift about what "in scope" means — and they must agree, because both answer "what can the keyboard reach right now". Calling `FocusTraversal.getTabStops()` from the service avoids all new code but couples one opt-in service to another's namespace for a pure helper, and names the spatial candidate set "tab stops". Moving both into `core/Focusable.ts` — the module that already exists to hold exactly these shared focus predicates, extracted from `Dialog` for the same reason — costs one small refactor of two private function bodies and single-sources the concept.

[^reveal]: The branch's `PanelNavigator extends FocusRevealer` exists so the service can find containers and reveal through the same registration. With the marker generalized, the service no longer looks containers up at all — it ranks rectangles — so the only thing left is the reveal, and `FocusReveal.reveal(handle)` already resolves that by DOM containment against the five registered revealers (`Split`, `Border`, `Tab`, `Accordion`, `Panel`). Making the marker imply `FocusRevealer` would have forced every marked component to implement two methods it has nothing to say about.

[^memory]: Recording on the way out — rather than through a standing `focusin` listener like `FocusHistory`'s — is the branch's own mechanism (`moveFocus` calls `navigator.recordFocus(origin)` before resolving), and it keeps the service to a single viewport listener. The cost is that focus moves made by other means are not recorded, so returning to a container the user left by clicking lands on its first focusable rather than the clicked control; that was already true on the branch and is not worth a second document-level listener. Recording against every marked ancestor rather than only the nearest is a one-line difference and makes the outer container's memory correct too.

[^chords]: `Ctrl+Shift`+arrow is the user's own choice, kept from the branch: no browser binds it, and the OS bindings that do collide with arrow chords are `Win`/`Super`+arrow (snapping and tiling), `Ctrl+Alt`+arrow (GNOME workspaces), and `Ctrl`+arrow (macOS spaces). `Ctrl+Alt`+arrow for the fine tier is likewise the user's choice, made in full knowledge of the GNOME collision — hence the configurable modifier set and the explicit manual check. Only the modifier set is configurable, not the whole per-direction combo: four arrows are a natural key group, unlike `FocusHistory`'s two independent accelerators. Deciding a same-modifier collision in favour of the component tier is arbitrary, but stating it beats leaving the outcome to whichever branch the implementer happens to write first.

[^no-cache]: A cache would have to be invalidated on every layout, scroll, resize, theme change, and DOM mutation — all of which move rectangles — and the framework has no existing invalidation channel for "some element somewhere moved". `FocusTraversal` faces the same choice for tab stops on every `Tab` press, which is a far more frequent key, and recomputes; following it is both the cheaper design and the conforming one.

[^new-pattern]: The precedent search covered the focus family (`FocusHistory`, `FocusReveal`, `FocusTraversal`, `Focusable`, `RovingTabIndex`), the layout managers, and every `getElementRect` call site in the library. Geometry is read in this codebase for anchoring overlays, scroll-into-view arithmetic, hit testing, and text measurement — never to rank a set of elements against a direction. `RovingTabIndex` is the nearest relative and is ordinal, not spatial. So this is the "no comparable problem already solved" case in `pattern-conformance.md`, and the algorithm is adapted from the CSS Spatial Navigation specification rather than invented — see `[^weight]` for what was taken and what was dropped.

[^offline-caveats]: The offline seam models everything the service touches: `getElementRect` composes from the inline-style `left`/`top`/`width`/`height` writes a test applies, `querySelectorAll` resolves seeded root+selector pairs, `hasAttribute` reads the folded `setAttr` writes, `isRenderedVisible` and `isConnected` read seeded flags, and `getActiveElement` reads the sink's recorded focus. The two gaps are `matches`, which always returns `false` offline, and `getBody`, which mints a fresh handle per call — both are covered in `## Potential Challenges` and both already have established workarounds in `FocusTraversal.test.ts`.
