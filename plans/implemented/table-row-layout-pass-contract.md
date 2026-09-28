---
depends-on: [field-internals-unchanged-commit-opt-in]
touches-shared:
  - packages/lib/src/typescript/lib/layout/Absolute.ts
  - packages/lib/src/typescript/lib/layout/index.ts
  - packages/lib/src/typescript/lib/component/table/Row.ts
  - packages/lib/tests/component/layout/Absolute.test.ts
  - packages/lib/tests/core/UnchangedCommitOptIns.test.ts
  - packages/lib/docs/layouts/Absolute.md
  - packages/lib/docs/reference/changelog/next.md
---

# Table Row Layout-Pass Contract — Implementation Plan

## Overview

A table [`Row`](packages/lib/src/typescript/lib/component/table/Row.ts#L70) overrides `doLayout` as a bare `return this;` ([`Row.ts:1003`](packages/lib/src/typescript/lib/component/table/Row.ts#L1003)). `Component.doLayout` ([`core/Component.ts:8015`](packages/lib/src/typescript/lib/core/Component.ts#L8015)) is the only place a component clears its layout-dirty flag, records the text-metrics generation and drains its `onFirstLayout` queue. So every `Row` reports `isLayoutDirty()` `true` for its whole life, and an `onFirstLayout` callback registered on a row before it is connected never runs. A third effect is new here: the batched layout flush drops a cell's scheduled pass whenever the cell's row was scheduled in the same frame, because it assumes the row's pass will reach the cell, and the row's pass does nothing.

Restoring `return super.doLayout();` alone was tried and reverted (see `field-internals-unchanged-commit-opt-in.md`'s *Why the `Row` half was reverted*). A row runs the default [`Absolute`](packages/lib/src/typescript/lib/layout/Absolute.ts#L22) manager, which commits each child at its *preferred* size, and several cells report one. The base pass would then shrink a `BooleanCell` from the rectangle the body's render window gave it to 20×16, and — found by this plan — grow a narrow header `FilterCell` to 236 pixels wide over its neighbour.

This plan adds a `sizing` option to `Absolute`. In `"committed"` mode it re-commits every child at the rectangle the child already holds instead of at its preferred size. `Row` is built with that manager and loses its `doLayout` override, so the base pass runs, records the pass, drains `onFirstLayout`, and lays out any cell that owes a pass — at the rectangle the body gave it. Nothing else changes: `Cell` keeps its preferred size, and no other class changes its manager.

---

## Architecture Decisions

### `Absolute` gains a `sizing` option; `"committed"` keeps each child's own rectangle

`AbsoluteOptions.sizing?: AbsoluteSizing`, with `AbsoluteSizing = "preferred" | "committed"`, default `"preferred"`. `"preferred"` is today's behaviour, unchanged. `"committed"` places each child at its own `getX()` / `getY()`, like today, but sizes it at its own `getWidth()` / `getHeight()` instead of `getPreferredSize() ?? getSize()`.[^why-option]

The shape mirrors [`BoxLayout`'s `overflowSizing`](packages/lib/src/typescript/lib/layout/BoxLayout.ts#L40): a string-union type exported from the layout barrel, a private field with a default, a getter, a setter that marks the container's pass owed through `this.getContainer()?.invalidateLayout()` ([`BoxLayout.ts:310`](packages/lib/src/typescript/lib/layout/BoxLayout.ts#L310)), and an `applyOptions` dispatch. ARCHITECTURE.md's *Positioning is always absolute* says a missing layout behaviour is added to an existing manager as an option before anything else.

| Child | Held rectangle | Preferred size | `"preferred"` commits | `"committed"` commits |
|---|---|---|---|---|
| `BooleanCell` in a body row | 248.5, 0, 48×20 | 20×16 | 248.5, 0, **20×16** | 248.5, 0, 48×20 |
| narrow `FilterCell` in the filter row | 0, 0, 25×22 | 236×22 | 0, 0, **236×22** | 0, 0, 25×22 |
| `StringCell` in a body row | 0, 0, 248.5×20 | `null` | 0, 0, 248.5×20 | 0, 0, 248.5×20 |
| child never sized | NaN, NaN, NaN×NaN | 40×25 | NaN, NaN, 40×25 | skipped (see below) |

The `StringCell` row is why the defect stayed hidden: when the preferred size is `null`, both modes give the same answer.

### `Row` runs `Absolute({ sizing: "committed" })`, and its `doLayout` override is deleted

`Row`'s constructor passes `layoutManager: new Absolute({ sizing: "committed" })` in its `super({ tag: "tr", … })` options bag. The `doLayout(): this { return this; }` override and its doc comment are deleted outright, so `Row` inherits `Component.doLayout`.[^why-committed-row]

The change covers every `Row`: the body's and the tree body's pooled rows, the header's three rows and the footer's row. They are the same class, and all of them are placed from outside — the body's render window places body cells with `applyBounds` ([`Body.ts:1517`](packages/lib/src/typescript/lib/component/table/Body.ts#L1517)), and the header positions its own cells the same way.

### `Cell` keeps reporting its preferred size

`Cell`'s preferred size is its `Card` manager's accurate report of the visible child, and ARCHITECTURE.md's *Size constraints* rules 2 and 3 make an inaccurate report a bug at the manager. So the fix goes where the misplacement happens — the row's manager — not into the cells' size reports.[^why-not-cell]

### In `"committed"` mode a child that was never sized is left alone

A child whose `getWidth()` or `getHeight()` is `NaN` — the "never assigned" seed — is skipped: not committed and not laid out. Its placer has not sized it yet, and that placer's first commit lays it out anyway. A `NaN` position with a real size is still committed, exactly as `"preferred"` mode already does it, because `commitBounds` handles an unknown position itself.[^nan-skip]

### A row's pass now lays out a cell that owes one

`commitBounds` withholds a settled cell's pass when its rectangle did not change, through `Cell`'s unchanged-commit opt-in ([`Cell.ts:256`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L256)). But it runs the pass of a cell that is marked dirty. This matters because `flushPendingLayouts` ([`Component.ts:282`](packages/lib/src/typescript/lib/core/Component.ts#L282)) drops a queued component whose ancestor is queued in the same frame, on the rule that "the ancestor's layout will recurse into it". With this plan, a row's pass keeps that promise for its cells.[^prune]

### What depends on the behaviour that changes

| Dependant | After this plan |
|---|---|
| `Component.onFirstLayout` on a `Row` | Drains on the row's first pass while connected. No library code registers one on a row today; a consumer `Row` subclass can. |
| `Row.isLayoutDirty()` | `false` after a pass, `true` again when marked. No library code reads a row's flag: `Panel` reads only its own flag, `isLayoutSettled` is reached through `canSkipUnchangedCommit` (still `false` for `Row`, which has not opted in), and the flush prunes by queue membership, not by the flag. |
| The flush's ancestor pruning | Unchanged code. A cell pruned under a queued row is now laid out by that row's pass. |
| The body's render window | Unchanged. It still places every cell through `applyBounds`; a row pass then re-commits the same rectangle. |
| `TableHeader` / `FooterRow`, which run default `Absolute` over their rows | Unchanged. A row's preferred size stays `null` (`Absolute` does not override `LayoutManager.getPreferredSize`), so they keep committing rows at their current size. |
| `Diagnostics`' layout-pass count | Each row pass now counts once; `Row.doLayout` used to return before the count. |

The table comes from a search of every `isLayoutDirty()` and `onFirstLayout(` caller.[^audit]

### `Row` stays out of the unchanged-commit opt-in

`Row.canSkipUnchangedLayout()` stays at the default `false`. A body row is never committed through a gate. Opting in the header rows is a separate performance question that this defect does not raise.[^no-opt-in]

---

## Public API

```ts
// layout/Absolute.ts — new exported type, re-exported from layout/index.ts
export type AbsoluteSizing = "preferred" | "committed";

export interface AbsoluteOptions extends LayoutManagerOptions {
    /** How each child is sized. Default `"preferred"`. */
    sizing?: AbsoluteSizing;
}

class Absolute extends LayoutManager {
    getSizing(): AbsoluteSizing;
    setSizing(sizing: AbsoluteSizing): this;              // marks the container's pass owed
    protected applyOptions(options: AbsoluteOptions): void;   // new override; dispatches `sizing`
    doLayout(): void;                                      // body branches on the mode
}
```

Backing field: `private _sizing: AbsoluteSizing = "preferred";`. A plain initializer is correct here: `Absolute` is not a `Component`, and its constructor calls `applyOptions` after `super()` returns, so the `declare` rule in CODE_CONVENTIONS.md does not apply — the same as `BoxLayout._overflowSizing`.

`Row` gains no public member and loses its `doLayout` override. `Row.doLayout()` is still callable and now resolves to `Component.doLayout`.

---

## Internal Structure

`Absolute.doLayout` after the change. The `"preferred"` arm matches today's body line for line:

```ts
    doLayout(): void {
        const container = this.getContainer();

        if (!container) {
            return;
        }

        const components = container.getLaidOutComponents();
        const placements: ResolvedPlacement[] = [];

        for (const component of components) {
            const x = component.getX();
            const y = component.getY();

            if (this._sizing === "committed") {
                const width  = component.getWidth();
                const height = component.getHeight();

                // A child nobody has sized yet holds no rectangle to keep.
                // Committing its NaN extents would report a change on every
                // pass and lay it out for ever; its placer's first commit lays
                // it out instead.
                if (Number.isNaN(width) || Number.isNaN(height)) {
                    continue;
                }

                placements.push({ component, x, y, width, height });

                continue;
            }

            const preferredSize = component.getPreferredSize();
            const size = component.getSize();

            const width = preferredSize?.width ?? size?.width ?? 0;
            const height = preferredSize?.height ?? size?.height ?? 0;

            placements.push({ component, x, y, width, height });
        }

        this.commitPlacements(placements);
    }
```

If the loop body passes about 30 lines once its comments are in, extract the two arms into private `committedPlacement(component): ResolvedPlacement | null` and `preferredPlacement(component): ResolvedPlacement` helpers, per the global CODE_CONVENTIONS.md *Decompose large or complex functions*.

`Row`'s constructor call:

```ts
        // A row's cells are placed from outside — the body's render window and
        // the header both commit each cell through `applyBounds` — so the
        // row's own pass must keep the rectangle each cell holds rather than
        // re-size it to its preferred size: a `BooleanCell` reports 20×16 and
        // a `FilterCell` 236×22. The pass still has to run, since it is what
        // records that the row laid out, drains `onFirstLayout`, and lays out
        // any cell that owes a pass the batched flush folded into this row's.
        super({ tag: "tr", layoutManager: new Absolute({ sizing: "committed" }) });
```

`Row.ts` gains `import { Absolute } from "~/layout/Absolute.js";`, using the callable name per ARCHITECTURE.md *Components are exported through `callable()`*.

---

## Ordered Implementation Steps

The `implement` skill works test-first: steps 1–3 write tests that must be **red** on the unchanged tree for the reasons stated, step 4 makes them green.

1. **`packages/lib/tests/component/layout/Absolute.test.ts`** — give the file's `hostAbsolute(width, height)` helper a third parameter, `manager: Absolute = new Absolute()`, passed as the host's `layoutManager` (the existing cases keep calling it with two arguments). Add a `describe('Absolute — sizing', …)` block with cases A1–A6 from *Expected Behaviour*, reusing `CONFIG`. Import `type AbsoluteSizing` only if a case needs it. Check: `npm run typecheck:test` fails (no `sizing` option yet) — expected at this step.
2. **`packages/lib/tests/core/UnchangedCommitOptIns.test.ts`** — add `import { Absolute } from '~/layout/Absolute';` and one `MANAGER_SETTERS` row (after the `Split.setPaneSize` row at line 659): `['Absolute.setSizing', () => new Absolute(), m => m.setSizing('committed'), 2],`. This is case A5.
3. **`packages/lib/tests/component/table/RowLayoutPass.test.ts`** (new) — cases R1–R4 from *Expected Behaviour*, using the shared fixture in *Verification*. Check: `npx vitest run tests/component/table/RowLayoutPass.test.ts` from `packages/lib` shows all seven cases red: R1's four and R2 on `isLayoutDirty()`, R3 on the callback count, R4 on the renderer's x. (This command matches `npm test`'s working directory; do not pass `--root`.)
4. **`packages/lib/src/typescript/lib/layout/Absolute.ts`** — add `AbsoluteSizing`, the `sizing` field on `AbsoluteOptions` with its doc comment, `_sizing`, `getSizing`, `setSizing`, an `applyOptions` override (call `super.applyOptions(options)` first, then `if (options.sizing !== undefined) { this.setSizing(options.sizing); }`), and the new `doLayout` body from *Internal Structure*. Extend the class JSDoc with one sentence after the existing first sentence, naming the `sizing` option. **Do not change the first sentence** — `llms.txt` quotes it. Update `doLayout`'s own JSDoc to describe both modes. Check: A1–A6 green.
5. **`packages/lib/src/typescript/lib/layout/index.ts`** — change line 9 to `export type { AbsoluteOptions, AbsoluteSizing } from '~/layout/Absolute.js';`.
6. **`packages/lib/src/typescript/lib/component/table/Row.ts`** — add the `Absolute` import; replace `super({ tag: "tr" });` (line 160) with the commented call from *Internal Structure*; delete the `doLayout` override and its doc comment (lines 997–1005). Check: `grep -n 'doLayout' packages/lib/src/typescript/lib/component/table/Row.ts` reports nothing. R1–R4 green.
7. **Mutation pass** — apply each mutation in *Verification*'s table one at a time, confirm the named case goes red, and revert. Record the outcome in the plan's `## Implementation Notes`.
8. **`packages/lib/docs/layouts/Absolute.md`** — see *Documentation Impact*.
9. **`packages/lib/docs/reference/changelog/next.md`** — see *Documentation Impact*.
10. Run the full *Verification* command list.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/layout/Absolute.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/index.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Row.ts` |
| Modify | `packages/lib/tests/component/layout/Absolute.test.ts` |
| Modify | `packages/lib/tests/core/UnchangedCommitOptIns.test.ts` |
| Create | `packages/lib/tests/component/table/RowLayoutPass.test.ts` |
| Modify (only if `docs:llms:check` reports drift) | `packages/lib/llms.txt` |
| Modify | `packages/lib/docs/layouts/Absolute.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Every case below is unit-testable offline. Each names the mutation it exists to catch. *Verification* repeats them as a checklist.

### `Absolute` — `tests/component/layout/Absolute.test.ts`

**A1 — `"committed"` keeps a sized child's rectangle on both axes.** Host `hostAbsolute(300, 200, new Absolute({ sizing: 'committed' }))`. Child `new Component({ preferredSize: { width: 40, height: 25 } })`, added, then `child.setBounds(17, 33, 90, 60)`. After `host.doLayout()`: `{ x: 17, y: 33, width: 90, height: 60 }`. *Catches:* the committed arm reading `getPreferredSize()` (gives 40×25), or swapping width and height (gives 60×90).

**A2 — the same fixture in default mode still moves to the preferred size.** Identical to A1 with `hostAbsolute(300, 200)`: result `{ x: 17, y: 33, width: 40, height: 25 }`. This is the anchor that proves A1's fixture discriminates — the two cases differ on both axes. *Catches:* a change that makes `"committed"` the default.

**A3 — `"committed"` keeps a null-preferred child's rectangle.** Child `new Component()` (no preferred size), `setBounds(5, 6, 70, 50)`. After `host.doLayout()` in `"committed"` mode: `{ x: 5, y: 6, width: 70, height: 50 }`. This is the arm that hid the defect. *Catches:* a committed arm that falls back to `0` or to the preferred size, or an axis swap.

**A4 — `"committed"` skips a never-sized child and still lays out a sized one that owes a pass.** Two children in a `"committed"` host: `sized` with `setBounds(0, 0, 50, 20)`, and `unsized` added but never sized. Assert both have elements (`getElement()` truthy), because a pass on an element-less component leaves the dirty flag set whatever the manager does. Run `host.doLayout()` once, then `sized.invalidateLayout()`, and assert `sized.isLayoutDirty()` and `unsized.isLayoutDirty()` are both `true`. Run `host.doLayout()` again. Assert `sized.isLayoutDirty()` is `false` (the non-zero baseline) and `unsized.isLayoutDirty()` is still `true`, with `Number.isNaN(unsized.getWidth())`. *Catches:* removing the `NaN` skip — `unsized` is then committed at `NaN`, `commitBounds` reports a change, and its pass clears the flag. *Also catches:* a committed arm that commits nothing — `sized` stays dirty.

**A5 — `setSizing` marks the container's pass owed.** The `MANAGER_SETTERS` row from step 2: a settled host reads `isLayoutDirty()` `false`, and after `setSizing('committed')` reads `true`. *Catches:* `setSizing` without `invalidateLayout()`.

**A6 — the option and the default reach the getter.** `new Absolute().getSizing()` is `'preferred'`; `new Absolute({ sizing: 'committed' }).getSizing()` is `'committed'`. *Catches:* `applyOptions` not forwarding `sizing`. The first half alone passes whatever the dispatch does, which is why both halves are required.

### `Row` — `tests/component/table/RowLayoutPass.test.ts`

R1, R3 and R4 settle the shared fixture from *Verification* first; R2 builds its own table. Every rectangle is compared as the whole `{ x, y, width, height }` object.

**R1 — a row pass keeps each cell's rectangle, sized and null arms alike** (`it.each` over `StringCell`, `BooleanCell`, `GlyphCell`, `DynamicCell`). Find the cell of that class on pool row 0 and assert it was found and that `cell.constructor.name` matches. Record `before`. Preconditions: `before.width > 0`, `before.height > 0`, `before.width !== before.height`. For the three sized classes, additionally `pref.width !== before.width` **and** `pref.height !== before.height`, where `pref = cell.getPreferredSize()`. For `StringCell`, `pref` is `null`. Then `row.invalidateLayout()`, assert `row.isLayoutDirty()` is `true`, call `row.scheduleLayout()`, `runFrames()`, and assert `row.isLayoutDirty()` is `false` **and** `rectOf(cell)` equals `before`.

At the fixture, `BooleanCell` holds `{ x: 248.5, y: 0, width: 48, height: 20 }` against a preferred 20×16. Under the default manager it becomes `{ x: 248.5, y: 0, width: 20, height: 16 }`. *Catches:* `Row` built without the option (the three sized arms go red on the rectangle; `StringCell` stays green, which is the point of the null arm); the override left in place (all four go red on the dirty flag); an axis swap (the `width !== height` precondition makes it visible).

**R2 — a header pass keeps both the grown and the shrunk arm of the filter row.** A table with a narrow `number` column `a` and a wide `string` column `b`, both `filterable: true`, at 600×300. `table.setFilterRowVisible(true)`, then `table.doLayout()` and `runFrames()`. Let `[narrow, wide] = header.getFilterRow().getComponents()` and `pref = narrow.getPreferredSize()` (236×22 at the fixture). Preconditions: `rectOf(narrow).width < pref.width` (25 < 236) and `rectOf(wide).width > pref.width` (561 > 236). Then `filterRow.invalidateLayout()`, `table.getHeader().scheduleLayout()`, `runFrames()`. Assert `filterRow.isLayoutDirty()` is `false`, and both rectangles are unchanged. Height does **not** discriminate here — the filter cell's preferred height equals its committed height, 22 — so the preconditions are on width only. *Catches:* the default manager (narrow grows to 236, wide shrinks to 236); the override left in place (dirty flag).

**R3 — `onFirstLayout` on a pooled row fires on the row's first connected pass.** Spy `DOM.source.isConnected` to return a local `connected` flag, starting `false`. Register `row.onFirstLayout(() => fired++)`, `runFrames()`, and assert `fired` is `0` (the callback waited). Set `connected = true`, call `row.scheduleLayout()`, `runFrames()`, and assert `fired` is `1`. *Catches:* the override left in place (`fired` stays `0`).

**R4 — a cell pass the flush folds into its row's pass is not lost.** Take the `StringCell` on row 0 and its renderer (`cell.getComponents()[0]`). Record the renderer's `getX()` as `x0` and the cell's rectangle as `before`. Then `cell.setInsets(new Insets(0, 0, 0, 7))`, `cell.scheduleLayout()`, `row.scheduleLayout()`, and assert `cell.isLayoutDirty()` is `true`. `runFrames()`. Assert the renderer's `getX()` is `x0 + 7` and the cell's rectangle still equals `before`. *Catches:* a row manager that places nothing (the rejected alternative) and the override left in place — in both, the flush drops the cell's queued pass because its row is queued, and the renderer stays at `x0`.

**Manual / in-engine.** Nothing here needs the desktop to prove correctness. The in-engine cost reading is the user's step (see *Potential Challenges*); it is not run as part of this plan.

---

## Verification

Offline only. **Never run `packages/qa/runqa.sh`, MiniBrowser, the Tauri qa-host, `npm run dev`, or anything that opens a window.**

### Shared fixture for `RowLayoutPass.test.ts`

Model the harness on [`tests/component/table/ScrollRebindLayoutEconomy.test.ts`](packages/lib/tests/component/table/ScrollRebindLayoutEconomy.test.ts): `installTestDOM(CONFIG)` in `beforeEach`, captured `requestAnimationFrame` callbacks, a `runFrames()` that drains them (including frames they queue in turn), every table disposed in `afterEach`, then `vi.restoreAllMocks()`, `ThemeManager.setTheme(ModernTheme)` and `DOM.reset()`.

```ts
const MODEL = new Model([
    { name: 'name',   type: 'string',  order: 0 },
    { name: 'active', type: 'boolean', order: 1 },
    { name: 'icon',   type: 'glyph',   order: 2 },
    { name: 'kind',   type: 'string',  order: 3 },
], 'name');

// 40 records; `kind` resolves every cell to a boolean through `cellType`,
// which is what makes a `DynamicCell` report a preferred size.
const store = new MemoryStore(MODEL, Array.from({ length: 40 }, (_, i) => ({
    name: `n${i}`, active: i % 2 === 0, icon: 'caret-down', kind: 'boolean',
})));
await store.load();

const table = new Table(store, { columns: [
    { field: 'name' }, { field: 'active' }, { field: 'icon' },
    { field: 'kind', cellType: () => 'boolean' },
] });
table.getElement(true);
table.setWidth(600);
table.setHeight(300);
table.doLayout();
runFrames();

const row = ((table.getBody() as any)._rowPool as Row[])[0];
```

A walk from the table does not reach the pooled rows or their cells, because `growRowPool` raw-appends them. The fixture reaches through `_rowPool` on purpose, and R1 asserts it found the right class before asserting anything else.[^digest]

### Mutation table

Each mutation is applied alone, run, confirmed red, and reverted (step 7).

| # | Mutation | Case that must go red | Why that case |
|---|---|---|---|
| M1 | `Row` built with plain `super({ tag: "tr" })` (default `Absolute`), override deleted | R1 `BooleanCell` / `GlyphCell` / `DynamicCell`, R2 | the rectangle becomes 20×16; the filter cells become 236 wide |
| M2 | `Row.doLayout` override restored as `return this;` | R1 (all four), R2, R3, R4 | the dirty flag stays `true`; no drain; the folded cell pass is lost |
| M3 | `"committed"` arm made a no-op (`continue` for every child) | A4 (`sized` stays dirty), R4 | the owed cell pass never runs |
| M4 | `"committed"` arm uses `getPreferredSize()` | A1, R1 sized arms, R2 | the preferred size replaces the held one |
| M5 | `"committed"` arm swaps width and height | A1, A3, R1 (all four) | every fixture has width ≠ height |
| M6 | `NaN` skip removed | A4 (`unsized` loses its dirty flag) | `commitBounds` reports a change for a `NaN` extent |
| M7 | `setSizing` without `invalidateLayout()` | A5 | settled host stays clean |
| M8 | `applyOptions` does not dispatch `sizing` | A6 second half, and R1 sized arms via M1's effect | the option never reaches the manager |

`R1 StringCell` alone stays green under M1 and M4 — that is the null arm behaving as designed, not a gap. It is there to catch M5 and M2.

### Commands

In this order. `npm run typecheck`, `npm run lint`, `npm test`, `npm run docs:api`, `npm run docs:llms:check` and `npm run docs:llms` run from the worktree root (each forwards to `packages/lib`); `npm run typecheck:test` and `npm run test:lint` run from `packages/lib`.

- `npm run typecheck` and `npm run typecheck:test` — clean.
- `npm run lint` and `npm run test:lint` — clean; the `local/require-content-bounds` baseline must not grow.
- `npm test` — green (it runs `typecheck:test` first). The start point for this plan is 518 files / 8708 passed / 2 todo; expect 519 files, and 8708 plus the new cases.
- `npm run docs:api` — 0 errors, and the pre-existing warning set unchanged. The new JSDoc must not `{@link}` anything protected or internal (CODE_CONVENTIONS.md).
- `npm run docs:llms:check` — clean. If it reports drift for `Absolute`, run `npm run docs:llms` and include the regenerated `llms.txt`.
- `grep -n 'doLayout' packages/lib/src/typescript/lib/component/table/Row.ts` — no matches.
- `grep -n 'AbsoluteSizing' packages/lib/src/typescript/lib/layout/index.ts` — one match.

---

## Documentation Impact

- **Export surface.** `AbsoluteSizing` joins `AbsoluteOptions` on `layout/index.ts` line 9. TypeDoc picks up `getSizing` / `setSizing` from the class.
- **`docs/layouts/Absolute.md`.** Its first sentence calls `Absolute` "the **no-op** layout manager" that "performs no automatic positioning", which is already only half true — it sizes every child — and would contradict the new option. Change it to say `Absolute` positions nothing: each child stays at its own `x` / `y`, and is sized at its preferred size (or its current size when it reports none). Add a `## Sizing` section after `## Per-child constraints` with a two-row table of the modes and one short example, `Absolute({ sizing: 'committed' })`, for a container whose children are sized by the code that owns them. Mention that the table's `Row` is the library's own user of `"committed"`. Link [`AbsoluteSizing`](/api/layout/type-aliases/AbsoluteSizing).
- **`docs/reference/changelog/next.md`.** Two bullets:
  - Under `## Added` → `### Layouts` (line 660): **`Absolute` takes `sizing`** (`"preferred"`, the default, or `"committed"`), with `getSizing()` / `setSizing()`. `"committed"` re-commits each child at the rectangle it already holds, for a container whose children are placed by their owner.
  - Under `## Fixed` → `### Components` (line 1146): **A table row now records its layout pass.** Modelled on the `Slider.doLayout()` bullet at line 410: `TableRow.isLayoutDirty()` no longer reads `true` for life; an `onFirstLayout` callback registered on a row before it is connected now fires on the row's first connected pass; a cell whose pass was queued in the same frame as its row's is no longer left owing it until the next render. Geometry is unchanged — the row re-commits every cell at the rectangle the table gave it. A consumer `Row` subclass that replaces the row's layout manager must keep a manager that does not re-size cells.
- No migration note: no documented behaviour is removed, and every rectangle stays where it is.

---

## Potential Challenges

- **In-engine cost on a horizontal scroll.** Each row pass now re-commits every cell. Offline, a window-changing horizontal scroll and a table resize each re-commit about 1,100 cells (34 rows of roughly 30 cells) that the flush used to skip entirely, and each row pass also turns over the size-hint generation. Mitigation: the re-commit writes nothing to the DOM (every setter it reaches is an equal-value no-op, and a cell's translate is 0). The in-engine A/B on the table scroll panels is the user's; under the standing *render time first, work second* rule, a flat clock ships and a regressed clock is a stop-and-report, not a new skip.[^cost]
- **`field-internals-unchanged-commit-opt-in`'s notes predicted a different fix.** Its revert note says "restoring the base call alone is not it". This plan restores the base call **and** changes what the base call's manager does, which is the missing half that note describes. Mitigation: R1 and R2 exist to prove the geometry claim the reverted attempt got wrong.
- **A cell deferral added later.** The tree body withholds row layout during a resize burst (`VirtualRowView.deferRowLayoutWhileResizing`). The table body does not use it today. If it is extended to table cells, a row pass would lay out a deferred cell at its held rectangle. Mitigation: that is a cost, not a geometry change, and whoever extends the deferral must decide it there.

---

## Critical Files

- [`layout/Absolute.ts`](packages/lib/src/typescript/lib/layout/Absolute.ts#L40) — the manager being extended.
- [`layout/BoxLayout.ts:40`](packages/lib/src/typescript/lib/layout/BoxLayout.ts#L40) and [`:295`–`:313`](packages/lib/src/typescript/lib/layout/BoxLayout.ts#L295) — the option/getter/setter precedent (`overflowSizing`).
- [`layout/LayoutManager.ts:601`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L601) — `commitBounds`: the unchanged-commit gate, the `NaN`-position handling, and why an equal re-commit writes nothing.
- [`component/table/Row.ts:160`](packages/lib/src/typescript/lib/component/table/Row.ts#L160) and [`:1003`](packages/lib/src/typescript/lib/component/table/Row.ts#L1003) — the constructor call and the override being deleted.
- [`core/Component.ts:263`](packages/lib/src/typescript/lib/core/Component.ts#L263) (`flushPendingLayouts`), [`:8015`](packages/lib/src/typescript/lib/core/Component.ts#L8015) (`doLayout`), [`:8096`](packages/lib/src/typescript/lib/core/Component.ts#L8096) (`onFirstLayout`), [`:4515`](packages/lib/src/typescript/lib/core/Component.ts#L4515) (`isLayoutSettled`), [`:4540`](packages/lib/src/typescript/lib/core/Component.ts#L4540) (`canSkipUnchangedCommit`).
- [`component/table/Body.ts:1517`](packages/lib/src/typescript/lib/component/table/Body.ts#L1517) — the render window placing every cell.
- [`layout/Table.ts:327`–`:389`](packages/lib/src/typescript/lib/layout/Table.ts#L327) — how the header rows and menu button are placed, and the existing comment on `Absolute`'s re-commit.
- [`tests/component/layout/Absolute.test.ts`](packages/lib/tests/component/layout/Absolute.test.ts) — the `NaN`-position cases the new block sits beside.
- [`tests/core/UnchangedCommitOptIns.test.ts:636`](packages/lib/tests/core/UnchangedCommitOptIns.test.ts#L636) — the `MANAGER_SETTERS` registry.
- `plans/implemented/field-internals-unchanged-commit-opt-in.md`, *Implementation Notes* → *Why the `Row` half was reverted*.

---

## Non-Goals

- **`TableHeader` and `FooterRow` keep the default `Absolute`.** Both place their own children from outside too, but they are safe today: a `Row` reports no preferred size, and the header's menu button has its preferred size pinned for exactly this reason ([`layout/Table.ts:379`](packages/lib/src/typescript/lib/layout/Table.ts#L379)). Switching them is a clean-up with no defect behind it.
- **No `Row` opt-in to the unchanged-commit skip** — see *Architecture Decisions*.
- **No mount-time pass for pooled rows.** A row's `onFirstLayout` fires on the row's first *connected* pass. A row registered before the table mounts waits for the next thing that schedules that row, as `onFirstLayout`'s contract already says for a component whose host does not lay it out on mount.
- **No in-engine measurement** — the user's step.

---

## Addendum: Investigation Record

All figures are offline, from throwaway probes on the stack tip (`5e4cec4c`), deleted afterwards.

**Cells that report a preferred size.** Rendered through a real `Table` and `TreeTable`, including a combo column, a custom renderer (`StringRenderer`, `LinkCellRenderer`), a `cellType` column, the rotated view, a parent-header group, a sorted column and the filter row:

| Cell | Row | Preferred size | Held rectangle (example) |
|---|---|---|---|
| `StringCell`, `NumberCell`, `DateCell`, `TimeCell`, `DateTimeCell`, `DefaultCell`, `ComboCell`, `Cell` with `StringRenderer` / `LinkCellRenderer`, tree-column `StringCell` | body | `null` | — |
| `BooleanCell` | body | 20×16 | 48×20 |
| `GlyphCell` | body | 20×16 | 41×20 |
| `DynamicCell` resolving to `boolean` or `glyph` (also the rotated view's value column) | body | 20×16 | 248.5×20 |
| `Cell` with a consumer renderer | body | whatever the renderer reports | — |
| `GroupSeparatorCell` | rotated separator row | `null` | — |
| `HeaderCell` (sorted or not), `ParentHeaderCell` | header rows | `null` | — |
| `FilterCell` | header filter row | 236×22 | 25×22 and 561×22 |

**Other parentless components running `Absolute`.** Every raw top-level mount was checked: `VirtualRowView.growRowPool` (table `Row`, tree `TreeRow`), `DragGhost.show`, `DragManager`, `Rail`, `Drawer`, and the seven `LayerManager.mount` callers (`Notification`, `AnimatedDropdown`, `Menu`, `Popover`, `Dialog`, `Tooltip`, `AbstractWindow`). Only `Row` combines an `Absolute` manager with children placed by someone else. `TreeRow` keeps its toggle and renderer off its manager by raw-appending them, so its default `Absolute` has nothing to place. `DragGhost` calls `super.doLayout()` and then re-places its own label in the same pass. The overlays place their children through their own managers or `doLayout` overrides.

**Reachability, and what the reverted fix did.** On a 40-column, 500-record table (pool 35, 30 cells per row), rows get a top-level pass on the first frame after the first layout (6), on a window-changing horizontal scroll (34), and on a table resize (34); a vertical scroll tick and a record edit schedule none. With the reverted `return super.doLayout()`, a `BooleanCell` went from 29×20 to 20×16 on that first frame and again after a window-changing scroll, and a header pass took the filter row's cells from 25 and 561 wide to 236 and 236.

**The lost cell passes, measured.** Today, a window-changing scroll leaves 68 cells (2 per row) owing a pass that nothing runs; the next render pays them (the following resize runs 68 cell passes). With `"committed"` rows, the row passes pay them in the scroll's own frame: 313 cell passes on the scroll instead of 245, then 0 on the resize instead of 68 — the same total, one frame earlier.

**Candidate fixes, simulated across the whole suite.** Each was patched in through a test-only setup file and run against all 518 files. The library suite stayed green under every one of them, the shrinking one included: nothing in the suite pins a cell's rectangle after a row pass. So the new R-cases are the first coverage this behaviour has. Under the draft of R1–R4:

| Candidate | R1 null | R1 sized | R2 | R3 | R4 |
|---|---|---|---|---|---|
| today (no-op override) | red | red | red | red | red |
| base call, default `Absolute` (the reverted fix) | green | **red** | **red** | green | green |
| base call, manager that places nothing | green | green | green | green | **red** |
| base call, `"committed"` `Absolute` (this plan) | green | green | green | green | green |

---

## Notes

[^why-option]: Three shapes were weighed for "a pass that keeps each child's rectangle". A file-local `LayoutManager` subclass in `Row.ts` would work but is a new layout primitive with one user, which ARCHITECTURE.md's *Positioning is always absolute* ranks below an option on an existing manager. A protected `Component` hook that records a pass without calling the manager would give `doLayout`'s bookkeeping a second entry point — its doc comment says it is "the only place" — and would still need its own loop to lay out cells that owe a pass, which is `commitBounds` re-implemented. An option on `Absolute` is the smallest change: `Absolute` already places each child at the child's own position, so `"committed"` changes only where the size comes from. The option also has two more natural users (`TableHeader`, `FooterRow`), which are left alone here (see *Non-Goals*).

[^why-committed-row]: Deleting the override rather than writing `return super.doLayout();` removes a method whose only job would be to call its parent. The explanation of why a row's pass must not re-size its cells lives with the manager choice in the constructor, which is where a reader looking at the row's layout will find it.

[^why-not-cell]: Making `Cell.getPreferredSize()` return `null` would make default `Absolute` commit every cell at its current size, which hides the symptom. It was rejected for three reasons. It breaks ARCHITECTURE.md's rule that a container reports sizes derived from its children, since a `Cell`'s `Card` accurately reports its renderer. Its reach is every `Cell` subclass and every consumer renderer, where the row-manager change reaches only `Row`. And a consumer `Cell` subclass could override the method again and bring the defect back. The layout-manager seam is where the misplacement happens, so that is where it is fixed. Pinning each cell's preferred size to its column rectangle — the `TableHeader` menu button's approach — was also rejected: `setPreferredSize` relays to the row's `scheduleLayout` and turns over the size-hint generation on every column resize, and it would overwrite the cell's real report.

[^nan-skip]: The existing `"preferred"` mode commits a child at its own `NaN` position when nobody positioned it, and `commitBounds` handles that (see `plans/implemented/nan-sentinel-dom-writes.md` and the `Absolute` tests beside the new block). A `NaN` *size* is different. `setWidth(NaN)` stores `NaN`, and `commitBounds`'s change test then reads `NaN !== NaN` as a change on every pass. `field-internals-unchanged-commit-opt-in`'s `ComboBoxCaretGlyph` note records the same trap for a position. In `"committed"` mode the held size is the whole point, so a child that has none has nothing to keep. In a table the likely case is a pooled row beyond the visible window, whose cells `createPoolRow` built but the render window never placed.

[^prune]: `flushPendingLayouts` walks up from each queued component and drops it when an ancestor is also queued in that frame. A cell whose renderer changes its preferred size queues both the cell and, through the parent relay `wireChild` installs, the row. With a do-nothing row pass the cell's pass is dropped and waits for the body's next render, which lays it out because its dirty flag is still set. The *Addendum*'s 68-cell figure shows cells left owing a pass after a real scroll; what marked each of them was not traced, only that nothing ran their pass until the next render. A manager that places nothing would record the row's pass and keep the geometry but keep this gap, which is why it lost to `"committed"`: R4 is the case that tells them apart.

[^audit]: The search covered `src/` and `tests/`. The library registers `onFirstLayout` only on `Markdown`, `WebGLCanvas`, `DiagramEdgeLayer`, `DiagramNodeLayer`, `AbstractCanvasSurface`, `MarkdownEditor` and `CodeEditor` — none is a row. The two table tests that read `isLayoutDirty()` (`ColumnWindowSlide`, `RowCellCache`) read it on cells, which this plan does not change. `markPassOwedAbove` marks only ancestors that opted into the skip, so a cell's `invalidateLayout()` still does not mark its row; the row-pass path in R4 is reached through the flush, not through that mark.

[^no-opt-in]: A body row is raw-appended by `growRowPool` and positioned by `VirtualRowView.positionRow`'s own setters, so no gate ever asks it — the reason `field-internals-unchanged-commit-opt-in` gave. Header rows are committed by `TableHeader`'s `Absolute` through `commitBounds`, so an opt-in would let a header pass skip them. That is a saving, not a fix, and it would need its own audit of what reaches a header row's pass.

[^digest]: `field-internals-unchanged-commit-opt-in`'s notes record that its first E13 test walked from the table, reached neither the pooled row nor its cells, and so passed vacuously. The fixture's `_rowPool` access and R1's class-name check are the answer to that.

[^cost]: The re-commit count is from the *Addendum*'s probe: 1,122 on the window-changing scroll and 1,020 on the resize. For a re-commit of a settled cell, `commitBounds` takes its slow path (size and position unchanged), where `setX`, `setY`, `setTranslate(0, 0)`, `setWillChange(null)`, `setWidth` and `setHeight` each return early on an equal value, and `Cell`'s opt-in then withholds the pass. The size-hint turnover comes from `Component.doLayout`'s `finally` block, which every row pass now reaches. It invalidates hints recorded earlier in the frame, which matters only to a size query later in the same frame.

---

## Implementation Notes

### The mutation table, executed

Every mutation in *Verification* was applied alone against the finished code,
run over `RowLayoutPass.test.ts`, `Absolute.test.ts` and
`UnchangedCommitOptIns.test.ts`, and reverted. All eight reddened the case the
table names; five also reddened cases the table did not claim, which is extra
coverage rather than a discrepancy.

| # | Cases the table names | Observed red |
|---|---|---|
| M1 | R1 `BooleanCell` / `GlyphCell` / `DynamicCell`, R2 | exactly those |
| M2 | R1 (all four), R2, R3, R4 | exactly those |
| M3 | A4, R4 | exactly those |
| M4 | A1, R1 sized arms, R2 | those, **and A4** |
| M5 | A1, A3, R1 (all four) | those, **and R2, R4** |
| M6 | A4 | exactly A4 |
| M7 | A5 | exactly A5 |
| M8 | A6, R1 sized arms | those, **and A1, A4, R2** |

`R1 StringCell` stayed green under M1 and M4, exactly as the plan predicted,
and went red under M2 and M5 — the null arm behaving as designed.

Two mutations show a limit worth naming: under M3 (the committed arm placing
nothing) A1 and A3 both stay green, because their child already holds the
rectangle `setBounds` wrote and nothing re-commits it. A4's dirty-flag
assertions and R4 are what tell "committed correctly" from "committed nothing"
apart, which is the division of labour the plan assigned them.

### Deviations

- **`Absolute.doLayout`'s two arms were extracted** into private
  `committedPlacement` / `preferredPlacement` helpers, which *Internal
  Structure* sanctions as the alternative once the loop body's comments are in.
  An inline ladder would have put an eight-line branch and a five-line branch
  inside the loop, which CODE_CONVENTIONS.md's *Decompose large or complex
  functions* asks to split.

- **`ThemeManager.setTheme(ModernTheme)` was left out** of
  `RowLayoutPass.test.ts`'s `afterEach`, although *Verification* lists it. No
  case in the file changes the theme, and the harness precedent *Verification*
  itself names — `ScrollRebindLayoutEconomy.test.ts`'s `afterEach` — calls
  neither `setTheme` nor `vi.restoreAllMocks()`, so the plan's description of
  that precedent was wrong on both counts. The nearest file that does reset the
  theme, `CellLayoutSkip.test.ts`, gives the reason in its own comment: it
  restores the theme because it changes it, and `setTheme` fires every listener
  still registered in the process. Vitest isolates module state per file, so
  nothing else can have moved the theme by the time this file runs. The table
  disposal and `vi.restoreAllMocks()` halves are both there, the latter because
  R3 spies on `DOM.source.isConnected`.

- **The changelog bullet names `Row`, not `TableRow`.** *Documentation Impact*
  wrote `TableRow.isLayoutDirty()`; the class is exported from
  `component/table` as `Row`, and `TableRow` appears nowhere else in the
  changelog.

- **No live demo was added** to `packages/docs/src/demos/`. The docs package
  does hold one per-option demo per layout feature (`hbox-justify`,
  `grid-uniform`), but nothing in its test suite invokes a demo's `create()` —
  only source-hygiene regexes run — so a new demo's correctness can only be
  confirmed by opening the docs site in a browser, which this run's constraints
  forbid. The `## Sizing` section carries a code example instead. A live
  `absolute-sizing` demo is a clean follow-up for whoever can view it, and
  would need a `<!-- demo: absolute-sizing -->` marker in
  `docs/layouts/Absolute.md` to satisfy the corpus↔registry bijection test.

- **`plans/in-progress/` did not exist** in this worktree and was created by the
  in-progress move.

- **`docs/concepts/layout-system.md` was updated, though *Documentation Impact*
  never names it.** Its "the placement inputs that announce nothing mark the
  pass owed that way themselves" list enumerates every such setter, including
  the configuration setters of the box, flow, grid, fit and border managers and
  `Split.setOrientation` / `setPaneSize`. `Absolute.setSizing` is now one of
  them — it is in the `MANAGER_SETTERS` registry for exactly that reason — so
  leaving it out would have made the page incomplete. The precedent is the pair
  of commits that added those `Split` setters: `4ab9794c` put them in the
  registry, and its documentation commit `e0ab00f6` added them to this same
  paragraph. Found by the audit.

### Verification, as run

- **`llms.txt` was regenerated even though `docs:llms:check` reported clean.**
  That check verifies catalogue coverage, not summary text; the checked-in row
  quotes the first ~200 characters of `Absolute`'s class JSDoc, which the new
  sentence changed, so `npm run docs:llms` was run and the one-line diff is
  included. `packages/docs/public/llms.txt` is gitignored.

- **Counts differ from the figures in *Verification*,** which were taken before
  the three phases that landed below this one. Measured on the start point
  (`feature/panel-resize-metrics-staleness`, `b78e3526`): **520 files / 8750
  passed / 2 todo / 0 failed**. After this plan: **521 files / 8763 passed / 2
  todo / 0 failed** — one new file and thirteen new cases (seven R, five A in
  `Absolute.test.ts`, one `MANAGER_SETTERS` row).

- `npm run typecheck`, `npm run typecheck:test`, `npm run lint`, `npm run
  test:lint` clean; `npm run docs:api` reports **0 errors and 14 warnings**, the
  pre-existing set unchanged; `npm -w packages/qa run test` **453 passed / 0
  failed**, matching its baseline. No golden-geometry digest moved —
  `UnchangedCommitSkip.test.ts` and `Component.sizeHintMemo.test.ts` both stayed
  green, so no re-capture was needed.

- **The dependants table was re-derived, not trusted.** A fresh search of every
  `isLayoutDirty()` and `onFirstLayout(` caller across `src/` and `tests/`
  confirms it holds after the `core/Panel.ts` rework two branches below: the
  only `isLayoutDirty()` reads in `src/` are `Panel.canSkipSettledRemeasure`
  (its own flag, on a `Panel`), `Component.isLayoutSettled`, and the accessor
  itself, and the library registers `onFirstLayout` only on `Markdown`,
  `WebGLCanvas`, `DiagramNodeLayer`, `DiagramEdgeLayer`, `AbstractCanvasSurface`,
  `MarkdownEditor` and `CodeEditor` — none a row. `Row` still has not opted into
  the unchanged-commit skip, so `canSkipUnchangedCommit()` stays `false` for a
  row and the flush's ancestor walk does not break at one.

### Still the user's step

The in-engine A/B on the table's scroll panels, per *Potential Challenges*.
Each row pass now re-commits every cell — about 1,100 on a window-changing
horizontal scroll or a table resize — and every setter that re-commit reaches
returns early on an equal value, so the expectation is a flat clock. Under the
standing *render time first, work second* rule a flat clock ships and a
regressed clock is a stop-and-report.
