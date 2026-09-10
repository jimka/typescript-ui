---
touches-shared:
  - packages/lib/src/typescript/lib/core/index.ts
  - packages/lib/src/typescript/lib/core/FocusHistory.ts
  - packages/lib/src/typescript/lib/core/Panel.ts
  - packages/lib/src/typescript/lib/layout/Tab.ts
  - packages/lib/src/typescript/lib/layout/Border.ts
  - packages/lib/src/typescript/lib/layout/Accordion.ts
  - packages/lib/src/typescript/lib/layout/Split.ts
---

# Reveal on Focus-History Navigation — Implementation Plan

## Overview

`FocusHistory.back()` / `forward()` re-focus a `Handle` from the trail, but do nothing to *surface* a target that is currently hidden — inside an unselected `Tab`, scrolled out of a scroll `Panel`, or in a collapsed `Border` / `Accordion` / `Split` region. For `Tab` this is fatal, not cosmetic: inactive tab content is hidden with `visibility: hidden` ([`Component.setVisible`](packages/lib/src/typescript/lib/core/Component.ts#L2106) writes `visibility: hidden`; [`Tab.doLayout`](packages/lib/src/typescript/lib/layout/Tab.ts#L2046) hides every inactive content), and a browser **cannot** move focus to a `visibility: hidden` element. Reveal must therefore be **proactive** — reveal first, *then* focus.

This plan adds a standalone module-level broker `FocusReveal` ([new `packages/lib/src/typescript/lib/core/FocusReveal.ts`](packages/lib/src/typescript/lib/core/FocusReveal.ts)) mirroring the `LayerManager` broker + `_listenerOwner` idiom ([`packages/lib/src/typescript/lib/core/LayerManager.ts`](packages/lib/src/typescript/lib/core/LayerManager.ts)). Hiding containers register themselves as `FocusRevealer`s; the broker, given a target `Handle`, invokes every registered revealer whose element contains the target, **outermost-first**. `FocusHistory` ([`packages/lib/src/typescript/lib/core/FocusHistory.ts`](packages/lib/src/typescript/lib/core/FocusHistory.ts)) becomes its first caller: `navigate()` reveals each candidate's ancestry, focuses with `preventScroll: true`, and **skips** any entry it cannot bring to a focusable state. `FocusHistory.onFocusIn` additionally stops recording focus that lands inside a table cell / cell editor.

The five revealers: `Tab`, `Border`, `Accordion`, `Split` (all `LayoutManager`s — register in `attach`, unregister in `detach`), and the scroll `Panel` (a `Component` — register when `autoScroll` is scrolling, unregister on `"none"` / `destructor`).

`plans/directional-panel-navigation.md` depends on this plan and extends `FocusRevealer` into its own `PanelNavigator` interface for `Split` and `Border`, reusing this broker's registry rather than adding a second one — see *Architecture Decisions* and *Non-Goals*.

---

## Architecture Decisions

### The broker holds `FocusRevealer` instances, not a component registry
The broker keeps a `Set<FocusRevealer>`. Each revealer exposes `getRevealElement(): Handle | null` (the container's own element) and `revealDescendant(target: Handle): void`. Containment is a DOM `contains` test between the revealer's element and the target — no global `id → Component` map is added, sidestepping element→Component resolution entirely (the task's explicit constraint). Each revealer does its *own* region→child mapping inside `revealDescendant`.

`FocusRevealer` stays reveal-only. `plans/directional-panel-navigation.md` extends it into a separate `PanelNavigator` interface (adding a last-focused-descendant lookup and a neighbour-direction resolver) rather than this plan growing members it has no use for itself — see `containing()` below, the shared primitive that lets a second interface reuse this same registry instead of keeping its own.[^extends]

### Outermost-first ordering is a hard invariant, exposed as its own query
Every registered revealer whose element contains the target lies on the target's DOM ancestor chain, so any two are nested and therefore totally ordered by containment. `containing(target)` returns them outermost-first: an **outer** container must act before an **inner** one, because an outer `Tab` must select its tab (making the inner content visible *and* laid out) before an inner scroll `Panel` can measure the target's geometry — a hidden inner panel has a zero/degenerate rect. Comparator: `DOM.source.contains(aEl, bEl) ? -1 : DOM.source.contains(bEl, aEl) ? 1 : 0`. `reveal(target)` is `containing(target).forEach(r => r.revealDescendant(target))` plus the disconnected-target guard — the ordering logic lives in one place so a second consumer (`directional-panel-navigation.md`'s neighbour walk, which wants the reverse order) does not re-derive it.

### Visibility-before-focus, and only `Tab` blocks focus
`FocusHistory` reveals, *then* focuses. Of the five revealers only `Tab` uses `visibility: hidden` — `Border` reveals a collapsed region via clip-path, `Accordion` clips content in an `overflow: hidden` wrapper, `Split` shrinks a pane to a strip, and a scroll `Panel` merely offsets — none of which prevent a browser from focusing the element. So only the `Tab` revealer must guarantee the target is *synchronously* visible before `navigate()` focuses. Tab selection normally re-lays out via `scheduleLayout()` (async — [`Tab._onBarTabPressed`](packages/lib/src/typescript/lib/layout/Tab.ts#L1038)), which would leave the content still `visibility: hidden` at the synchronous focus call. The `Tab` revealer therefore forces a synchronous `this.getContainer()?.doLayout()` after `setActiveContent`, so the `setVisible(true)` in `doLayout` is applied before focus.

### "Skip if unrevealable" replaces any sub-component classifier
`navigate()` walks the trail in the requested direction until an entry successfully reveals **and** focus actually lands on it (`DOM.source.getActiveElement() === handle`), or the trail end is reached. Whether focus landed is the operational success signal — a still-hidden element silently refuses focus and is skipped. This intentionally removes the need to classify "is this an internal sub-component"; landing on, e.g., a ComboBox's inner input is harmless.

### Lifecycle: register in `attach`/`detach`, plus reveal-time pruning as the leak guard
`Tab`, `Border`, `Accordion`, and `Split` all get an `attach(container)` override that calls `super.attach(container)` then registers, and an unregister added to their existing `detach` — see *Register / unregister sites* below for which of the four already have one half of that pair to build on. `setLayoutManager` calls `detach` on manager replacement, so these are the complete register/unregister sites. The scroll `Panel` registers in `setAutoScroll` (scrolling mode) and unregisters on `"none"` / in `destructor`. To close the one path neither hook covers — a container garbage-collected without a `detach` — `containing()` **prunes** at query time any revealer whose `getRevealElement()` returns a *disconnected* element (`!DOM.source.isConnected`). A revealer whose `getRevealElement()` returns `null` is different: `attach` can run before first render, so a freshly-registered container legitimately has no element yet. Pruning on `null` would permanently unregister it the first time `reveal`/`containing` runs before it ever renders — that revealer is skipped for this query but stays in `_revealers`, exactly as `directional-panel-navigation.md`'s own registry pruning already documents.[^prune] No change to the general `Component.destructor` is needed, keeping the change surgical.

### Record-time filter uses the `<td>`/`<th>` tag marker
`onFocusIn` must not record focus inside a table cell / cell editor. The DOM seam offers no `closest`/`matches`. Every framework cell renders as `<td>` ([`Cell`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L135)) or `<th>` ([`HeaderCell`](packages/lib/src/typescript/lib/component/table/cell/Header.ts#L204), [`ParentHeader`](packages/lib/src/typescript/lib/component/table/cell/ParentHeader.ts#L135)), and renderers/editors are descendants of that cell element — so an ancestor walk via `DOM.source.getParentNode` matching `getTagName() === "TD" || "TH"` catches cell content *and* in-cell editors. This is the only record-time exclusion, and it is offline-testable because `TestDOM` models `tagName` + parent natively (no new seam needed).

---

## Public API

New module [`packages/lib/src/typescript/lib/core/FocusReveal.ts`](packages/lib/src/typescript/lib/core/FocusReveal.ts), exported from [`packages/lib/src/typescript/lib/core/index.ts`](packages/lib/src/typescript/lib/core/index.ts) alongside `FocusHistory`:

```typescript
/** A container that can bring one of its hidden descendants into a focusable state. */
export interface FocusRevealer {
    /** The container's own element, used for containment + outermost-first ordering. Null when unrendered. */
    getRevealElement(): Handle | null;
    /** Reveal whichever of this container's regions/children is on the DOM path to `target`. */
    revealDescendant(target: Handle): void;
}

export namespace FocusReveal {
    export function register(revealer: FocusRevealer): void;
    export function unregister(revealer: FocusRevealer): void;
    /**
     * Registered revealers whose element contains `target`, outermost-first. Prunes
     * any revealer whose element has gone (a container GC'd without `detach`); one
     * whose element is still `null` (unrendered) is skipped but stays registered.
     */
    export function containing(target: Handle): FocusRevealer[];
    /** Reveal every registered revealer containing `target`, outermost-first. Returns false when `target` is disconnected. */
    export function reveal(target: Handle): boolean;
}
```

`containing` is exported (not just an internal helper) specifically so
`plans/directional-panel-navigation.md` can reuse this broker's registry for its own
neighbour walk instead of keeping a second `Set` — see *Non-Goals*.

Each revealer class gains the two `FocusRevealer` methods; no other public signatures change. `FocusHistory`'s public surface is unchanged.

---

## Implementation

### `FocusReveal.ts` (new)

```typescript
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";

export interface FocusRevealer {
    getRevealElement(): Handle | null;
    revealDescendant(target: Handle): void;
}

const _revealers = new Set<FocusRevealer>();

export namespace FocusReveal {
    export function register(revealer: FocusRevealer): void {
        _revealers.add(revealer);
    }

    export function unregister(revealer: FocusRevealer): void {
        _revealers.delete(revealer);
    }

    export function containing(target: Handle): FocusRevealer[] {
        // Collect the revealers whose element contains the target, pruning any
        // whose element has *rendered and then gone* (a container GC'd without
        // detach — the leak guard). A `null` element means "not rendered yet",
        // not "dead" — attach() can run before first render — so it is skipped
        // without being dropped from the registry.
        const found: Array<{ revealer: FocusRevealer; el: Handle }> = [];

        for (const revealer of _revealers) {
            const el = revealer.getRevealElement();

            if (el === null) {
                continue;
            }

            if (!DOM.source.isConnected(el)) {
                _revealers.delete(revealer);
                continue;
            }

            if (DOM.source.contains(el, target)) {
                found.push({ revealer, el });
            }
        }

        // Outermost-first: an outer container must select/expand before an inner
        // one can measure. All entries are nested (each contains `target`), so
        // this containment comparator is a total order over them.
        found.sort((a, b) =>
            DOM.source.contains(a.el, b.el) ? -1 : DOM.source.contains(b.el, a.el) ? 1 : 0);

        return found.map(entry => entry.revealer);
    }

    export function reveal(target: Handle): boolean {
        if (!DOM.source.isConnected(target)) {
            return false;
        }

        for (const revealer of containing(target)) {
            revealer.revealDescendant(target);
        }

        return true;
    }
}
```

### `FocusHistory.ts` changes

Add the import, replace `focusEntry` with a reveal+focus attempt under the guard, rewrite `navigate` to a skip-loop, and add the record-time cell filter.

```typescript
import { FocusReveal } from "~/core/FocusReveal.js";

// Replaces focusEntry(). Reveals ancestry then focuses with preventScroll; the
// whole op is guarded so any focus side effect during reveal isn't recorded.
// Returns true only when focus actually landed on `handle`.
function revealAndFocus(handle: Handle): boolean {
    _navigating = true;

    try {
        if (!FocusReveal.reveal(handle)) {
            return false;
        }

        DOM.sink.focus(handle, { preventScroll: true });

        return DOM.source.getActiveElement() === handle;
    } finally {
        _navigating = false;
    }
}

function navigate(direction: -1 | 1): boolean {
    pruneStale();

    let target = _index + direction;

    while (target >= 0 && target < _entries.length) {
        if (revealAndFocus(_entries[target])) {
            _index = target;
            fireChange();

            return true;
        }

        target += direction;
    }

    return false;
}

// Ancestor walk for the record filter (see Architecture Decisions).
function isInTableCell(handle: Handle): boolean {
    for (let h: Handle | null = handle; h !== null; h = DOM.source.getParentNode(h)) {
        const tag = DOM.source.getTagName(h);

        if (tag === "TD" || tag === "TH") {
            return true;
        }
    }

    return false;
}
```

`onFocusIn` gains the filter after interning:

```typescript
function onFocusIn(e: FocusEvent): void {
    if (!_enabled || _navigating) {
        return;
    }

    if (!DOM.source.isElement(e.target)) {
        return;
    }

    const handle = DOM.source.intern(e.target);

    if (isInTableCell(handle)) {
        return;
    }

    record(handle);
}
```

The old `focusEntry` function is deleted (its `fireChange` responsibility moves into `navigate`'s success branch; the guard/focus responsibility moves into `revealAndFocus`).

### Per-revealer `revealDescendant`

**Tab** ([`packages/lib/src/typescript/lib/layout/Tab.ts`](packages/lib/src/typescript/lib/layout/Tab.ts)) — `class Tab extends LayoutManager implements FocusRevealer`:
```typescript
getRevealElement(): Handle | null {
    return this.getContainer()?.getElement() ?? null;
}

revealDescendant(target: Handle): void {
    for (const entry of this._contents) {
        const el = entry.component?.getElement();

        if (el && DOM.source.contains(el, target)) {
            if (this.getVisibleComponent() !== entry.component) {
                this.setActiveContent(entry.component!);
                // scheduleLayout is async; force a synchronous layout so the
                // active content's setVisible(true) applies before FocusHistory focuses.
                this.getContainer()?.doLayout();
            }

            return;
        }
    }
}
```

**Border** ([`packages/lib/src/typescript/lib/layout/Border.ts`](packages/lib/src/typescript/lib/layout/Border.ts)) — uses the private `getRegionComponent` and public `isRegionCollapsed` / `setRegionCollapsed`:
```typescript
revealDescendant(target: Handle): void {
    for (const placement of [Placement.NORTH, Placement.SOUTH, Placement.WEST, Placement.EAST]) {
        const comp = this.getRegionComponent(placement);
        const el   = comp?.getElement();

        if (el && DOM.source.contains(el, target)) {
            if (this.isRegionCollapsed(placement)) {
                this.setRegionCollapsed(placement, false);
            }

            return;
        }
    }
}
```

**Accordion** ([`packages/lib/src/typescript/lib/layout/Accordion.ts`](packages/lib/src/typescript/lib/layout/Accordion.ts)) — section index aligns across `getComponents()`, `_headers`, and `openState`:
```typescript
revealDescendant(target: Handle): void {
    const container = this.getContainer();

    if (!container) {
        return;
    }

    const components = container.getComponents();

    for (let i = 0; i < components.length; i++) {
        const el = components[i].getElement();

        if (el && DOM.source.contains(el, target)) {
            if (!this.isSectionOpen(i)) {
                this.openSection(i);
            }

            return;
        }
    }
}
```

**Split** ([`packages/lib/src/typescript/lib/layout/Split.ts`](packages/lib/src/typescript/lib/layout/Split.ts)) — pane index resolved via `getLaidOutComponents()`, matching `isPaneCollapsed` / `setPaneCollapsed`:
```typescript
revealDescendant(target: Handle): void {
    const container = this.getContainer();

    if (!container) {
        return;
    }

    const panes = container.getLaidOutComponents();

    for (let i = 0; i < panes.length; i++) {
        const el = panes[i].getElement();

        if (el && DOM.source.contains(el, target)) {
            if (this.isPaneCollapsed(i)) {
                this.setPaneCollapsed(i, false);
            }

            return;
        }
    }
}
```

**Panel** ([`packages/lib/src/typescript/lib/core/Panel.ts`](packages/lib/src/typescript/lib/core/Panel.ts)) — scroll driven through the cached scroll API, never native `scrollIntoView`:
```typescript
getRevealElement(): Handle | null {
    return this.getElement() ?? null;
}

revealDescendant(target: Handle): void {
    const el = this.getScrollElement() ?? this.getElement();

    if (!el) {
        return;
    }

    const view = DOM.source.getElementRect(el);      // scroll viewport rect — the overlay inner element when scrollbarStyle is "overlay", else the panel's own element
    const rect = DOM.source.getElementRect(target);  // target's rect, same viewport frame

    if (rect.top < view.top) {
        this.setScrollTop(this.getScrollTop() - (view.top - rect.top));
    } else if (rect.bottom > view.bottom) {
        this.setScrollTop(this.getScrollTop() + (rect.bottom - view.bottom));
    }

    if (rect.left < view.left) {
        this.setScrollLeft(this.getScrollLeft() - (view.left - rect.left));
    } else if (rect.right > view.right) {
        this.setScrollLeft(this.getScrollLeft() + (rect.right - view.right));
    }
}
```
`setScrollTop` / `setScrollLeft` read the browser-clamped result back into the cache ([`Component.setScrollTop`](packages/lib/src/typescript/lib/core/Component.ts#L4264)), so no manual clamp to `getMaxScroll*` is needed; a non-scrolling axis has ~0 max range and does not move.

### Register / unregister sites

- **Tab / Accordion** — `Tab` already overrides both `attach` and `detach`; add `FocusReveal.register(this)` in `attach` (after `super.attach`) and `FocusReveal.unregister(this)` in `detach` (before/after `super.detach`). `Accordion` currently overrides only `detach` — add a new `attach(container)` override (`super.attach(container)` then register), the same shape as `Border` / `Split` below, plus `FocusReveal.unregister(this)` in its existing `detach`.
- **Border / Split** — override `detach` only; add an `attach(container)` override that calls `super.attach(container)` then `FocusReveal.register(this)`, and add `FocusReveal.unregister(this)` to the existing `detach`.
- **Panel** — in `setAutoScroll`, after computing the mode: `if (mode === "none") FocusReveal.unregister(this); else FocusReveal.register(this);` (both idempotent via the `Set`). `Panel` already overrides `destructor()` (`Panel.ts:680`, cleaning up scroll shadows and the overlay scrollbar) — add `FocusReveal.unregister(this);` as its first line, before the existing `this.removeScrollShadows();`; do not add a second `destructor()` method.

Each file adds `import { FocusReveal } from "~/core/FocusReveal.js";` and `import type { FocusRevealer } from "~/core/FocusReveal.js";` (all five already import `DOM`; `Border` already imports `Placement`).

---

## Ordered Implementation Steps

1. **Create [`packages/lib/src/typescript/lib/core/FocusReveal.ts`](packages/lib/src/typescript/lib/core/FocusReveal.ts)** with the `FocusRevealer` interface + `FocusReveal` namespace (`register`, `unregister`, `containing`, `reveal`) from *Implementation*. Export both from [`packages/lib/src/typescript/lib/core/index.ts`](packages/lib/src/typescript/lib/core/index.ts): a new `export { FocusReveal } from '~/core/FocusReveal.js';` line, mirroring the shape of the existing `export { FocusHistory } from '~/core/FocusHistory.js';` line at [`core/index.ts:43`](packages/lib/src/typescript/lib/core/index.ts#L43), and a new `export type { FocusRevealer } from '~/core/FocusReveal.js';` line — both additions this plan makes, not a mirror of line 44 (which exports `FocusHistory`'s own associated interfaces — `FocusHistoryOptions`, `FocusHistoryKeyCombo`, `FocusHistoryEvent`, `FocusHistoryChange` — not `FocusHistory` itself).
2. **`FocusHistory.ts`**: add the `FocusReveal` import; delete `focusEntry`; add `revealAndFocus` and `isInTableCell`; rewrite `navigate` to the skip-loop; add the cell filter to `onFocusIn`. Verify `back()`/`forward()` still call `navigate(-1)`/`navigate(1)`.
3. **`Tab.ts`**: add imports; `implements FocusRevealer`; add `getRevealElement` + `revealDescendant`; `FocusReveal.register(this)` in `attach`, `unregister` in `detach`.
4. **`Border.ts`**: add imports; `implements FocusRevealer`; add `getRevealElement` (`this.getContainer()?.getElement() ?? null`) + `revealDescendant`; add an `attach` override registering; `unregister` in the existing `detach`.
5. **`Accordion.ts`**: add imports; `implements FocusRevealer`; add `getRevealElement` + `revealDescendant`; add a **new** `attach(container)` override (`super.attach(container)` then register — `Accordion` has no `attach` override today, unlike `Tab`); `unregister` in the existing `detach`.
6. **`Split.ts`**: add imports; `implements FocusRevealer`; add `getRevealElement` + `revealDescendant`; add an `attach` override registering; `unregister` in the existing `detach`.
7. **`Panel.ts`**: add imports; `implements FocusRevealer`; add `getRevealElement` + `revealDescendant`; register/unregister in `setAutoScroll`; add `destructor` unregister.
8. **Typecheck**: `npm run typecheck` — expect zero errors. Grep check: `grep -rn "focusEntry" packages/lib/src/typescript/lib/core/FocusHistory.ts` — expect zero matches.
9. **Tests**: extend [`packages/lib/tests/unit/core/FocusHistory.test.ts`](packages/lib/tests/unit/core/FocusHistory.test.ts) and add [`packages/lib/tests/unit/core/FocusReveal.test.ts`](packages/lib/tests/unit/core/FocusReveal.test.ts) per *Verification*; run `npx vitest run packages/lib/tests/unit/core/FocusReveal.test.ts packages/lib/tests/unit/core/FocusHistory.test.ts`.
10. **Document.** Add a "Reveal on navigation" mention to
    [`packages/lib/docs/concepts/accessibility.md`](packages/lib/docs/concepts/accessibility.md)'s
    existing focus-history coverage, and a `### Core` entry under `## Added` in
    [`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md).
    Verify: `npm run docs:api` — zero warnings; `npm run build:docs` — clean.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/core/FocusReveal.ts` |
| Create | `packages/lib/tests/unit/core/FocusReveal.test.ts` |
| Modify | `packages/lib/src/typescript/lib/core/index.ts` (export `FocusReveal` + `FocusRevealer`) |
| Modify | `packages/lib/src/typescript/lib/core/FocusHistory.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Tab.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Border.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Accordion.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Split.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Panel.ts` |
| Modify | `packages/lib/tests/unit/core/FocusHistory.test.ts` |
| Modify | `packages/lib/docs/concepts/accessibility.md` — reveal-on-navigation mention |
| Modify | `packages/lib/docs/reference/changelog/next.md` — `### Core` entry |

---

## Expected Behaviour

Offline-testable through the `TestDOM` seam (`installTestDOM` + `makeEvent` + `setConnected`, plus `DOM.sink.createElement`/`appendChild` to build a modelled tree; `focus`/`getActiveElement` are modelled):

1. **Broker containment** — `reveal(target)` invokes `revealDescendant(target)` on a registered revealer whose element (via `appendChild`) is an ancestor of `target`, and does **not** invoke one whose element is not an ancestor.
2. **Outermost-first ordering** — given `outerEl ⊃ innerEl ⊃ target`, both registered, `reveal(target)` calls the outer revealer's `revealDescendant` **before** the inner's (assert recorded call order). `containing(target)` returns the same two revealers in the same order without invoking either.
3. **Disconnected target** — `reveal(target)` returns `false` and invokes nothing when `target` is not connected (`setConnected(target, false)`).
4. **Leak-guard pruning** — a registered revealer whose `getRevealElement()` returns a *disconnected* element is dropped from the set during `containing`/`reveal` and never invoked thereafter. A revealer whose `getRevealElement()` returns `null` is skipped for that call but is **not** dropped — a later call, after it renders, still finds it (distinguishes "not yet rendered" from "gone").
5. **navigate skips an unrevealable entry** — with a mocked `DOM.sink.focus` that refuses focus for a designated handle (leaves `getActiveElement()` unchanged), `back()` steps past that entry to the next focusable one; `_index` lands on the entry that took focus; the intermediate entry stays in the trail (skipped, not pruned — distinct from the existing stale-drop case).
6. **navigate returns false at trail end** — when no entry in the requested direction can take focus, `navigate` returns `false` and leaves `_index` unchanged.
7. **Reveal precedes focus** — `back()` to a hidden entry calls the containing revealer's `revealDescendant` (spy) **before** `DOM.sink.focus` (assert order via mock).
8. **preventScroll** — the service-driven focus passes `{ preventScroll: true }` (the recording sink records the options object on `focus`).
9. **`_navigating` guard still holds** — a `focusin` fired synchronously during reveal+focus is not recorded (the existing guard test must still pass; extend it to also fire the decoy during a mocked *reveal*).
10. **Record filter** — a `focusin` whose target is a descendant of a `<td>` (or `<th>`) element is **not** recorded (`canGoBack`/trail unchanged); a `focusin` on a plain element still records.
11. **All existing `FocusHistory` behaviours** (seed, dedupe, truncate, stale-skip, maxSize, modal-suppression, disable-preserves-trail, `"change"` payloads) remain green.

**Per-revealer `revealDescendant`**, each offline-checkable from committed state rather than visual output:

12. **`Tab`** — after `revealDescendant(target)` where `target` is inside a non-active tab's content, `Tab.getVisibleComponent()` becomes that content, and the forced synchronous `doLayout()` means the content's `isVisible()` is already `true` by the time `revealDescendant` returns (no async wait needed in the test).
13. **`Border`** — after `revealDescendant(target)` where `target` is inside a collapsed region, `Border.isRegionCollapsed(placement)` is `false` immediately afterward; a `target` inside an already-expanded region leaves `isRegionCollapsed` unchanged (no redundant toggle call).
14. **`Accordion`** — after `revealDescendant(target)` where `target` is inside a closed section, `Accordion.isSectionOpen(i)` is `true` immediately afterward; an already-open section is left untouched.
15. **`Split`** — after `revealDescendant(target)` where `target` is inside a collapsed pane, `Split.isPaneCollapsed(i)` is `false` immediately afterward; an already-expanded pane is left untouched.
16. **`Panel`** — `revealDescendant(target)` for a `target` above the visible viewport decreases `getScrollTop()` by exactly `view.top - rect.top` (checked from the recorded `scrollTop` write, using modelled rects from `TestDOM`); a `target` already inside the viewport leaves `getScrollTop()`/`getScrollLeft()` unchanged. The horizontal case mirrors this for `getScrollLeft()`.

**Manual verification required** (live-only — the modelled source cannot reproduce these):
- Real `visibility: hidden` focusability: that a `Tab` reveal makes the target genuinely focusable before focus lands.
- Real scroll geometry: that scrolling a `Panel` brings the target into the visible viewport (browser layout).
- Real collapse animations (`Border`/`Split`/`Accordion`) completing after focus already moved.

---

## Verification

- **Typecheck**: `npm run typecheck` — zero errors.
- **Grep invariants**: `grep -rn "focusEntry" packages/lib/src/typescript/lib/` — zero matches (function removed). `grep -rn "scrollIntoView" packages/lib/src/typescript/lib/core/Panel.ts` — zero matches (must use the cached scroll API, not native).
- **Unit tests**: `npx vitest run packages/lib/tests/unit/core/FocusReveal.test.ts packages/lib/tests/unit/core/FocusHistory.test.ts` — all green, covering Expected Behaviour 1–16. Mirror the existing `FocusHistory.test.ts` harness: `installTestDOM(CONFIG)` in each test, `afterEach` does `FocusHistory.disable(); FocusHistory.clear(); FocusReveal`-registrations cleared (register a fresh revealer per test and unregister in the test body or rely on reveal-time pruning after `DOM.reset()`), then `DOM.reset()`. Build modelled trees with `DOM.sink.createElement` + `DOM.sink.appendChild` + `setConnected`; drive focus via the existing `focusIn` / `keyDown` helpers; mock `DOM.sink.focus` (as the existing `_navigating`-guard test does) for the skip-loop and reveal-order assertions.
- **Full suite**: `npx vitest run` — no regressions.
- **Manual smoke** (dev app, `npm run dev`, http://localhost:8015): focus an element in tab A, switch to tab B, focus something there, then `Alt+[` — the app must **re-select tab A** and land focus on the original element. Repeat with (a) a control scrolled out of an `autoScroll` `Panel` (verify it scrolls into view via the framework scroll model, no scroll jump/corruption), (b) a control in a collapsed `Border` edge, `Accordion` section, and `Split` pane (verify each expands/restores then focuses). Confirm focusing a table cell / cell editor and then navigating away does **not** create a history stop on the cell.

---

## Documentation Impact

- `FocusReveal` and `FocusRevealer` are exported from
  [`packages/lib/src/typescript/lib/core/index.ts`](packages/lib/src/typescript/lib/core/index.ts),
  so TypeDoc renders them. Give the namespace, its exported functions, and the
  interface a `@category Core` JSDoc block, matching `FocusHistory`'s existing style.
- [`packages/lib/docs/concepts/accessibility.md`](packages/lib/docs/concepts/accessibility.md)
  already documents `FocusHistory`'s `back()`/`forward()`; add one paragraph there
  noting that navigation now reveals a hidden target (switches tabs, expands
  collapsed regions, scrolls) before focusing it, rather than a new top-level
  section — this plan changes `FocusHistory`'s existing behaviour, it does not add a
  separate feature surface.
- No `llms.txt` change: `FocusReveal` is a `namespace`, not a concrete class, so the
  coverage manifest (tracked from `scripts/llms/manifest.data.mjs`) needs no entry —
  matching the same reasoning `directional-panel-navigation.md` and
  `framework-focus-traversal.md` both use for their own namespace exports.
- Changelog: a `### Core` entry under `## Added` in
  [`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md)
  for `FocusReveal`, plus a `### Core` fix/change entry noting `FocusHistory.back()` /
  `forward()` now reveal before focusing (a behaviour change existing consumers should
  know about, even though the public signatures are unchanged).
- No sidebar change: `/concepts/accessibility` is already listed in
  [`packages/docs/src/content/pages.ts:155`](packages/docs/src/content/pages.ts#L155).

---

## Potential Challenges

- **Async tab layout**: `Tab` selection re-lays out via `scheduleLayout()` (async), so the newly active content stays `visibility: hidden` at the synchronous focus. Mitigation: the `Tab` revealer calls `this.getContainer()?.doLayout()` after `setActiveContent` to apply visibility synchronously (already in the snippet).
- **Reveal side-effect focus**: a revealer's state change could itself move focus (a tab select, a collapse). Mitigation: `revealAndFocus` wraps the *entire* reveal+focus in the `_navigating` guard, so any interim `focusin` is not recorded.
- **Animated collapse completing after focus**: `Border`/`Split`/`Accordion` reveal with a rAF animation. This does not block focus (those states are not `visibility: hidden`), so focus lands immediately and the animation catches up visually — acceptable; noted as manual-verify.
- **Panel scroll frame**: under the default `scrollbarStyle: "overlay"`, the panel's own element never scrolls — a separate, narrower inner element (`_overlayScrollElement`, installed by `installOverlayScrollbars`) is the actual scroll container, sized to leave room for the floating scrollbar gutter. `Panel.getScrollElement()` already resolves to that inner element when it exists, falling back to the panel's own element under `scrollbarStyle: "native"`; `revealDescendant` reads its viewport rect through `getScrollElement()` (not `getElement()`) for exactly this reason — reading the outer element's rect would treat the scrollbar gutter band as already-visible and under-scroll a target sitting there. `getScrollTop`/`setScrollTop` already route through the same resolution ([`Component.setScrollTop`](packages/lib/src/typescript/lib/core/Component.ts#L4227)), so only the geometry *read* needed the same fix.
- **Register-during-super**: `Panel.setAutoScroll` runs inside the `super()` options cascade, so `FocusReveal.register(this)` fires before the panel is fully constructed. Harmless — the broker only stores the reference; `getRevealElement`/`revealDescendant` are invoked later at reveal time.
- **A second consumer of the same registry**: `directional-panel-navigation.md`'s `PanelNavigator` extends `FocusRevealer` and registers through this same broker. `containing()` must stay a pure containment+ordering query with no side effects, so a consumer that only wants the list (not a `revealDescendant` sweep) can safely call it — this is already true of the implementation above, but keep it true through any future change here.

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/FocusHistory.ts`](packages/lib/src/typescript/lib/core/FocusHistory.ts) — the service being extended (`navigate`, `onFocusIn`, `focusEntry`, the `_navigating` guard, `pruneStale`).
- [`packages/lib/src/typescript/lib/core/LayerManager.ts`](packages/lib/src/typescript/lib/core/LayerManager.ts) — the module-broker + `Set`/`WeakMap` registry + `containsAcrossLayers` idiom to mirror.
- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) — `setVisible`/`visibility` (L2106), `getScrollTop`/`setScrollTop` (L4227/L4264), `getScrollLeft`/`setScrollLeft` (L4218/L4241), `getElement`, `getComponents`/`getLaidOutComponents` (L6780/L6794), `destructor` (L990).
- [`packages/lib/src/typescript/lib/core/DOM.ts`](packages/lib/src/typescript/lib/core/DOM.ts) — the seam: `focus(handle, { preventScroll })` (L608), `contains` (L1264), `getParentNode` (L1331), `getTagName` (L1463), `getElementRect` (L1027), `isConnected` (L1153), `getActiveElement` (L1179), `intern`/`isElement`.
- [`packages/lib/src/typescript/lib/layout/LayoutManager.ts`](packages/lib/src/typescript/lib/layout/LayoutManager.ts) — `attach`/`detach`/`getContainer` (the register hooks).
- [`packages/lib/src/typescript/lib/layout/Tab.ts`](packages/lib/src/typescript/lib/layout/Tab.ts) — `_contents` (L324), `getVisibleComponent`, `setActiveContent` (L2309), `indexOfContent` (L2273), `attach`/`detach` (L977/L999), `_onBarTabPressed` (L1038).
- [`packages/lib/src/typescript/lib/layout/Border.ts`](packages/lib/src/typescript/lib/layout/Border.ts) — `getRegionComponent` (L225), `isRegionCollapsed` (L241), `setRegionCollapsed` (L260), `detach` (L1146), `Placement`.
- [`packages/lib/src/typescript/lib/layout/Accordion.ts`](packages/lib/src/typescript/lib/layout/Accordion.ts) — `openSection` (L855), `isSectionOpen` (L940), `detach` (L1073) — **no existing `attach` override; this plan adds the first one.**
- [`packages/lib/src/typescript/lib/layout/Split.ts`](packages/lib/src/typescript/lib/layout/Split.ts) — `isPaneCollapsed` (L279), `setPaneCollapsed` (L399), `getLaidOutComponents` usage, `detach` (L1278).
- [`packages/lib/src/typescript/lib/core/Panel.ts`](packages/lib/src/typescript/lib/core/Panel.ts) — `setAutoScroll` (L339), scroll model on the panel's own element.
- [`packages/lib/src/typescript/lib/component/table/cell/Cell.ts`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts) — `<td>` tag (L135); [`Header.ts`](packages/lib/src/typescript/lib/component/table/cell/Header.ts) `<th>`.
- [`packages/lib/tests/dom/TestDOM.ts`](packages/lib/tests/dom/TestDOM.ts) — `setConnected`, `makeEvent`, `contains`/`getParentNode`/`getTagName`/`getElementRect` modelling, `focus`/`getActiveElement`.
- [`packages/lib/tests/unit/core/FocusHistory.test.ts`](packages/lib/tests/unit/core/FocusHistory.test.ts) — the harness style (offline `focusin`/`keydown` dispatch, `focus` mocking) to mirror.
- [`plans/directional-panel-navigation.md`](plans/directional-panel-navigation.md) — depends on this plan; extends `FocusRevealer` into `PanelNavigator` and reuses `FocusReveal.register`/`unregister`/`containing` for `Split` and `Border` rather than a second registry. Read its *Architecture Decisions* before changing this plan's registry shape.

---

## Non-Goals

- **No global `id → Component` registry** — the containment-against-registered-revealers approach replaces it (explicit task constraint).
- **No reactive `focusin` revealer** — reveal is proactive; a reactive handler is dead-on-arrival for `visibility: hidden` content (focus can never land to trigger it).
- **No sub-component "internal element" classifier** — the skip-if-unfocusable loop supersedes it.
- **No `Component.destructor` change** — reveal-time pruning is the leak guard, keeping the change surgical.
- **No new DOM-seam method** (`closest`/`matches`) — the ancestor-tag walk uses existing seam calls and stays offline-testable.
- **No neighbour-direction resolution or last-focused-descendant tracking on `FocusRevealer` itself.** That is `plans/directional-panel-navigation.md`'s `PanelNavigator extends FocusRevealer`, layered on top of this broker once this plan ships. `FocusRevealer` stays exactly the two reveal-only members above.

---

## Notes

[^extends]: `directional-panel-navigation.md`'s neighbour walk needs two things this
    broker has no use for on its own: a last-focused-descendant lookup per pane/region,
    and a direction-to-neighbour resolver. Rather than growing `FocusRevealer` to carry
    members only one consumer needs, that plan defines `PanelNavigator extends
    FocusRevealer` and registers through this same `register`/`unregister`, so `Split`
    and `Border` still have exactly one attach/detach registration each, not two.

[^prune]: An earlier design pruned on a `null` element too, treating "not yet
    rendered" the same as "gone". That breaks a container registered in `attach`
    before its first `doLayout` — a real sequence, since `setLayoutManager` calls
    `attach` immediately but rendering is deferred — because the very first
    `reveal`/`containing` call after such a registration would permanently drop it,
    and `attach` never runs again to re-add it. Pruning only a *rendered-then-
    disconnected* element (a real teardown-without-`detach` case) avoids that false
    positive.
</content>
