# Split Pane Non-Collapsible Opt-Out — Implementation Plan

## Overview

Add a per-pane opt-out so a [`Split`](src/typescript/lib/layout/Split.ts) pane can be **drag-resizable but not collapsible**: the gutter serving that pane renders as a plain draggable divider with no collapse chevron, and neither the chevron double-click nor a programmatic `setPaneCollapsed` can collapse it. Default behaviour is unchanged — every pane stays collapsible exactly as today.

The flag reuses the **existing** `collapsible?: boolean` field on [`LayoutConstraints`](src/typescript/lib/layout/LayoutConstraints.ts#L75). Today only [`Border`](src/typescript/lib/layout/Border.ts#L159) reads it, as opt-in (`collapsible ?? false`). `Split` will read the same field with the opposite default — opt-**out** (`collapsible !== false`): a pane is collapsible unless its constraint sets `collapsible: false`. The two managers interpret `undefined` differently by design; that asymmetry is the one thing this plan must document loudly.

The change is localised almost entirely to `Split.ts` — a new private predicate plus edits at the three sites that already gate on "does this pane collapse": [`gutterTargetPane`](src/typescript/lib/layout/Split.ts#L165), [`setPaneCollapsed`](src/typescript/lib/layout/Split.ts#L219), and [`setPaneCollapsedImmediate`](src/typescript/lib/layout/Split.ts#L630). The gutter (`SplitGutter`) and the chevron (`CollapseButton`) need **no** changes: `SplitGutter.setCollapsible(false)` already hides the chevron via `visibility: hidden`, and the double-click that drives collapse lives only on the `CollapseButton` — a `visibility: hidden` element receives no pointer events, so hiding the chevron removes the double-click affordance too. Split already calls `gutter.setCollapsible(target >= 0)` at [Split.ts#L994](src/typescript/lib/layout/Split.ts#L994), so once a non-collapsible pane reports no serving gutter, the chevron disappears with no further wiring.

---

## Architecture Decisions

### Reuse the existing `collapsible` constraint — one field, manager-specific default

Introduce **no new field**. `Split` reads the existing `LayoutConstraints.collapsible`. The tension is that the two managers disagree on what `undefined` means:

- **`Border`** — collapsing is opt-**in**. `constraints.collapsible ?? false` ([Border.ts#L159](src/typescript/lib/layout/Border.ts#L159)): a region is fixed unless it sets `collapsible: true`.
- **`Split`** — collapsing is opt-**out**. `constraints.collapsible !== false`: a pane collapses unless it sets `collapsible: false`.

This asymmetry is defensible because each manager's default matches its established behaviour: Border regions have always been non-collapsible until they opt in, and Split panes have always been collapsible with no opt-out at all. Forcing a single default would silently change one manager's history. A layout constraint is a *hint bag* whose fields are already documented as "read differently by different managers" — `weight` is the precedent (HBox treats unset as `0`; Split treats unset as "current size"). `collapsible` joins that pattern. The rejected alternative — a distinct field such as `paneCollapsible` or `resizeOnly` — adds a second near-synonym to the constraint surface, invites "which one does X read?" confusion, and buys nothing: no consumer sets `collapsible` on a Split pane today (verified: DockRegion, Dock, SplitPanel, LayoutSerialization never reference it), so reuse is strictly additive.

The cost is one obligation: the JSDoc on `LayoutConstraints.collapsible` must state both readings explicitly, and `Split.md` / `Border.md` must each describe their own default. That documentation is cheaper than a redundant field.

### Programmatic collapse is hard-blocked by `collapsible: false`

`collapsible: false` blocks **all** collapse paths, not just the user-facing chevron:

- The chevron/double-click (via the gutter `"collapse"` handler).
- Direct `setPaneCollapsed(index, true)` and `setPaneCollapsedImmediate(index, true)`.
- The `collapsedPanes` startup option (drained through `applyPendingCollapsed`, which already gates on `paneServingGutter(index) >= 0`).

Rationale: the flag's contract is "this pane cannot be collapsed," full stop. A split contract where the affordance is suppressed but a direct call still folds the pane would be a footgun — a consumer that set `collapsible: false` to guarantee a pane stays open could have it collapsed out from under them by an unrelated bulk-restore or serialization path. Hard-blocking is also *free* to implement: every collapse path in Split already funnels through the "does this pane have a serving gutter" question (`paneServingGutter` / `gutterTargetPane`), so making a non-collapsible pane report **no serving gutter** shuts every path at once with a single predicate — no per-call-site guard sprawl. `setPaneCollapsed(index, false)` (restore) is a no-op on a pane that was never allowed to collapse, so blocking is symmetric and safe.

The one nuance: a non-collapsible pane must still get a **draggable divider**, and its collapse-capable *neighbour* must keep its own chevron. So the block cannot be "this gutter serves nobody" — it must be "this gutter does not serve *this* pane," applied per-candidate inside `gutterTargetPane`, which naturally lets the gutter fall through to serving the other neighbour when that one is collapsible.

### The single choke point is `gutterTargetPane`

`gutterTargetPane(gutterIndex, components)` ([Split.ts#L165](src/typescript/lib/layout/Split.ts#L165)) already answers "which pane, if any, does this gutter collapse — else `-1`." Every collapse decision derives from it:

- `paneServingGutter` ([Split.ts#L190](src/typescript/lib/layout/Split.ts#L190)) is defined in terms of `gutterTargetPane`.
- `doLayout`'s chevron toggle: `gutter.setCollapsible(target >= 0)` ([Split.ts#L994](src/typescript/lib/layout/Split.ts#L994)) where `target = gutterTargetPane(idx, …)`.
- The gutter `"collapse"` event handler guards on `target >= 0` ([Split.ts#L902-905](src/typescript/lib/layout/Split.ts#L902)).
- `setPaneCollapsed` / `setPaneCollapsedImmediate` resolve the serving gutter first and bail on `-1`.
- `applyPendingCollapsed` gates on `paneServingGutter(index) >= 0` ([Split.ts#L1107](src/typescript/lib/layout/Split.ts#L1107)).

Making `gutterTargetPane` refuse a non-collapsible pane as its target therefore closes the chevron, the double-click, both programmatic setters, and the startup option in one edit — while the divider itself (drawn unconditionally in `doLayout`'s expanded-gutter branch, independent of `target`) stays draggable. This is why the mechanism is a predicate consulted inside `gutterTargetPane`, not a wrapper around it. `setPaneCollapsedImmediate` is the sole path that does **not** currently consult `gutterTargetPane` — it sets `_collapsed` directly ([Split.ts#L641](src/typescript/lib/layout/Split.ts#L641)) — so it needs one explicit guard added.

---

## Public API

No new exported symbols, methods, or setters. The change is:

1. A documentation change to the existing constraint field (behaviour, not signature):

```typescript
// src/typescript/lib/layout/LayoutConstraints.ts  (existing field, doc updated)
collapsible?: boolean;
```

Consumers use it declaratively through the existing `Container.addComponent(pane, constraints)` path:

```typescript
const split = Split({ orientation: 'horizontal' });
split.addComponent(sidebar);                          // collapsible (default)
split.addComponent(content, { collapsible: false });  // draggable, never collapses
```

2. A new **private** predicate on `Split` (internal, not exported, not on the options bag):

```typescript
// Split.ts — private
private paneCollapsible(pane: Component): boolean;
// returns this.getLayoutConstraints(pane)?.collapsible !== false
```

There is no matching setter and no `SplitOptions` field: `collapsible` is a *per-pane* constraint carried on `LayoutConstraints`, not a manager-wide option, and it is set once at `addComponent` time like `collapseDirection` and `weight` — none of which have a Split-level setter either. This matches the existing per-pane constraint pattern exactly.

---

## Internal Structure

The predicate and its use inside `gutterTargetPane`:

```typescript
/**
 * Whether the pane opts into collapsing. Split is opt-OUT: a pane collapses
 * unless its constraint sets `collapsible: false`. (Border reads the same
 * field opt-IN — `collapsible ?? false`; the default differs per manager.)
 */
private paneCollapsible(pane: Component): boolean {
    return this.getLayoutConstraints(pane)?.collapsible !== false;
}

private gutterTargetPane(gutterIndex: number, components: Array<Component>): number {
    const next = components[gutterIndex + 1];
    if (next && this.paneCollapsible(next) && !this.collapsesTowardStart(this.paneDirection(next))) {
        return gutterIndex + 1;
    }

    const lead = components[gutterIndex];
    if (lead && this.paneCollapsible(lead) && this.collapsesTowardStart(this.paneDirection(lead))) {
        return gutterIndex;
    }

    return -1;
}
```

Because `paneServingGutter`, the chevron toggle, the `"collapse"` handler, `setPaneCollapsed`, and `applyPendingCollapsed` all flow from `gutterTargetPane`, they inherit the block with no further change. `setPaneCollapsedImmediate` gets its own guard since it bypasses `gutterTargetPane`:

```typescript
setPaneCollapsedImmediate(index: number, collapsed: boolean): this {
    // …existing container/pane resolution…
    // Only a pane that opts into collapsing (and can, geometrically) may fold.
    if (collapsed && this.paneServingGutter(index, components) < 0) {
        return this;
    }
    this._collapsed.set(pane, collapsed);
    // …
}
```

`paneServingGutter` now returns `-1` for a non-collapsible pane (via `gutterTargetPane`), so the guard reads naturally. Restoring (`collapsed === false`) is left unguarded so a pane can always be expanded back if its flag changed.

---

## Ordered Implementation Steps

1. **`LayoutConstraints.ts`** — expand the JSDoc on `collapsible` ([line 69-75](src/typescript/lib/layout/LayoutConstraints.ts#L69)) to document both readings: Border opt-in (`?? false`), Split opt-out (`!== false`). No code change to the field.

2. **`Split.ts`** — add the private `paneCollapsible(pane)` predicate near `paneDirection` ([~line 148](src/typescript/lib/layout/Split.ts#L148)), with a JSDoc noting the opt-out default and the Border contrast.

3. **`Split.ts`** — in `gutterTargetPane` ([line 165-177](src/typescript/lib/layout/Split.ts#L165)), add `this.paneCollapsible(next)` to the trailing-pane branch and `this.paneCollapsible(lead)` to the leading-pane branch, as shown in *Internal Structure*. → verify: a gutter whose only candidate is non-collapsible returns `-1`; a gutter with one collapsible and one non-collapsible neighbour still serves the collapsible one.

4. **`Split.ts`** — in `setPaneCollapsedImmediate` ([line 630-646](src/typescript/lib/layout/Split.ts#L630)), add the `if (collapsed && this.paneServingGutter(index, components) < 0) return this;` guard before `this._collapsed.set(...)`. Resolve `components` from the container once (the method currently reads only the single pane; use `getLaidOutComponents()` for the guard). → verify: `setPaneCollapsedImmediate(i, true)` on a non-collapsible pane is a no-op; on a collapsible pane it still collapses.

5. **Regression checkpoint** — `grep -rn "collapsible" src/typescript/lib/layout/DockRegion.ts src/typescript/lib/overlay/Dock.ts src/typescript/SplitPanel.ts src/typescript/lib/layout/LayoutSerialization.ts` → expect **zero** matches (no in-repo Split consumer sets the flag, so all behave as today).

6. **`docs/layouts/Split.md`** — add a short subsection under *Collapsible panels* documenting `collapsible: false` (draggable, no chevron, cannot collapse). See *Documentation Impact*.

7. **`tests/component/layout/Split.test.ts`** — add the offline tests from *Expected Behaviour* to the `Split collapse state` describe block.

8. **Run** `npm run typecheck`, `npm test`, `npm run docs:build` (zero warnings), and the manual smoke checks in *Verification*.

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Modify | `src/typescript/lib/layout/Split.ts` (add `paneCollapsible`; edit `gutterTargetPane`, `setPaneCollapsedImmediate`) |
| Modify | `src/typescript/lib/layout/LayoutConstraints.ts` (expand `collapsible` JSDoc) |
| Modify | `docs/layouts/Split.md` (document the opt-out) |
| Modify | `tests/component/layout/Split.test.ts` (new offline tests) |

No new files; nothing deleted; `SplitGutter.ts` and `CollapseButton.ts` untouched; `Border.ts` untouched.

---

## Expected Behaviour

Derived from the contract (opt-out default, hard block on collapse, divider stays draggable), not from current output.

**Testable offline** (state + geometry via the `_gutters` / `getPaneSize` / `isPaneCollapsed` surface the existing tests already use):

1. A pane added with `collapsible: false` reports **no serving gutter**: `(split as any).paneServingGutter(index, components)` (or equivalently, the served gutter's `isCollapsible()`) is `-1` / `false`. — *offline*
2. The gutter serving a non-collapsible pane has `gutter.isCollapsible() === false` after `doLayout`, i.e. its chevron is suppressed. — *offline* (assert on `(split as any)._gutters[i].isCollapsible()`).
3. That same gutter is still a **movable divider**: `gutter.isMovable() === true`, and a simulated `onDragStart`/`onDrag` on it resizes the two adjacent panes (their `getPaneSize` changes, sum conserved) — exactly as the existing "gutter-drag" tests do. — *offline*
4. `setPaneCollapsed(index, true)` on a non-collapsible pane is a **no-op**: `isPaneCollapsed(index)` stays `false`. — *offline*
5. `setPaneCollapsedImmediate(index, true)` on a non-collapsible pane is a **no-op**: `isPaneCollapsed(index)` stays `false`. — *offline*
6. `collapsedPanes: [i]` where pane `i` is `collapsible: false` leaves pane `i` **expanded** after first layout (`applyPendingCollapsed` skips it). — *offline*
7. A non-collapsible pane's **collapsible neighbour keeps its chevron**: given panes `[A collapsible, B collapsible:false]` sharing one gutter with A defaulting west, the gutter still serves A (`gutterTargetPane === 0`), so A can still collapse. — *offline*
8. **Default unchanged**: a pane with no `collapsible` constraint (and one with `collapsible: true`) still reports a serving gutter, still shows the chevron, and `setPaneCollapsed`/`setPaneCollapsedImmediate`/`collapsedPanes` still collapse it — byte-for-byte with today. Assert the existing collapse tests still pass and add a `collapsible: true` twin. — *offline*

**Needs manual verification** (UI paint / real pointer events the harness can't exercise):

9. Visually, the gutter serving a `collapsible: false` pane shows **no chevron grip** but still shows the resize cursor and drags. — *manual*
10. **Double-clicking** where the chevron would be on a non-collapsible pane's gutter does **not** collapse it (the `CollapseButton` is `visibility: hidden`, so it receives no `dblclick`). — *manual*
11. The gutter body's hover **tooltip** ("Double-click to collapse…") behaviour: note the tooltip is attached to the gutter body regardless of `collapsible`; if a stale "Double-click to collapse" tooltip on a non-collapsible divider is undesirable, that is a follow-up cosmetic item — see *Potential Challenges*. — *manual*

---

## Verification

- `npm run typecheck` — clean.
- `npm test` — all existing Split tests green (no regression) plus the new cases 1-8 above.
- Regression grep from step 5 — zero matches in the four in-repo consumers.
- `npm run docs:build` — zero warnings (the JSDoc edits add no `{@link}` to internal symbols).
- **Manual smoke** (`npm run dev`, app on http://localhost:8015): open the **SplitPanel demo** ([src/typescript/SplitPanel.ts](src/typescript/SplitPanel.ts)). Temporarily add `{ collapsible: false }` to one pane's `addComponent` (or confirm via a scratch panel), then check cases 9-11: chevron gone, resize cursor + drag still work, double-click does nothing, other panes still collapse. Confirm the unmodified demo behaves identically to master (every pane still collapsible). Scope DevTools queries to `.SplitPanel .Split` to avoid measuring another Split on the page.

---

## Documentation Impact

`collapsible` is already an exported field on the exported `LayoutConstraints` class, so it appears in the API docs; only its prose changes.

- **`src/typescript/lib/layout/LayoutConstraints.ts`** — the `collapsible` JSDoc must now state both readings (Border opt-in `?? false`; Split opt-out `!== false`) and that the default is per-manager. This is the single source the API reference renders.
- **`docs/layouts/Split.md`** — under *Collapsible panels* ([line 44](docs/layouts/Split.md#L44)), add a short paragraph + snippet:

  ```typescript
  split.addComponent(sidebar, { collapsible: false }); // draggable divider, no chevron, never collapses
  ```

  State: the pane's gutter is a plain draggable divider (no chevron), double-click and `setPaneCollapsed`/`collapsedPanes` cannot collapse it, and the default (unset / `true`) is unchanged. Cross-link to `Border`'s opposite default for contrast.
- **`docs/layouts/Border.md`** — no change required (Border's semantics are untouched), but a one-line note contrasting the two defaults may reduce confusion; optional.
- No barrel/export change (no new symbol). No renames, so no `grep -rln '\bOldName\b' docs/` sweep needed.

---

## Potential Challenges

- **Gutter tooltip staleness.** `SplitGutter.updateTooltip` attaches "Double-click to collapse…" to the gutter body regardless of the chevron's visibility. A non-collapsible divider will still show that hover text even though it can't collapse. Mitigation: out of scope for the core opt-out (the chevron and its action are correctly suppressed); flag it as a cosmetic follow-up rather than expanding this change into `SplitGutter`. Note it in the manual-verify step so the reviewer decides.
- **`setPaneCollapsedImmediate` needs the components list.** It currently resolves only the single pane by index; the new guard needs `getLaidOutComponents()` to call `paneServingGutter`. Mitigation: fetch it once at the top (the container is already resolved), mirroring `setPaneCollapsed`.
- **A live flag flip mid-collapse.** If a consumer sets `collapsible: false` while a pane is already collapsed, the pane stays collapsed (the block only guards *collapsing*, not the existing state) and can still be *restored*. Mitigation: this is the correct contract (restore is always allowed); document it in the JSDoc's edge note. No special handling needed.

---

## Critical Files

- [src/typescript/lib/layout/Split.ts](src/typescript/lib/layout/Split.ts) — `gutterTargetPane` (L165), `paneServingGutter` (L190), `paneDirection` (L148), `setPaneCollapsed` (L219), `setPaneCollapsedImmediate` (L630), `applyPendingCollapsed` (L1098), `doLayout` chevron toggle + collapse handler (L892-1015).
- [src/typescript/lib/layout/LayoutConstraints.ts](src/typescript/lib/layout/LayoutConstraints.ts) — the `collapsible` field (L75) and its `weight`/`collapseDirection` neighbours (the per-manager-interpretation precedent).
- [src/typescript/lib/layout/Border.ts](src/typescript/lib/layout/Border.ts#L159) — the opt-in reader that must stay untouched.
- [src/typescript/lib/component/container/SplitGutter.ts](src/typescript/lib/component/container/SplitGutter.ts#L211) — `setCollapsible` (L211, chevron via `setVisible`), drag wiring (L165). Read-only reference; not modified.
- [src/typescript/lib/component/container/CollapseButton.ts](src/typescript/lib/component/container/CollapseButton.ts#L289) — the dblclick→`collapse` source (L157, L289). Read-only reference; confirms the double-click is the only user affordance and dies with `visibility: hidden`.
- [tests/component/layout/Split.test.ts](tests/component/layout/Split.test.ts) — the offline harness pattern (`installTestDOM`, `(split as any)._gutters`, `getPaneSize`, `isPaneCollapsed`).
- [docs/layouts/Split.md](docs/layouts/Split.md) — the *Collapsible panels* section to extend.

---

## Non-Goals

- **The sqladmin shell sidebar↔dock gutter.** The driving downstream use case (a sidebar↔dock gutter that resizes but never collapses because collapse is rail-icon-driven) lives outside this repo. This plan delivers the `collapsible: false` primitive it needs; wiring it into the sqladmin shell is downstream work, not part of this change.
- **A manager-wide "no panes collapse" `SplitOptions` flag.** Only the per-pane constraint is requested; a split-level toggle is speculative and can be composed by setting the constraint on every pane.
- **Fixing the gutter-body collapse tooltip on non-collapsible dividers.** A cosmetic follow-up (see *Potential Challenges*), not required for the affordance to be correctly suppressed.
- **Changing Border's `collapsible` semantics.** Border keeps its opt-in `?? false` reading unchanged.
- **A runtime `setPaneCollapsible` setter.** Matching the existing per-pane constraints (`collapseDirection`, `weight` have no Split-level setter), the flag is set at `addComponent` time only.
