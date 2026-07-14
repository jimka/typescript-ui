# Reveal on Focus-History Navigation — Implementation Plan

## Overview

`FocusHistory.back()` / `forward()` re-focus a `Handle` from the trail, but do nothing to *surface* a target that is currently hidden — inside an unselected `Tab`, scrolled out of a scroll `Panel`, or in a collapsed `Border` / `Accordion` / `Split` region. For `Tab` this is fatal, not cosmetic: inactive tab content is hidden with `visibility: hidden` ([`Component.setVisible`](src/typescript/lib/core/Component.ts#L1417) writes `visibility: hidden`; [`Tab.doLayout`](src/typescript/lib/layout/Tab.ts#L1580) hides every inactive content), and a browser **cannot** move focus to a `visibility: hidden` element. Reveal must therefore be **proactive** — reveal first, *then* focus.

This plan adds a standalone module-level broker `FocusReveal` ([new `src/typescript/lib/core/FocusReveal.ts`](src/typescript/lib/core/FocusReveal.ts)) mirroring the `LayerManager` broker + `_listenerOwner` idiom ([`src/typescript/lib/core/LayerManager.ts`](src/typescript/lib/core/LayerManager.ts)). Hiding containers register themselves as `FocusRevealer`s; the broker, given a target `Handle`, invokes every registered revealer whose element contains the target, **outermost-first**. `FocusHistory` ([`src/typescript/lib/core/FocusHistory.ts`](src/typescript/lib/core/FocusHistory.ts)) becomes its first caller: `navigate()` reveals each candidate's ancestry, focuses with `preventScroll: true`, and **skips** any entry it cannot bring to a focusable state. `FocusHistory.onFocusIn` additionally stops recording focus that lands inside a table cell / cell editor.

The five revealers: `Tab`, `Border`, `Accordion`, `Split` (all `LayoutManager`s — register in `attach`, unregister in `detach`), and the scroll `Panel` (a `Component` — register when `autoScroll` is scrolling, unregister on `"none"` / `destructor`).

---

## Architecture Decisions

### The broker holds `FocusRevealer` instances, not a component registry
The broker keeps a `Set<FocusRevealer>`. Each revealer exposes `getRevealElement(): Handle | null` (the container's own element) and `revealDescendant(target: Handle): void`. Containment is a DOM `contains` test between the revealer's element and the target — no global `id → Component` map is added, sidestepping element→Component resolution entirely (the task's explicit constraint). Each revealer does its *own* region→child mapping inside `revealDescendant`.

### Outermost-first ordering is a hard invariant
Every registered revealer whose element contains the target lies on the target's DOM ancestor chain, so any two are nested and therefore totally ordered by containment. The broker sorts them so an **outer** container acts before an **inner** one: an outer `Tab` must select its tab (making the inner content visible *and* laid out) before an inner scroll `Panel` can measure the target's geometry — a hidden inner panel has a zero/degenerate rect. Comparator: `DOM.source.contains(aEl, bEl) ? -1 : DOM.source.contains(bEl, aEl) ? 1 : 0`.

### Visibility-before-focus, and only `Tab` blocks focus
`FocusHistory` reveals, *then* focuses. Of the five revealers only `Tab` uses `visibility: hidden` — `Border` reveals a collapsed region via clip-path, `Accordion` clips content in an `overflow: hidden` wrapper, `Split` shrinks a pane to a strip, and a scroll `Panel` merely offsets — none of which prevent a browser from focusing the element. So only the `Tab` revealer must guarantee the target is *synchronously* visible before `navigate()` focuses. Tab selection normally re-lays out via `scheduleLayout()` (async — [`Tab._onBarTabPressed`](src/typescript/lib/layout/Tab.ts#L990)), which would leave the content still `visibility: hidden` at the synchronous focus call. The `Tab` revealer therefore forces a synchronous `this.getContainer()?.doLayout()` after `setActiveContent`, so the `setVisible(true)` in `doLayout` is applied before focus.

### "Skip if unrevealable" replaces any sub-component classifier
`navigate()` walks the trail in the requested direction until an entry successfully reveals **and** focus actually lands on it (`DOM.source.getActiveElement() === handle`), or the trail end is reached. Whether focus landed is the operational success signal — a still-hidden element silently refuses focus and is skipped. This intentionally removes the need to classify "is this an internal sub-component"; landing on, e.g., a ComboBox's inner input is harmless.

### Lifecycle: register in `attach`/`detach`, plus reveal-time pruning as the leak guard
The four `LayoutManager` revealers already override `attach` / `detach` ([`Tab`](src/typescript/lib/layout/Tab.ts#L918), [`Border`](src/typescript/lib/layout/Border.ts#L1109), [`Accordion`](src/typescript/lib/layout/Accordion.ts#L992), [`Split`](src/typescript/lib/layout/Split.ts#L790)) — these are the register/unregister sites (`setLayoutManager` calls `detach` on manager replacement). The scroll `Panel` registers in `setAutoScroll` (scrolling mode) and unregisters on `"none"` / in `destructor`. To close the one path that neither hook covers — a container garbage-collected without a `detach` — the broker **prunes** at reveal time any revealer whose `getRevealElement()` returns `null` or a disconnected element (`!DOM.source.isConnected`). No change to the general `Component.destructor` is needed, keeping the change surgical.

### Record-time filter uses the `<td>`/`<th>` tag marker
`onFocusIn` must not record focus inside a table cell / cell editor. The DOM seam offers no `closest`/`matches`. Every framework cell renders as `<td>` ([`Cell`](src/typescript/lib/component/table/cell/Cell.ts#L50)) or `<th>` ([`HeaderCell`](src/typescript/lib/component/table/cell/Header.ts#L103), [`ParentHeader`](src/typescript/lib/component/table/cell/ParentHeader.ts#L47)), and renderers/editors are descendants of that cell element — so an ancestor walk via `DOM.source.getParentNode` matching `getTagName() === "TD" || "TH"` catches cell content *and* in-cell editors. This is the only record-time exclusion, and it is offline-testable because `TestDOM` models `tagName` + parent natively (no new seam needed).

---

## Public API

New module [`src/typescript/lib/core/FocusReveal.ts`](src/typescript/lib/core/FocusReveal.ts), exported from [`src/typescript/lib/core/index.ts`](src/typescript/lib/core/index.ts) alongside `FocusHistory`:

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
    /** Reveal every registered revealer containing `target`, outermost-first. Returns false when `target` is disconnected. */
    export function reveal(target: Handle): boolean;
}
```

Each revealer class gains the two interface methods; no other public signatures change. `FocusHistory`'s public surface is unchanged.

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

    export function reveal(target: Handle): boolean {
        if (!DOM.source.isConnected(target)) {
            return false;
        }

        // Collect the revealers whose element contains the target, pruning any
        // whose element has gone (a container GC'd without detach — the leak guard).
        const containing: Array<{ revealer: FocusRevealer; el: Handle }> = [];

        for (const revealer of _revealers) {
            const el = revealer.getRevealElement();

            if (el === null || !DOM.source.isConnected(el)) {
                _revealers.delete(revealer);
                continue;
            }

            if (DOM.source.contains(el, target)) {
                containing.push({ revealer, el });
            }
        }

        // Outermost-first: an outer container must select/expand before an inner
        // one can measure. All entries are nested (each contains `target`), so
        // this containment comparator is a total order over them.
        containing.sort((a, b) =>
            DOM.source.contains(a.el, b.el) ? -1 : DOM.source.contains(b.el, a.el) ? 1 : 0);

        for (const { revealer } of containing) {
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

**Tab** ([`src/typescript/lib/layout/Tab.ts`](src/typescript/lib/layout/Tab.ts)) — `class Tab extends LayoutManager implements FocusRevealer`:
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

**Border** ([`src/typescript/lib/layout/Border.ts`](src/typescript/lib/layout/Border.ts)) — uses the private `getRegionComponent` and public `isRegionCollapsed` / `setRegionCollapsed`:
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

**Accordion** ([`src/typescript/lib/layout/Accordion.ts`](src/typescript/lib/layout/Accordion.ts)) — section index aligns across `getComponents()`, `_headers`, and `openState`:
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

**Split** ([`src/typescript/lib/layout/Split.ts`](src/typescript/lib/layout/Split.ts)) — pane index resolved via `getLaidOutComponents()`, matching `isPaneCollapsed` / `setPaneCollapsed`:
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

**Panel** ([`src/typescript/lib/core/Panel.ts`](src/typescript/lib/core/Panel.ts)) — scroll driven through the cached scroll API, never native `scrollIntoView`:
```typescript
getRevealElement(): Handle | null {
    return this.getElement() ?? null;
}

revealDescendant(target: Handle): void {
    const el = this.getElement();

    if (!el) {
        return;
    }

    const view = DOM.source.getElementRect(el);      // scroll container's viewport rect
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
`setScrollTop` / `setScrollLeft` read the browser-clamped result back into the cache ([`Component.setScrollTop`](src/typescript/lib/core/Component.ts#L3080)), so no manual clamp to `getMaxScroll*` is needed; a non-scrolling axis has ~0 max range and does not move.

### Register / unregister sites

- **Tab / Accordion** — already override both `attach` and `detach`; add `FocusReveal.register(this)` in `attach` (after `super.attach`) and `FocusReveal.unregister(this)` in `detach` (before/after `super.detach`).
- **Border / Split** — override `detach` only; add an `attach(container)` override that calls `super.attach(container)` then `FocusReveal.register(this)`, and add `FocusReveal.unregister(this)` to the existing `detach`.
- **Panel** — in `setAutoScroll`, after computing the mode: `if (mode === "none") FocusReveal.unregister(this); else FocusReveal.register(this);` (both idempotent via the `Set`). Add a `destructor()` override: `FocusReveal.unregister(this); super.destructor();`.

Each file adds `import { FocusReveal } from "~/core/FocusReveal.js";` and `import type { FocusRevealer } from "~/core/FocusReveal.js";` (all five already import `DOM`; `Border` already imports `Placement`).

---

## Ordered Implementation Steps

1. **Create [`src/typescript/lib/core/FocusReveal.ts`](src/typescript/lib/core/FocusReveal.ts)** with the `FocusRevealer` interface + `FocusReveal` namespace from *Implementation*. Export both from [`src/typescript/lib/core/index.ts`](src/typescript/lib/core/index.ts) (mirror the existing `FocusHistory` export lines 33–34: `export { FocusReveal }` + `export type { FocusRevealer }`).
2. **`FocusHistory.ts`**: add the `FocusReveal` import; delete `focusEntry`; add `revealAndFocus` and `isInTableCell`; rewrite `navigate` to the skip-loop; add the cell filter to `onFocusIn`. Verify `back()`/`forward()` still call `navigate(-1)`/`navigate(1)`.
3. **`Tab.ts`**: add imports; `implements FocusRevealer`; add `getRevealElement` + `revealDescendant`; `FocusReveal.register(this)` in `attach`, `unregister` in `detach`.
4. **`Border.ts`**: add imports; `implements FocusRevealer`; add `getRevealElement` (`this.getContainer()?.getElement() ?? null`) + `revealDescendant`; add an `attach` override registering; `unregister` in the existing `detach`.
5. **`Accordion.ts`**: add imports; `implements FocusRevealer`; add `getRevealElement` + `revealDescendant`; register in `attach`, unregister in `detach`.
6. **`Split.ts`**: add imports; `implements FocusRevealer`; add `getRevealElement` + `revealDescendant`; add an `attach` override registering; `unregister` in the existing `detach`.
7. **`Panel.ts`**: add imports; `implements FocusRevealer`; add `getRevealElement` + `revealDescendant`; register/unregister in `setAutoScroll`; add `destructor` unregister.
8. **Typecheck**: `npm run type-check` (or the project's tsc script) — expect zero errors. Grep check: `grep -rn "focusEntry" src/typescript/lib/core/FocusHistory.ts` — expect zero matches.
9. **Tests**: extend [`tests/unit/core/FocusHistory.test.ts`](tests/unit/core/FocusHistory.test.ts) and add [`tests/unit/core/FocusReveal.test.ts`](tests/unit/core/FocusReveal.test.ts) per *Verification*; run `npx vitest run tests/unit/core/FocusReveal.test.ts tests/unit/core/FocusHistory.test.ts`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/core/FocusReveal.ts` |
| Create | `tests/unit/core/FocusReveal.test.ts` |
| Modify | `src/typescript/lib/core/index.ts` (export `FocusReveal` + `FocusRevealer`) |
| Modify | `src/typescript/lib/core/FocusHistory.ts` |
| Modify | `src/typescript/lib/layout/Tab.ts` |
| Modify | `src/typescript/lib/layout/Border.ts` |
| Modify | `src/typescript/lib/layout/Accordion.ts` |
| Modify | `src/typescript/lib/layout/Split.ts` |
| Modify | `src/typescript/lib/core/Panel.ts` |
| Modify | `tests/unit/core/FocusHistory.test.ts` |

---

## Expected Behaviour

Offline-testable through the `TestDOM` seam (`installTestDOM` + `makeEvent` + `setConnected`, plus `DOM.sink.createElement`/`appendChild` to build a modelled tree; `focus`/`getActiveElement` are modelled):

1. **Broker containment** — `reveal(target)` invokes `revealDescendant(target)` on a registered revealer whose element (via `appendChild`) is an ancestor of `target`, and does **not** invoke one whose element is not an ancestor.
2. **Outermost-first ordering** — given `outerEl ⊃ innerEl ⊃ target`, both registered, `reveal(target)` calls the outer revealer's `revealDescendant` **before** the inner's (assert recorded call order).
3. **Disconnected target** — `reveal(target)` returns `false` and invokes nothing when `target` is not connected (`setConnected(target, false)`).
4. **Leak-guard pruning** — a registered revealer whose `getRevealElement()` returns `null` (or a disconnected element) is dropped from the set during `reveal` and never invoked thereafter.
5. **navigate skips an unrevealable entry** — with a mocked `DOM.sink.focus` that refuses focus for a designated handle (leaves `getActiveElement()` unchanged), `back()` steps past that entry to the next focusable one; `_index` lands on the entry that took focus; the intermediate entry stays in the trail (skipped, not pruned — distinct from the existing stale-drop case).
6. **navigate returns false at trail end** — when no entry in the requested direction can take focus, `navigate` returns `false` and leaves `_index` unchanged.
7. **Reveal precedes focus** — `back()` to a hidden entry calls the containing revealer's `revealDescendant` (spy) **before** `DOM.sink.focus` (assert order via mock).
8. **preventScroll** — the service-driven focus passes `{ preventScroll: true }` (the recording sink records the options object on `focus`).
9. **`_navigating` guard still holds** — a `focusin` fired synchronously during reveal+focus is not recorded (the existing guard test must still pass; extend it to also fire the decoy during a mocked *reveal*).
10. **Record filter** — a `focusin` whose target is a descendant of a `<td>` (or `<th>`) element is **not** recorded (`canGoBack`/trail unchanged); a `focusin` on a plain element still records.
11. **All existing `FocusHistory` behaviours** (seed, dedupe, truncate, stale-skip, maxSize, modal-suppression, disable-preserves-trail, `"change"` payloads) remain green.

Per-container `revealDescendant` reveal *primitives* are unit-checkable at the seam level for state (e.g. after `revealDescendant`, `Tab.getVisibleComponent()` is the target's content; `Split.isPaneCollapsed(i)` is `false`; `Panel.getScrollTop()` moved by the computed delta from written rects), but require constructing modelled geometry; the scroll delta math is offline-testable from recorded style writes.

**Manual verification required** (live-only — the modelled source cannot reproduce these):
- Real `visibility: hidden` focusability: that a `Tab` reveal makes the target genuinely focusable before focus lands.
- Real scroll geometry: that scrolling a `Panel` brings the target into the visible viewport (browser layout).
- Real collapse animations (`Border`/`Split`/`Accordion`) completing after focus already moved.

---

## Verification

- **Typecheck**: `npm run type-check` — zero errors.
- **Grep invariants**: `grep -rn "focusEntry" src/typescript/lib/` — zero matches (function removed). `grep -rn "scrollIntoView" src/typescript/lib/core/Panel.ts` — zero matches (must use the cached scroll API, not native).
- **Unit tests**: `npx vitest run tests/unit/core/FocusReveal.test.ts tests/unit/core/FocusHistory.test.ts` — all green, covering Expected Behaviour 1–11. Mirror the existing `FocusHistory.test.ts` harness: `installTestDOM(CONFIG)` in each test, `afterEach` does `FocusHistory.disable(); FocusHistory.clear(); FocusReveal`-registrations cleared (register a fresh revealer per test and unregister in the test body or rely on reveal-time pruning after `DOM.reset()`), then `DOM.reset()`. Build modelled trees with `DOM.sink.createElement` + `DOM.sink.appendChild` + `setConnected`; drive focus via the existing `focusIn` / `keyDown` helpers; mock `DOM.sink.focus` (as the existing `_navigating`-guard test does) for the skip-loop and reveal-order assertions.
- **Full suite**: `npx vitest run` — no regressions.
- **Manual smoke** (dev app, `npm run dev`, http://localhost:8015): focus an element in tab A, switch to tab B, focus something there, then `Alt+[` — the app must **re-select tab A** and land focus on the original element. Repeat with (a) a control scrolled out of an `autoScroll` `Panel` (verify it scrolls into view via the framework scroll model, no scroll jump/corruption), (b) a control in a collapsed `Border` edge, `Accordion` section, and `Split` pane (verify each expands/restores then focuses). Confirm focusing a table cell / cell editor and then navigating away does **not** create a history stop on the cell.

---

## Potential Challenges

- **Async tab layout**: `Tab` selection re-lays out via `scheduleLayout()` (async), so the newly active content stays `visibility: hidden` at the synchronous focus. Mitigation: the `Tab` revealer calls `this.getContainer()?.doLayout()` after `setActiveContent` to apply visibility synchronously (already in the snippet).
- **Reveal side-effect focus**: a revealer's state change could itself move focus (a tab select, a collapse). Mitigation: `revealAndFocus` wraps the *entire* reveal+focus in the `_navigating` guard, so any interim `focusin` is not recorded.
- **Animated collapse completing after focus**: `Border`/`Split`/`Accordion` reveal with a rAF animation. This does not block focus (those states are not `visibility: hidden`), so focus lands immediately and the animation catches up visually — acceptable; noted as manual-verify.
- **Panel scroll frame**: `autoScroll` sets `overflow` directly on the panel's own element ([`Panel.setAutoScroll`](src/typescript/lib/core/Panel.ts#L258)), so `getElement()` *is* the scroll container and `getScrollTop`/`setScrollTop` apply to it — no content-frame indirection to account for.
- **Register-during-super**: `Panel.setAutoScroll` runs inside the `super()` options cascade, so `FocusReveal.register(this)` fires before the panel is fully constructed. Harmless — the broker only stores the reference; `getRevealElement`/`revealDescendant` are invoked later at reveal time.

---

## Critical Files

- [`src/typescript/lib/core/FocusHistory.ts`](src/typescript/lib/core/FocusHistory.ts) — the service being extended (`navigate`, `onFocusIn`, `focusEntry`, the `_navigating` guard, `pruneStale`).
- [`src/typescript/lib/core/LayerManager.ts`](src/typescript/lib/core/LayerManager.ts) — the module-broker + `Set`/`WeakMap` registry + `containsAcrossLayers` idiom to mirror.
- [`src/typescript/lib/core/Component.ts`](src/typescript/lib/core/Component.ts) — `setVisible`/`visibility` (L1417), `getScrollTop`/`setScrollTop`/`getScrollLeft`/`setScrollLeft` (L3034–3093), `getElement`, `getComponents`/`getLaidOutComponents` (L4503/L4517), `destructor` (L615).
- [`src/typescript/lib/core/DOM.ts`](src/typescript/lib/core/DOM.ts) — the seam: `focus(handle, { preventScroll })` (L574), `contains` (L1046), `getParentNode` (L1080), `getTagName` (L1182), `getElementRect` (L889), `isConnected` (L996), `getActiveElement` (L1007), `intern`/`isElement`.
- [`src/typescript/lib/layout/LayoutManager.ts`](src/typescript/lib/layout/LayoutManager.ts) — `attach`/`detach`/`getContainer` (the register hooks).
- [`src/typescript/lib/layout/Tab.ts`](src/typescript/lib/layout/Tab.ts) — `_contents` (L269), `getVisibleComponent`, `setActiveContent` (L1811), `indexOfContent` (L1775), `attach`/`detach` (L918/L939), `_onBarTabPressed` (L969).
- [`src/typescript/lib/layout/Border.ts`](src/typescript/lib/layout/Border.ts) — `getRegionComponent` (L217), `isRegionCollapsed` (L233), `setRegionCollapsed` (L252), `detach` (L1109), `Placement`.
- [`src/typescript/lib/layout/Accordion.ts`](src/typescript/lib/layout/Accordion.ts) — `openSection` (L853), `isSectionOpen` (L938), `attach`/`detach` (L992/L1002).
- [`src/typescript/lib/layout/Split.ts`](src/typescript/lib/layout/Split.ts) — `isPaneCollapsed` (L116), `setPaneCollapsed` (L236), `getLaidOutComponents` usage (L122), `detach` (L790).
- [`src/typescript/lib/core/Panel.ts`](src/typescript/lib/core/Panel.ts) — `setAutoScroll` (L258), scroll model on the panel's own element.
- [`src/typescript/lib/component/table/cell/Cell.ts`](src/typescript/lib/component/table/cell/Cell.ts) — `<td>` tag + `gridcell` role (L50/L54); [`Header.ts`](src/typescript/lib/component/table/cell/Header.ts) `<th>`.
- [`tests/dom/TestDOM.ts`](tests/dom/TestDOM.ts) — `setConnected`, `makeEvent`, `contains`/`getParentNode`/`getTagName`/`getElementRect` modelling, `focus`/`getActiveElement`.
- [`tests/unit/core/FocusHistory.test.ts`](tests/unit/core/FocusHistory.test.ts) — the harness style (offline `focusin`/`keydown` dispatch, `focus` mocking) to mirror.

---

## Non-Goals

- **No global `id → Component` registry** — the containment-against-registered-revealers approach replaces it (explicit task constraint).
- **No reactive `focusin` revealer** — reveal is proactive; a reactive handler is dead-on-arrival for `visibility: hidden` content (focus can never land to trigger it).
- **No sub-component "internal element" classifier** — the skip-if-unfocusable loop supersedes it.
- **No `Component.destructor` change** — reveal-time pruning is the leak guard, keeping the change surgical.
- **No new DOM-seam method** (`closest`/`matches`) — the ancestor-tag walk uses existing seam calls and stays offline-testable.
