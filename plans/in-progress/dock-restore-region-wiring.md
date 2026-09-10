# Dock Restore Region Wiring — Implementation Plan

## Overview

[`Dock.wireRegion`](packages/lib/src/typescript/lib/overlay/Dock.ts#L1323) is the idempotent sweep step that makes a region's `Tab` reorderable, applies the dock-wide tab-strip options, and subscribes the seven listeners (`empty`, `tabclose`, `activate`, `detach`, `dock`, `beforetabclose`, `tabdblclick`) that let close/focus/detach/dock events reach `Dock`'s own handlers. It guards this work with a per-region ledger, `_wiring: Map<Component, RegionWiring>` ([Dock.ts:250](packages/lib/src/typescript/lib/overlay/Dock.ts#L250)), so a region already wired is never wired twice.

[`Dock.setLayoutState`](packages/lib/src/typescript/lib/overlay/Dock.ts#L591) delegates to [`restoreLayout`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L623), which — for the common case where the root holds a split or a tab arrangement — calls [`populateContainer`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L505) directly on `Dock.getRootRegion()`'s own `Component`. `populateContainer` gives that **same** `Component` a **new** `Tab` via `container.setLayoutManager(new Tab(...))` ([LayoutSerialization.ts:529-530](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L529)) rather than replacing the container itself. `wireRegion`'s ledger is keyed on the container, not on which `Tab` instance is currently attached to it, so once the root has been wired once — which happens on the very first sweep, before any restore ever runs — the guard is permanently satisfied for that `Component` and the fresh `Tab` a restore installs never receives `applyTabOptions` or any of the seven listeners. This is not a rare edge case: every `Dock` wraps its root in a `Tab` (even for a single panel), so every `setLayoutState` restore with at least one panel drives this path. The confirmed, user-visible symptom — closing a dirty tab in the root region no longer prompting to save — is documented in `plans/implemented/dock-panel-tab-control.md`'s `## Implementation Notes` (where the bug was first found, reading it off `master` as pre-existing and out of scope for that plan) and, more concretely, `/home/jika/typescript/loom/plans/implemented/dock-split-pane-editing.md`'s `## Implementation Notes` (where it was confirmed to break Loom's unsaved-changes prompt after every restart that restores at least one file).

This plan fixes `wireRegion`'s guard so it notices a manager swapped in place, in [`packages/lib/src/typescript/lib/overlay/Dock.ts`](packages/lib/src/typescript/lib/overlay/Dock.ts) only. `LayoutSerialization.ts` is untouched — see `## Architecture Decisions`.

---

## Architecture Decisions

### `RegionWiring`'s Tab-listener guard keys on the `Tab` instance, not just the region `Component`

`RegionWiring.tabWired: boolean` becomes `RegionWiring.wiredTab: Tab | null` — the `Tab` instance `wireRegion` last ran `setReorderable`/`applyTabOptions`/the seven `tab.on(...)` subscriptions against, or `null` before that has happened for the region's current manager. `wireRegion` re-runs that block whenever `region.getLayoutManager()` is a `Tab` whose identity differs from `wiredTab`, not just when the region has never been seen before. A steady-state sweep against an unchanged `Tab` instance still short-circuits exactly as it does today — `wiredTab === tab` is the same no-op the old `tabWired` boolean produced.[^rebind-precedent]

### The fix stays inside `Dock.ts`; `LayoutSerialization.ts` is unchanged

`restoreLayout`/`populateContainer` rebuilding the root's manager in place is legitimate, reusable behaviour, not the bug — `restoreLayout` is a public, `Dock`-independent function (`LayoutSerializationPanel.ts` also calls it) with no knowledge of, or business knowing about, `Dock`'s private `_wiring` ledger. Threading a ledger-reset call into it would couple a generic serialization utility to one consumer's internal bookkeeping. `DockRegion` needs no change either: every place it reads a region's manager (`DockRegion.ts:321,373,447,642`) calls `this._region.getLayoutManager()` live, never caching the instance, so its edge/centre drop coordination already works correctly across a manager swap — only the `Tab`-instance-scoped listener wiring in `wireRegion` was ever stale.[^rejected-clear]

### This is not a third instance of `dock-panel-tab-control.md`'s "same fix shape, different construction site"

That plan's two fixes (`DockRegion.newStack()`, `TabWindow`'s tear-off constructor) each added a missing `applyTabOptions` call *inside* a `wireRegion` block that was already firing correctly — both sites build a brand-new `Component` **and** a brand-new `Tab` together, so the identity-keyed ledger already recognised them as unseen. The restore-path bug this plan fixes is different: `populateContainer` reuses the **same** root `Component` and swaps only its manager, so `wireRegion`'s guard never even reaches the "wire it" branch — nothing was missing from inside the guard; the guard's own key was wrong. The fix is therefore to `wireRegion`'s ledger itself, not an added call inside an already-correct branch.[^rejected-restructure]

---

## Internal Structure

`RegionWiring` ([Dock.ts:211-216](packages/lib/src/typescript/lib/overlay/Dock.ts#L211)):

```ts
interface RegionWiring {
    /** The region's edge/centre drop coordinator (torn down on teardown). */
    dockRegion: DockRegion;
    /**
     * The `Tab` instance last wired with `setReorderable(true)` + the
     * prune-on-`"empty"` subscription + the seven `tab.on(...)` handlers, or
     * `null` before that has run for this region's current manager. Compared
     * by identity against `region.getLayoutManager()` on every sweep, so a
     * manager rebuilt in place on the same `Component` (a `setLayoutState`
     * restore) is re-wired instead of permanently skipped.
     */
    wiredTab: Tab | null;
}
```

`wireRegion` ([Dock.ts:1323-1373](packages/lib/src/typescript/lib/overlay/Dock.ts#L1323)):

```ts
private wireRegion(region: Component): void {
    let wiring = this._wiring.get(region);

    if (!wiring) {
        wiring = { dockRegion: new DockRegion(region, this.requestSweep), wiredTab: null };

        this._wiring.set(region, wiring);
    }

    if (this.isTab(region)) {
        const tab: Tab = region.getLayoutManager() as Tab;

        if (wiring.wiredTab !== tab) {
            tab.setReorderable(true);
            // Applies the dock-wide presentation to a Tab instance this sweep
            // is wiring for the first time — the only way setTabOptions's
            // "every region it builds later" promise reaches a region a
            // drag-driven edge split creates (DockRegion.newStack() builds
            // its own plain Tab, with no knowledge of Dock's _tabOptions at
            // all) or a setLayoutState restore rebuilds in place
            // (LayoutSerialization's populateContainer calls
            // container.setLayoutManager(new Tab(...)) on the SAME region
            // Component this method already wired once); an already-wired
            // Tab instance got it immediately from setTabOptions's own loop.
            this.applyTabOptions(tab, this._tabOptions);
            // Per-region prune; the named const carries the region the shared
            // handler set otherwise could not (ARCHITECTURE: a listener is a named
            // reference, never an inline arrow).
            const onEmpty: () => void = (): void => { this.pruneRegion(region); };

            tab.on("empty", onEmpty);
            // The lifecycle handlers are shared bound methods: their payloads (the
            // closed/activated content, the torn-off window) carry the identity
            // they need, so no per-region capture is required.
            tab.on("tabclose",  this.onPanelClosed);
            tab.on("activate", this.onPanelFocused);
            tab.on("detach",  this.onPanelDetached);
            tab.on("dock",    this.onPanelDocked);
            tab.on("beforetabclose", this.onPanelBeforeClose);
            tab.on("tabdblclick",    this.onPanelDoubleClicked);

            wiring.wiredTab = tab;
        }
    }

    for (const child of region.getComponents()) {
        // A lazy panel's identity frame carries a Tab manager, which would
        // otherwise make this sweep wire the panel itself as a drop-taking,
        // prunable region — so its inner strip draining would prune the
        // frame out of its parent and leave a phantom tab behind.
        if (this.isRegionContainer(child) && this._frames.get(child.getId()) !== child) {
            this.wireRegion(child);
        }
    }
}
```

The only behavioural change from today's code: the `if` that used to read `!wiring.tabWired` now reads `wiring.wiredTab !== tab`, so a same-instance re-sweep still no-ops (`wiring.wiredTab === tab`) but a manager rebuilt in place on the same `Component` no longer does.

---

## Ordered Implementation Steps

1. **`packages/lib/tests/overlay/Dock.beforeClose.test.ts`** — in `describe('Dock "beforeclose" — tiled tab ✕', ...)` ([line 95](packages/lib/tests/overlay/Dock.beforeClose.test.ts#L95)), add two cases immediately after the existing three (after [line 159](packages/lib/tests/overlay/Dock.beforeClose.test.ts#L159), before the block's closing `});`):
   - `'still fires after a setLayoutState restore rebuilds the root region in place'` — mount a dock, `addPanel({ id: 'a', ... })`, `doLayout()` + `flush()` (wires the root once), then `const state = dock.getLayoutState(); dock.setLayoutState(state); flush();` (rebuilds the root's `Tab` in place — the buggy path), re-fetch `frameA = frameOf(dock, 'a')`, register a `beforeclose` veto and a `close` spy, `driveBarClose(rootTab(dock), barEntryId(rootTab(dock), frameA))`, and assert `closeSpy` was never called and `frameA.getParentComponent()` is not null — the exact two assertions the existing veto test above it uses.
   - `'close still fires once for a non-vetoed close after the same restore'` — identical setup (through `setLayoutState` + `flush()`), no veto registered, assert a `close` listener records exactly `['a']`.

   Run `npm test -- Dock.beforeClose` — both new cases red (the veto is silently ignored because `beforetabclose` was never re-wired onto the post-restore `Tab`; the plain close fires no `"close"` event either, because `tabclose` was never re-wired).

2. **Same file** — in the same `describe` block, add a third case that must stay green both before and after step 4, guarding against reintroducing duplicate listener registration:
   - `'does not double-register a Tab instance\'s listeners across a repeated sweep'` — mount a dock, `addPanel`, `doLayout()` + `flush()`, then call `priv(dock).runSweep()` once more directly (an extra sweep against the *same*, unchanged root `Tab`), then close panel `'a'` via `driveBarClose`/`barEntryId` with a `close` listener recording events, and assert it recorded exactly one entry (`['a']`), not two.

   Run `npm test -- Dock.beforeClose` — this case is already green (today's `tabWired` boolean already prevents double-wiring an unchanged region; this pins that today's fix must keep preventing it for an unchanged `Tab` instance too).

3. **`packages/lib/tests/overlay/Dock.panelPresentation.test.ts`** — in `describe('Dock.setTabOptions', ...)` ([line 197](packages/lib/tests/overlay/Dock.panelPresentation.test.ts#L197)), add a third "picked up later" case after the existing `'is picked up by the TabWindow a tab tear-off creates later'` case (after [line 292](packages/lib/tests/overlay/Dock.panelPresentation.test.ts#L292)):
   - `'is picked up by the root region a setLayoutState restore rebuilds in place'` — mount a dock, `addPanel({ id: 'a', ... })`, `doLayout()` + `flush()`, `dock.setTabOptions({ maxWidth: 250 })`, then `const state = dock.getLayoutState(); dock.setLayoutState(state); flush();`, and assert `(dock.getRootRegion().getLayoutManager() as Tab).getMaxWidth()` is `250`.

   Run `npm test -- Dock.panelPresentation` — red (the restored root `Tab` never receives `applyTabOptions`).

4. **`packages/lib/src/typescript/lib/overlay/Dock.ts`** — apply the `## Internal Structure` changes: rename `RegionWiring.tabWired` to `wiredTab: Tab | null`, update its doc comment, update the ledger's construction site (`wiredTab: null`), and change `wireRegion`'s guard from `!wiring.tabWired` / `wiring.tabWired = true` to the `wiring.wiredTab !== tab` / `wiring.wiredTab = tab` shape shown above. Also:
   - Add one sentence to `wireRegion`'s own doc comment ([Dock.ts:1315-1322](packages/lib/src/typescript/lib/overlay/Dock.ts#L1315)) noting it is idempotent per `Tab` instance, not per region `Component`.
   - In `setTabOptions`'s doc comment ([Dock.ts:1984-1985](packages/lib/src/typescript/lib/overlay/Dock.ts#L1984)), change "`wireRegion` force-sets it on every region exactly once at first wire" to "...on every `Tab` instance exactly once, at first wire" — it is no longer once per region for the region's whole lifetime.

   Run `npm test -- Dock` — every case in `Dock.beforeClose.test.ts` and `Dock.panelPresentation.test.ts` green, including the four new cases from steps 1-3; no other `Dock.*.test.ts` file regresses.

5. **`npm run typecheck`** — clean (confirms the `Tab | null` field type and the `wiring.wiredTab !== tab` comparison compile).

6. **`packages/lib/docs/reference/changelog/next.md`** — under `## Fixed` › `### Overlay` ([around line 131](packages/lib/docs/reference/changelog/next.md#L131)), add a bullet per `## Documentation Impact`.

7. **Run the whole `## Verification` list.**

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Modify | `packages/lib/src/typescript/lib/overlay/Dock.ts` |
| Modify | `packages/lib/tests/overlay/Dock.beforeClose.test.ts` |
| Modify | `packages/lib/tests/overlay/Dock.panelPresentation.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

All four cases below need a real `Dock` instance driven through a real `setLayoutState` restore — the bug is invisible to any test that only exercises `LayoutSerialization`'s pure data-shape functions (`nodeFor`/`constraintsFor`/`materializeNode`) or a hand-constructed `RegionWiring`, because it depends on `wireRegion` actually having run once already, on the same live `Component` `restoreLayout` then rebuilds. All four are unit-testable through the existing offline `installTestDOM`/`captureRaf`/`flush` harness — no manual verification needed.

| Case | Expected |
| --- | --- |
| A dock's root region is wired once (construction's own initial sweep), then `setLayoutState` restores a state with at least one panel (root becomes a fresh `Tab` on the same `Component`), then a tiled tab in that root is closed with a `beforeclose` veto registered | The veto fires and blocks the close, exactly as it does with no restore in between — `"close"` never fires, the frame stays parented |
| Same setup, no veto | `"close"` fires exactly once for the closed panel |
| Same setup, but `dock.setTabOptions({...})` was called before the restore | The restored root `Tab` reflects those options immediately after the restore (no extra `setTabOptions` call needed post-restore) |
| A sweep runs twice in a row against a root region whose `Tab` instance has **not** changed between the two sweeps (no restore in between) | The `Tab`'s listeners are wired only once — closing a panel afterward fires `"close"` exactly once, not twice |

---

## Verification

- `npm run typecheck` — clean.
- `npm test` — full suite green, in particular `Dock.beforeClose.test.ts`, `Dock.panelPresentation.test.ts`, `Dock.lifecycle.test.ts`, and `Dock.closeDisposal.test.ts` (the other three files already calling `setLayoutState`/`getLayoutState`, per `## Critical Files`).
- `grep -rn "tabWired" packages/lib/src/` — zero matches (fully replaced by `wiredTab`).
- Manual verification: none required — see `## Expected Behaviour`.

---

## Documentation Impact

`packages/lib/docs/reference/changelog/next.md`, under `## Fixed` › `### Overlay` (a new subsection in that heading, following the existing `### Components`/`### Layouts`/`### Overlay` pattern under `## Fixed`): add a bullet stating that a `setLayoutState` restore no longer permanently drops a tiled root region's tab wiring — previously, closing a tab in the dock's original group after a restore did not fire `"beforeclose"`/`"close"`, and `setTabOptions`/`DockOptions.tabOptions` stopped reaching that region — because the restore rebuilds the root's `Tab` in place and the sweep's idempotency guard mistook the unchanged container for an already-wired one. No consumer action is needed.

No other doc page describes `wireRegion`, `RegionWiring`, or this internal ledger, so nothing else needs updating.

---

## Critical Files

| File | Why |
| --- | --- |
| [`packages/lib/src/typescript/lib/overlay/Dock.ts`](packages/lib/src/typescript/lib/overlay/Dock.ts) | `RegionWiring`, `wireRegion`, `setLayoutState`, `getRootRegion`, `applyTabOptions`, `setTabOptions` — read all in full; the fix and its surrounding doc comments live here. |
| [`packages/lib/src/typescript/lib/layout/LayoutSerialization.ts`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts) | `restoreLayout`/`populateContainer` — read to confirm the in-place `container.setLayoutManager(new Tab(...))` call this plan does *not* change, and why (`## Architecture Decisions`). |
| [`packages/lib/src/typescript/lib/layout/DockRegion.ts`](packages/lib/src/typescript/lib/layout/DockRegion.ts) | Confirms every `this._region.getLayoutManager()` read is live, never cached — why `DockRegion` itself needs no change. |
| [`packages/lib/src/typescript/lib/component/table/Body.ts`](packages/lib/src/typescript/lib/component/table/Body.ts) | `_boundIndices[i] !== dataIndex` ([Body.ts:1433](packages/lib/src/typescript/lib/component/table/Body.ts#L1433)) — the codebase's established "detect a reused slot was rebound to a different underlying thing" pattern this fix mirrors. |
| `plans/implemented/dock-panel-tab-control.md` | `## Implementation Notes` — where this bug was first found and reported out of scope, and the two `DockRegion.newStack()`/`TabWindow` fixes whose shape `## Architecture Decisions` distinguishes this fix from. |
| `/home/jika/typescript/loom/plans/implemented/dock-split-pane-editing.md` | `## Implementation Notes` — the confirmed, concrete consumer-visible symptom (context only; this plan touches nothing in that repo). |
| [`packages/lib/tests/overlay/Dock.beforeClose.test.ts`](packages/lib/tests/overlay/Dock.beforeClose.test.ts), [`Dock.panelPresentation.test.ts`](packages/lib/tests/overlay/Dock.panelPresentation.test.ts) | The exact harness (`mountDock`, `frameOf`, `rootTab`, `priv`, `driveBarClose`, `barEntryId`, `captureRaf`/`flush`) and the sibling tests the four new cases extend. |

---

## Non-Goals

- **Changing `LayoutSerialization.ts`'s restore behaviour.** Rebuilding a region's manager in place is correct and shared by every non-`Dock` consumer of `restoreLayout`; only `Dock`'s own idempotency guard was wrong (`## Architecture Decisions`).
- **Rekeying `_wiring` by `LayoutManager` instead of `Component`.** `DockRegion` and `teardownVanished`'s reachability walk are inherently container-shaped (an element, a parent, children); only the `Tab`-listener half of a region's wiring ever goes stale, not the region's whole ledger entry (`## Architecture Decisions`, `## Notes`).
- **A `Split`-manager equivalent of this fix.** `wireRegion` has no per-instance listener wiring for `Split` regions — only the identity-agnostic `DockRegion` coordinator — so a `Split` rebuilt in place has nothing to go stale.

---

## Notes

[^rebind-precedent]: `Body.ts`'s row-pool binding loop faces the same shape of problem: a pooled `Row` slot is reused across renders, and `afterRowBound`'s `wasRebound` parameter — computed as `this._boundIndices[i] !== dataIndex` ([Body.ts:1433](packages/lib/src/typescript/lib/component/table/Body.ts#L1433)) — tells a subclass whether the slot's record changed since it was last bound, so drag-source/drop-target wiring is replaced only when it has (`TreeBody.afterRowBound`'s doc comment, [TreeBody.ts:566-578](packages/lib/src/typescript/lib/component/table/TreeBody.ts#L566)). `wireRegion`'s fix is the same check at the same granularity: a per-slot cache of "what was this last wired to," compared by identity on every pass, acted on only when it changed.

[^rejected-clear]: An alternative considered: have `Dock.setLayoutState` itself destroy and delete `_wiring`'s entry for `this.getRootRegion()` before calling `restoreLayout`, mirroring the `_frameRegion.clear()` call already in that method for the same "restore invalidates cached identity" reason ([Dock.ts:580-585](packages/lib/src/typescript/lib/overlay/Dock.ts#L580)). Rejected: it special-cases the one call site known to trigger the bug today rather than fixing the guard's own invariant, so it would not protect a hypothetical future region-construction site that rebuilds a manager in place elsewhere. It would also destroy and immediately reconstruct a `DockRegion` coordinator that remains correct across the swap (per the `DockRegion.ts` reads cited above), churning a drop-target registration for no reason.

[^rejected-restructure]: A second alternative: rekey `_wiring` by the region's `LayoutManager` instance instead of its `Component`. Rejected: `DockRegion` is a per-*container* coordinator (it registers a drop target against the container's element and needs the container's parent/children to do edge/centre detection), and `teardownVanished`'s reachability walk ([Dock.ts:1475-1490](packages/lib/src/typescript/lib/overlay/Dock.ts#L1475)) recurses over live `Component` children — neither has a `LayoutManager`-shaped equivalent. Rekeying the whole ledger would break both to fix a staleness that only ever affects the `Tab`-listener half of one entry.
