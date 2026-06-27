# Region-Fill Max Size — Implementation Plan

## Overview

A `List` (or any leaf `Component`-derived widget) placed in a stretching layout region — a `Border` WEST/CENTER region, a `Fit`/`Box` cell with `FillType.BOTH/VERTICAL` — caps its committed height at its *content-derived* maximum instead of filling the region. A 13-item `List` in a 400px-tall WEST or CENTER region lays out at **288px** (13 × 22px content height) rather than 400px. The user wants it to **fill** the region.

The root cause is **not** in `Border` or in the layout managers' geometry — those commit the full region extent. It is in the component's own self-clamp. `Component.setHeight` runs the height through [`clampHeight`](../src/typescript/lib/core/Component.ts#L2858), which — when [`clampsToContentSize()`](../src/typescript/lib/core/Component.ts#L2781) returns `true` (the `Component` default) — clamps to the **merged** [`getMaxSize()`](../src/typescript/lib/core/Component.ts#L2366), folding in the layout manager's finite content max via `Math.min`. `List` (`AbstractCustomList → AbstractInput → Component`) never overrides `clampsToContentSize()`, so it keeps the content-clamping default; its inner `VBox` reports a finite 288px max, and `clampHeight` refuses the 400px the region assigned.

The fix is a one-line policy override already used by every component that fills its allocation (`Container`, `Panel`, `Body`, `Cell`, `TabBar`, `Rail`): override `clampsToContentSize()` to `false` on [`AbstractCustomList`](../src/typescript/lib/component/list/AbstractCustomList.ts#L411), so a list fits the space its parent allocates while an explicit `setMaxSize` / `setMinSize` still binds. This lives entirely in the list class — no change to `Component`, `getMaxSize`, the layout managers, or `Table`.

---

## Architecture Decisions

### Override `clampsToContentSize()` on `AbstractCustomList` — the recommended fix

ARCHITECTURE.md (lines 105–110, "Self-clamping — the `Component`'s job") already names the exact switch for this behaviour: the protected `Component.clampsToContentSize()`. `true` (default) means "adhere to my content-derived `[min, max]`"; `false` means "fit my parent's allocation; only my explicit `setMinSize`/`setMaxSize` are hard limits." `Container`/`Panel` ([Container.ts:49](../src/typescript/lib/core/Container.ts#L49)), `Body` ([Body.ts:90](../src/typescript/lib/core/Body.ts#L90)), `Cell` ([Cell.ts:100](../src/typescript/lib/component/table/cell/Cell.ts#L100)), `Rail` ([Rail.ts:1129](../src/typescript/lib/overlay/Rail.ts#L1129)), and `TabBar` all override it to `false` for precisely this reason.

A list is conceptually a fill-the-region widget, not a shrink-wrap one: it scrolls (`autoScroll: "y"` on its inner panel) rather than insisting on its content height. So `AbstractCustomList` is exactly the class that should opt out of content-clamping. The override is inherited by both concrete subclasses — `List` and `MultiSelectList` — and by the embedded-list usages (`ComboBox`, `AutoCompleteField`) without further change.

Empirically verified in a throwaway test against the real `List`: with the override, a 13-item list fills both a 400px WEST region and a 400px CENTER region (400, not 288); an explicit `maxSize: {height: 150}` still caps at 150; an explicit/region floor still applies. The full suite (1222 tests, 129 files) passes with the override in place.

### Rejected — folding a `clampToFit` flag into `getMaxSize()`

The user floated a `clampToFit` (default `false`) flag controlling whether `getMaxSize` folds the layout content max. Rejected: `getMaxSize()` is a *reporting* query read upward by parents to size and scroll-decide a child (ARCHITECTURE.md line 87). Making the **merged max report UNBOUNDED by default** would change what every parent layout manager sees — `aggregateMaxSize`, `Fit.getMaxSize`, `Border.getMaxSize`, `Grid`, the flows all consume child `getMaxSize()` to compute *their own* max. That is a far wider blast radius than the bug, and it would also weaken the size-constraint invariant story (min ≤ preferred ≤ max) by divorcing the reported max from the content. The bug is a *self-clamp* concern, not a *reporting* concern, and the codebase already has the self-clamp switch. A new flag would duplicate `clampsToContentSize()` with inverted polarity.

### Rejected — layout managers (VBox/Fit) not reporting a finite `getMaxSize()`

Making `VBox`/`Fit`/etc. report UNBOUNDED max would fix the symptom but break legitimate consumers that rely on the content max to *cap* a child (e.g. a `Cell` whose `BooleanCell` child must report a 16×16 max so the cell can centre it — the very case [Cell.ts:90](../src/typescript/lib/component/table/cell/Cell.ts#L90) documents). The content max is correct *reporting*; the bug is only that a list *self-clamps* to it. Fixing the report would be a global regression.

### Rejected — stretching regions consulting `getMaxSizeConstraint()` instead of `getMaxSize()`

`Border`'s region placement already commits the full region extent via `commitBounds` (no max clamp at the call site) — confirmed by reading [Border.ts:1037](../src/typescript/lib/layout/Border.ts#L1037) (WEST) and [Border.ts:1101](../src/typescript/lib/layout/Border.ts#L1101) (CENTER). The clamp happens *after*, inside the child's own `setHeight → clampHeight`. So there is no region-side read of `getMaxSize()` to redirect; the alternative targets the wrong layer.

### Table needs no change — already fills

`Table` extends `Component` and uses `TableLayout`, which does **not** override `LayoutManager.getMaxSize()` — it inherits the base `_defaultMaxSize` of `{UNBOUNDED, UNBOUNDED}` ([LayoutManager.ts:35](../src/typescript/lib/layout/LayoutManager.ts#L35), [:112](../src/typescript/lib/layout/LayoutManager.ts#L112)). So `Table.getMaxSize()` is already UNBOUNDED and `clampHeight` never caps it — a table already fills a stretching region. This matches the documented "`Table` opts out of size negotiation" stance. The user named tables out of caution; no Table edit is required. The plan adds an `## Expected Behaviour` case to **assert** Table fills, guarding against a future `TableLayout.getMaxSize` override silently reintroducing the cap.

---

## Public API (TypeScript Signatures)

No public API change. The edit adds a `protected` override of an existing `protected` method:

```ts
// AbstractCustomList
protected clampsToContentSize(): boolean; // returns false
```

No new option, no setter, no `XOptions` field — so the default-resolution invariant (ARCHITECTURE.md "Class-level defaults must survive the getter") and the `default-options-fallback.test.ts` registry are **not** engaged. `clampsToContentSize()` is a fixed class policy, not an option-backed value.

---

## Internal Structure

The override mirrors the existing ones verbatim in shape:

```ts
/**
 * Overrides {@link Component.clampsToContentSize} to `false`: a list fits the
 * space its parent's layout manager allocates — filling a stretching region
 * (a Border WEST/CENTER, a Fit/Box cell) rather than capping at its inner
 * VBox's content height — and scrolls the overflow via the inner panel's
 * `autoScroll`. Only an explicit {@link Component.setMaxSize} /
 * {@link Component.setMinSize} remains a hard ceiling or floor.
 *
 * @returns `false`, so size clamping uses the list's own explicit
 *   constraints only, not its content-derived ones.
 */
protected clampsToContentSize(): boolean {
    return false;
}
```

Place it among the other `protected` methods of `AbstractCustomList` (e.g. just after the field block, before the constructor, or beside `applyEnabled`/`applyReadOnly`), matching the file's existing ordering.

---

## Ordered Implementation Steps

1. **Add the override.** In [`AbstractCustomList.ts`](../src/typescript/lib/component/list/AbstractCustomList.ts), add the `protected clampsToContentSize(): boolean { return false; }` method with the JSDoc above. → verify: `grep -n clampsToContentSize src/typescript/lib/component/list/AbstractCustomList.ts` shows one definition.
2. **Write the behaviour tests first** (test-first, per the implement skill) in a new `tests/component/list/` or `tests/component/layout/` spec — see `## Expected Behaviour` for the enumerated cases. Run them against the unpatched class to confirm the WEST/CENTER cases fail at 288 (red), then with the override to confirm 400 (green).
3. **Regression sweep.** → verify: `npx vitest run tests/component/layout tests/component/list` (all green), then `npx vitest run` (full suite, 1222 tests green at plan time).
4. **No-op checkpoints.** → verify: `grep -rn "getMaxSize" src/typescript/lib/core/Component.ts` is unchanged (no edit to the merge logic); `grep -rn "clampsToContentSize" src/typescript/lib/component/table` returns nothing new (Table untouched).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/component/list/AbstractCustomList.ts` (add `clampsToContentSize()` override + JSDoc) |
| Create | A test spec under `tests/component/list/` (or `tests/component/layout/`) covering the `## Expected Behaviour` cases |

---

## Expected Behaviour

All cases below are **offline-testable** via the TestDOM geometry harness (`installTestDOM` + `Border` + real `List`, host `doLayout()`, then assert `getHeight()` / `getWidth()`), following the pattern in [`tests/component/layout/Border.test.ts`](../tests/component/layout/Border.test.ts). The reproduction was verified live with exactly this harness.

Host setup for each: a `Container` with a `Border` layout, `getElement(true)`, `setWidth(600)`, `setHeight(400)`, `clearInsets()`, one child added with the named `Placement`, then `host.doLayout()`.

1. **List fills a stretching WEST region.** A `List({ items })` with 13 items in a 400px-tall WEST region → `list.getHeight() === 400` (was 288). Cross-axis (width) follows the region's reserved width as before.
2. **List fills a CENTER region.** Same list in CENTER → `list.getHeight() === 400`.
3. **Explicit `maxSize` still caps.** `List({ items, maxSize: { width: 9999, height: 150 } })` in CENTER → `list.getHeight() === 150`. The author's hard ceiling is honoured.
4. **Explicit / region minimum still floors.** A single-item list in a 50px-tall CENTER region → `list.getHeight() >= 50` (the list also carries `setMinSize(100, 100)`; assert it does not collapse below the region or its own floor).
5. **`MultiSelectList` inherits the same fill behaviour.** The same WEST/CENTER fill assertion against `MultiSelectList` (subclass of `AbstractCustomList`) → fills to 400.
6. **A short list still fills (does not shrink-wrap below the region).** A 3-item list (content ~66px) in a 400px region → `getHeight() === 400`, confirming the change is "fill", not merely "uncap".
7. **`getMaxSize()` report is unchanged.** `list.getMaxSize().height` still reports the content-derived 288 (the *reporting* contract is untouched; only the *self-clamp* changed). Assert this so a future reader sees the report and the clamp are intentionally decoupled.
8. **Table already fills (guard, no Table code change).** A `Table` in a 400px CENTER region → fills to 400. This documents and protects the existing correct behaviour; if it ever regresses, a `TableLayout.getMaxSize` override is the likely culprit.

Edge / no-regression cases (covered by the existing suite, re-run rather than re-authored): embedded list in `ComboBox` / `AutoCompleteField` dropdowns (these passed full-suite under the override); list inside a scrolling `Panel` (the inner `autoScroll` still scrolls overflow).

---

## Verification

- **Typecheck:** `npx tsc --noEmit` (or the project's typecheck script) — clean.
- **Unit tests:** the new spec (cases 1–8 above) green; `npx vitest run tests/component/layout tests/component/list` green; full `npx vitest run` green (1222 tests at plan time).
- **Grep invariants:** `Component.ts` `getMaxSize`/`clampHeight`/`clampWidth` bodies unchanged; no new `clampsToContentSize` in `table/`.
- **Manual smoke (DOM, offline-untestable visuals):** open the demo screen that shows a `List` in a `Border` region (the List demo / the layout-demo panel) at `http://localhost:8015`; confirm the list visually fills its region top-to-bottom and that the inner rows scroll when there are more items than fit. Toggle theme to confirm no chrome regression.

---

## Documentation Impact

Internal behaviour change to a `protected` method — `clampsToContentSize()` is excluded from the TypeDoc public API, so no curated page or barrel export moves. No `{@link}` to internal symbols from public JSDoc (the override's JSDoc may `{@link Component.setMaxSize}` / `{@link Component.setMinSize}` — both public and documented, mirroring `Container`/`Cell`). One optional touch: the `AbstractCustomList` class JSDoc (or the `List` page under `docs/component/`) could note that a list fills its allocated region and scrolls overflow rather than shrink-wrapping — only if the implementer judges it consumer-relevant; not required.

`npm run docs:build` must finish with zero warnings (the lone acceptable notice is TypeDoc's "unsupported TypeScript version").

---

## Potential Challenges

- **Embedded lists in pickers.** `ComboBox` / `AutoCompleteField` host a `List` in a dropdown sized by the popup, not a stretching region — the override changes the self-clamp there too. Mitigation: the full suite (which exercises both) passes under the override; add no special-casing unless a picker test regresses.
- **A consumer relying on the old shrink-wrap.** Any caller that placed a bare `List` in an `Absolute`/`Anchor` cell expecting it to size to content will now fill the cell. Mitigation: `Absolute` places at preferred size (not fill), so the common shrink-wrap path is unaffected; the change only bites where a layout actively *stretches* the list, which is the desired fix.

---

## Critical Files

- [`src/typescript/lib/core/Component.ts`](../src/typescript/lib/core/Component.ts) — `clampsToContentSize()` (L2781), `clampWidth`/`clampHeight` (L2795/L2858), `getMaxSize`/`getMaxSizeConstraint` (L2366/L2284), `setHeight` (L2832). The mechanism; do not edit.
- [`src/typescript/lib/component/list/AbstractCustomList.ts`](../src/typescript/lib/component/list/AbstractCustomList.ts) — the edit site (L411 class); inner `Fit` + `VBox`/`autoScroll` structure (constructor ~L457–490).
- [`src/typescript/lib/core/Container.ts`](../src/typescript/lib/core/Container.ts#L49), [`Body.ts`](../src/typescript/lib/core/Body.ts#L90), [`table/cell/Cell.ts`](../src/typescript/lib/component/table/cell/Cell.ts#L100) — the existing `clampsToContentSize → false` overrides to mirror.
- [`src/typescript/lib/layout/Border.ts`](../src/typescript/lib/layout/Border.ts) — region placement (WEST L1004–1040, CENTER L1085–1103) committing the full extent; confirms the clamp is not here.
- [`src/typescript/lib/layout/LayoutManager.ts`](../src/typescript/lib/layout/LayoutManager.ts) — `commitBounds` (L417, no clamp), base `getMaxSize` / `_defaultMaxSize` (L112/L35) showing Table inherits UNBOUNDED.
- `ARCHITECTURE.md` lines 87–110 — the size-negotiation contract and the `clampsToContentSize()` switch.
- [`tests/component/layout/Border.test.ts`](../tests/component/layout/Border.test.ts) — TestDOM host/`doLayout`/measure pattern for the new spec.

---

## Non-Goals

- **No change to `Component.getMaxSize()` / `getMaxSizeConstraint()` or the merge `Math.min`.** The reporting contract stays; only the list's self-clamp policy changes.
- **No new `clampToFit` option or any new option field.** The existing `clampsToContentSize()` switch covers the need; a new option would duplicate it.
- **No edit to layout managers (`VBox`/`Fit`/`Border`/`Grid`/flows).** Their content-max reporting is correct and relied upon elsewhere.
- **No `Table` / `TableLayout` change.** Table already fills; only a guard test is added.
- **Not addressing the documented size-constraint invariant violation** (min ≤ preferred ≤ max) tracked in its own plan — this change must not regress it, but does not aim to fix it.
