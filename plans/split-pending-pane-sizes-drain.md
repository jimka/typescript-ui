---
touches-shared:
  - packages/lib/src/typescript/lib/layout/Split.ts
  - packages/lib/docs/layouts/Split.md
  - packages/lib/docs/reference/changelog/next.md
---

# Split Pending Pane-Sizes Drain — Implementation Plan

## Overview

`Split` throws away the `paneSizes` it was constructed with whenever a layout pass runs before its panes are added. [`applyPendingSizes`](packages/lib/src/typescript/lib/layout/Split.ts#L2415) clears `_pendingSizes` at [`Split.ts:2422`](packages/lib/src/typescript/lib/layout/Split.ts#L2422) and only then calls `applyPaneSizes` at [`:2424`](packages/lib/src/typescript/lib/layout/Split.ts#L2424), which bails at [`:1328-1330`](packages/lib/src/typescript/lib/layout/Split.ts#L1328) because a container with no panes yields no units for [`isRestorableSizes`](packages/lib/src/typescript/lib/layout/LayoutSizes.ts#L114) to match ([`LayoutSizes.ts:115`](packages/lib/src/typescript/lib/layout/LayoutSizes.ts#L115)). That bail enforces the **discard rule** — a persisted array is restored only when its length and every entry's unit match the live panes and at least one value is positive, and is otherwise thrown away whole ([`LayoutSizes.ts:102-126`](packages/lib/src/typescript/lib/layout/LayoutSizes.ts#L102)). The array here was never stale — only undrainable — but it is already gone, so the next pass falls to the equal division in [`recalculateSizes`](packages/lib/src/typescript/lib/layout/Split.ts#L2680).

The sibling drain has the same defect. [`applyPendingCollapsed`](packages/lib/src/typescript/lib/layout/Split.ts#L2434) clears `_pendingCollapsed` at [`:2449`](packages/lib/src/typescript/lib/layout/Split.ts#L2449) whether or not any index resolved, so the same pass silently discards `collapsedPanes` too.

A pane-less pass is unavoidable in the shape the library documents — a `Split` handed to `Body.init` and its panes added after the `await`.[^why-the-pass] That shape is the library's own pending demo-app plan, [`plans/demo-app-category-navigation.md:415-422`](plans/demo-app-category-navigation.md#L415), so the defect currently blocks an in-repo consumer as well as the user's app.

Both drains get a guard that holds the pending value until there is something to apply it to, and `applyPaneSizes`' three silent exits each get a `console.warn`. No public signature changes.

---

## Findings

Measured on `master` (`d812b18e`) with throwaway probes under the offline harness, then re-measured with the guards in place. Every number below was observed, not inferred.

| # | Fact | Why the plan needs it |
|---|---|---|
| 1 | Exact demo config (1280 px, `spacing: 8`, seed `[px:200, ratio:1]`, `weight: 0` / `weight: 1`, bare `Component` panes), one pane-less pass before the panes are added: **636 / 636** instead of 200 / 1072. Without that pass: 200 / 1072. | E1 is a real pin, and the control proves the pass is what breaks it. |
| 2 | `collapsedPanes: [0]` through the same pane-less pass: `isPaneCollapsed(0)` is **`false`** afterwards; without the pass it is `true`. | The sibling drain has the same bug. It is fixed here, not merely reported. |
| 3 | `split.applyPaneSizes([px:420, ratio:1])` on an attached container with no panes: **silently ignored**, panes later land at 636 / 636. The core guard does not help — this is the public method, not the drain. | The public arm needs its own answer (a warning plus a documented precondition). |
| 4 | With both guards in place the whole library suite is green: **521 files / 8763 tests**, plus `typecheck`, `typecheck:test` and `eslint` clean. | The guards cost nothing elsewhere. |
| 5 | Neutering the **entire** `paneSizes` drain turns exactly **1 of the 67** `Split.test.ts` cases red (`round trip preserves the weighted panes' ratio`). | The drain is nearly uncovered, which is why the defect shipped. |
| 6 | Of the four cases that read like restore tests, three pass with the drain deleted: [`:977`](packages/lib/tests/component/layout/Split.test.ts#L977) (restored px 400 equals the pane's `preferredSize` 400), [`:1049`](packages/lib/tests/component/layout/Split.test.ts#L1049) (asserts stability, not the value), [`:1137`](packages/lib/tests/component/layout/Split.test.ts#L1137) (first assertion 100 equals `preferredSize` 100). | Two of them are strengthened here (E15, E16); the third pins a different property and is left alone. |
| 7 | `Accordion`'s twin drain also clears before checking ([`Accordion.ts:2738`](packages/lib/src/typescript/lib/layout/Accordion.ts#L2738) then [`:2742`](packages/lib/src/typescript/lib/layout/Accordion.ts#L2742)), but is unreachable with no sections: its caller returns early on an empty open set at [`:2702-2704`](packages/lib/src/typescript/lib/layout/Accordion.ts#L2702). | `Accordion` needs no change, and its structural gate is the precedent the guard mirrors. |
| 8 | `_pendingSizes` is written in exactly two places: the option at [`Split.ts:322`](packages/lib/src/typescript/lib/layout/Split.ts#L322) and the clear at [`:2422`](packages/lib/src/typescript/lib/layout/Split.ts#L2422). | The field comment at [`:213-217`](packages/lib/src/typescript/lib/layout/Split.ts#L213), which says a pre-attach `applyPaneSizes` call lands there, is false and is corrected. |
| 9 | `insertComponent` only ever calls `scheduleLayout` ([`Component.ts:7579`](packages/lib/src/typescript/lib/core/Component.ts#L7579)), and the child size relay installed by `wireChild` does the same ([`:7421-7430`](packages/lib/src/typescript/lib/core/Component.ts#L7421)). | Adding panes never lays out synchronously, so a half-added child list needs app code to force a pass mid-build. |
| 10 | Vitest 4 hides console output for a passing test, so the three existing discard cases emit no visible noise once the discard warns. | No spy has to be retro-fitted to them. |
| 11 | `npm run docs:api` on `master`: **0 errors, 14 warnings**, none of them in `Split`. | The bar for this work is "still 14", not zero. |

---

## Architecture Decisions

### Each drain holds its pending value until there is something to apply it to

`applyPendingSizes` returns without clearing `_pendingSizes` while the container has no panes, and `applyPendingCollapsed` returns without clearing `_pendingCollapsed` while its component list is empty. Both then drain exactly once, on the first pass that can resolve a pane. The precedent is `Accordion`, whose identical drain is gated structurally — its caller returns before the drain when no section is open ([`Accordion.ts:2702-2704`](packages/lib/src/typescript/lib/layout/Accordion.ts#L2702)) — and `Split`'s own [`applyPaneRatios`](packages/lib/src/typescript/lib/layout/Split.ts#L1223), which already refuses an empty container at [`:1231-1233`](packages/lib/src/typescript/lib/layout/Split.ts#L1231).[^narrow-guard]

The guard changes nothing about the discard rule. A genuinely stale array still fails `isRestorableSizes` and is still thrown away whole, once, and never retried.[^no-retry]

| Container state when the drain runs | `_pendingSizes` after | Panes get |
|---|---|---|
| no panes | held | nothing this pass; the next pass with panes applies the seed |
| 2 panes, units `[px, ratio]`, seed `[px:200, ratio:1]` | cleared | the seed — 200 / 1072 |
| 2 panes, units `[px, ratio]`, seed `[ratio:.5, ratio:.5]` | cleared | nothing — discarded whole, and a warning |
| 3 panes, seed of length 2 | cleared | nothing — discarded whole, and a warning |

### The sizes guard counts `getComponents()`, not the laid-out list

`applyPendingSizes` reads `this.getContainer()?.getComponents()`, the same list `applyPaneSizes` validates against at [`Split.ts:1325`](packages/lib/src/typescript/lib/layout/Split.ts#L1325), so the guard and the check can never disagree about whether there is a pane. `applyPendingCollapsed` keeps using the `components` parameter `doLayout` hands it — the laid-out list from [`:2148`](packages/lib/src/typescript/lib/layout/Split.ts#L2148) — because that is the list it indexes.[^which-list]

A persisted array carries one entry per *child*, so a pane that is not displayed still owns an entry and the seed drains on the pass that finds it (E7).

### `applyPaneSizes` warns on each of its three silent exits

The detached exit, a new explicit pane-less exit, and the existing whole-array discard each emit one `console.warn` naming what was supplied and what the live panes offer. The shape follows [`Router.register`](packages/lib/src/typescript/lib/router/Router.ts#L118) and [`Grid`'s overlap warning](packages/lib/src/typescript/lib/layout/Grid.ts#L1091): an unconditional `console.warn`, prefixed with the class name, naming the specific values. The library has no dev/production switch and no warn-once helper, and this plan does not introduce one.[^diag-shape]

| Call | Live panes | Outcome | Message |
|---|---|---|---|
| `applyPaneSizes([px:420, ratio:1])` | not attached | ignored | `Split: applyPaneSizes ignored — this layout manager is not attached to a container; …` |
| `applyPaneSizes([px:420, ratio:1])` | attached, 0 panes | ignored | `Split: applyPaneSizes ignored — the container has no panes yet; …` |
| `applyPaneSizes([ratio:0.5, ratio:0.5])` | `[px, ratio]` | discarded | `Split: paneSizes discarded — [ratio:0.5, ratio:0.5] is not restorable against the live pane units [px, ratio]; …` |
| `applyPaneSizes([px:0, ratio:0])` | `[px, ratio]` | discarded | `Split: paneSizes discarded — [px:0, ratio:0] is not restorable against the live pane units [px, ratio]; …` |
| `applyPaneSizes([px:420, ratio:1])` | `[px, ratio]` | applied | none |

The discard message prints each entry as `unit:value` rather than the unit alone, because an array with matching units and no positive value is discarded too and its units alone would explain nothing.

### `applyPaneSizes` gets a documented precondition as well as the warning

Its JSDoc, and the persistence section of [`docs/layouts/Split.md`](packages/lib/docs/layouts/Split.md#L182), both state that the container must already hold its panes and point a caller who needs an earlier restore at the `paneSizes` option. The warning and the precondition answer different failure modes, so both ship.[^both-warn-and-doc]

### `applyPaneSizes` keeps returning `this`

No signature change, no success flag, no new method. A caller that needs to know already can: `getPaneSizes()` returns `[]` for a detached or pane-less container ([`Split.ts:1286-1294`](packages/lib/src/typescript/lib/layout/Split.ts#L1286)) and the live sizes rather than the supplied ones after a discard.[^no-return-value]

### The `_pendingSizes` field comment is corrected

The comment at [`Split.ts:213-217`](packages/lib/src/typescript/lib/layout/Split.ts#L213) says the field also holds "a direct `applyPaneSizes` call before the container is attached". It never has (Finding 8). The comment is rewritten to state what the field does hold and that a direct call is resolved immediately instead.

### Commit grouping

| Commit | Bucket | Contents |
|---|---|---|
| 1 | code | Steps 1-7: the two drain guards, their doc comments, E1-E7 and E12-E13, and the two strengthened existing cases E15-E16 |
| 2 | code | Steps 8-12: the three `applyPaneSizes` diagnostics, `describeSizes`, the documented precondition, and E8-E11 plus E14 |
| 3 | documentation | Steps 13-14: the `docs/layouts/Split.md` precondition and the changelog entry |

---

## Internal Structure

**Guard A — `applyPendingSizes`** ([`Split.ts:2415-2425`](packages/lib/src/typescript/lib/layout/Split.ts#L2415)). Insert the new block between the `pending === null` return and the clear; the clear and the apply keep their current order.

```typescript
    /**
     * Drains the `paneSizes` option into `_sizes` on the first layout that has
     * panes, where {@link applyPaneSizes} can resolve the live panes and the
     * container's main-axis budget. Held rather than drained while the
     * container has no panes: `applyPaneSizes` validates against the live
     * per-pane units, and a pane-less container offers none, so draining there
     * would discard an array that is merely undrainable. Once a pane exists the
     * drain runs once, and `applyPaneSizes` discards a genuinely stale array
     * whole.
     */
    private applyPendingSizes(): void {
        const pending = this._pendingSizes;

        if (pending === null) {
            return;
        }

        // The same list `applyPaneSizes` validates against, so the guard and
        // that check can never disagree about whether there is a pane. Not the
        // laid-out list: a persisted array carries one entry per child, so an
        // undisplayed pane still owns one.
        if ((this.getContainer()?.getComponents().length ?? 0) === 0) {
            return;
        }

        this._pendingSizes = null;

        this.applyPaneSizes(pending);
    }
```

**Guard B — `applyPendingCollapsed`** ([`Split.ts:2434-2437`](packages/lib/src/typescript/lib/layout/Split.ts#L2434)). One term added to the existing guard, plus one JSDoc sentence.

```typescript
        // `components` is the laid-out list this method indexes, so an empty one
        // resolves no pane at all — hold the indices for a later pass instead of
        // clearing them below.
        if (this._pendingCollapsed.length === 0 || components.length === 0) {
            return;
        }
```

**Diagnostics — `applyPaneSizes`** ([`Split.ts:1318-1330`](packages/lib/src/typescript/lib/layout/Split.ts#L1318)). The head of the method becomes:

```typescript
    applyPaneSizes(sizes: LayoutSize[]): this {
        const container = this.getContainer();

        if (!container) {
            console.warn("Split: applyPaneSizes ignored — this layout manager is not attached to a container; pass the array as the `paneSizes` option instead.");

            return this;
        }

        const components = container.getComponents();
        const units      = this.paneSizeUnits(components);

        if (components.length === 0) {
            console.warn("Split: applyPaneSizes ignored — the container has no panes yet; add the panes first, or pass the array as the `paneSizes` option.");

            return this;
        }

        if (!isRestorableSizes(sizes, units)) {
            console.warn(`Split: paneSizes discarded — [${this.describeSizes(sizes)}] is not restorable against the live pane units [${units.join(", ")}]; the lengths must match, every entry's unit must match its pane, and at least one value must be positive.`);

            return this;
        }
```

The rest of the method is unchanged from [`:1332`](packages/lib/src/typescript/lib/layout/Split.ts#L1332) down.

**The formatter**, inserted immediately above `paneSizeUnits` ([`Split.ts:1267`](packages/lib/src/typescript/lib/layout/Split.ts#L1267)):

```typescript
    /**
     * Formats a persisted size array for a diagnostic message as `unit:value`
     * pairs — `"px:420, ratio:1"`.
     *
     * @param sizes - The array to describe.
     * @returns The comma-joined `unit:value` pairs.
     */
    private describeSizes(sizes: LayoutSize[]): string {
        // A persisted array reaches this class straight from `JSON.parse`, so an
        // entry can be null at runtime however it is typed — `isRestorableSizes`
        // guards `size != null` for the same reason.
        return sizes.map(size => `${size?.unit ?? "?"}:${size?.value ?? "?"}`).join(", ");
    }
```

`size?.value ?? "?"` keeps a `0` (`??` is nullish-only), which the no-positive-value message needs.

**The regression case shape.** E1 below is mutation-proved: without Guard A it fails `expected 636 to be close to 200`. Every other new case in `## Expected Behaviour` is this host with its own option and its own sequence of `doLayout()` calls.

```typescript
it('survives a layout pass that runs before the panes are added', () => {
    installTestDOM(CONFIG);
    const split = new Split({
        orientation: 'horizontal',
        spacing:     8,
        paneSizes:   [{ unit: 'px', value: 200 }, { unit: 'ratio', value: 1 }],
    });
    const host = new Container({ layoutManager: split });
    host.getElement(true);
    host.setWidth(1280);
    host.setHeight(800);

    host.doLayout(); // the pane-less pass Body.init's own await lets through

    const pinned = new Component({});
    const body   = new Component({});
    host.addComponent(pinned, { weight: 0 });
    host.addComponent(body,   { weight: 1 });
    host.doLayout();

    expect(split.getPaneSize(pinned)!).toBeCloseTo(200, 4);   // pre-fix: 636
    expect(body.getWidth()).toBeCloseTo(1280 - 8 - 200, 4);
});
```

E2 adds a source split ahead of this one, built the same way: two bare panes, `split.setPaneSize(pinned, 420)`, one `doLayout()`, then `split.getPaneSizes()` — which reports `[{ unit: 'px', value: 420 }, { unit: 'ratio', value: 1 }]` — handed to the second split's `paneSizes`.

---

## Ordered Implementation Steps

"Run the file" below means, from `packages/lib`, `npx vitest run tests/component/layout/Split.test.ts`. Never invoke `vitest` with a bare `--root`. Full-suite commands run from the worktree root. Nothing in this plan opens a window: no `packages/qa/runqa.sh`, no `packages/qa/sweeps/*.sh` without `--dry-run`, no MiniBrowser, no Tauri `qa-host`, no `npm run dev`, no `npm run docs:dev`.

**Commit 1 — the two drain guards**

1. **Add the drain cases, red first.** In [`packages/lib/tests/component/layout/Split.test.ts`](packages/lib/tests/component/layout/Split.test.ts), append E1-E4, E7, E12 and E13 from `## Expected Behaviour` to the existing `describe('Split pane sizes (getPaneSizes / applyPaneSizes)')` block ([`:906`](packages/lib/tests/component/layout/Split.test.ts#L906)), beside the three discard cases. Append E5 and E6 to `describe('Split collapse state')` ([`:751`](packages/lib/tests/component/layout/Split.test.ts#L751)).

   Every new case builds its host inline with **bare `Component`s** — no `preferredSize`, because a preferred constraint lets [`seedFromPreferred`](packages/lib/src/typescript/lib/layout/Split.ts#L1020) supply a value at [`:1032`](packages/lib/src/typescript/lib/layout/Split.ts#L1032) and mask the whole defect (Findings 5-6). Do not reuse `hostSplit` or `threePaneHost`; both seed `preferredSize`.

   Run the file. Expect **E1-E6 red** and **E7, E12 and E13 green** — E7 guards the guard's choice of list, so it passes before the fix as well. If any of E1-E6 passes here, stop and report: that case is pinning nothing.
2. **Guard the sizes drain.** Apply Guard A from `## Internal Structure` to [`Split.ts:2415`](packages/lib/src/typescript/lib/layout/Split.ts#L2415), replacing the JSDoc block at [`:2408-2414`](packages/lib/src/typescript/lib/layout/Split.ts#L2408) with the one given there. The old comment's closing claim — that the drain needs no check of its own — is the reasoning this plan disproves; it must not survive.
3. **Guard the collapsed drain.** Apply Guard B to [`Split.ts:2435`](packages/lib/src/typescript/lib/layout/Split.ts#L2435) and add its JSDoc sentence at [`:2427-2433`](packages/lib/src/typescript/lib/layout/Split.ts#L2427): *"Held while the component list is empty, since no index resolves against it."*
4. **Correct the two field comments.** At [`Split.ts:213-217`](packages/lib/src/typescript/lib/layout/Split.ts#L213), drop the false "or a direct `applyPaneSizes` call before the container is attached" clause and say instead that the field holds the option only, is held while the container has no panes, and that a direct `applyPaneSizes` call resolves its panes immediately. At [`:199-202`](packages/lib/src/typescript/lib/layout/Split.ts#L199), add that the indices are likewise held while the laid-out list is empty.
5. Run the file: E1-E7 and E12-E13 all pass.
6. **Strengthen the two masked cases.** Both changes are value-only; change nothing else in either case.
   - E16, in `round-trips exactly for the pin at a different viewport` ([`:977`](packages/lib/tests/component/layout/Split.test.ts#L977)): change `split.setPaneSize(side, 400)` to `260`, and the three `400` literals that follow it in that case (`toBeCloseTo(400, 4)` on the source, `side2.getWidth()`, and `totalAvailable - 400`) to `260`. The panes keep `preferredSize: { width: 400 }`, so the restored px no longer coincides with the seed.
   - E15, in `the drain is once-only: a later applyPaneSizes call is not overridden by the option` ([`:1137`](packages/lib/tests/component/layout/Split.test.ts#L1137)): change the option's first entry from `{ unit: 'px', value: 100 }` to `{ unit: 'px', value: 150 }` and the first assertion from `toBeCloseTo(100, 4)` to `toBeCloseTo(150, 4)`. The pane keeps `preferredSize: { width: 100 }`.
7. `npm run typecheck`, `npm test` and `npm run lint`, all from the worktree root. All clean. Commit (code).

**Commit 2 — the diagnostics**

8. **Add the diagnostics cases, red first.** Append a new `describe('Split paneSizes diagnostics')` block to `Split.test.ts`, after the pane-sizes block, holding E8-E11 and E14. Model each case on [`Router.test.ts:24-39`](packages/lib/tests/unit/router/Router.test.ts#L24): `const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});` at the top, assertions on `toHaveBeenCalledTimes`, on `warn.mock.calls[0][0]` matching `/^Split:/`, and on the substrings the case names, then `warn.mockRestore()` at the end. `vi` is already imported at [`Split.test.ts:4`](packages/lib/tests/component/layout/Split.test.ts#L4).

   Run the file: E8-E11 red, E14 green.
9. **Add `describeSizes`.** Insert the formatter from `## Internal Structure` immediately above `paneSizeUnits` ([`Split.ts:1267`](packages/lib/src/typescript/lib/layout/Split.ts#L1267)).
10. **Add the three warnings.** Replace the head of `applyPaneSizes` ([`:1318-1330`](packages/lib/src/typescript/lib/layout/Split.ts#L1318)) with the block from `## Internal Structure`. The new `components.length === 0` arm goes *after* `units` is derived and *before* the `isRestorableSizes` check, so the pane-less case gets its own message instead of the discard one.
11. **Document the precondition.** Add the second paragraph from `## Architecture Decisions` (*"The container must already hold its panes…"*) to `applyPaneSizes`' JSDoc at [`:1308-1317`](packages/lib/src/typescript/lib/layout/Split.ts#L1308), above the `@param`. Write `` `paneSizes` `` as plain code text, never `{@link}` — the option is reachable in the docs but a link to a non-rendered symbol is what produces a `docs:api` warning (see [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md), *Don't `{@link}` internal symbols from public JSDoc*).
12. Run the file: all of E1-E16 pass. Then `npm run typecheck`, `npm test`, `npm run lint` and `npm run docs:api` from the worktree root — the last must still report 0 errors and 14 warnings. Commit (code).

**Commit 3 — documentation**

13. In [`packages/lib/docs/layouts/Split.md`](packages/lib/docs/layouts/Split.md#L202), after the discard paragraph at `:202`, add:

    ```markdown
    `applyPaneSizes` resolves the live panes as it is called, so the container
    must already hold them; a call made earlier is ignored and warns in the
    console. To restore before the panes exist — the usual case, where the split
    is handed to `Body.init` and the panes are added afterwards — pass the array
    as the `paneSizes` option instead. The first layout that has panes applies
    it, however many pane-less passes ran before.
    ```

    In the Common methods table, replace the `applyPaneSizes(sizes)` row at [`:227`](packages/lib/docs/layouts/Split.md#L227) with:

    ```markdown
    | `applyPaneSizes(sizes)` | Restore sizes captured by `getPaneSizes`, onto panes the container already holds. |
    ```
14. In [`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md), append a `## Fixed` heading below the existing `## Added` block, then a `### Layouts` subheading — the section names [`0.10.0.md:814`](packages/lib/docs/reference/changelog/0.10.0.md#L814) and [`:1696`](packages/lib/docs/reference/changelog/0.10.0.md#L1696) use — and one entry:

    ```markdown
    ## Fixed

    ### Layouts

    - **A `Split`'s `paneSizes` and `collapsedPanes` now survive a layout pass
      that runs before its panes are added.** Both options were drained on the
      first layout pass and cleared whether or not that pass had any pane to
      apply them to, so a split handed to `Body.init` — which lays out once
      while it waits for the startup font — lost its seeded pane widths and its
      collapsed panes on every load, and fell back to an equal division. Each
      option is now held until the first pass that has panes. A genuinely stale
      array is still discarded whole, once, and `applyPaneSizes` now says so in
      the console instead of discarding in silence; it also warns when it is
      called before the container has panes, which is a no-op. No consumer
      action is needed.
    ```

    Commit (documentation).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/layout/Split.ts` |
| Modify | `packages/lib/tests/component/layout/Split.test.ts` |
| Modify | `packages/lib/docs/layouts/Split.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

No new files. `packages/lib/src/typescript/lib/layout/LayoutSizes.ts`, `Accordion.ts` and `Split.collapseUndisplay.test.ts` are read but not changed.

---

## Expected Behaviour

Every case is offline-testable; none needs a browser. The mutations the cases are graded against:

| Id | Mutation of a shipped line |
|---|---|
| M1 | Guard A's `getComponents().length === 0` return deleted from `applyPendingSizes` (back to `master`) |
| M2 | Guard B's `components.length === 0` term deleted from `applyPendingCollapsed`'s guard |
| M3 | Guard A's list swapped to `getLaidOutComponents()` |
| M4 | the `components.length === 0` warn arm deleted from `applyPaneSizes`, so the pane-less call falls through to the discard arm |
| M5 | the discard `console.warn` deleted |
| M6 | the detached `console.warn` deleted |
| M7 | `describeSizes` printing `size?.unit` alone, without the value |
| M8 | `applyPendingSizes`' first return taken unconditionally (the whole `paneSizes` drain deleted) |

E1-E6 and E8-E11 are defect pins: each is red on `master` and red again under the mutation named. E7 and E12-E14 are regression guards — they pass on `master` too, and exist to catch a fix that holds too much, warns too eagerly, or waits on the wrong list. E15-E16 are existing cases that currently cannot fail; after the step 6 value change each is red under M8.

Each case's container is 1280 px wide, `spacing: 8`, two bare `Component` panes added `{ weight: 0 }` then `{ weight: 1 }` unless stated otherwise, so the live units are `["px", "ratio"]` and the flexible pane's width is `1280 - 8 - pinned`. E15 and E16 keep the hosts their existing cases already build.

| # | Case | Assertion | Catches |
|---|---|---|---|
| E1 | `paneSizes: [px:200, ratio:1]`; one `doLayout()` before the panes are added, then the panes, then `doLayout()` | `getPaneSize(pinned)` ≈ `200` and `flexible.getWidth()` ≈ `1072` | M1 — pre-fix both are 636 |
| E2 | a capture taken from a live split whose pin was set to `420` via `setPaneSize` + `getPaneSizes()`, fed to a second split's `paneSizes`, through the same pane-less pass | `getPaneSize(pinned)` ≈ `420` and `flexible.getWidth()` ≈ `852` | M1 — the persisted-restore arm, symmetric with E1's hand-written seed |
| E3 | `paneSizes: [px:200, ratio:1]`; **three** pane-less `doLayout()` calls, then the panes, then `doLayout()` | `getPaneSize(pinned)` ≈ `200` | M1, and a guard that survives only one pass |
| E4 | `paneSizes: [px:200, ratio:1]`; one pane-less `doLayout()`, then the panes added and **no** further layout | `getPaneSizes()` deep-equals the seed array | M1 — pins the "reports the pending array while one is undrained" contract at [`Split.ts:1281-1283`](packages/lib/src/typescript/lib/layout/Split.ts#L1281); pre-fix it reports `[px:0, ratio:1]` |
| E5 | `collapsedPanes: [0]`; one pane-less `doLayout()`, then the panes, then `doLayout()` | `isPaneCollapsed(0)` is `true` | M2 — pre-fix `false` |
| E6 | `collapsedPanes: [0]`; both panes added then `setDisplayed(false)`, one `doLayout()`, then both redisplayed and `doLayout()` | `isPaneCollapsed(0)` is `true` | M2 — the laid-out list was empty on the first pass although the children existed |
| E7 | `paneSizes: [px:200, ratio:1]`; both panes added then `setDisplayed(false)`, one `doLayout()` and nothing else | `getPaneSize(pinned)` ≈ `200` | M3 — green on `master`, which consults no list at all; under the laid-out list the drain waits and that pass stores 636 instead |
| E8 | `new Split().applyPaneSizes([px:420, ratio:1])` — no container | `console.warn` called once; `calls[0][0]` matches `/^Split:/` and contains `not attached` | M6 |
| E9 | attached, no panes, `applyPaneSizes([px:420, ratio:1])` | `console.warn` called once; the message contains `no panes yet` | M4 — under M4 the message is the discard one instead |
| E10 | `paneSizes: [ratio:0.5, ratio:0.5]` against live units `[px, ratio]`; **two** `doLayout()` calls | `console.warn` called exactly once; the message contains `[ratio:0.5, ratio:0.5]` and `[px, ratio]` | M5, M7, plus once-only: a per-pass warning would be called twice |
| E11 | `paneSizes: [px:0, ratio:0]` against live units `[px, ratio]`; one `doLayout()` | `console.warn` called once; the message contains `px:0, ratio:0` | M5, M7 — the units match here, so only the values identify the fault |
| E12 | a 3-entry seed `[px:420, ratio:0.5, ratio:0.5]` against 2 live panes, `doLayout()`; then a third pane joins (making the length match) and `doLayout()` | `getPaneSize(pinned)` is **not** ≈ `420` at either point | guard: a stale array must stay discarded, not be resurrected by a later topology change |
| E13 | `paneSizes: [px:200, ratio:1]`; three pane-less `doLayout()` calls and no panes ever added | `getPaneSizes()` is `[]` | guard: a held array must not leak out as a capture a consumer would persist |
| E14 | E1's sequence, with a `console.warn` spy installed for the whole case | `console.warn` never called | guard: the happy path stays silent |
| E15 | the existing once-only case with the step 6 values: `paneSizes: [px:150, ratio:1]` against panes whose `preferredSize.width` is `100` | `getPaneSize(panes[0])` ≈ `150`, then ≈ `250` after `applyPaneSizes([px:250, ratio:1])`, then ≈ `250` after a further layout | M8 — at the option's old value of `100` the first assertion was satisfied by the pane's preferred seed instead |
| E16 | the existing round-trip case with the step 6 values: pin set to `260` against panes whose `preferredSize.width` is `400` | `side2.getWidth()` ≈ `260` and `body2.getWidth()` ≈ `totalAvailable - 260` | M8 — at the old pin of `400` the assertion was satisfied by the pane's preferred seed instead |

Two assertions are forbidden; neither can fail.

- **Any assertion on a bare `Component`'s width or stored size that equals its own `preferredSize`.** `seedFromPreferred` supplies exactly that value when the restore is discarded, so the case passes either way (Findings 5-6). Every new case uses bare `Component`s for this reason; where a constraint is unavoidable, its value must differ from the asserted one.
- **`_pendingSizes === null` after the draining pass, or non-`null` after a pane-less one.** Asserting the guard's own bookkeeping restates the implementation. Assert the resulting pane width instead — E1, E3, E7 and E13 already cover both directions of the hold.

---

## Verification

1. `npm run typecheck` from the worktree root — clean. `npm run typecheck:test` from `packages/lib` — clean; it also runs as the first half of `npm test`, and the root has no script of that name.
2. `npm test` from the worktree root — green, and the file count and test count must both be at or above `master`'s 521 / 8763 (Finding 4).
3. `npm run lint` from the worktree root — no new findings. The `local/*` rules do not cover either drain, so this only confirms nothing else regressed.
4. **Mutation check, one mutation at a time.** For each of M1-M8: apply it, run `npx vitest run tests/component/layout/Split.test.ts` from `packages/lib`, confirm that **every** case whose `Catches` column names that mutation goes red, then revert it. Eight mutations, eight reverts, and the file green at the end. Record the full observed red set per mutation in the implementation notes; M8 additionally reds the pre-existing `round trip preserves the weighted panes' ratio` case (Finding 5), which is expected. This is the step that proves the pins are not vacuous; do not skip it and do not substitute reasoning for it.
5. `grep -n 'console.warn' packages/lib/src/typescript/lib/layout/Split.ts` — exactly three matches, all inside `applyPaneSizes`.
6. `npm run docs:api` — 0 errors and **14** warnings, the same 14 `master` reports, none naming `Split` (Finding 11). Step 11 touches public JSDoc, so this is a real check rather than a formality.
7. Nothing opened a window during any of the above.

`npm run build:lib`, `npm run docs:llms:check` and the `packages/qa` suite are not needed: no public signature changes, no new class for the manifest, and no built artefact change.

**Manual verification — one check, not automatable.** The offline harness models geometry but not the real startup frame, and the defect's trigger is that frame. In the library's demo app (or any app that hands a seeded `Split` to `Body.init` and adds its panes after the `await`), load the page and confirm the pinned pane opens at its seeded width rather than at half the window, then drag the gutter, reload, and confirm the dragged width returns. `plans/demo-app-category-navigation.md` is the in-repo app that will exercise this; until it lands, the check runs against the user's own app.

---

## Documentation Impact

- Two paragraphs of [`docs/layouts/Split.md`](packages/lib/docs/layouts/Split.md#L182)'s *Saving and restoring layout* section (step 13): the `applyPaneSizes` precondition, and the Common methods row. The section's existing discard paragraph at [`:202`](packages/lib/docs/layouts/Split.md#L202) stays as it is — the discard rule does not change.
- One `## Fixed` → `### Layouts` entry in [`changelog/next.md`](packages/lib/docs/reference/changelog/next.md) (step 14). `paneSizes`, `collapsedPanes` and `applyPaneSizes` are all public, and a consumer's saved layout was being dropped, so this is consumer-visible.
- `applyPaneSizes`' own JSDoc gains the precondition (step 11). It is the only public JSDoc this plan touches, which is why `docs:api` is a real check in `## Verification`.
- No change to [`llms.txt`](packages/lib/llms.txt) or to [`docs/layouts/Accordion.md`](packages/lib/docs/layouts/Accordion.md). No class is added or removed, so the manifest's coverage guard is unaffected, and `Accordion`'s own drain is not changed.

---

## Potential Challenges

- **A half-added child list still loses the array.** A pass that runs when one of two panes has been added sees a length mismatch and discards, exactly as it does today. It needs app code to force a synchronous layout between two `addComponent` calls, which the library itself never does (Finding 9), and the alternative — retrying until the array fits — resurrects stale captures (E12).[^partial-list]
- **The held array is now visible to `getPaneSizes()`.** After a pane-less pass with the panes since added, `getPaneSizes()` reports the pending seed rather than the live sizes. That is the documented contract at [`Split.ts:1281-1283`](packages/lib/src/typescript/lib/layout/Split.ts#L1281) and it is what stops a `paneresize`-driven save from overwriting a restore in flight; E4 pins it and E13 pins the pane-less case, which still reports `[]`.
- **Three existing discard cases start warning.** They pass unchanged and Vitest hides console output for a passing test (Finding 10), so no spy has to be added to them. If a future runner surfaces it, add the `Router.test.ts` spy to each rather than weakening the warning.
- **The guard must not be mistaken for a retry.** `_pendingSizes` is cleared before `applyPaneSizes` runs, so a stale array is still discarded on its one draining pass. Step 2 keeps that order; moving the clear after the call would change the semantics E12 forbids.

---

## Critical Files

- [`packages/lib/src/typescript/lib/layout/Split.ts`](packages/lib/src/typescript/lib/layout/Split.ts) — the two drains at [`:2415`](packages/lib/src/typescript/lib/layout/Split.ts#L2415) and [`:2434`](packages/lib/src/typescript/lib/layout/Split.ts#L2434), their call site in `doLayout` at [`:2190-2192`](packages/lib/src/typescript/lib/layout/Split.ts#L2190), `applyPaneSizes` at [`:1318`](packages/lib/src/typescript/lib/layout/Split.ts#L1318), `getPaneSizes` at [`:1284`](packages/lib/src/typescript/lib/layout/Split.ts#L1284), the `applyPaneRatios` empty guard at [`:1231`](packages/lib/src/typescript/lib/layout/Split.ts#L1231), `seedFromPreferred` at [`:1020`](packages/lib/src/typescript/lib/layout/Split.ts#L1020), and the equal-division fallback at [`:2680-2709`](packages/lib/src/typescript/lib/layout/Split.ts#L2680).
- [`packages/lib/src/typescript/lib/layout/LayoutSizes.ts:102-126`](packages/lib/src/typescript/lib/layout/LayoutSizes.ts#L102) — `isRestorableSizes`, the discard rule and its `units.length === 0` arm.
- [`packages/lib/src/typescript/lib/layout/Accordion.ts:2702-2758`](packages/lib/src/typescript/lib/layout/Accordion.ts#L2702) — the twin drain and the structural gate Guard A mirrors. Read before step 2.
- [`packages/lib/src/typescript/lib/router/Router.ts:113-124`](packages/lib/src/typescript/lib/router/Router.ts#L113) and [`packages/lib/tests/unit/router/Router.test.ts:24-39`](packages/lib/tests/unit/router/Router.test.ts#L24) — the diagnostics precedent, warning and assertion. Read before steps 8 and 10.
- [`packages/lib/tests/component/layout/Split.test.ts:906-1195`](packages/lib/tests/component/layout/Split.test.ts#L906) — the pane-sizes block, its three discard cases, and the two masked cases step 6 strengthens.
- [`packages/lib/tests/component/layout/PrematureLayout.test.ts`](packages/lib/tests/component/layout/PrematureLayout.test.ts) — the established treatment of a layout pass that runs too early: it must cost nothing and the next one must do the work. Case B2-4 at [`:130`](packages/lib/tests/component/layout/PrematureLayout.test.ts#L130) already covers `Split` with no element; this plan covers the element-but-no-panes case it does not.
- [`packages/lib/src/typescript/lib/core/Body.ts:119-144`](packages/lib/src/typescript/lib/core/Body.ts#L119) and [`:278-288`](packages/lib/src/typescript/lib/core/Body.ts#L278) — the startup sequence that makes the pane-less pass unavoidable.
- [`plans/demo-app-category-navigation.md:404-422`](plans/demo-app-category-navigation.md#L404) — the in-repo consumer, and the exact construction shape the defect breaks.

---

## Non-Goals

- **`Accordion`'s `applyPendingSectionSizes` is not changed.** It clears before checking, like `Split` did, but its caller cannot reach it with an empty section list (Finding 7). Adding a second guard for an unreachable path is speculative.
- **No retry semantics.** `_pendingSizes` is still cleared before the one attempt that resolves panes; a stale array is discarded whole and never re-tried (E12).
- **No API change on `applyPaneSizes`.** No boolean return, no `tryApplyPaneSizes`, no deferred variant modelled on `Accordion.applySectionSizes`.
- **`applyPaneRatios`' silent empty-container bail gets no warning.** It is a same-session topology surface driven by `LayoutSerialization`, not a consumer's saved layout, and nothing reported a diagnosis cost there.
- **The collapsed drain's per-index skip stays silent.** An out-of-range index in `collapsedPanes` is a legitimate partial application after a layout shrinks, not a whole-array discard; warning on it would fire for a correct app.
- **The 14 pre-existing `docs:api` warnings are not cleared.** A branch in the unmerged stack owns that; the bar here is no new warning.
- **No dev/production gate and no warn-once helper.** The library has neither today and this change does not need one (`## Architecture Decisions`).
- **No demo-app change.** `plans/demo-app-category-navigation.md` owns the app that consumes this fix.

---

## Notes

[^why-the-pass]: `Body.init` applies its options — including the `layoutManager` — synchronously at [`Body.ts:123`](packages/lib/src/typescript/lib/core/Body.ts#L123), and the singleton's own `init()` calls `setSize(DOM.source.getViewportSize())` at [`:281`](packages/lib/src/typescript/lib/core/Body.ts#L281), which reaches `Component.setSize` ([`Component.ts:4398`](packages/lib/src/typescript/lib/core/Component.ts#L4398)) → `scheduleLayout` ([`:4419`](packages/lib/src/typescript/lib/core/Component.ts#L4419), defined at [`:8185`](packages/lib/src/typescript/lib/core/Component.ts#L8185)) → `ensureFlushScheduled` ([`:233`](packages/lib/src/typescript/lib/core/Component.ts#L233)), arming an animation frame. `Body.init` then awaits `whenFontActivated()` at [`:141`](packages/lib/src/typescript/lib/core/Body.ts#L141), whose 50 ms deadline is itself armed from the first animation frame ([`Theme.ts:1344-1350`](packages/lib/src/typescript/lib/core/Theme.ts#L1344), `FONT_ACTIVATION_DEADLINE_MS` at [`FontActivation.ts:25`](packages/lib/src/typescript/lib/core/FontActivation.ts#L25)), so at least one frame elapses before the `await` returns. That frame flushes `Body.doLayout()` → `Split.doLayout()` → `applyPendingSizes()` with zero children. Only afterwards does the app add its panes. Handing `paneSizes` to the constructor and adding the panes after `await Body.init(...)` is the shape the library's own demo-app plan uses ([`plans/demo-app-category-navigation.md:415-422`](plans/demo-app-category-navigation.md#L415)), so the caller is correct and the library is wrong.

[^narrow-guard]: Two alternatives were rejected. **Extracting a `tryApplyPaneSizes(): boolean` and clearing `_pendingSizes` only on success** would also cover a partially-populated child list, but it converts a once-only discard into a retry on every layout pass, and a stale array then waits for a topology change that happens to make it fit — a 3-pane-era capture would be applied the moment a pane is removed, silently overwriting the user's current geometry. E12 is the case that forbids it. **Making `applyPaneSizes` deferred, like [`Accordion.applySectionSizes`](packages/lib/src/typescript/lib/layout/Accordion.ts#L1135)**, would remove the public arm's silence outright, but it changes an immediate method into a deferred one — `getPaneSize` straight after the call would stop reflecting the write — and `Split.applyPaneSizes` belongs to the immediate family: it rebases `_lastAvailableMain` on the spot at [`Split.ts:1341`](packages/lib/src/typescript/lib/layout/Split.ts#L1341), exactly as `applyPaneRatios` does at [`:1250`](packages/lib/src/typescript/lib/layout/Split.ts#L1250). No caller asked for either, and the project deletes unused public API rather than deprecating it.

[^no-retry]: The clear stays where it is, immediately before the `applyPaneSizes` call, so the one pass that has panes is the one and only attempt. The existing once-only case at [`Split.test.ts:1137`](packages/lib/tests/component/layout/Split.test.ts#L1137) already fails if the clear is dropped altogether, and step 6 makes its first assertion able to fail as well.

[^which-list]: `getLaidOutComponents()` filters `getComponents()` to the displayed children ([`Component.ts:7795`](packages/lib/src/typescript/lib/core/Component.ts#L7795)), so a laid-out count above zero implies a child count above zero and a laid-out-based guard would never be *wrong* — only more conservative, holding the seed through a pass whose panes all happen to be undisplayed. It is still the wrong list: `applyPaneSizes` validates against `getComponents()`, and `getPaneSizes` captures one entry per child from the same list, so an undisplayed pane owns an entry and there is nothing to wait for. E7 is the case that discriminates the two; measured, the laid-out variant leaves the pane at 636 on that pass instead of 200.

[^diag-shape]: The library has no `__DEV__`, `NODE_ENV` or `import.meta.env` switch anywhere in `packages/lib/src/typescript/lib`, and no warn-once helper: every diagnostic is a bare `console.warn`, in `Router`, `Grid`, `Card` ([`Card.ts:224`](packages/lib/src/typescript/lib/layout/Card.ts#L224)), `LayoutSerialization` ([`:560`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L560)), `Popover` ([`:828`](packages/lib/src/typescript/lib/overlay/Popover.ts#L828)), `Button` ([`:2249`](packages/lib/src/typescript/lib/component/button/Button.ts#L2249)) and the store. The newer ones are prefixed with the class name and name the offending values; `Button`'s uses a literal em-dash in the message, as these do. No `no-console` ESLint rule exists. Repetition needs no suppression here: the drain calls `applyPaneSizes` at most once, because it clears `_pendingSizes` first, and a public call warns once per call — E10 pins exactly one warning across two layout passes. Several of these warnings are asserted in tests ([`Router.test.ts`](packages/lib/tests/unit/router/Router.test.ts#L24), [`LayoutSerialization.test.ts:340`](packages/lib/tests/component/layout/LayoutSerialization.test.ts#L340), `Popover.test.ts`, `Markdown.test.ts`), always through a mocked `vi.spyOn(console, 'warn')`, which is the shape step 8 follows.

[^both-warn-and-doc]: The two cover different readers. The warning reaches the developer who has already made the mistake — which is the observed failure mode: the defect took four exchanges to identify precisely because a saved layout vanished with no signal. The precondition reaches the developer reading the method before calling it, and is the only one of the two that survives into a production build's silence. Neither alone closes the gap, and a precondition with no runtime signal is what the `_pendingSizes` field comment already was: a claim nothing enforced.

[^no-return-value]: A caller can already distinguish the three outcomes without new surface. `getPaneSizes()` returns `[]` when the manager is detached or the container has no panes, the supplied values when a pending seed is still undrained, and the live sizes when an array was discarded — so comparing what it returns against what was supplied answers the question. Against that, a `boolean` return would break the chaining every other `Split` mutator offers and diverge from `applyPaneRatios` and `Accordion.applySectionSizes`, both of which return `this`. With no caller needing it, the project's pre-1.0 rule — surface with no callers is not added — settles it.

[^partial-list]: Reaching the drain with some but not all panes added needs a synchronous layout pass between two `addComponent` calls on the same host. `insertComponent` only schedules an animation-frame flush ([`Component.ts:7579`](packages/lib/src/typescript/lib/core/Component.ts#L7579)) and the child size relay installed by `wireChild` does the same ([`:7421-7430`](packages/lib/src/typescript/lib/core/Component.ts#L7421)), so two adds in one tick collapse into a single pass. The only synchronous `doLayout` the library drives is [`LayoutManager.setOverflowing`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L272), which lays out its *own* container and is driven from `Panel.setAutoScroll` ([`Panel.ts:450`](packages/lib/src/typescript/lib/core/Panel.ts#L450)) — a call on the split's host, not something a pane's construction triggers. So the case needs app code that calls `host.doLayout()` or flips the host's `autoScroll` mid-build, and the answer it gets is the defensible one: two live panes against a three-entry array is a length mismatch that the manager cannot tell apart from a genuinely stale capture.
